import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import { upstream, type PayResult } from "../src/upstream";
import { requestPayout } from "../src/campaign-payout";
import { appAdmins, bearer, identities, makeAgent, makeMember, makeReviewer, resetDb, restoreUpstream, testHandle } from "./helpers";

// 發放、重試、取消、對帳。Provider 用記憶體裡的點數池模擬：同一把 key 再送回 replayed:true。
const ADMIN = 64001, MOD = 64003, AGENT = 64004, OWNER = 64005, OTHER = 64006;
// 令牌要夠獨特，才驗得出它沒出現在任何日誌裡。
const ADMIN_TOKEN = "tok-admin-Zq8v1c7rLm";
const DAY = 86_400_000, MIN = 60_000;

async function call(path: string, init: { method?: string; token?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = init.token ? bearer(init.token) : {};
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request("https://c.test" + path, { method: init.method ?? "GET", headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) }), env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}
const json = async (r: Response) => (await r.json()) as any;
const code = async (r: Response) => { const b = await json(r); return `${r.status} ${b.error}${b.field ? ` ${b.field}` : ""}`; };
const op = () => crypto.randomUUID();
const count = async (sql: string, ...b: unknown[]) => (await env.DB.prepare(sql).bind(...b).first<{ n: number }>())!.n;
const metrics = async () => (await call("/metrics")).text();
const metric = (operation: string, outcome: string, n: number) => `hearthroom_campaign_operations_total{operation="${operation}",outcome="${outcome}"} ${n}`;

// ---- 假的 Provider 點數池 --------------------------------------------------------

type Sent = { token: string; key: string; accountNo: number; amount: number; campaignRef: string; contentRef: string };
const pool = {
  balance: 0,
  entries: new Map<string, { body: Omit<Sent, "token">; entryId: string }>(),
  sent: [] as Sent[],
  checked: [] as string[],
  /** 下一次拒絕的代碼（Provider 沒寫入）。 */
  reject: null as string | null,
  /** 下一次入帳了但回應丟了（逾時）。 */
  dropAfterPay: false,
  /** 下一次根本沒送到（逾時，沒入帳）。 */
  lose: false,
  /** 設了就卡住，直到放行。 */
  gate: null as Promise<void> | null,
};
function providerPool(balance: number) {
  Object.assign(pool, { balance, entries: new Map(), sent: [], checked: [], reject: null, dropAfterPay: false, lose: false, gate: null });
  upstream.payCampaign = async (_env, token, body): Promise<PayResult> => {
    pool.sent.push({ token, ...body });
    if (pool.gate) await pool.gate;
    if (pool.lose) { pool.lose = false; return { kind: "unknown" }; }
    const prior = pool.entries.get(body.key);
    if (prior) {
      return JSON.stringify(prior.body) === JSON.stringify(body) ? { kind: "paid", entryId: prior.entryId, paidAt: "2026-10-15T00:00:00Z", replayed: true } : { kind: "rejected", code: "idempotency_conflict" };
    }
    if (pool.reject) { const c = pool.reject; pool.reject = null; return { kind: "rejected", code: c }; }
    if (pool.balance < body.amount) return { kind: "insufficient" };
    pool.balance -= body.amount;
    const entryId = crypto.randomUUID();
    pool.entries.set(body.key, { body: { ...body }, entryId });
    if (pool.dropAfterPay) { pool.dropAfterPay = false; return { kind: "unknown" }; }
    return { kind: "paid", entryId, paidAt: "2026-10-15T00:00:00Z", replayed: false };
  };
  upstream.getCampaignPayout = async (_env, _token, key) => {
    pool.checked.push(key);
    if (pool.gate) await pool.gate;
    const e = pool.entries.get(key);
    return e ? { kind: "paid", entryId: e.entryId, paidAt: "2026-10-15T00:00:00Z" } : { kind: "absent" };
  };
}

// ---- 資料 ---------------------------------------------------------------------

