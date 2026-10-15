import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import worker from "../src/index";
import { bearer, identities, makeMember, resetDb, restoreUpstream } from "./helpers";

// 活動歸因：分享碼訪客計數（不需登入）與登入後綁成新玩家的歸因列。
const OWNER = 64001, FRESH = 64002;
const MIN = 60_000, DAY = 86_400_000;
const CODE = "AB12CD34", OTHER_CODE = "ZZ99YY88";

async function call(path: string, init: { token?: string; body?: unknown; raw?: string; headers?: Record<string, string>; env?: Record<string, unknown> } = {}) {
  const headers: Record<string, string> = { "Content-Type": "application/json", ...(init.token ? bearer(init.token) : {}), ...init.headers };
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request("https://c.test" + path, { method: "POST", headers, body: init.raw ?? JSON.stringify(init.body ?? {}) }), { ...env, ...init.env } as typeof env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}
const bind = (body: Record<string, unknown>, token = "fresh") => call("/v1/me/campaign/attribution", { token, body });
const visit = (s: unknown) => call("/v1/campaign/visits", { body: { s } });
const rows = async () => (await env.DB.prepare("SELECT * FROM campaign_attributions").all()).results;
const visits = async () => (await env.DB.prepare("SELECT share_code, day, visits FROM campaign_share_visits ORDER BY share_code").all()).results;

let owner = "", fresh = "", campaignId = "", contentId = "";
async function content(code: string, memberId: string) {
  const id = crypto.randomUUID(), now = Date.now();
  await env.DB.prepare("INSERT INTO share_contents (id, campaign_id, member_id, recipient_account_no, title, share_code, created_at, updated_at) VALUES (?, ?, ?, 1, '介紹', ?, ?, ?)")
    .bind(id, campaignId, memberId, code, now, now).run();
  return id;
}
const setCreated = (memberId: string, at: number) => env.DB.prepare("UPDATE members SET created_at = ? WHERE id = ?").bind(at, memberId).run();

beforeEach(async () => {
  await resetDb();
  identities({ owner: OWNER, fresh: FRESH });
  owner = await makeMember(OWNER);
  fresh = await makeMember(FRESH);
  campaignId = crypto.randomUUID();
  const now = Date.now();
  await env.DB.prepare("INSERT INTO campaigns (id, slug, title, status, created_by, created_at, updated_at) VALUES (?, 'launch', '{\"zh-Hant\":\"開站\"}', 'active', 'test', ?, ?)").bind(campaignId, now, now).run();
  contentId = await content(CODE, owner);
  await content(OTHER_CODE, owner);
});
afterEach(() => { restoreUpstream(); });

