import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import app from "../src/index";
import { sign } from "../src/community/crypto";
import { listUpdates, maintainUpdates, restoreUpdates, saveState, updateBridge, useUpdates } from "../src/updates";
import type { UpdateEntry } from "../shared/updates";
import type { Env } from "../src/types";
import { bearer, envWithAssets, identities, makeMember, resetDb, restoreUpstream } from "./helpers";

const HOUR = 3_600_000, DAY = 86_400_000;
/** 2026-10-05 21:00 台北：已過每日彙整的時間 */
const EVENING = Date.parse("2026-10-05T21:00:00+08:00");
const MORNING = Date.parse("2026-10-05T09:00:00+08:00");

const text = (zh: string) => ({ "zh-Hant": zh, "zh-Hans": zh + "（简）", en: `EN ${zh}`, ja: `JA ${zh}`, ko: `KO ${zh}` });
const entry = (id: string, over: Partial<UpdateEntry> = {}): UpdateEntry => ({
  id, tier: "feature", audience: "everyone", try: "/", spotlight: [], reports: [], announce: 1, draft: false, live: null,
  title: text(`標題 ${id}`), body: null, ...over,
});
let build = 0;
const use = (...entries: UpdateEntry[]) => useUpdates(entries, `test-${++build}-${Math.random()}`);

