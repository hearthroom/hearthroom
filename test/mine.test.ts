import { ensureCardNumber } from "../src/cards";
import { SELF, env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  bearer,
  identities,
  myRolesOnUpstream,
  resetDb,
  restoreUpstream,
  rolesOnMainSite,
  upstreamCalls,
  whoAmI,
} from "./helpers";

const mine = async (query = "", token = "alice-token") => {
  const res = await SELF.fetch(`https://c.test/v1/me/cards${query}`, { headers: bearer(token) });
  return { status: res.status, cache: res.headers.get("X-Cache"), body: (await res.json()) as any };
};

beforeEach(async () => {
  await resetDb();
  identities({ "alice-token": 10001, "bob-token": 20002 });
  myRolesOnUpstream({
    "alice-token": [{ roleId: "a1", name: "愛麗絲的卡" }, { roleId: "a2", name: "第二張" }],
    "bob-token": [{ roleId: "b1", name: "鮑伯的卡" }],
  });
});
afterEach(restoreUpstream);

describe("我的卡片", () => {
  it("回傳自己的卡，並標出哪些已登記", async () => {
    await env.DB.prepare(
      `INSERT INTO cards (id, source_role_id, author_num_id, names, summaries, tags, search_text, registered_at, last_synced_at,provider)
       VALUES (?,'a1',10001,'{}','{}','[]','',1,1,'harbor')`,
    ).bind(await ensureCardNumber(env.DB,'harbor','a1')).run();

    const { status, body } = await mine();
    expect(status).toBe(200);
    expect(body.items.map((i: any) => [i.roleId, i.registered])).toEqual([
      ["a1", true],
      ["a2", false],
    ]);
    expect(body.total).toBe(2);
  });

  it("沒帶 token → 401，不打上游", async () => {
    const res = await SELF.fetch("https://c.test/v1/me/cards");
    expect(res.status).toBe(401);
    expect(upstreamCalls).toHaveLength(0);
  });

  it("只回傳畫面用得到的欄位", async () => {
    const { body } = await mine();
    expect(Object.keys(body.items[0]).sort()).toEqual(
      ["avatarUrl", "backgroundUrl", "detailId", "name", "num", "provider", "registered", "roleId", "summary", "talkNum", "visibility", "zone"],
    );
  });
});

describe("分頁", () => {
  beforeEach(() => {
    myRolesOnUpstream({
      "alice-token": Array.from({ length: 30 }, (_, i) => ({ roleId: `r${i}`, name: `卡 ${i}` })),
    });
  });

  it("預設一頁 24 筆並回報還有下一頁", async () => {
    const { body } = await mine();
    expect(body.items).toHaveLength(24);
    expect(body.total).toBe(30);
    expect(body.hasNext).toBe(true);
  });

  it("第二頁接得上，且最後一頁不再宣稱有下一頁", async () => {
    const { body } = await mine("?page=2");
    expect(body.items.map((i: any) => i.roleId)).toEqual(["r24", "r25", "r26", "r27", "r28", "r29"]);
    expect(body.hasNext).toBe(false);
  });

  it("pageSize 有上限，擋住一次撈全部", async () => {
    const { body } = await mine("?pageSize=9999");
    expect(body.pageSize).toBe(100);
    expect(upstreamCalls.at(-1)?.pageSize).toBe(100);
  });
});

