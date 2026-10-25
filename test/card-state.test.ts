import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import worker from "../src/index";
import { upsertCard } from "../src/cards";
import { opsMetrics } from "../src/ops-metrics";
import { periodOf } from "../src/card-state";
import { upstream } from "../src/upstream";
import { HttpError } from "../src/types";
import { makeMember, resetDb, restoreUpstream, role, testHandle } from "./helpers";

/**
 * 卡片共用狀態（design §7）：宣告過的投票與計數器、玩過才寫得進去、每人上限與目標、排行榜只給暱稱、
 * 測試帳號另一份、作者開關、平台總開關。
 */
const DECL = {
  polls: { "p1-4": { options: ["a", "b", "c"] } },
  counters: { boss: { goal: 100, maxStep: 50, perMember: 60, period: "week" }, cheer: { maxStep: 5, perMember: 1000 } },
};
const ACCOUNTS: Record<string, { id: number; accountClass?: "test" }> = { alice: { id: 11 }, bob: { id: 12 }, carol: { id: 13 }, author: { id: 10001 }, qa: { id: 99, accountClass: "test" } };
let cardId = "";
let declared: unknown = DECL;
let limit: { success: boolean } = { success: true };

beforeEach(async () => {
  await resetDb();
  declared = DECL;
  limit = { success: true };
  upstream.fetchMe = async (_env, token) => {
    const a = ACCOUNTS[token];
    if (!a) throw new HttpError(401, "upstream rejected the token");
    return a.accountClass ? { accountNumId: a.id, accountClass: "test", testState: "active", testGeneration: 1 } : { accountNumId: a.id };
  };
  upstream.fetchSharedState = async () => declared;
  cardId = (await upsertCard(env.DB, role({ roleId: "src-1", authorNumId: 10001 }), Date.now())).id;
  for (const [name, a] of Object.entries(ACCOUNTS)) {
    const member = await makeMember(a.id);
    await env.DB.prepare("UPDATE members SET display_name = ? WHERE id = ?").bind(name === "carol" ? null : name.toUpperCase(), member).run();
  }
});
afterEach(restoreUpstream);

async function call(path: string, opts: { token?: string; method?: string; body?: unknown; vars?: Record<string, unknown> } = {}) {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request(`https://c.test${path}`, {
    method: opts.method ?? (opts.body === undefined ? "GET" : "POST"),
    headers: { ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}), ...(opts.body === undefined ? {} : { "Content-Type": "application/json" }) },
    ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
  }), { ...env, CARD_STATE_ENABLED: "true", CARD_STATE_MEMBER_LIMIT: { limit: async () => limit }, CARD_STATE_CARD_LIMIT: { limit: async () => ({ success: true }) }, ...opts.vars } as typeof env, ctx);
  await waitOnExecutionContext(ctx);
  return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
}
const played = (who: string) => env.DB.prepare("INSERT INTO member_conversations VALUES (?, 'harbor', 'src-1', ?, 1, 1)").bind(`member-${ACCOUNTS[who]!.id}`, `conv-${who}`).run();
const vote = (who: string, option: string) => call("/v1/cards/src-1/state/p1-4/vote", { token: who, body: { option } });
const add = (who: string, key: string, delta: number) => call(`/v1/cards/src-1/state/${key}/add`, { token: who, body: { delta } });
const read = (keys: string, token?: string) => call(`/v1/cards/src-1/state?keys=${keys}`, { token });

describe("開關與資格", () => {
  it("平台總開關沒開：讀到 enabled:false、寫入 403 shared_disabled", async () => {
    await played("alice");
    expect((await call("/v1/cards/src-1/state?keys=p1-4", { vars: { CARD_STATE_ENABLED: undefined } })).body).toEqual({ enabled: false, items: {} });
    expect(await call("/v1/cards/src-1/state/p1-4/vote", { token: "alice", body: { option: "a" }, vars: { CARD_STATE_ENABLED: "false" } })).toMatchObject({ status: 403, body: { error: "shared_disabled" } });
  });

  it("沒玩過這張卡不能寫；遊客只能讀；限流打滿回 rate_limited", async () => {
    expect(await vote("alice", "a")).toMatchObject({ status: 403, body: { error: "not_eligible" } });
    expect((await call("/v1/cards/src-1/state/p1-4/vote", { body: { option: "a" } })).status).toBe(401);
    await played("alice");
    limit = { success: false };
    expect(await vote("alice", "a")).toMatchObject({ status: 429, body: { error: "rate_limited" } });
    expect(await opsMetrics(env.DB)).toContain('hearthroom_card_state_total{operation="vote",outcome="limited"} 1');
    expect(await opsMetrics(env.DB)).toContain('hearthroom_card_state_total{operation="vote",outcome="ineligible"} 1');
  });

  it("作者關掉這張卡就停；只有作者本人改得了，別人 404", async () => {
    await played("alice");
    expect((await call("/v1/me/cards/src-1/shared-state", { token: "alice", method: "PUT", body: { enabled: false } })).status).toBe(404);
    expect((await call("/v1/me/cards/src-1/shared-state", { token: "author", method: "PUT", body: { enabled: false } })).body).toEqual({ authorOff: true });
    expect(await vote("alice", "a")).toMatchObject({ status: 403, body: { error: "shared_disabled" } });
    expect((await call("/v1/me/cards/src-1/shared-state", { token: "author", method: "PUT", body: { enabled: true } })).body).toEqual({ authorOff: false });
    expect((await vote("alice", "a")).status).toBe(200);
    const audit = await env.DB.prepare("SELECT action FROM audit_log WHERE subject_kind = 'card_state' ORDER BY created_at").all<{ action: string }>();
    expect(audit.results.map((r) => r.action)).toEqual(["author_off", "author_on"]);
  });
});