const settings = () => ({ ...env, COMMUNITY_ENABLED: "true", COMMUNITY_SITE_URL: "https://sukisuki.ai", COMMUNITY_GUILD_ID: "123456789012345678", COMMUNITY_BRIDGE_KEY: "a".repeat(64) }) as Env;
async function bridge(op: string, value: Record<string, unknown> = {}) {
  const path = "/internal/community/" + op, time = String(Date.now()), nonce = crypto.randomUUID(), body = JSON.stringify({ guild: settings().COMMUNITY_GUILD_ID, ...value });
  const ctx = createExecutionContext();
  const res = await app.fetch(new Request("https://sukisuki.ai" + path, { method: "POST", body, headers: { "X-Community-Time": time, "X-Community-Nonce": nonce, "X-Community-Signature": await sign(settings().COMMUNITY_BRIDGE_KEY!, "POST", path, time, nonce, body) } }), settings(), ctx);
  await waitOnExecutionContext(ctx);
  return res;
}
async function get(path: string, init: RequestInit = {}, e: Env = env as Env) {
  const ctx = createExecutionContext();
  const res = await app.fetch(new Request("https://sukisuki.ai" + path, init), e, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}
const json = async (r: Response) => (await r.json()) as any;

beforeEach(async () => { await resetDb(); });
afterEach(() => { restoreUpdates(); restoreUpstream(); });

describe("上線登記", () => {
  it("沒見過的說明記下第一次上線的時間；回填的用 live 那天中午；草稿不登記", async () => {
    use(entry("2026-10-05-new"), entry("2026-10-04-old", { live: "2026-10-04" }), entry("2026-10-05-draft", { draft: true }));
    const now = EVENING;
    const r = await listUpdates(env as Env, "zh-Hant", "full", now);
    expect(r.items.map((i) => i.id)).toEqual(["2026-10-05-new", "2026-10-04-old"]);
    expect(r.items[0]!.liveAt).toBe(now);
    expect(r.items[1]!.liveAt).toBe(Date.parse("2026-10-04T12:00:00+08:00"));
    const rows = await env.DB.prepare("SELECT id FROM update_entries ORDER BY id").all();
    expect(rows.results.map((x) => x.id)).toEqual(["2026-10-04-old", "2026-10-05-new"]);
  });

  it("同一則說明不會因為重新部署而換上線時間；announce 加一才重新公告", async () => {
    use(entry("2026-10-05-a"));
    await listUpdates(env as Env, "zh-Hant", "full", EVENING - DAY);
    use(entry("2026-10-05-a", { title: text("改了字") }));
    let r = await listUpdates(env as Env, "zh-Hant", "full", EVENING);
    expect(r.items[0]).toMatchObject({ liveAt: EVENING - DAY, announcedAt: EVENING - DAY, title: "改了字" });
    use(entry("2026-10-05-a", { announce: 2 }));
    r = await listUpdates(env as Env, "zh-Hant", "full", EVENING);
    expect(r.items[0]).toMatchObject({ liveAt: EVENING - DAY, announcedAt: EVENING });
  });

  it("不在這次 build 裡的說明（回滾、刪檔）哪裡都看不到，回來時沿用原本的時間", async () => {
    use(entry("2026-10-05-a"), entry("2026-10-05-b"));
    await listUpdates(env as Env, "zh-Hant", "full", EVENING - HOUR);
    use(entry("2026-10-05-b"));
    expect((await listUpdates(env as Env, "zh-Hant", "full", EVENING)).items.map((i) => i.id)).toEqual(["2026-10-05-b"]);
    use(entry("2026-10-05-a"), entry("2026-10-05-b"));
    const back = await listUpdates(env as Env, "zh-Hant", "full", EVENING + DAY);
    expect(back.items.find((i) => i.id === "2026-10-05-a")!.liveAt).toBe(EVENING - HOUR);
  });

  it("連到回報案件的說明排進通知佇列；回填超過兩天的不排", async () => {
    const kase = "0123456789abcdef01234567", old = "abcdefabcdefabcdefabcdef";
    use(entry("2026-10-05-a", { reports: [kase] }), entry("2026-09-22-b", { live: "2026-09-22", reports: [old] }));
    await listUpdates(env as Env, "zh-Hant", "full", EVENING);
    const rows = await env.DB.prepare("SELECT entry_id,case_id,state FROM update_reports").all();
    expect(rows.results).toEqual([{ entry_id: "2026-10-05-a", case_id: kase, state: "pending" }]);
  });
});

describe("GET /v1/updates", () => {
  it("摘要只給最近兩週、不帶說明；完整版帶說明；文字照語言；可以公開快取", async () => {
    use(entry("2026-10-05-a", { body: text("說明") }), entry("2026-09-01-old", { live: "2026-09-01", tier: "fix", try: null }));
    const summary = await get("/v1/updates?lang=ja");
    expect(summary.headers.get("Cache-Control")).toContain("public");
    const s = await json(summary);
    expect(s.items.map((i: any) => i.id)).toEqual(["2026-10-05-a"]);
    expect(s.items[0]).toMatchObject({ title: "JA 標題 2026-10-05-a", body: null, tier: "feature", try: "/" });
    const full = await json(await get("/v1/updates?lang=zh-Hans&view=full"));
    expect(full.items.map((i: any) => i.id)).toEqual(["2026-10-05-a", "2026-09-01-old"]);
    expect(full.items[0].body).toBe("說明（简）");
    expect(full.stats).toEqual({ features: 1, fixes: 0, days: 30 });
  });

  it("不認得的語言用繁中", async () => {
    use(entry("2026-10-05-a"));
    expect((await json(await get("/v1/updates?lang=fr"))).items[0].title).toBe("標題 2026-10-05-a");
  });
});

describe("已讀狀態", () => {
  it("要登入；第一次是空的；兩台裝置合併時看過的時間取較晚、用過的入口取聯集", async () => {
    identities({ reader: 30001 });
    await makeMember(30001);
    expect((await get("/v1/me/updates/state")).status).toBe(401);
    const read = async () => json(await get("/v1/me/updates/state", { headers: bearer("reader") }));
    expect(await read()).toEqual({ state: null });
    const put = (body: unknown) => get("/v1/me/updates/state", { method: "PUT", headers: { "Content-Type": "application/json", ...bearer("reader") }, body: JSON.stringify(body) });
    expect((await put({ seenThrough: 2000, stripClosedAt: 1500, stripDays: 2, stripDay: "2026-10-05", spotlights: ["header.bell"] })).status).toBe(200);
    const merged = await json(await put({ seenThrough: 1000, stripClosedAt: 1800, stripDays: 0, stripDay: "", spotlights: ["menu.updates", "BAD KEY", 7] }));
    expect(merged.state).toEqual({ seenThrough: 2000, stripClosedAt: 1800, stripDays: 0, stripDay: "", spotlights: ["header.bell", "menu.updates"] });
    expect((await read()).state).toEqual(merged.state);
  });

  it("未來的時間與奇怪的數字不收", async () => {
    const member = await makeMember(30002);
    const s = await saveState(env as Env, member, { seenThrough: EVENING + 10 * DAY, stripDays: -1, stripDay: "tomorrow" }, EVENING);
    expect(s).toMatchObject({ seenThrough: 0, stripDays: 0, stripDay: "" });
  });
});

describe("每日彙整", () => {
  const digests = () => env.DB.prepare("SELECT day,entry_ids,revision FROM update_digests ORDER BY day").all<{ day: string; entry_ids: string; revision: number }>();

  it("台北晚上八點前不建；之後把上次彙整後公告的說明收成一則，重點排前面", async () => {
    use(entry("2026-10-05-a"), entry("2026-10-05-hl", { tier: "highlight" }), entry("2026-10-05-fix", { tier: "fix", try: null }));
    await listUpdates(env as Env, "zh-Hant", "full", MORNING);
    await maintainUpdates(env as Env, MORNING + HOUR);
    expect((await digests()).results).toEqual([]);
    await maintainUpdates(env as Env, EVENING);
    const d = (await digests()).results;
    expect(d).toHaveLength(1);
    expect(d[0]!.day).toBe("2026-10-05");
    expect(JSON.parse(d[0]!.entry_ids)).toEqual(["2026-10-05-hl", "2026-10-05-a", "2026-10-05-fix"]);
    await maintainUpdates(env as Env, EVENING + HOUR);
    expect((await digests()).results).toHaveLength(1);
  });

  it("只有一則一般更新時等隔天；最多等三天", async () => {
    use(entry("2026-10-05-a"));
    await listUpdates(env as Env, "zh-Hant", "full", MORNING);
    await maintainUpdates(env as Env, EVENING);
    expect((await digests()).results).toEqual([]);
    await maintainUpdates(env as Env, EVENING + DAY);
    expect((await digests()).results).toEqual([]);
    await maintainUpdates(env as Env, EVENING + 3 * DAY);
    expect((await digests()).results.map((d) => d.day)).toEqual(["2026-10-08"]);
  });

  it("一則重點就夠發；隔天只收新上線的", async () => {
    use(entry("2026-10-05-hl", { tier: "highlight" }));
    await listUpdates(env as Env, "zh-Hant", "full", MORNING);
    await maintainUpdates(env as Env, EVENING);
    use(entry("2026-10-05-hl", { tier: "highlight" }), entry("2026-10-06-a"), entry("2026-10-06-b"));
    await listUpdates(env as Env, "zh-Hant", "full", MORNING + DAY);
    await maintainUpdates(env as Env, EVENING + DAY);
    const d = (await digests()).results;
    expect(d.map((x) => [x.day, JSON.parse(x.entry_ids)])).toEqual([["2026-10-05", ["2026-10-05-hl"]], ["2026-10-06", ["2026-10-06-b", "2026-10-06-a"]]]);
  });

  it("48 小時內說明改了字或被撤下，revision 加一；之後不再動", async () => {
    use(entry("2026-10-05-hl", { tier: "highlight" }), entry("2026-10-05-a"));
    await listUpdates(env as Env, "zh-Hant", "full", MORNING);
    await maintainUpdates(env as Env, EVENING);
    use(entry("2026-10-05-hl", { tier: "highlight", title: text("新的字") }), entry("2026-10-05-a"));
    await maintainUpdates(env as Env, EVENING + HOUR);
    expect((await digests()).results[0]!.revision).toBe(2);
    use(entry("2026-10-05-hl", { tier: "highlight", title: text("新的字") }));
    await maintainUpdates(env as Env, EVENING + 2 * HOUR);
    expect((await digests()).results[0]!.revision).toBe(3);
    use(entry("2026-10-05-hl", { tier: "highlight", title: text("太晚了") }));
    await maintainUpdates(env as Env, EVENING + 3 * DAY);
    expect((await digests()).results[0]!.revision).toBe(3);
  });
});

describe("機器人送出彙整", () => {
  async function ready() {
    use(entry("2026-10-05-hl", { tier: "highlight" }), entry("2026-10-05-a"), entry("2026-10-05-fix", { tier: "fix", try: null }));
    await listUpdates(env as Env, "zh-Hant", "full", MORNING);
    await maintainUpdates(env as Env, EVENING);
  }
  const call = (op: string, b: Record<string, unknown>, now = EVENING) => updateBridge(env as Env, op, b, now) as Promise<any>;
  const CHANNEL = "111111111111111111", MESSAGE = "222222222222222222";

  it("列出要送的語言；拿到已經翻好、帶連結的內容；回報之後就不再列", async () => {
    await ready();
    const p = await call("update-pending", { locales: ["en", "ja", "xx"] });
    expect(p.digests).toEqual([{ day: "2026-10-05", locale: "en" }, { day: "2026-10-05", locale: "ja" }]);
    const job = await call("update-project", { day: "2026-10-05", locale: "en", channel: CHANNEL });
    expect(job.messageId).toBeNull();
    expect(job.digest.heading).toBe("What's new on Hearthroom, Oct 5");
    expect(job.digest.url).toBe("https://sukisuki.ai/en/updates?from=discord&day=2026-10-05");
    expect(job.digest.items).toEqual([
      { tier: "highlight", title: "EN 標題 2026-10-05-hl", url: "https://sukisuki.ai/en/updates?from=discord#2026-10-05-hl" },
      { tier: "feature", title: "EN 標題 2026-10-05-a", url: "https://sukisuki.ai/en/updates?from=discord#2026-10-05-a" },
    ]);
    expect(job.digest.fixes).toEqual([{ title: "EN 標題 2026-10-05-fix", url: "https://sukisuki.ai/en/updates?from=discord#2026-10-05-fix" }]);
    await expect(call("update-project", { day: "2026-10-05", locale: "en", channel: CHANNEL })).rejects.toThrow("update_delivery_busy");
    expect(await call("update-ack", { day: "2026-10-05", locale: "en", lease: job.lease, revision: job.revision, channel: CHANNEL, messageId: MESSAGE })).toEqual({ accepted: true });
    expect((await call("update-pending", { locales: ["en"] })).digests).toEqual([]);
  });

  it("內容改了就再列一次，並交回原訊息讓機器人編輯", async () => {
    await ready();
    const job = await call("update-project", { day: "2026-10-05", locale: "zh-Hant", channel: CHANNEL });
    await call("update-ack", { day: "2026-10-05", locale: "zh-Hant", lease: job.lease, revision: job.revision, channel: CHANNEL, messageId: MESSAGE });
    use(entry("2026-10-05-hl", { tier: "highlight", title: text("改過") }), entry("2026-10-05-a"), entry("2026-10-05-fix", { tier: "fix", try: null }));
    expect((await call("update-pending", { locales: ["zh-Hant"] }, EVENING + HOUR)).digests).toEqual([{ day: "2026-10-05", locale: "zh-Hant" }]);
    const again = await call("update-project", { day: "2026-10-05", locale: "zh-Hant", channel: CHANNEL }, EVENING + HOUR);
    expect(again.messageId).toBe(MESSAGE);
    expect(again.digest.items[0].title).toBe("改過");
    expect((await call("update-project", { day: "2026-10-05", locale: "zh-Hant", channel: CHANNEL }, EVENING + HOUR + 10_000).catch((e) => e)).message).toBe("update_delivery_busy");
    // 頻道換了：原訊息不在新頻道裡，機器人要發新的
    const moved = await call("update-project", { day: "2026-10-05", locale: "zh-Hant", channel: "333333333333333333" }, EVENING + 2 * HOUR);
    expect(moved.messageId).toBeNull();
  });

  it("送出途中內容又變了：記住訊息，回報不算數，下一輪再編輯", async () => {
    await ready();
    const job = await call("update-project", { day: "2026-10-05", locale: "zh-Hant", channel: CHANNEL });
    use(entry("2026-10-05-hl", { tier: "highlight", title: text("中途改") }), entry("2026-10-05-a"));
    await maintainUpdates(env as Env, EVENING + 1000);
    expect(await call("update-ack", { day: "2026-10-05", locale: "zh-Hant", lease: job.lease, revision: job.revision, channel: CHANNEL, messageId: MESSAGE }, EVENING + 2000)).toEqual({ accepted: false });
    const next = await call("update-project", { day: "2026-10-05", locale: "zh-Hant", channel: CHANNEL }, EVENING + 3000);
    expect(next.messageId).toBe(MESSAGE);
    expect(next.digest.fixes).toEqual([]);
  });

  it("送失敗等一分鐘再試；全部撤下時給空內容，機器人刪掉後回報", async () => {
    await ready();
    const job = await call("update-project", { day: "2026-10-05", locale: "ko", channel: CHANNEL });
    expect(await call("update-ack", { day: "2026-10-05", locale: "ko", lease: job.lease, revision: job.revision, failed: true })).toEqual({ accepted: true });
    expect((await call("update-pending", { locales: ["ko"] })).digests).toEqual([]);
    expect((await call("update-pending", { locales: ["ko"] }, EVENING + 61_000)).digests).toHaveLength(1);
    use();
    const gone = await call("update-project", { day: "2026-10-05", locale: "ko", channel: CHANNEL }, EVENING + 120_000);
    expect(gone.digest.items).toEqual([]);
    expect(gone.digest.fixes).toEqual([]);
    expect(await call("update-ack", { day: "2026-10-05", locale: "ko", lease: gone.lease, revision: gone.revision, channel: CHANNEL, deleted: true }, EVENING + 121_000)).toEqual({ accepted: true });
  });

  it("超過 48 小時的彙整不再列", async () => {
    await ready();
    expect((await call("update-pending", { locales: ["en"] }, EVENING + 49 * HOUR)).digests).toEqual([]);
  });

  it("透過簽章的社群通道呼叫，伺服器要對", async () => {
    use(entry("2026-10-05-a"));
    const res = await bridge("update-pending", { locales: ["zh-Hant"] });
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ version: 1, reports: [] });
  });
});