describe("快取", () => {
  it("同一頁重複請求只打一次上游", async () => {
    await mine();
    await mine();
    const { cache } = await mine();
    expect(upstreamCalls).toHaveLength(1);
    expect(cache).toBe("hit");
  });

  it("不同分頁各自快取，不會互相汙染", async () => {
    myRolesOnUpstream({
      "alice-token": Array.from({ length: 30 }, (_, i) => ({ roleId: `r${i}` })),
    });
    const p1 = await mine("?page=1");
    const p2 = await mine("?page=2");
    expect(p1.body.items[0].roleId).toBe("r0");
    expect(p2.body.items[0].roleId).toBe("r24");
    expect(upstreamCalls).toHaveLength(2);
  });

  /**
   * 這是這條路唯一會造成嚴重事故的失誤：快取鍵混進可偽造的輸入，
   * 就會把一個人的卡片清單送給另一個人。
   */
  it("不同使用者的快取彼此隔離", async () => {
    const alice = await mine("", "alice-token");
    const bob = await mine("", "bob-token");
    expect(alice.body.items.map((i: any) => i.roleId)).toEqual(["a1", "a2"]);
    expect(bob.body.items.map((i: any) => i.roleId)).toEqual(["b1"]);
    expect(upstreamCalls).toHaveLength(2);
  });

  it("fresh=1 繞過快取，讓前端在自己剛改完卡之後拿得到新資料", async () => {
    await mine();
    const { cache } = await mine("?fresh=1");
    expect(cache).toBe("bypass");
    expect(upstreamCalls).toHaveLength(2);
  });

  /** 登記狀態住在自己的 D1，使用者正在操作它——快取住上游清單不能把它一起凍住。 */
  it("登記狀態永遠即時，不受上游清單的快取影響", async () => {
    const before = await mine();
    expect(before.body.items[0].registered).toBe(false);

    await env.DB.prepare(
      `INSERT INTO cards (id, source_role_id, author_num_id, names, summaries, tags, search_text, registered_at, last_synced_at,provider)
       VALUES (?,'a1',10001,'{}','{}','[]','',1,1,'harbor')`,
    ).bind(await ensureCardNumber(env.DB,'harbor','a1')).run();

    const after = await mine();
    expect(after.cache).toBe("hit");
    expect(after.body.items[0].registered).toBe(true);
  });

  it("私人資料不得進共用快取", async () => {
    const res = await SELF.fetch("https://c.test/v1/me/cards", { headers: bearer("alice-token") });
    expect(res.headers.get("Cache-Control")).toContain("private");
    expect(res.headers.get("Cache-Control")).toContain("no-store");
  });
});

describe("篩選", () => {
  /** 作者有 30 張卡、一頁 24 張；已登記的 3 張裡有 2 張落在第二頁。 */
  beforeEach(async () => {
    myRolesOnUpstream({
      "alice-token": Array.from({ length: 30 }, (_, i) => ({ roleId: `a${i + 1}`, name: `卡 ${i + 1}` })),
    });
    for (const [id, roleId] of [["r1", "a1"], ["r2", "a25"], ["r3", "a26"]] as const) {
      await env.DB.prepare(
        `INSERT INTO cards (id, source_role_id, author_num_id, names, summaries, tags, search_text, registered_at, last_synced_at,provider)
         VALUES (?, ?, 10001, '{"zh":"登記過的"}', '{"zh":""}', '[]', '', 1, 1,'harbor')`,
      ).bind(await ensureCardNumber(env.DB,'harbor',roleId), roleId).run();
    }
  });

  it("已登記列的是全部，不是這一頁裡的那幾張", async () => {
    const { body } = await mine("?filter=listed");
    expect(body.items.map((i: any) => i.roleId).sort()).toEqual(["a1", "a25", "a26"]);
    expect(body.items.every((i: any) => i.registered)).toBe(true);
  });

  // total 是「符合目前篩選的張數」（翻頁用）：已上架那組就是已上架的張數，由本站的庫算，不問上游
  it("已登記那組的總數是已上架的張數——翻頁算得出來，而且不問上游", async () => {
    const { body } = await mine("?filter=listed");
    expect(body.total).toBe(3);
    expect(body.registeredTotal).toBe(3);
  });

  it("已登記清單保留儲存的直式背景", async () => {
    await env.DB.prepare("UPDATE cards SET background_url = ? WHERE source_role_id = ?")
      .bind("https://cdn.example.test/portrait.png", "a1").run();
    const { body } = await mine("?filter=listed");
    expect(body.items.find((card: any) => card.roleId === "a1").backgroundUrl)
      .toBe("https://cdn.example.test/portrait.png");
  });

  it("已登記那組不必問上游", async () => {
    upstreamCalls.length = 0;
    await mine("?filter=listed");
    expect(upstreamCalls).toHaveLength(0);
  });

  it("已登記的數字是全域的，翻到哪一頁都一樣", async () => {
    const first = await mine();
    const second = await mine("?page=2");
    expect(first.body.registeredTotal).toBe(3);
    expect(second.body.registeredTotal).toBe(3);
    // 上游說作者一共有幾張，照樣是上游那個數字
    expect(first.body.total).toBe(30);
  });

  it("未登記把這一頁裡已登記的挑掉", async () => {
    const { body } = await mine("?filter=unlisted");
    expect(body.items.map((i: any) => i.roleId)).not.toContain("a1");
    expect(body.items).toHaveLength(23);
  });

  it("已登記可以翻頁", async () => {
    const { body } = await mine("?filter=listed&pageSize=2");
    expect(body.items).toHaveLength(2);
    expect(body.hasNext).toBe(true);
    const { body: p2 } = await mine("?filter=listed&pageSize=2&page=2");
    expect(p2.items).toHaveLength(1);
    expect(p2.hasNext).toBe(false);
  });

  it("認不得的 filter 當成全部", async () => {
    const { body } = await mine("?filter=nonsense");
    expect(body.items).toHaveLength(24);
  });
});