describe("投票", () => {
  it("一人一票、可以改票，總數跟著移；重投同一票不重算；沒宣告的選項或 key 拒絕", async () => {
    await played("alice"); await played("bob");
    expect((await vote("alice", "a")).body).toEqual({ mine: "a" });
    await vote("bob", "a");
    await vote("alice", "a");
    expect((await read("p1-4", "alice")).body.items["p1-4"]).toEqual({ kind: "poll", counts: { a: 2, b: 0, c: 0 }, total: 2, mine: "a" });
    await vote("alice", "b");
    expect((await read("p1-4")).body.items["p1-4"]).toEqual({ kind: "poll", counts: { a: 1, b: 1, c: 0 }, total: 2 });
    expect(await vote("alice", "z")).toMatchObject({ status: 400, body: { error: "option_invalid" } });
    expect(await call("/v1/cards/src-1/state/nope/vote", { token: "alice", body: { option: "a" } })).toMatchObject({ status: 400, body: { error: "not_declared" } });
  });

  it("作者移除了某個選項：那個選項的票不再算進總數", async () => {
    await played("alice"); await played("bob");
    await vote("alice", "a"); await vote("bob", "c");
    declared = { polls: { "p1-4": { options: ["a", "b"] } } };
    expect((await read("p1-4")).body.items["p1-4"]).toEqual({ kind: "poll", counts: { a: 1, b: 0 }, total: 1 });
  });
});

describe("共鬥計數器與排行榜", () => {
  it("每次 1..maxStep；每人每期最多 perMember（超過的部分不算）；達標記時刻、之後不能再加", async () => {
    await played("alice"); await played("bob");
    expect(await add("alice", "boss", 51)).toMatchObject({ status: 400, body: { error: "delta_invalid" } });
    expect((await add("alice", "boss", 50)).body).toMatchObject({ total: 50, mine: 50, reachedAt: null });
    expect((await add("alice", "boss", 50)).body).toMatchObject({ total: 60, mine: 60 });
    expect(await add("alice", "boss", 1)).toMatchObject({ status: 429, body: { error: "limit_reached" } });
    const reached = await add("bob", "boss", 50);
    expect(reached.body.total).toBe(100);
    expect(typeof reached.body.reachedAt).toBe("number");
    expect(await add("bob", "boss", 1)).toMatchObject({ status: 409, body: { error: "goal_reached" } });
    const view = (await read("boss,cheer", "bob")).body.items;
    expect(view.boss).toMatchObject({ kind: "counter", total: 100, goal: 100, previous: 0, mine: 50 });
    expect(view.cheer).toEqual({ kind: "counter", total: 0, mine: 0 });
  });

  it("排行榜只給名次、公開暱稱（跟留言區同一個，沒設暱稱的人是他的公開代號）與貢獻；看得到自己的名次；回應裡沒有帳號或會員 ID", async () => {
    for (const w of ["alice", "bob", "carol"]) await played(w);
    await add("bob", "cheer", 5); await add("bob", "cheer", 5);
    await add("carol", "cheer", 5); await add("carol", "cheer", 5);
    await add("alice", "cheer", 3);
    const board = await call("/v1/cards/src-1/state/cheer/leaderboard?limit=2", { token: "alice" });
    expect(board.body).toEqual({ items: [{ rank: 1, name: "BOB", value: 10 }, { rank: 2, name: testHandle(13), value: 10 }], mine: { rank: 3, value: 3 } });
    expect(JSON.stringify(board.body)).not.toMatch(/member-|\b1[123]\b/);
  });

  it("測試帳號寫進另一份：不算正式總數、不上榜", async () => {
    await env.DB.prepare("UPDATE members SET account_class = 'test', test_generation = 1 WHERE id = 'member-99'").run();
    await played("qa"); await played("alice");
    expect((await add("qa", "cheer", 5)).body).toMatchObject({ total: 5, mine: 5 });
    await add("alice", "cheer", 1);
    expect((await read("cheer")).body.items.cheer.total).toBe(1);
    expect((await call("/v1/cards/src-1/state/cheer/leaderboard")).body.items).toEqual([{ rank: 1, name: "ALICE", value: 1 }]);
  });

  it("作者重設一個 key；草稿試玩寫進 draft、不混進正式數字", async () => {
    await played("alice");
    await add("alice", "cheer", 4);
    expect((await call("/v1/cards/src-1/state/cheer/add?draft=1", { token: "author", body: { delta: 2 } })).body).toMatchObject({ total: 2 });
    expect((await read("cheer")).body.items.cheer.total).toBe(4);
    const mine = await call("/v1/me/cards/src-1/shared-state", { token: "author" });
    expect(mine.body).toMatchObject({ platformEnabled: true, authorOff: false, live: { cheer: { total: 4 } }, draft: { cheer: { total: 2 } } });
    await call("/v1/me/cards/src-1/shared-state/cheer/reset", { token: "author", body: {} });
    expect((await read("cheer")).body.items.cheer.total).toBe(0);
  });
});