describe("登入後綁定", () => {
  it("新玩家：寫一筆歸因，註冊時間是第一次登入本站的時間；回應不含成員 id", async () => {
    const seen = Date.now() - MIN;
    const r = await bind({ s: CODE, firstSeenAt: seen });
    expect(r.status).toBe(200);
    const text = await r.text();
    expect(JSON.parse(text)).toEqual({ bound: true });
    expect(text).not.toContain(fresh);
    expect(r.headers.get("Cache-Control")).toBe("private, no-store");
    const created = await env.DB.prepare("SELECT created_at FROM members WHERE id = ?").bind(fresh).first<number>("created_at");
    expect(await rows()).toEqual([{
      member_id: fresh, share_code: CODE, content_id: contentId, campaign_id: campaignId, first_seen_at: seen, registered_at: created, first_play_at: null, created_at: expect.any(Number),
    }]);
  });

  it("歸因只寫一次：同人之後帶別的碼回 existing，列不變", async () => {
    await bind({ s: CODE, firstSeenAt: Date.now() - MIN });
    const before = await rows();
    const r = await bind({ s: OTHER_CODE, firstSeenAt: Date.now() - MIN });
    expect(await r.json()).toEqual({ bound: false, reason: "existing" });
    expect(await rows()).toEqual(before);
  });

  it("歸因只寫一次：並發兩次只有一列、只有一次 bound", async () => {
    const seen = Date.now() - MIN;
    const results = await Promise.all([bind({ s: CODE, firstSeenAt: seen }), bind({ s: OTHER_CODE, firstSeenAt: seen })].map(async (p) => (await p).json()));
    expect(results.filter((x: any) => x.bound)).toHaveLength(1);
    expect(results.filter((x: any) => !x.bound)).toEqual([{ bound: false, reason: "existing" }]);
    expect(await rows()).toHaveLength(1);
  });

  it("老玩家不算新玩家：成員建立早於點擊超過 10 分鐘 → not_new；早 5 分鐘照算", async () => {
    const seen = Date.now() - MIN;
    await setCreated(fresh, seen - 11 * MIN);
    expect(await (await bind({ s: CODE, firstSeenAt: seen })).json()).toEqual({ bound: false, reason: "not_new" });
    expect(await rows()).toEqual([]);
    await setCreated(fresh, seen - 5 * MIN);
    expect(await (await bind({ s: CODE, firstSeenAt: seen })).json()).toEqual({ bound: true });
  });

  it("自己的內容 → own；未知碼 → unknown；都不寫", async () => {
    expect(await (await bind({ s: CODE, firstSeenAt: Date.now() - MIN }, "owner")).json()).toEqual({ bound: false, reason: "own" });
    expect(await (await bind({ s: "NOPE0000", firstSeenAt: Date.now() - MIN })).json()).toEqual({ bound: false, reason: "unknown" });
    expect(await rows()).toEqual([]);
  });

  it("firstSeenAt 範圍：晚於現在（超過時鐘誤差）、早於 30 天前、不是數字、碼格式不對都是 400", async () => {
    for (const body of [
      { s: CODE, firstSeenAt: Date.now() + 60 * MIN },
      { s: CODE, firstSeenAt: Date.now() - 31 * DAY },
      { s: CODE, firstSeenAt: "yesterday" },
      { s: CODE },
      { s: "short", firstSeenAt: Date.now() - MIN },
    ]) {
      const r = await bind(body);
      expect(r.status).toBe(400);
      expect(await r.json()).toEqual({ error: "invalid_arguments" });
    }
    expect(await rows()).toEqual([]);
    // 瀏覽器的鐘快一點點不算未來
    expect(await (await bind({ s: CODE, firstSeenAt: Date.now() + 2 * MIN })).json()).toEqual({ bound: true });
  });

  it("要登入；本體過大回 400 而不是 500", async () => {
    expect((await call("/v1/me/campaign/attribution", { body: { s: CODE, firstSeenAt: Date.now() } })).status).toBe(401);
    expect((await call("/v1/me/campaign/attribution", { token: "fresh", raw: JSON.stringify({ s: CODE, pad: "x".repeat(4096) }) })).status).toBe(400);
  });
});

describe("訪客計數", () => {
  it("只對存在的碼累加，同碼同日累加；未知與格式不對的碼回 204 不寫", async () => {
    // 先取日子再送：跨過 UTC 午夜時才不會一邊是昨天、一邊是今天
    const day = Math.floor(Date.now() / DAY);
    for (const s of [CODE, CODE, OTHER_CODE, "NOPE0000", "bad", 12345678, null]) {
      const r = await visit(s);
      expect(r.status).toBe(204);
      expect(await r.text()).toBe("");
    }
    expect(await visits()).toEqual([{ share_code: CODE, day, visits: 2 }, { share_code: OTHER_CODE, day, visits: 1 }]);
  });

  it("不需登入；本體過大回 204 不寫", async () => {
    expect((await call("/v1/campaign/visits", { raw: JSON.stringify({ s: CODE, pad: "x".repeat(4096) }) })).status).toBe(204);
    expect(await visits()).toEqual([]);
  });

  it("限流拒絕：回 204 不寫；限流的鍵是連線 IP", async () => {
    const keys: string[] = [];
    const VISIT_LIMIT = { limit: async ({ key }: { key: string }) => (keys.push(key), { success: false }) };
    const r = await call("/v1/campaign/visits", { body: { s: CODE }, headers: { "cf-connecting-ip": "203.0.113.9" }, env: { VISIT_LIMIT } });
    expect(r.status).toBe(204);
    expect(keys).toEqual(["203.0.113.9"]);
    expect(await visits()).toEqual([]);
  });

  it("沒有限流綁定（本機、分叉）照常計數", async () => {
    const day = Math.floor(Date.now() / DAY);
    expect((await call("/v1/campaign/visits", { body: { s: CODE }, env: { VISIT_LIMIT: undefined } })).status).toBe(204);
    expect(await visits()).toEqual([{ share_code: CODE, day, visits: 1 }]);
  });
});