describe("我的卡片：認人不必跨洋", () => {
  // 讀取時本站 session 就認得出是誰：不再先問供應商「你是誰」（那一趟從亞洲要約 0.4 s）。
  // 卡片清單本身仍用這個人的 token 向供應商讀。
  it("帶著本站登入 cookie 的讀取，身分從 session 來；清單照樣用 token 讀", async () => {
    const { makeMember } = await import("./helpers");
    const { default: worker } = await import("../src/index");
    const { createExecutionContext, waitOnExecutionContext } = await import("cloudflare:test");
    const { upstream } = await import("../src/upstream");
    const { vi } = await import("vitest");
    const origin = "https://c.test";
    const memberId = await makeMember(10001);
    const raw = "session-alice";
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw)));
    const tokenHash = btoa(String.fromCharCode(...digest)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    await env.DB.prepare("INSERT INTO account_sessions VALUES (?,?,?,?,?,?,?)").bind(tokenHash, memberId, "harbor", "10001", origin, Date.now(), Date.now() + 86400000).run();
    const whoIs = vi.spyOn(upstream, "fetchMe");
    const ctx = createExecutionContext();
    const res = await worker.fetch(new Request(`${origin}/v1/me/cards?fresh=1`, { headers: { ...bearer("alice-token"), Cookie: `__Host-hr-session=${raw}` } }), { ...env, AUTH_ENABLED: "true", AUTH_ALLOWED_ORIGINS: origin }, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).items.map((i: any) => i.roleId)).toEqual(["a1", "a2"]);
    expect(whoIs).not.toHaveBeenCalled();
    expect(upstreamCalls.at(-1)?.token).toBe("alice-token");
    whoIs.mockRestore();
  });
});

describe("我的卡片：資料庫查詢不隨卡片張數變多", () => {
  // 原本每張卡各查兩次（屬於哪個作品、卡號），一頁 24 張就是 48 次；作者卡多時這一頁跟著變慢
  it("2 張與 6 張的查詢次數一樣", async () => {
    const { recordD1 } = await import("./helpers");
    const { default: worker } = await import("../src/index");
    const { createExecutionContext, waitOnExecutionContext } = await import("cloudflare:test");
    const count = async (n: number) => {
      const token = `many-${n}`;
      identities({ [token]: 30000 + n });
      myRolesOnUpstream({ [token]: Array.from({ length: n }, (_, i) => ({ roleId: `m${n}-${i}`, name: `卡 ${i}` })) });
      // 卡號先發好：第一次見到的卡要寫入一次，那不是這裡要量的
      for (let i = 0; i < n; i++) await ensureCardNumber(env.DB, "harbor", `m${n}-${i}`);
      const { queries, db } = recordD1(env.DB);
      const ctx = createExecutionContext();
      const res = await worker.fetch(new Request("https://c.test/v1/me/cards?fresh=1", { headers: bearer(token) }), { ...env, DB: db }, ctx);
      await waitOnExecutionContext(ctx);
      expect(res.status).toBe(200);
      expect(((await res.json()) as any).items).toHaveLength(n);
      return queries.length;
    };
    const two = await count(2);
    const six = await count(6);
    expect(six, `2 張 ${two} 次、6 張 ${six} 次`).toBe(two);
  });
});