describe("回報者通知", () => {
  const KASE = "0123456789abcdef01234567", REPORTER = "323456789012345678";
  async function linked(member: string) {
    await env.DB.prepare("INSERT INTO community_subjects(discord_id) VALUES(?)").bind(REPORTER).run();
    await env.DB.prepare("INSERT INTO discord_links(member_id,discord_id,name,state,version,created_at) VALUES(?,?,?,?,?,?)").bind(member, REPORTER, "Reporter", "active", "v1", Date.now()).run();
  }
  const call = (op: string, b: Record<string, unknown>, now = EVENING) => updateBridge(env as Env, op, b, now) as Promise<any>;

  it("具名回報：送達後在綁定的會員鈴鐺裡留一則，標題照會員的語言", async () => {
    identities({ reporter: 40001 });
    const member = await makeMember(40001);
    await linked(member);
    use(entry("2026-10-05-a", { reports: [KASE] }));
    expect((await call("update-pending", { locales: [] })).reports).toEqual([{ entry: "2026-10-05-a", case: KASE }]);
    const r = await call("update-report", { entry: "2026-10-05-a", case: KASE });
    expect(r).toMatchObject({ entry: "2026-10-05-a", case: KASE, url: "https://sukisuki.ai/updates#2026-10-05-a" });
    expect(r.titles.en).toBe("EN 標題 2026-10-05-a");
    expect(await call("update-report-ack", { entry: "2026-10-05-a", case: KASE, outcome: "delivered", reporter: REPORTER })).toEqual({ accepted: true });
    expect((await call("update-pending", { locales: [] })).reports).toEqual([]);
    const notices = await json(await get("/v1/me/community/notifications?lang=ja", { headers: bearer("reporter") }));
    expect(notices.items).toHaveLength(1);
    expect(notices.items[0]).toMatchObject({ kind: "report_shipped", path: "/updates#2026-10-05-a", extra: { entry: "2026-10-05-a", title: "JA 標題 2026-10-05-a" } });
  });

  it("匿名回報不帶身分，就不寫鈴鐺；關了通知的人也不寫", async () => {
    const member = await makeMember(40002);
    await linked(member);
    use(entry("2026-10-05-a", { reports: [KASE] }), entry("2026-10-05-b", { reports: [KASE] }));
    await call("update-report-ack", { entry: "2026-10-05-a", case: KASE, outcome: "delivered" });
    await env.DB.prepare("INSERT INTO community_preferences(member_id,notifications) VALUES(?,0)").bind(member).run();
    await call("update-report-ack", { entry: "2026-10-05-b", case: KASE, outcome: "delivered", reporter: REPORTER });
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM community_notifications WHERE kind='report_shipped'").first<{ n: number }>();
    expect(n!.n).toBe(0);
  });

  it("送不出去就十分鐘後再試，第六次放棄；找不到案件直接放棄", async () => {
    use(entry("2026-10-05-a", { reports: [KASE] }), entry("2026-10-05-b", { reports: ["fedcbafedcbafedcbafedcba"] }));
    await listUpdates(env as Env, "zh-Hant", "full", EVENING);
    for (let i = 0; i < 6; i++) await call("update-report-ack", { entry: "2026-10-05-a", case: KASE, outcome: "failed" }, EVENING + i * DAY);
    await call("update-report-ack", { entry: "2026-10-05-b", case: "fedcbafedcbafedcbafedcba", outcome: "missing" });
    const rows = await env.DB.prepare("SELECT entry_id,state,attempts FROM update_reports ORDER BY entry_id").all();
    expect(rows.results).toEqual([{ entry_id: "2026-10-05-a", state: "missing", attempts: 6 }, { entry_id: "2026-10-05-b", state: "missing", attempts: 0 }]);
    await expect(call("update-report", { entry: "2026-10-05-a", case: KASE })).rejects.toThrow("not_found");
  });
});