it("期別：日與週以 UTC+8 換期，週從週一開始", () => {
  const sun = Date.parse("2026-10-25T15:59:00Z"); // 台灣時間 10-25（週日）23:59
  expect(periodOf("day", sun)).toBe("D2026-10-25");
  expect(periodOf("week", sun)).toBe("W2026-10-19");
  expect(periodOf("week", sun + 60_000)).toBe("W2026-10-26");
  expect(periodOf("week", sun, 1)).toBe("W2026-10-12");
  expect(periodOf("none", sun)).toBe("");
});

describe("分享回流（短碼）", () => {
  const SHARE_DECL = { polls: { "p1-4": { options: ["a", "b", "c"], share: true }, solo: { options: ["x", "y"] } } };
  const mint = (who: string, context = "p1-4.b", poll = "p1-4") => call("/v1/cards/src-1/share-tokens", { token: who, body: { context, poll } });
  const respond = (who: string, token: string, option: string) => call(`/v1/cards/src-1/share-tokens/${token}/respond`, { token: who, body: { option } });
  const results = (who: string) => call("/v1/cards/src-1/share-tokens", { token: who });

  it("分享者產生短碼（同一個情境碼回同一條）；朋友解得回情境碼與投票，不必登入；分享者是誰從不回傳", async () => {
    declared = SHARE_DECL;
    await played("alice");
    const first = await mint("alice");
    expect(first.body.token).toMatch(/^~[A-Z0-9]{8}$/);
    expect((await mint("alice")).body.token).toBe(first.body.token);
    expect(await mint("alice", "p1-4.b", "solo")).toMatchObject({ status: 400, body: { error: "not_declared" } });
    expect(await mint("alice", "<b>")).toMatchObject({ status: 400, body: { error: "context_invalid" } });
    const resolved = await call(`/v1/cards/src-1/share-tokens/${first.body.token}`);
    expect(resolved.body).toEqual({ context: "p1-4.b", poll: { key: "p1-4", options: ["a", "b", "c"] } });
    expect((await call("/v1/cards/src-1/share-tokens/~AAAAAAAA")).status).toBe(404);
    // 開關關著：情境碼照樣送到，只是不給投票
    expect((await call(`/v1/cards/src-1/share-tokens/${first.body.token}`, { vars: { CARD_STATE_ENABLED: "false" } })).body).toEqual({ context: "p1-4.b", poll: null });
  });

  it("朋友回應：玩過才算、分享者不能回自己的；未滿 3 人只給總數，滿了給各選項人數（當天照一張快照）", async () => {
    declared = SHARE_DECL;
    for (const w of ["alice", "bob", "carol", "author"]) await played(w);
    const token = (await mint("alice")).body.token as string;
    expect(await respond("alice", token, "a")).toMatchObject({ status: 403, body: { error: "own_token" } });
    expect((await respond("bob", token, "a")).body).toEqual({ mine: "a" });
    await respond("carol", token, "c");
    expect((await results("alice")).body.items).toEqual([expect.objectContaining({ context: "p1-4.b", pollKey: "p1-4", total: 2, counts: null, updatedAt: null })]);
    await respond("author", token, "a");
    const after = (await results("alice")).body.items[0];
    // 今天第一次讀時只有 2 人，快照也是 2 人：各選項人數要到明天才出現，總數即時是 3
    expect(after).toMatchObject({ total: 3, counts: null });
    await env.DB.prepare("DELETE FROM card_share_snapshots").run();
    expect((await results("alice")).body.items[0]).toMatchObject({ total: 3, counts: { a: 2, b: 0, c: 1 } });
    expect((await results("bob")).body.items).toEqual([]);
    expect(JSON.stringify((await call(`/v1/cards/src-1/share-tokens/${token}`)).body)).not.toContain("member-");
  });
});