describe("我的卡片：搜尋", () => {
  it("關鍵字帶給供應商（全部／未上架由供應商比對）；總數跟著篩選；不同關鍵字不共用快取", async () => {
    myRolesOnUpstream({ "alice-token": [{ roleId: "a1", name: "夜行偵探" }, { roleId: "a2", name: "星海旅人" }, { roleId: "a3", name: "夜行偵探 番外" }] });
    const hit = await mine("?q=" + encodeURIComponent("  夜行偵探 "));
    expect(hit.status).toBe(200);
    expect(hit.body.items.map((i: any) => i.roleId)).toEqual(["a1", "a3"]);
    expect(hit.body.total).toBe(2);
    expect(upstreamCalls.at(-1)?.q).toBe("夜行偵探");
    // 同一頁、換一個關鍵字：不能拿到上一個關鍵字的快取
    const other = await mine("?q=" + encodeURIComponent("星海"));
    expect(other.body.items.map((i: any) => i.roleId)).toEqual(["a2"]);
    // 沒有關鍵字：照舊全部
    expect((await mine()).body.total).toBe(3);
  });

  it("已上架的卡用關鍵字找：繁簡互通、比對四語卡名與簡介，總數與翻頁跟著篩選", async () => {
    const { makeMember } = await import("./helpers");
    await makeMember(10001);
    const insert = async (roleId: string, names: Record<string, string>, summaries: Record<string, string>) => {
      await env.DB.prepare(
        `INSERT INTO cards (id, source_role_id, author_num_id, names, summaries, tags, search_text, registered_at, last_synced_at, provider)
         VALUES (?,?,10001,?,?,'[]','',1,1,'harbor')`,
      ).bind(await ensureCardNumber(env.DB, "harbor", roleId), roleId, JSON.stringify(names), JSON.stringify(summaries)).run();
    };
    await insert("a1", { zh: "夜行偵探", en: "Night Detective", ja: "", ko: "" }, { zh: "", en: "", ja: "", ko: "" });
    await insert("a2", { zh: "星海旅人", en: "", ja: "", ko: "" }, { zh: "一个侦探的故事", en: "", ja: "", ko: "" });
    await insert("a3", { zh: "花園", en: "", ja: "", ko: "" }, { zh: "", en: "", ja: "", ko: "" });
    const simplified = await mine("?filter=listed&q=" + encodeURIComponent("侦探"));
    expect(simplified.status).toBe(200);
    expect(simplified.body.items.map((i: any) => i.roleId).sort()).toEqual(["a1", "a2"]);
    expect(simplified.body.total).toBe(2);
    expect((await mine("?filter=listed&q=" + encodeURIComponent("night"))).body.items.map((i: any) => i.roleId)).toEqual(["a1"]);
    const paged = await mine("?filter=listed&pageSize=1&page=2&q=" + encodeURIComponent("偵探"));
    expect(paged.body.items).toHaveLength(1);
    expect(paged.body.total).toBe(2);
    expect(paged.body.hasNext).toBe(false);
    // 沒有關鍵字：總數就是已上架的張數，頁碼算得出來
    expect((await mine("?filter=listed")).body.total).toBe(3);
  });
});