let owner = "", admin = "", campaignId = "";
async function campaign(over: { status?: string; payoutDeadline?: number } = {}) {
  const now = Date.now(), id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO campaigns (id, slug, title, starts_at, ends_at, timezone, submit_deadline, payout_deadline, tiers, extra_placement_amount, status, created_by, created_at, updated_at)
     VALUES (?, ?, '{"zh-Hant":"開站分享"}', ?, ?, 'Asia/Taipei', ?, ?, '{"light":500,"original":3000,"guide":5000,"video":10000}', 500, ?, 'test', ?, ?)`,
  ).bind(id, `c${id.slice(0, 8)}`, now - 5 * DAY, now + 9 * DAY, now + 11 * DAY, over.payoutDeadline ?? now + 20 * DAY, over.status ?? "active", now, now).run();
  return id;
}
async function content(memberId: string, accountNo: number, over: { cId?: string; tier?: string | null; title?: string } = {}) {
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO share_contents (id, campaign_id, member_id, recipient_account_no, title, share_code, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(id, over.cId ?? campaignId, memberId, accountNo, over.title ?? "介紹", id.slice(0, 8).toUpperCase(), Date.now(), Date.now()).run();
  const tier = over.tier === undefined ? "original" : over.tier;
  if (tier) await placement(id, { status: "approved", tier });
  return id;
}
async function placement(contentId: string, over: { status?: string; tier?: string | null; requested?: string } = {}) {
  const id = crypto.randomUUID(), at = Date.now();
  await env.DB.prepare(
    `INSERT INTO share_placements (id, content_id, platform, location, location_key, published_at, url, requested_tier, approved_tier, review_status, created_at, updated_at)
     VALUES (?, ?, 'tieba', '角色扮演吧', ?, ?, 'https://tieba.baidu.com/p/1', ?, ?, ?, ?, ?)`,
  ).bind(id, contentId, `url:${id}`, at - MIN, over.requested ?? over.tier ?? "original", over.tier ?? null, over.status ?? "submitted", at, at).run();
  return id;
}
/** 活動整個過去了（日期仍然前後一致，canActivate 照樣通過），發獎截止剛過。 */
const closePayout = () => { const now = Date.now(); return env.DB.prepare("UPDATE campaigns SET starts_at = ?, ends_at = ?, submit_deadline = ?, payout_deadline = ?, status = 'ended' WHERE id = ?").bind(now - 10 * DAY, now - 3 * DAY, now - 2 * DAY, now - 1, campaignId).run(); };
const backdate = (payoutId: string, ms: number) => env.DB.prepare("UPDATE share_payouts SET created_at = created_at - ?, updated_at = updated_at - ? WHERE id = ?").bind(ms, ms, payoutId).run();
const payoutRows = (contentId: string) => env.DB.prepare("SELECT id, amount, target_total, status, attempts, error, provider_entry_id, checked_absent_at FROM share_payouts WHERE content_id = ? ORDER BY created_at, rowid").bind(contentId).all<any>().then((r) => r.results);
const audits = (payoutId: string) => env.DB.prepare("SELECT action, actor_kind, reason, after_json FROM audit_log WHERE subject_kind = 'share_payout' AND subject_id = ? ORDER BY created_at, rowid").bind(payoutId).all<any>().then((r) => r.results);
const notes = (memberId: string) => env.DB.prepare("SELECT event_key, kind, path FROM community_notifications WHERE member_id = ? ORDER BY created_at, event_key").bind(memberId).all<any>().then((r) => r.results);

const pay = (contentId: string, token = ADMIN_TOKEN, operationId = op()) => call(`/v1/moderation/campaign/contents/${contentId}/payout`, { method: "POST", token, body: { operationId } });
const retry = (id: string, token = ADMIN_TOKEN, operationId = op()) => call(`/v1/moderation/campaign/payouts/${id}/retry`, { method: "POST", token, body: { operationId } });
const cancel = (id: string, reason: unknown = "pool will not be refilled", token = ADMIN_TOKEN, operationId = op()) =>
  call(`/v1/moderation/campaign/payouts/${id}/cancel`, { method: "POST", token, body: { reason, operationId } });
const check = (id: string, token = ADMIN_TOKEN) => call(`/v1/moderation/campaign/payouts/${id}/check`, { method: "POST", token, body: {} });
const reconcile = (token = ADMIN_TOKEN) => call("/v1/moderation/campaign/payouts/reconcile", { method: "POST", token, body: {} });
const batch = (contentIds: unknown, token = ADMIN_TOKEN, operationId = op()) => call("/v1/moderation/campaign/payouts/batch", { method: "POST", token, body: { contentIds, operationId } });
const list = (q = "", token = ADMIN_TOKEN) => call(`/v1/moderation/campaign/payouts${q}`, { token });
const decide = (id: string, body: Record<string, unknown>, token = ADMIN_TOKEN) =>
  call(`/v1/moderation/campaign/placements/${id}/decision`, { method: "POST", token, body: { expectedVersion: 1, operationId: op(), ...body } });

beforeEach(async () => {
  await resetDb();
  identities({ [ADMIN_TOKEN]: ADMIN, mod: MOD, agent: AGENT, owner: OWNER, other: OTHER });
  appAdmins(ADMIN_TOKEN, "agent");
  admin = await makeReviewer(ADMIN);
  await makeReviewer(MOD);
  await makeAgent(AGENT);
  owner = await makeMember(OWNER);
  await makeMember(OTHER);
  campaignId = await campaign();
  providerPool(1_000_000);
});
afterEach(() => { restoreUpstream(); vi.restoreAllMocks(); });

describe("發放", () => {
  it("群聊分享（輕量）每人每週上限：同一週超過上限的不發，下一週重新算；其他檔位不受影響（owner 2026-10-17）", async () => {
    await env.DB.prepare("UPDATE campaigns SET light_limit = 2 WHERE id = ?").bind(campaignId).run();
    // 台北時間的週一 00:00 起算：10/25（日）23:30 還是第一週，10/26（一）00:30 是下一週
    const sun = Date.UTC(2026, 9, 25, 15, 30), mon = Date.UTC(2026, 9, 25, 16, 30), wed = Date.UTC(2026, 9, 21, 4, 0);
    let reviewed = 1_000;
    const light = async (contentId: string, publishedAt: number) => {
      const id = await placement(contentId, { status: "approved", tier: "light" });
      await env.DB.prepare("UPDATE share_placements SET published_at = ?, reviewed_at = ? WHERE id = ?").bind(publishedAt, reviewed++, id).run();
    };
    const a = await content(owner, OWNER, { tier: null, title: "A" });
    await light(a, wed); await light(a, sun); await light(a, wed);
    const b = await content(owner, OWNER, { tier: null, title: "B" });
    await light(b, wed);
    const c = await content(owner, OWNER, { tier: null, title: "C" });
    await light(c, mon);
    const big = await content(owner, OWNER, { title: "原創" });
    const payable = async () => (await json(await call("/v1/moderation/campaign/payable", { token: ADMIN_TOKEN }))).items as any[];
    const items = await payable();
    const due = Object.fromEntries(items.map((i) => [i.contentTitle, i.due]));
    // A 有三個位置都在第一週，只算先核准的兩個；B 在第一週已經沒有名額；C 在下一週
    expect(due).toEqual({ A: 1000, C: 500, 原創: 3000 });
    expect(await code(await pay(b))).toBe("409 share_nothing_due");
    expect((await json(await pay(a))).amount).toBe(1000);
    expect((await json(await pay(big))).amount).toBe(3000);
    // 申請人自己看到的核准金額也是封頂後的
    const mine = (await json(await call(`/v1/me/campaign/contents?campaign=c${campaignId.slice(0, 8)}`, { token: "owner" }))).items as any[];
    expect(Object.fromEntries(mine.map((m) => [m.title, m.approvedAmount]))).toMatchObject({ A: 1000, B: 0, C: 500 });
    // 沒設上限就不封頂
    await env.DB.prepare("UPDATE campaigns SET light_limit = NULL WHERE id = ?").bind(campaignId).run();
    expect(Object.fromEntries((await payable()).map((i) => [i.contentTitle, i.due]))).toMatchObject({ B: 500 });
  });

  it("正常發放：D1 記成 paid、Provider 收到正確的 key／帳號／金額、通知入帳、稽核 request 與 paid；同一個操作編號重送不再呼叫 Provider", async () => {
    const c = await content(owner, OWNER);
    const opId = op();
    const r = await pay(c, ADMIN_TOKEN, opId);
    expect(r.status).toBe(200);
    expect(r.headers.get("Cache-Control")).toBe("private, no-store");
    const v = await json(r);
    expect(v).toMatchObject({ contentId: c, amount: 3000, targetTotal: 3000, status: "paid", attempts: 1, error: null, checkedAbsentAt: null });
    expect(v.providerEntryId).toBe(pool.entries.get(v.id)!.entryId);
    expect(pool.sent).toEqual([{ token: ADMIN_TOKEN, key: v.id, accountNo: OWNER, amount: 3000, campaignRef: campaignId, contentRef: c }]);
    expect(await notes(owner)).toEqual([{ event_key: `share:payout:${v.id}:share_paid`, kind: "share_paid", path: "/me/campaign" }]);
    expect((await audits(v.id)).map((a: any) => [a.action, a.actor_kind])).toEqual([["request", "human"], ["paid", "human"]]);
    expect(await metrics()).toContain(metric("payout", "success", 1));
    // 同一個操作編號：回那一筆，不再送。
    const again = await pay(c, ADMIN_TOKEN, opId);
    expect(again.status).toBe(200);
    expect((await json(again)).id).toBe(v.id);
    expect(pool.sent).toHaveLength(1);
    // 已經全發完：沒有可發的。
    expect(await code(await pay(c))).toBe("409 share_nothing_due");
    // 同一個操作編號拿去發別的內容：衝突。
    const d = await content(owner, OWNER);
    expect(await code(await pay(d, ADMIN_TOKEN, opId))).toBe("409 campaign_operation_repeated");
    expect(pool.sent).toHaveLength(1);
  });

  it("同內容並發發放只送一次：兩個請求一個 200、一個 409 share_payout_in_progress，Provider 只被呼叫一次", async () => {
    const c = await content(owner, OWNER);
    let release!: () => void;
    pool.gate = new Promise<void>((r) => { release = r; setTimeout(r, 3000); });
    const a = pay(c), b = pay(c);
    await Promise.race([a, b]); // 輸的那個在送出前就被擋下
    release();
    const results = await Promise.all([a, b]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const loser = results.find((r) => r.status === 409)!;
    expect(await json(loser)).toEqual({ error: "share_payout_in_progress" });
    expect(pool.sent).toHaveLength(1);
    expect(await payoutRows(c)).toHaveLength(1);
    expect((await payoutRows(c))[0].status).toBe("paid");
  });

  it("逾時後重試只入帳一次：第一次不知道結果但 Provider 已入帳 → pending；重試同一把 key → paid、replayed:true、只有一列、attempts=2", async () => {
    const c = await content(owner, OWNER);
    pool.dropAfterPay = true;
    const first = await json(await pay(c));
    expect(first).toMatchObject({ status: "pending", attempts: 1, providerEntryId: null });
    expect((await audits(first.id)).map((a: any) => a.action)).toEqual(["request", "unknown"]);
    expect(await notes(owner)).toEqual([]);
    // 還在處理中：不能另開一筆。
    expect(await code(await pay(c))).toBe("409 share_payout_in_progress");
    const r = await retry(first.id);
    expect(r.status).toBe(200);
    const v = await json(r);
    expect(v).toMatchObject({ id: first.id, status: "paid", attempts: 2, amount: 3000 });
    expect(pool.sent.map((s) => s.key)).toEqual([first.id, first.id]);
    expect(pool.entries.size).toBe(1);
    expect(pool.balance).toBe(1_000_000 - 3000);
    const paidAudit = (await audits(first.id)).find((a: any) => a.action === "paid");
    expect(JSON.parse(paidAudit.after_json)).toMatchObject({ replayed: true });
    expect(await payoutRows(c)).toHaveLength(1);
    expect(await notes(owner)).toHaveLength(1);
    // 已入帳的不能再重試。
    expect(await code(await retry(first.id))).toBe("409 share_payout_not_retryable");
  });

  it("算完差額之後別人剛好發完：不照舊的差額再開一筆（409 share_payout_in_progress），只入帳一次", async () => {
    const c = await content(owner, OWNER);
    // 讓 B 算完差額、正要開單時停住；A 在這期間整筆發完。
    let hold!: () => void, reached!: () => void;
    const held = new Promise<void>((r) => { hold = r; }), atInsert = new Promise<void>((r) => { reached = r; });
    const inserts = new WeakSet<object>();
    const tag = (st: D1PreparedStatement): D1PreparedStatement => new Proxy(st, { get(t, k) {
      if (k === "bind") return (...a: unknown[]) => { const b = t.bind(...a); inserts.add(b); return b; };
      const v = Reflect.get(t, k); return typeof v === "function" ? v.bind(t) : v;
    } });
    const slow = new Proxy(env.DB, { get(t, k) {
      if (k === "prepare") return (sql: string) => (/^INSERT INTO share_payouts/.test(sql.trim()) ? tag(t.prepare(sql)) : t.prepare(sql));
      if (k === "batch") return async (stmts: D1PreparedStatement[]) => { if (stmts.some((x) => inserts.has(x))) { reached(); await held; } return t.batch(stmts); };
      const v = Reflect.get(t, k); return typeof v === "function" ? v.bind(t) : v;
    } });
    const b = requestPayout({ env: { ...env, DB: slow }, bearer: ADMIN_TOKEN, provider: "harbor", memberId: admin, now: Date.now }, c, op()).then(() => "ok", (e) => `${e.status} ${e.message}`);
    await atInsert;
    expect((await json(await pay(c))).status).toBe("paid");
    hold();
    expect(await b).toBe("409 share_payout_in_progress");
    expect(pool.sent).toHaveLength(1);
    expect((await payoutRows(c)).map((x: any) => x.status)).toEqual(["paid"]);
  });

  it("重試絕不重算金額：核准檔位在處理中被調高，重試仍送原本那一筆的金額與帳號", async () => {
    const c = await content(owner, OWNER);
    pool.lose = true;
    const first = await json(await pay(c));
    expect(first.status).toBe("pending");
    await env.DB.prepare("UPDATE share_placements SET approved_tier = 'video' WHERE content_id = ?").bind(c).run();
    await retry(first.id);
    expect(pool.sent.map((s) => [s.key, s.amount, s.accountNo])).toEqual([[first.id, 3000, OWNER], [first.id, 3000, OWNER]]);
  });

  it("池不足 → blocked_insufficient、通知排隊中、指標 insufficient；補足後重試同一把 key 成功", async () => {
    const c = await content(owner, OWNER);
    pool.balance = 1000;
    const v = await json(await pay(c));
    expect(v).toMatchObject({ status: "blocked_insufficient", error: "pool_insufficient" });
    expect(await notes(owner)).toEqual([{ event_key: `share:payout:${v.id}:share_queued`, kind: "share_queued", path: "/me/campaign" }]);
    expect(await metrics()).toContain(metric("payout", "insufficient", 1));
    expect(await code(await pay(c))).toBe("409 share_payout_in_progress");
    // 申請人只看到排隊中，看不到池。
    const mine = await json(await call("/v1/me/campaign/contents", { token: "owner" }));
    expect(mine.items[0].payoutState).toBe("queued");
    expect(JSON.stringify(mine)).not.toMatch(/balance|pool/);
    // 還是不足：維持排隊，不再通知一次。
    expect((await json(await retry(v.id))).status).toBe("blocked_insufficient");
    expect(await notes(owner)).toHaveLength(1);
    pool.balance = 5000;
    const r = await json(await retry(v.id));
    expect(r).toMatchObject({ id: v.id, status: "paid", attempts: 3, error: null });
    expect(new Set(pool.sent.map((s) => s.key))).toEqual(new Set([v.id]));
    expect((await notes(owner)).map((n: any) => n.kind)).toEqual(["share_queued", "share_paid"]);
  });

  it("Provider 拒絕（payout_over_limit）→ failed＋錯誤碼，可以重新發放（新的一列）", async () => {
    const c = await content(owner, OWNER);
    pool.reject = "payout_over_limit";
    const v = await json(await pay(c));
    expect(v).toMatchObject({ status: "failed", error: "payout_over_limit" });
    expect(await metrics()).toContain(metric("payout", "denied", 1));
    expect(await code(await retry(v.id))).toBe("409 share_payout_not_retryable");
    const again = await json(await pay(c));
    expect(again).toMatchObject({ status: "paid", amount: 3000 });
    expect(again.id).not.toBe(v.id);
    expect((await payoutRows(c)).map((x: any) => x.status)).toEqual(["failed", "paid"]);
  });

  it("重試處理中的那筆被拒絕：不知道先前那次有沒有入帳，維持 pending 並記下代碼，不改成 failed", async () => {
    const c = await content(owner, OWNER);
    pool.lose = true;
    const v = await json(await pay(c));
    pool.reject = "pool_disabled";
    const r = await json(await retry(v.id));
    expect(r).toMatchObject({ status: "pending", error: "pool_disabled", attempts: 2 });
    expect(await code(await pay(c))).toBe("409 share_payout_in_progress");
  });

  it("降級後不發負數：已發 3000 後把唯一核准位置改成 light → 409 share_nothing_due", async () => {
    const c = await content(owner, OWNER, { tier: null });
    const p = await placement(c, { status: "submitted", requested: "original" });
    const approved = await json(await decide(p, { decision: "approve" }));
    expect(approved.payout).toMatchObject({ status: "paid", amount: 3000 });
    const down = await json(await decide(p, { decision: "approve", tier: "light", expectedVersion: 2 }));
    expect(down.placement.approvedTier).toBe("light");
    expect(down.payout).toBeNull();
    expect(await code(await pay(c))).toBe("409 share_nothing_due");
    expect(pool.sent).toHaveLength(1);
    expect(await count("SELECT count(*) AS n FROM share_payouts WHERE amount <= 0")).toBe(0);
  });

  it("升級後只補差額 2000", async () => {
    const c = await content(owner, OWNER, { tier: null });
    const p = await placement(c, { status: "submitted", requested: "original" });
    await decide(p, { decision: "approve" });
    // 非管理員的審核員調檔位：不自動發。
    const up = await json(await decide(p, { decision: "approve", tier: "guide", expectedVersion: 2 }, "mod"));
    expect(up.payout).toBeNull();
    const v = await json(await pay(c));
    expect(v).toMatchObject({ status: "paid", amount: 2000, targetTotal: 5000 });
    expect(pool.sent.map((s) => s.amount)).toEqual([3000, 2000]);
  });
});

describe("閘門", () => {
  it("AI 帳號不能發放：payout、retry、cancel、check、reconcile、batch、列表都 403 agent_not_allowed，Provider 沒被呼叫", async () => {
    const c = await content(owner, OWNER);
    pool.balance = 0;
    const v = await json(await pay(c));
    const sent = pool.sent.length;
    for (const r of [await pay(c, "agent"), await retry(v.id, "agent"), await cancel(v.id, "x", "agent"), await check(v.id, "agent"), await reconcile("agent"), await batch([c], "agent"), await list("", "agent")]) {
      expect(await code(r)).toBe("403 agent_not_allowed");
    }
    expect(pool.sent).toHaveLength(sent);
    expect(pool.checked).toEqual([]);
    expect((await payoutRows(c))[0].status).toBe("blocked_insufficient");
  });

  it("不是應用管理員的真人審核員 403 community_admin_required；一般成員 403；訪客 401", async () => {
    const c = await content(owner, OWNER);
    for (const r of [await pay(c, "mod"), await batch([c], "mod"), await list("", "mod"), await reconcile("mod")]) expect(await code(r)).toBe("403 community_admin_required");
    expect((await pay(c, "other")).status).toBe(403);
    expect((await pay(c, "")).status).toBe(401);
    expect(pool.sent).toEqual([]);
    expect(await metrics()).toContain('hearthroom_campaign_operations_total{operation="payout",outcome="denied"}');
  });

  it("問不到供應商誰是應用管理員：發放、批次、列表、對帳、點數池都 503 community_admin_unavailable，不放行、不送出", async () => {
    const c = await content(owner, OWNER);
    upstream.fetchCommunityStatus = async () => { throw new Error("offline"); };
    const rs = [await pay(c), await batch([c]), await list(""), await reconcile(), await call("/v1/moderation/campaign/payable", { token: ADMIN_TOKEN }), await call("/v1/moderation/campaign-pool", { token: ADMIN_TOKEN })];
    for (const r of rs) expect(await code(r)).toBe("503 community_admin_unavailable");
    expect(pool.sent).toEqual([]);
    expect(await payoutRows(c)).toEqual([]);
  });

  it("發獎截止後 409 campaign_payout_closed（發放與重試都是）；對帳照樣能補記", async () => {
    const c = await content(owner, OWNER);
    pool.dropAfterPay = true;
    const v = await json(await pay(c));
    await closePayout();
    const d = await content(owner, OWNER);
    expect(await code(await pay(d))).toBe("409 campaign_payout_closed");
    expect(await code(await retry(v.id))).toBe("409 campaign_payout_closed");
    expect(pool.sent).toHaveLength(1);
    expect((await json(await check(v.id))).payout.status).toBe("paid");
  });

  it("草稿活動不發 409 campaign_not_payable", async () => {
    const draft = await campaign({ status: "draft" });
    const c = await content(owner, OWNER, { cId: draft });
    expect(await code(await pay(c))).toBe("409 campaign_not_payable");
    expect(await code(await pay(crypto.randomUUID()))).toBe("404 share_content_not_found");
    expect(pool.sent).toEqual([]);
  });

  it("不能發給自己：申請人是自己，或收款帳號連結在自己名下，都 403 share_self_payout", async () => {
    const own = await content(admin, ADMIN);
    expect(await code(await pay(own))).toBe("403 share_self_payout");
    // 內容記在別人名下，但收款帳號是管理員連結過來的 Harbor 帳號。
    await env.DB.prepare("INSERT INTO member_connections (owner_member_id, provider, external_id, linked_at) VALUES (?, 'harbor', ?, ?)").bind(admin, String(OTHER), Date.now()).run();
    const linked = await content(owner, OTHER);
    expect(await code(await pay(linked))).toBe("403 share_self_payout");
    expect((await json(await batch([linked]))).items).toEqual([{ contentId: linked, error: "share_self_payout" }]);
    expect(pool.sent).toEqual([]);
  });
});

describe("取消與對帳", () => {
  it("取消：池不足的可以取消；剛建立的 pending 不行；對帳回查無且超過 10 分鐘後才可以", async () => {
    const a = await content(owner, OWNER);
    pool.balance = 0;
    const blocked = await json(await pay(a));
    expect(await code(await cancel(blocked.id, ""))).toBe("400 share_invalid reason");
    const r = await cancel(blocked.id);
    expect(r.status).toBe(200);
    expect(await json(r)).toMatchObject({ status: "cancelled" });
    expect((await audits(blocked.id)).at(-1)).toMatchObject({ action: "cancel", reason: "pool will not be refilled" });
    expect(await code(await cancel(blocked.id))).toBe("409 share_payout_not_cancellable");

    pool.balance = 1_000_000;
    const b = await content(owner, OWNER);
    pool.lose = true;
    const pending = await json(await pay(b));
    expect(pending.status).toBe("pending");
    expect(await code(await cancel(pending.id))).toBe("409 share_payout_not_cancellable");
    // 剛送出不久：查無不算數（Provider 可能還在處理）。
    const early = await json(await check(pending.id));
    expect(early).toMatchObject({ result: "absent", payout: { status: "pending", checkedAbsentAt: null } });
    await backdate(pending.id, 11 * MIN);
    expect(await code(await cancel(pending.id))).toBe("409 share_payout_not_cancellable");
    const late = await json(await check(pending.id));
    expect(late.result).toBe("absent");
    expect(late.payout.checkedAbsentAt).toBeTypeOf("number");
    expect((await json(await cancel(pending.id))).status).toBe("cancelled");
    // 取消後可以重新發放（新的一把 key）。
    const again = await json(await pay(b));
    expect(again).toMatchObject({ status: "paid", amount: 3000 });
    expect(pool.entries.size).toBe(1);
  });

  it("重試會讓先前的查無作廢：要再對帳一次才能取消", async () => {
    const c = await content(owner, OWNER);
    pool.lose = true;
    const v = await json(await pay(c));
    await backdate(v.id, 11 * MIN);
    expect((await json(await check(v.id))).payout.checkedAbsentAt).toBeTypeOf("number");
    pool.lose = true;
    expect((await json(await retry(v.id))).checkedAbsentAt).toBeNull();
    expect(await code(await cancel(v.id))).toBe("409 share_payout_not_cancellable");
  });

  it("對帳：超過 10 分鐘的 pending，Provider 有就補記 paid（通知入帳），查無就填時間；剛建立的不動", async () => {
    const a = await content(owner, OWNER), b = await content(owner, OWNER), fresh = await content(owner, OWNER);
    pool.dropAfterPay = true;
    const pa = await json(await pay(a));
    pool.lose = true;
    const pb = await json(await pay(b));
    pool.lose = true;
    const pf = await json(await pay(fresh));
    await backdate(pa.id, 11 * MIN);
    await backdate(pb.id, 12 * MIN);
    const r = await reconcile();
    expect(r.status).toBe(200);
    const body = await json(r);
    expect(body.items.map((x: any) => [x.payout.id, x.result])).toEqual([[pb.id, "absent"], [pa.id, "paid"]]);
    expect(pool.checked.sort()).toEqual([pa.id, pb.id].sort());
    const rows = Object.fromEntries((await env.DB.prepare("SELECT id, status, provider_entry_id, checked_absent_at FROM share_payouts").all<any>()).results.map((x) => [x.id, x]));
    expect(rows[pa.id]).toMatchObject({ status: "paid", provider_entry_id: pool.entries.get(pa.id)!.entryId });
    expect(rows[pb.id].status).toBe("pending");
    expect(rows[pb.id].checked_absent_at).toBeTypeOf("number");
    expect(rows[pf.id]).toMatchObject({ status: "pending", checked_absent_at: null });
    expect((await notes(owner)).map((n: any) => n.event_key)).toEqual([`share:payout:${pa.id}:share_paid`]);
    expect(await metrics()).toContain(metric("reconcile", "success", 2));
    // 再對一次：已入帳的不再通知。
    await reconcile();
    expect(await notes(owner)).toHaveLength(1);
  });

  it("重試與對帳同時記成 paid：只有一個寫得進去，只通知一次", async () => {
    const c = await content(owner, OWNER);
    pool.dropAfterPay = true;
    const v = await json(await pay(c));
    // 兩個都已經送到 Provider、都會拿到「入帳」，才放行：兩邊同時要把它記成 paid。
    let release!: () => void;
    pool.gate = new Promise<void>((r) => { release = r; setTimeout(r, 3000); });
    const both = Promise.all([retry(v.id), check(v.id)]);
    for (let i = 0; i < 300 && (pool.sent.length < 2 || pool.checked.length < 1); i++) await new Promise((r) => setTimeout(r, 5));
    expect([pool.sent.length, pool.checked.length]).toEqual([2, 1]);
    release();
    const [x, y] = await both;
    expect([x.status, y.status]).toEqual([200, 200]);
    expect((await payoutRows(c))[0].status).toBe("paid");
    expect((await audits(v.id)).filter((a: any) => a.action === "paid")).toHaveLength(1);
    expect(await notes(owner)).toHaveLength(1);
  });
});

describe("修正一：同一把 key 的舊結果與重試", () => {
  it("C1 池不足的那筆重試後結果未知（其實已入帳）：先變回 pending，不能立刻取消；對帳補記 paid 後沒有可發的", async () => {
    const c = await content(owner, OWNER);
    pool.balance = 0;
    const v = await json(await pay(c));
    expect(v.status).toBe("blocked_insufficient");
    pool.balance = 5000;
    pool.dropAfterPay = true;
    const r = await json(await retry(v.id));
    expect(r).toMatchObject({ status: "pending", attempts: 2 });
    expect(await code(await cancel(v.id))).toBe("409 share_payout_not_cancellable");
    await backdate(v.id, 11 * MIN);
    expect(await code(await cancel(v.id))).toBe("409 share_payout_not_cancellable");
    expect((await json(await check(v.id))).payout).toMatchObject({ status: "paid", providerEntryId: pool.entries.get(v.id)!.entryId });
    expect(await code(await pay(c))).toBe("409 share_nothing_due");
    expect(pool.entries.size).toBe(1);
  });

  it("I1 舊的那次送出晚回池不足：較新的一次（同一把 key）還在送，這筆維持 pending、不放開唯一索引", async () => {
    const c = await content(owner, OWNER);
    let n = 0, open1!: () => void, open2!: () => void;
    const g1 = new Promise<void>((r) => { open1 = r; setTimeout(r, 3000); }), g2 = new Promise<void>((r) => { open2 = r; setTimeout(r, 3000); });
    upstream.payCampaign = async (): Promise<PayResult> => {
      const me = ++n;
      if (me === 1) { await g1; return { kind: "insufficient" }; }
      await g2;
      return { kind: "unknown" };
    };
    const wait = async (k: number) => { for (let i = 0; i < 300 && n < k; i++) await new Promise((r) => setTimeout(r, 5)); expect(n).toBe(k); };
    const a = pay(c);
    await wait(1);
    const id = (await payoutRows(c))[0].id;
    const b = retry(id);
    await wait(2);
    open1();
    const ra = await json(await a);
    expect(ra).toMatchObject({ id, status: "pending", attempts: 2 });
    expect(await code(await pay(c))).toBe("409 share_payout_in_progress");
    expect(await notes(owner)).toEqual([]);
    open2();
    expect((await json(await b)).status).toBe("pending");
    expect((await payoutRows(c))[0]).toMatchObject({ status: "pending", attempts: 2 });
  });

  it("I1 同一筆同時兩次重試：只有一個送得出去（次數只加一）", async () => {
    const c = await content(owner, OWNER);
    pool.lose = true;
    const v = await json(await pay(c));
    let release!: () => void;
    pool.gate = new Promise<void>((r) => { release = r; setTimeout(r, 3000); });
    const x = retry(v.id), y = retry(v.id);
    await Promise.race([x, y]);
    release();
    expect((await Promise.all([x, y])).map((r) => r.status).sort()).toEqual([200, 409]);
    expect(pool.sent).toHaveLength(2);
    expect((await payoutRows(c))[0]).toMatchObject({ status: "paid", attempts: 2 });
  });

  it("M1 池不足那筆重試回 idempotency_conflict：Provider 手上有這把 key，不改成 failed，記下代碼", async () => {
    const c = await content(owner, OWNER);
    pool.balance = 0;
    const v = await json(await pay(c));
    pool.reject = "idempotency_conflict";
    const r = await json(await retry(v.id));
    expect(r).toMatchObject({ status: "pending", error: "idempotency_conflict" });
    expect(await code(await pay(c))).toBe("409 share_payout_in_progress");
  });

  it("對帳跳過剛送過的列（剛重試的舊列不搶名額）；重試的稽核記下回到 pending", async () => {
    const c = await content(owner, OWNER);
    pool.lose = true;
    const v = await json(await pay(c));
    await env.DB.prepare("UPDATE share_payouts SET created_at = ? WHERE id = ?").bind(Date.now() - 60 * MIN, v.id).run();
    expect((await json(await reconcile())).items).toHaveLength(0);
    expect(pool.checked).toEqual([]);
    await env.DB.prepare("UPDATE share_payouts SET status = 'blocked_insufficient' WHERE id = ?").bind(v.id).run();
    pool.lose = true;
    await retry(v.id);
    expect((await audits(v.id)).find((a: any) => a.action === "retry")?.after_json).toContain('"status":"pending"');
  });

  it("I2 對帳：先查還沒查過的，舊的查無列不佔名額；重複查無只留一筆稽核", async () => {
    const now = Date.now();
    for (let i = 0; i < 20; i++) {
      const c = await content(owner, OWNER);
      await env.DB.prepare("INSERT INTO share_payouts (id, content_id, amount, target_total, status, requested_by, attempts, checked_absent_at, created_at, updated_at) VALUES (?, ?, 3000, 3000, 'pending', ?, 1, ?, ?, ?)")
        .bind(crypto.randomUUID(), c, admin, now - 20 * MIN, now - 60 * MIN - i, now - 60 * MIN - i).run();
    }
    const c = await content(owner, OWNER);
    pool.lose = true;
    const v = await json(await pay(c));
    await backdate(v.id, 11 * MIN);
    const first = (await json(await reconcile())).items;
    expect(first).toHaveLength(20);
    expect(first[0]).toMatchObject({ result: "absent", payout: { id: v.id } });
    expect((await json(await reconcile())).items.find((x: any) => x.payout.id === v.id)).toBeUndefined();
    await check(v.id);
    expect((await audits(v.id)).filter((a: any) => a.action === "absent")).toHaveLength(1);
  });
});

describe("最終修正", () => {
  it("I1 池不足那筆排隊時被降級：重試回 409 share_payout_stale、不送 Provider、維持排隊；取消後重新發放只發新的差額", async () => {
    const c = await content(owner, OWNER, { tier: null });
    const p = await placement(c, { status: "approved", tier: "video" });
    pool.balance = 0;
    const v = await json(await pay(c));
    expect(v).toMatchObject({ status: "blocked_insufficient", amount: 10000 });
    await env.DB.prepare("UPDATE share_placements SET approved_tier = 'light' WHERE id = ?").bind(p).run();
    pool.balance = 1_000_000;
    const sent = pool.sent.length;
    expect(await code(await retry(v.id))).toBe("409 share_payout_stale");
    expect(pool.sent).toHaveLength(sent);
    expect((await payoutRows(c))[0]).toMatchObject({ status: "blocked_insufficient", attempts: 1, amount: 10000 });
    await cancel(v.id);
    const again = await json(await pay(c));
    expect(again).toMatchObject({ status: "paid", amount: 500 });
    expect(again.id).not.toBe(v.id);
    expect(pool.sent.map((s) => s.amount)).toEqual([10000, 500]);
  });

  it("I1 排隊時被升級：重試照原金額送（同一把 key），差額由下一次請求補", async () => {
    const c = await content(owner, OWNER, { tier: null });
    const p = await placement(c, { status: "approved", tier: "original" });
    pool.balance = 0;
    const v = await json(await pay(c));
    await env.DB.prepare("UPDATE share_placements SET approved_tier = 'guide' WHERE id = ?").bind(p).run();
    pool.balance = 1_000_000;
    expect(await json(await retry(v.id))).toMatchObject({ status: "paid", amount: 3000 });
    expect(await json(await pay(c))).toMatchObject({ status: "paid", amount: 2000 });
  });

  it("M2 管理員再核准一次同檔位同計數（沒有寫入）：不自動發放", async () => {
    const c = await content(owner, OWNER, { tier: null });
    const p = await placement(c, { requested: "original" });
    // 非管理員先核准：有可發的金額，但還沒發。
    const first = await json(await decide(p, { decision: "approve" }, "mod"));
    expect(first.placement.version).toBe(2);
    const same = await json(await decide(p, { decision: "approve", expectedVersion: 2 }));
    expect(same.placement.version).toBe(2);
    expect(same.payout).toBeNull();
    expect(pool.sent).toEqual([]);
    expect(await count("SELECT count(*) AS n FROM share_payouts")).toBe(0);
  });
});

describe("核准後自動發放", () => {
  it("真人管理員核准即發；不是管理員的審核員與 AI 帳號核准都不發", async () => {
    const a = await content(owner, OWNER, { tier: null });
    const pa = await placement(a, { requested: "guide" });
    const r = await json(await decide(pa, { decision: "approve" }));
    expect(r.placement.reviewStatus).toBe("approved");
    expect(r.payout).toMatchObject({ contentId: a, status: "paid", amount: 5000 });
    expect((await audits(r.payout.id))[0].action).toBe("request");

    const b = await content(owner, OWNER, { tier: null });
    const pb = await placement(b);
    expect((await json(await decide(pb, { decision: "approve" }, "mod"))).payout).toBeNull();
    const c = await content(owner, OWNER, { tier: null });
    const pc = await placement(c);
    expect((await json(await decide(pc, { decision: "approve" }, "agent"))).payout).toBeNull();
    expect(pool.sent).toHaveLength(1);
    expect(await count("SELECT count(*) AS n FROM share_payouts")).toBe(1);
  });

  it("核准了但池不足：核准照樣成立、回應帶排隊中的那一筆；重送同一個決定不再送；截止後核准不發也不算錯", async () => {
    const a = await content(owner, OWNER, { tier: null });
    const p = await placement(a);
    pool.balance = 0;
    const opId = op();
    const r = await json(await decide(p, { decision: "approve", operationId: opId }));
    expect(r.placement.reviewStatus).toBe("approved");
    expect(r.payout).toMatchObject({ status: "blocked_insufficient" });
    const again = await json(await decide(p, { decision: "approve", operationId: opId }));
    expect(again.payout.id).toBe(r.payout.id);
    expect(pool.sent).toHaveLength(1);
    // 同一份內容還有排隊中的那筆：再核准一個位置，核准成立，發放回錯誤碼。
    const second = await json(await decide(await placement(a), { decision: "approve" }));
    expect(second.placement.reviewStatus).toBe("approved");
    expect(second).toMatchObject({ payout: null, payoutError: "share_payout_in_progress" });
    expect(pool.sent).toHaveLength(1);
    // 截止後核准：不發，也不算錯。
    await closePayout();
    const late = await placement(await content(owner, OWNER, { tier: null }));
    const lr = await json(await decide(late, { decision: "approve" }));
    expect(lr.payout).toBeNull();
    expect(lr.payoutError).toBeUndefined();
  });
});

describe("批次與列表", () => {
  it("批次：21 筆 400；一筆池不足不影響其他筆；找不到的那筆只有它自己報錯；重送不再發", async () => {
    expect(await code(await batch(Array.from({ length: 21 }, () => crypto.randomUUID())))).toBe("400 share_invalid contentIds");
    expect(await code(await batch([]))).toBe("400 share_invalid contentIds");
    const a = await content(owner, OWNER), big = await content(owner, OWNER, { tier: "video" }), c = await content(owner, OWNER);
    const missing = crypto.randomUUID();
    pool.balance = 6500;
    const opId = op();
    const r = await batch([a, big, missing, c], ADMIN_TOKEN, opId);
    expect(r.status).toBe(200);
    const items = (await json(r)).items;
    expect(items.map((x: any) => [x.contentId, x.payout?.status ?? x.error])).toEqual([[a, "paid"], [big, "blocked_insufficient"], [missing, "share_content_not_found"], [c, "paid"]]);
    expect(pool.sent.map((s) => s.amount)).toEqual([3000, 10000, 3000]);
    const sent = pool.sent.length;
    const again = (await json(await batch([a, big, missing, c], ADMIN_TOKEN, opId))).items;
    expect(again.map((x: any) => x.payout?.id ?? x.error)).toEqual(items.map((x: any) => x.payout?.id ?? x.error));
    expect(pool.sent).toHaveLength(sent);
  });

  it("列表：內容標題、申請人 handle、金額、狀態、錯誤碼、次數、時間、entryId；可依狀態與活動篩選；不含成員 id 與收款帳號", async () => {
    const a = await content(owner, OWNER, { title: "攻略分享" });
    const b = await content(owner, OWNER);
    const pa = await json(await pay(a));
    pool.balance = 0;
    const pb = await json(await pay(b));
    const r = await list();
    expect(r.status).toBe(200);
    expect(r.headers.get("Cache-Control")).toBe("private, no-store");
    const body = await json(r);
    expect(body.total).toBe(2);
    const slug = (await env.DB.prepare("SELECT slug FROM campaigns WHERE id = ?").bind(campaignId).first<string>("slug"))!;
    expect(body.items.find((x: any) => x.id === pa.id)).toEqual({
      id: pa.id, contentId: a, contentTitle: "攻略分享", campaignSlug: slug, applicant: { handle: testHandle(OWNER) }, amount: 3000, targetTotal: 3000,
      status: "paid", error: null, attempts: 1, providerEntryId: pa.providerEntryId, checkedAbsentAt: null, createdAt: pa.createdAt, updatedAt: expect.any(Number), settledAt: expect.any(Number),
    });
    expect(JSON.stringify(body)).not.toContain(owner);
    expect(JSON.stringify(body)).not.toMatch(/recipient|accountNo|memberId|requestedBy/);
    expect((await json(await list("?status=blocked_insufficient"))).items.map((x: any) => x.id)).toEqual([pb.id]);
    expect((await json(await list("?campaign=nope"))).items).toEqual([]);
    expect(await code(await list("?status=bogus"))).toBe("400 share_invalid status");
  });

  it("令牌不出現在任何 console 輸出", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m));
    const a = await content(owner, OWNER), b = await content(owner, OWNER);
    pool.dropAfterPay = true;
    const v = await json(await pay(a));
    await retry(v.id);
    pool.balance = 0;
    await batch([b, crypto.randomUUID()]);
    await reconcile();
    await list();
    const printed = spies.flatMap((s) => s.mock.calls.map((args) => args.map((x) => (typeof x === "string" ? x : JSON.stringify(x) ?? String(x))).join(" "))).join("\n");
    expect(printed).not.toContain(ADMIN_TOKEN);
  });
});
