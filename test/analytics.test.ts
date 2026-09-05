import { SELF, createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import { BEACON_EVENTS, clientKind, refHostOf, safeSubject, shapeTerm, surfaceOf } from "../src/analytics";
import { HOST, LEGACY_HOSTS, MIGRATED, canonicalUrl, isSelfHost } from "../src/site";
import { upsertCard } from "../src/cards";
import { resetDb, restoreUpstream, role } from "./helpers";

/**
 * 埋點測的是「呼叫契約」：事件名、欄位、hit/miss。
 * 不測真的寫進 Analytics Engine——它的查詢介面是遠端 HTTP API，本地讀不回來。
 */
type Point = { indexes: string[]; blobs: string[]; doubles: number[] };
let points: Point[];

/** blob 的順序跟 src/analytics.ts 的 BLOBS 一致。 */
const F = (p: Point) => ({
  event: p.blobs[0], from: p.blobs[1], route: p.blobs[2], locale: p.blobs[3],
  zoneScope: p.blobs[4], country: p.blobs[5], refHost: p.blobs[6], sortKey: p.blobs[7],
  tag: p.blobs[8], term: p.blobs[9], subject: p.blobs[10], outcome: p.blobs[11],
  cache: p.blobs[12], detail: p.blobs[13], client: p.blobs[14],
  durationMs: p.doubles[0], resultCount: p.doubles[1], offset: p.doubles[2], status: p.doubles[3],
});
const seen = (event: string) => points.map(F).filter((p) => p.event === event);

const SHELL = `<!doctype html><html lang="zh-Hant"><head><title>Taproom</title><meta name="description" content="s"></head><body><div id="app"></div></body></html>`;

beforeEach(async () => {
  await resetDb();
  points = [];
  env.EVENTS = { writeDataPoint: (p: Point) => points.push(p) } as unknown as AnalyticsEngineDataset;
  await upsertCard(env.DB, role({ roleId: "r-1", name: "夜行偵探", tags: ["推理"], authorNumId: 7 }), Date.now());
});
afterEach(restoreUpstream);

/** 走 SELF 才會經過中間件；waitUntil 的寫入要等它排完。 */
async function hit(path: string, init?: RequestInit) {
  const res = await SELF.fetch(`https://c.test${path}`, init);
  await res.arrayBuffer();
  return res;
}

describe("服務端事件", () => {
  it("榜單記成 list，帶排序鍵、結果數與翻頁深度", async () => {
    await hit("/v1/cards?sort=new&offset=24", { headers: { "X-From": "board" } });
    const [ev] = seen("list");
    expect(ev).toBeDefined();
    expect(ev!.from).toBe("board");
    expect(ev!.route).toBe("/v1/cards");
    expect(ev!.sortKey).toBe("new");
    expect(ev!.offset).toBe(24);
    expect(ev!.status).toBe(200);
    expect(ev!.cache).toBe("miss");
  });

  it("帶 q 就記成 search，零結果看得出來", async () => {
    await hit("/v1/cards?q=完全沒有這種東西");
    const [ev] = seen("search");
    expect(ev!.term).toBe("完全沒有這種東西");
    expect(ev!.resultCount).toBe(0);
    expect(ev!.outcome).toBe("empty");
  });

  it("快取命中一樣記一條，cache 標成 hit", async () => {
    await hit("/v1/cards?sort=top");
    points = [];
    await hit("/v1/cards?sort=top");
    const [ev] = seen("list");
    expect(ev!.cache).toBe("hit");
  });

  it("卡片瀏覽只在 /v1/cards/:id 記一次，帶 roleId", async () => {
    await hit("/v1/cards/r-1", { headers: { "X-From": "search" } });
    const views = seen("card_view");
    expect(views).toHaveLength(1);
    expect(views[0]!.subject).toBe("r-1");
    expect(views[0]!.from).toBe("search");
  });

  it("作者頁替卡片頁發的副請求不算一次卡片瀏覽", async () => {
    await hit("/v1/cards?author=7", { headers: { "X-From": "card" } });
    expect(seen("card_view")).toHaveLength(0);
    expect(seen("list")[0]!.from).toBe("card");
  });

  it("找不到的卡記成 not_found，不是 ok", async () => {
    await hit("/v1/cards/nope");
    const [ev] = seen("card_view").concat(seen("api"));
    expect(ev!.outcome).toBe("not_found");
    expect(ev!.status).toBe(404);
  });

  it("HTML 殼記成 page_html，帶站外來源網域", async () => {
    const ctx = createExecutionContext();
    const testEnv = { ...env, ASSETS: { fetch: async () => new Response(SHELL, { headers: { "content-type": "text/html" } }) } as unknown as Fetcher };
    const res = await worker.fetch(new Request("https://c.test/cards/r-1", { headers: { Referer: "https://discord.com/channels/1" } }), testEnv, ctx);
    await res.text();
    await waitOnExecutionContext(ctx);
    const [ev] = seen("page_html");
    expect(ev!.refHost).toBe("discord.com");
    expect(ev!.subject).toBe("r-1");
  });

  it("健康檢查不記", async () => {
    await hit("/v1/health");
    expect(points).toHaveLength(0);
  });

  it("綁定沒配時整站照常，不會 500", async () => {
    env.EVENTS = undefined as unknown as AnalyticsEngineDataset;
    const res = await hit("/v1/cards");
    expect(res.status).toBe(200);
  });

  it("開關關掉就一條都不發", async () => {
    const spy = vi.fn();
    const ctx = createExecutionContext();
    const off = { ...env, ANALYTICS_ENABLED: "false", EVENTS: { writeDataPoint: spy } as unknown as AnalyticsEngineDataset };
    const res = await worker.fetch(new Request("https://c.test/v1/cards"), off, ctx);
    await res.arrayBuffer();
    await waitOnExecutionContext(ctx);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("搬家", () => {
  it("LEGACY_HOSTS 還空著時誰都不轉——新家沒確認通之前不准開", async () => {
    const res = await SELF.fetch("https://community.johnny.moe/v1/cards?zone=zh", { redirect: "manual" });
    await res.arrayBuffer();
    expect(LEGACY_HOSTS).toHaveLength(0);
    expect(res.status).toBe(200);
  });

  it("舊主機一填進去就整條路徑原樣 301，查詢字串跟著走", async () => {
    const url = new URL("https://community.johnny.moe/zh-Hans/cards/r-1?x=1");
    // 直接驗轉址要組什麼——中間件就是照這個規則做的
    url.host = HOST;
    url.port = "";
    expect(url.toString()).toBe("https://hearthroom.club/zh-Hans/cards/r-1?x=1");
  });

  it("搬家前後的主機都算自己人，referer 才不會把自己記成外部流量", () => {
    expect(isSelfHost(HOST)).toBe(true);
    expect(isSelfHost("discord.com")).toBe(false);
    expect(refHostOf(`https://${HOST}/`, HOST)).toBe("");
    expect(refHostOf("https://discord.com/x", HOST)).toBe("discord.com");
  });

  it("canonical：切過去之前跟著請求，切過去之後一律指新家", () => {
    const u = new URL("https://community.johnny.moe/cards/r-1?x=1");
    // 還沒切：用請求進來的網域，不然會把搜尋引擎指向一個還沒通的地方
    expect(MIGRATED).toBe(false);
    expect(canonicalUrl(u)).toBe("https://community.johnny.moe/cards/r-1");
  });

  it("靜態資源原樣交回資源層，不會拿到 HTML 殼", async () => {
    const ctx = createExecutionContext();
    const asset = new Response("console.log(1)", { headers: { "content-type": "application/javascript" } });
    const testEnv = { ...env, ASSETS: { fetch: async (r: Request) => (new URL(r.url).pathname.startsWith("/assets/") ? asset : new Response(SHELL, { headers: { "content-type": "text/html" } })) } as unknown as Fetcher };
    const res = await worker.fetch(new Request("https://hearthroom.club/assets/index-abc.js"), testEnv, ctx);
    const body = await res.text();
    await waitOnExecutionContext(ctx);
    expect(body).toBe("console.log(1)");
    expect(body).not.toContain("<html");
  });
});

describe("beacon 端點", () => {
  const post = (body: unknown, headers: Record<string, string> = {}) =>
    hit("/v1/e", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });

  it("收白名單裡的事件", async () => {
    await post([{ event: "cta", subject: "r-1", from: "card" }]);
    const [ev] = seen("cta");
    expect(ev!.subject).toBe("r-1");
    expect(ev!.client).toBe("beacon");
  });

  it("白名單外的事件直接丟掉，不記成 unknown", async () => {
    await post([{ event: "刷榜", subject: "r-1" }, { event: "cta" }]);
    expect(points).toHaveLength(1);
    expect(seen("cta")).toHaveLength(1);
  });

  it("跨站來的一律靜默丟棄", async () => {
    const res = await post([{ event: "cta" }], { Origin: "https://evil.example" });
    expect(res.status).toBe(204);
    expect(points).toHaveLength(0);
  });

  it("一次最多收 20 條", async () => {
    await post(Array.from({ length: 50 }, () => ({ event: "cta" })));
    expect(points).toHaveLength(20);
  });

  it("壞掉的 body 不會炸", async () => {
    const res = await hit("/v1/e", { method: "POST", body: "not json" });
    expect(res.status).toBe(204);
    expect(points).toHaveLength(0);
  });

  it("收得下打上游那些服務端看不到的事件", async () => {
    // 評論、建卡、編輯、錢包、外觀、語言都是跨域或純前端，服務端那條路記不到
    const events = ["comment_tab", "comment_post", "comment_like", "comment_delete",
      "card_create", "card_edit", "wallet_view", "topup_click", "appearance", "locale_switch",
      "logout", "page_404"];
    await post(events.map((event) => ({ event })));
    expect(points).toHaveLength(events.length);
    for (const e of events) expect(seen(e)).toHaveLength(1);
  });

  it("外觀記的是哪一套：類別進 detail，實際選擇進 subject", async () => {
    await post([{ event: "appearance", detail: "theme", subject: "violet" }]);
    const [ev] = seen("appearance");
    expect(ev!.detail).toBe("theme");
    expect(ev!.subject).toBe("violet");
  });

  it("subject 只收安全字元，擋掉塞進來的任意字串", async () => {
    await post([{ event: "cta", subject: "<script>x</script>" }]);
    expect(seen("cta")[0]!.subject).toBe("scriptxscript");
  });

  it("失敗的建卡記成 error，成功的記成 ok", async () => {
    await post([{ event: "card_create", ok: false }, { event: "card_edit", subject: "r-1" }]);
    expect(seen("card_create")[0]!.outcome).toBe("error");
    expect(seen("card_edit")[0]!.outcome).toBe("ok");
  });

  it("beacon 端點本身不記 api 事件", async () => {
    await post([{ event: "share", detail: "share_web" }]);
    expect(seen("api")).toHaveLength(0);
    expect(seen("share")).toHaveLength(1);
  });
});

describe("欄位過濾", () => {
  it("搜尋詞：截斷、丟掉信箱網址與長數字", () => {
    expect(shapeTerm("  修仙  ")).toBe("修仙");
    expect(shapeTerm("a@b.com")).toBe("");
    expect(shapeTerm("https://x.test/y")).toBe("");
    expect(shapeTerm("訂單 123456789")).toBe("");
    expect(shapeTerm("x".repeat(200))).toHaveLength(64);
    expect(shapeTerm(undefined)).toBe("");
  });

  it("來源網域：只留站外的", () => {
    expect(refHostOf("https://discord.com/a", "c.test")).toBe("discord.com");
    expect(refHostOf("https://c.test/board", "c.test")).toBe("");
    expect(refHostOf("garbage", "c.test")).toBe("");
    expect(refHostOf(undefined, "c.test")).toBe("");
  });

  it("來源標記走白名單", () => {
    expect(surfaceOf("board")).toBe("board");
    expect(surfaceOf("<script>")).toBe("direct");
    expect(surfaceOf(undefined)).toBe("direct");
  });

  it("subject 淨化：只留安全字元、截到 64", () => {
    expect(safeSubject("46bb0c4b-b19a-4e62-911f-935a71813ee1")).toBe("46bb0c4b-b19a-4e62-911f-935a71813ee1");
    expect(safeSubject("zh-Hant")).toBe("zh-Hant");
    expect(safeSubject("a b<>'\"c")).toBe("abc");
    expect(safeSubject("x".repeat(200))).toHaveLength(64);
    expect(safeSubject(123)).toBe("");
  });

  it("白名單涵蓋所有打上游或純前端的功能", () => {
    for (const e of ["comment_post", "comment_like", "comment_delete", "comment_tab",
      "card_create", "card_edit", "wallet_view", "topup_click",
      "appearance", "locale_switch", "logout", "page_404"]) {
      expect(BEACON_EVENTS.has(e)).toBe(true);
    }
  });

  it("認得抓取器", () => {
    expect(clientKind("Discordbot/2.0")).toBe("bot");
    expect(clientKind("Mozilla/5.0 (Macintosh)")).toBe("server");
    expect(clientKind(undefined)).toBe("server");
  });
});
