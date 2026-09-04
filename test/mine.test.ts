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
      `INSERT INTO cards (id, source_role_id, author_num_id, names, summaries, tags, search_text, registered_at, last_synced_at)
       VALUES ('x','a1',10001,'{}','{}','[]','',1,1)`,
    ).run();

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
      ["avatarUrl", "name", "registered", "roleId", "summary", "talkNum", "visibility", "zone"],
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
      `INSERT INTO cards (id, source_role_id, author_num_id, names, summaries, tags, search_text, registered_at, last_synced_at)
       VALUES ('x','a1',10001,'{}','{}','[]','',1,1)`,
    ).run();

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
        `INSERT INTO cards (id, source_role_id, author_num_id, names, summaries, tags, search_text, registered_at, last_synced_at)
         VALUES (?, ?, 10001, '{"zh":"登記過的"}', '{"zh":""}', '[]', '', 1, 1)`,
      ).bind(id, roleId).run();
    }
  });

  it("已登記列的是全部，不是這一頁裡的那幾張", async () => {
    const { body } = await mine("?filter=listed");
    expect(body.items.map((i: any) => i.roleId).sort()).toEqual(["a1", "a25", "a26"]);
    expect(body.items.every((i: any) => i.registered)).toBe(true);
  });

  it("已登記那組不知道作者一共有幾張——那個數字只有上游有，這條路不問它", async () => {
    const { body } = await mine("?filter=listed");
    expect(body.total).toBeNull();
    expect(body.registeredTotal).toBe(3);
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