describe("Atom、頁面與指標", () => {
  it("每種語言一份 feed，連結帶語言前綴", async () => {
    use(entry("2026-10-05-a", { body: text("<說明>") }));
    const zh = await get("/updates.atom");
    expect(zh.headers.get("Content-Type")).toContain("application/atom+xml");
    const body = await zh.text();
    expect(body).toContain("<title>Hearthroom 更新紀錄</title>");
    expect(body).toContain("<link href=\"https://sukisuki.ai/updates#2026-10-05-a\"/>");
    expect(body).toContain("&lt;說明&gt;");
    const en = await (await get("/en/updates.atom")).text();
    expect(en).toContain("https://sukisuki.ai/en/updates#2026-10-05-a");
    expect(en).toContain("EN 標題 2026-10-05-a");
  });

  it("更新頁的 <head> 寫著這一頁是什麼", async () => {
    const res = await get("/ja/updates", {}, envWithAssets({}) as Env);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<meta property="og:title" content="Hearthroom の更新履歴">');
    expect(html).toContain('<link rel="canonical" href="https://sukisuki.ai/ja/updates">');
  });

  it("/metrics 數得到登記與彙整", async () => {
    use(entry("2026-10-05-hl", { tier: "highlight" }));
    await listUpdates(env as Env, "zh-Hant", "full", MORNING);
    await maintainUpdates(env as Env, EVENING);
    const text = await (await get("/metrics")).text();
    expect(text).toContain('hearthroom_updates_operations_total{operation="register",outcome="success"} 1');
    expect(text).toContain('hearthroom_updates_operations_total{operation="digest_build",outcome="success"} 1');
  });
});
