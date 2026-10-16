import { auditStmt, auditStmtIfChanged } from "./audit";
import { canActivate, getCampaign, listCampaigns, memberLightCaps, payoutAmount, type Campaign, type Tier } from "./campaign";
import { ownsAccount } from "./campaign-review";
import { bumpOp } from "./ops-metrics";
import type { ProviderId } from "./providers";
import { upstream, type PayResult } from "./upstream";
import { HttpError, type Env } from "./types";

/**
 * 分享獎勵的發放、重試、取消與對帳（開業活動設計 §4.4）。錢只在 Provider：本站記發放紀錄，
 * share_payouts.id 就是 Provider 的冪等鍵，同一筆紀錄不管送幾次都用同一把 key、同一個金額與帳號。
 *
 * 呼叫端（路由）已經確認：真人審核員、Provider 回報是本站應用管理員。令牌只用來呼叫 Provider，不落地、不進日誌。
 *
 * 狀態：pending（送出了、結果未知或還沒回）→ paid／blocked_insufficient／failed；blocked_insufficient → paid／failed／cancelled；
 * pending 在查無且夠久之後 → cancelled。同一份內容同時最多一筆 pending 或 blocked_insufficient（部分唯一索引）。
 * Provider 說入帳了就記 paid（不管本站當下記的是什麼），其餘結果只從預期的狀態改，用 changes() 串稽核與通知。
 */
export type Payer = { env: Env; bearer: string; provider: ProviderId; memberId: string; now: () => number };

const TEN_MIN = 600_000;
const PAGE = 20;
export const BATCH_MAX = 20;
const STATUSES = ["pending", "paid", "blocked_insufficient", "failed", "cancelled"] as const;
const OPEN = ["pending", "blocked_insufficient"];

type Row = {
  id: string; content_id: string; amount: number; target_total: number; status: string; provider_entry_id: string | null; error: string | null; attempts: number;
  checked_absent_at: number | null; created_at: number; updated_at: number; settled_at: number | null;
  member_id: string; recipient_account_no: number; campaign_id: string;
};
const COLUMNS = `p.id, p.content_id, p.amount, p.target_total, p.status, p.provider_entry_id, p.error, p.attempts, p.checked_absent_at, p.created_at, p.updated_at, p.settled_at,
  s.member_id, s.recipient_account_no, s.campaign_id FROM share_payouts p JOIN share_contents s ON s.id = p.content_id`;

const view = (r: Row) => ({
  id: r.id, contentId: r.content_id, amount: r.amount, targetTotal: r.target_total, status: r.status, error: r.error, attempts: r.attempts,
  providerEntryId: r.provider_entry_id, checkedAbsentAt: r.checked_absent_at, createdAt: r.created_at, updatedAt: r.updated_at, settledAt: r.settled_at,
});
export type PayoutView = ReturnType<typeof view>;

const load = (db: D1Database, id: string) => db.prepare(`SELECT ${COLUMNS} WHERE p.id = ?`).bind(id).first<Row>();
const current = async (db: D1Database, id: string) => view((await load(db, id))!);

/**
 * 這個操作編號這個人用過沒有：用過且是同一種發放動作 → 回那筆發放的 id；用在別的事上 → 409。
 * 衍生的編號（批次 `<op>:<i>`、核准後 `<op>:payout`、結果 `<op>:settle`）帶冒號，用戶端送不出來，不會跟它的編號撞。
 */
async function replayed(db: D1Database, actor: string, op: string, action: string): Promise<string | null> {
  const r = await db.prepare("SELECT subject_kind, subject_id, action FROM audit_log WHERE actor_member_id = ? AND operation_id = ?").bind(actor, op)
    .first<{ subject_kind: string; subject_id: string; action: string }>();
  if (!r) return null;
  if (r.subject_kind !== "share_payout" || r.action !== action) throw new HttpError(409, "campaign_operation_repeated");
  return r.subject_id;
}

/** 草稿或設定不完整的活動不發（不靠計算的預設值兜底）；發獎截止後不發，要延長就改活動設定。 */
function payable(c: Campaign | null, now: number) {
  if (!c || c.status === "draft" || !canActivate(c).ok) throw new HttpError(409, "campaign_not_payable");
  if (now >= c.payoutDeadline!) throw new HttpError(409, "campaign_payout_closed");
}

/** 錢不能發到操作者自己：申請人是自己，或收款帳號是自己的（登入或連結的）Harbor 帳號。 */
async function notSelf(db: D1Database, actor: string, memberId: string, accountNo: number) {
  if (memberId === actor || (await ownsAccount(db, actor, accountNo))) throw new HttpError(403, "share_self_payout");
}

const send = (x: Payer, r: Row): Promise<PayResult> =>
  upstream.payCampaign(x.env, x.bearer, { key: r.id, accountNo: r.recipient_account_no, amount: r.amount, campaignRef: r.campaign_id, contentRef: r.content_id }, x.provider)
    .catch(() => ({ kind: "unknown" }) as const);

const NOTIFY = `INSERT OR IGNORE INTO community_notifications (event_key, member_id, kind, path, created_at, extra, delivered)
  SELECT ?, ?, ?, '/me/campaign', ?, NULL, 1 WHERE EXISTS (SELECT 1 FROM audit_log WHERE id = ?)
  AND NOT EXISTS (SELECT 1 FROM community_preferences pr WHERE pr.member_id = ? AND pr.notifications = 0)`;

/**
 * 把一次 Provider 結果寫回去，一個 batch：條件式 UPDATE → 稽核（changes() 串接）→ 通知（以這一筆稽核存在為條件，event_key 每筆發放每種只一次）。
 * 並發的重試與對帳都拿到「入帳」時只有一個改得到列，只留一筆稽核、只通知一次。
 * 每次送出都從 pending 出發（重試先把列改回 pending），r.attempts 是這一次送出的次數：
 * 入帳以外的結果只在列仍是 pending 且次數還是這一次時才寫，晚回來的舊結果不會在較新的送出還沒回來時把列移出 pending
 * （移出就放開了「同內容只能有一筆」的唯一索引，別人可以另開一筆再發）。入帳不看次數：Provider 說付了就是付了。
 * rejectFails：這次被拒能不能證明這把 key 從沒入帳。第一次送出，或重試前是池不足（Provider 明確沒寫入）才算；
 * 處理中（上一次結果未知）的那筆被拒不能證明什麼，idempotency_conflict 更表示 Provider 手上有這把 key：
 * 這些都維持 pending 只記代碼，要靠對帳查無才能取消。
 */
async function settle(x: Payer, r: Row, res: PayResult, op: string, rejectFails: boolean, metric: "payout" | "reconcile") {
  const db = x.env.DB, now = x.now(), auditId = crypto.randomUUID();
  const audit = (action: string, extra: { reason?: string; after?: unknown } = {}) =>
    ({ id: auditId, subjectKind: "share_payout", subjectId: r.id, actorMemberId: x.memberId, actorKind: "human", action, before: { status: r.status }, operationId: `${op}:settle`, now, ...extra }) as const;
  const notify = (kind: "share_paid" | "share_queued") => db.prepare(NOTIFY).bind(`share:payout:${r.id}:${kind}`, r.member_id, kind, now, auditId, r.member_id);
  let writes: D1PreparedStatement[];
  if (res.kind === "paid") {
    writes = [
      db.prepare("UPDATE share_payouts SET status = 'paid', provider_entry_id = ?, error = NULL, settled_at = ?, updated_at = ? WHERE id = ? AND status <> 'paid'").bind(res.entryId, now, now, r.id),
      auditStmtIfChanged(db, audit("paid", { after: { status: "paid", entryId: res.entryId, replayed: res.replayed } })),
      notify("share_paid"),
    ];
  } else if (res.kind === "insufficient") {
    writes = [
      db.prepare("UPDATE share_payouts SET status = 'blocked_insufficient', error = 'pool_insufficient', updated_at = ? WHERE id = ? AND status = 'pending' AND attempts = ?").bind(now, r.id, r.attempts),
      auditStmtIfChanged(db, audit("insufficient", { after: { status: "blocked_insufficient" } })),
      notify("share_queued"),
    ];
  } else if (res.kind === "rejected" && rejectFails && res.code !== "idempotency_conflict") {
    writes = [
      db.prepare("UPDATE share_payouts SET status = 'failed', error = ?, settled_at = ?, updated_at = ? WHERE id = ? AND status = 'pending' AND attempts = ?").bind(res.code, now, now, r.id, r.attempts),
      auditStmtIfChanged(db, audit("failed", { reason: res.code, after: { status: "failed" } })),
    ];
  } else if (res.kind === "rejected") {
    writes = [
      db.prepare("UPDATE share_payouts SET error = ? WHERE id = ? AND status = 'pending' AND attempts = ?").bind(res.code, r.id, r.attempts),
      auditStmtIfChanged(db, audit("rejected", { reason: res.code, after: { status: "pending" } })),
    ];
  } else {
    // 不知道有沒有入帳：狀態與次數都不動，只留紀錄。之後用同一把 key 重試或對帳。
    writes = [auditStmt(db, audit("unknown"))];
  }
  await db.batch(writes);
  await bumpOp(db, "campaign", metric, res.kind === "paid" ? "success" : res.kind === "insufficient" ? "insufficient" : res.kind === "rejected" ? "denied" : "error");
}

/** 這份內容現在該拿多少（目標）、已發多少、還差多少。 */
async function owed(db: D1Database, contentId: string, campaign: Campaign) {
  const [ps, paid, owner] = await db.batch([
    db.prepare("SELECT review_status, approved_tier, counts_as_placement FROM share_placements WHERE content_id = ?").bind(contentId),
    db.prepare("SELECT COALESCE(sum(amount), 0) AS n FROM share_payouts WHERE content_id = ? AND status = 'paid'").bind(contentId),
    db.prepare("SELECT member_id FROM share_contents WHERE id = ?").bind(contentId),
  ]);
  const paidTotal = (paid!.results[0] as { n: number }).n;
  const memberId = (owner!.results[0] as { member_id: string } | undefined)?.member_id;
  const caps = memberId ? await memberLightCaps(db, campaign, [memberId]) : new Map<string, number>();
  const { target, due } = payoutAmount(
    (ps!.results as { review_status: string; approved_tier: Tier | null; counts_as_placement: number }[])
      .map((p) => ({ reviewStatus: p.review_status, approvedTier: p.approved_tier, countsAsPlacement: !!p.counts_as_placement })),
    campaign, paidTotal, caps.get(contentId),
  );
  return { paidTotal, target, due };
}

const isUnique = (e: unknown, table: string) => new RegExp(`UNIQUE constraint failed: ${table}\\.`).test(String(e));

/** 第一次發放：算出還差多少，開一筆 pending（同內容同時只能有一筆），再送 Provider。 */
export async function requestPayout(x: Payer, contentId: string, op: string): Promise<PayoutView> {
  const db = x.env.DB, now = x.now();
  const replay = async () => {
    const prior = await replayed(db, x.memberId, op, "request");
    if (!prior) return null;
    const r = await load(db, prior);
    if (!r || r.content_id !== contentId) throw new HttpError(409, "campaign_operation_repeated");
    return view(r);
  };
  const again = await replay();
  if (again) return again;

  const s = await db.prepare("SELECT id, member_id, recipient_account_no, campaign_id FROM share_contents WHERE id = ?").bind(contentId)
    .first<{ id: string; member_id: string; recipient_account_no: number; campaign_id: string }>();
  if (!s) throw new HttpError(404, "share_content_not_found");
  const campaign = await getCampaign(db, s.campaign_id);
  payable(campaign, now);
  await notSelf(db, x.memberId, s.member_id, s.recipient_account_no);

  const { paidTotal, target, due } = await owed(db, contentId, campaign!);
  if (due <= 0) throw new HttpError(409, "share_nothing_due");

  const id = crypto.randomUUID();
  let inserted = 0;
  try {
    // 只有在算金額時讀到的已發總額沒變才開單：讀完之後別人剛好發完一筆，這裡就不會照舊的差額再發一次。
    const [ins] = await db.batch([
      db.prepare(`INSERT INTO share_payouts (id, content_id, amount, target_total, status, requested_by, attempts, created_at, updated_at)
        SELECT ?, ?, ?, ?, 'pending', ?, 1, ?, ? WHERE (SELECT COALESCE(sum(amount), 0) FROM share_payouts WHERE content_id = ? AND status = 'paid') = ?`)
        .bind(id, contentId, due, target, x.memberId, now, now, contentId, paidTotal),
      auditStmtIfChanged(db, { subjectKind: "share_payout", subjectId: id, actorMemberId: x.memberId, actorKind: "human", action: "request", after: { amount: due, targetTotal: target }, operationId: op, now }),
    ]);
    inserted = ins!.meta.changes;
  } catch (e) {
    const r = await replay();
    if (r) return r;
    if (isUnique(e, "share_payouts")) throw new HttpError(409, "share_payout_in_progress");
    throw e;
  }
  if (!inserted) {
    const r = await replay();
    if (r) return r;
    throw new HttpError(409, "share_payout_in_progress");
  }
  const row = (await load(db, id))!;
  await settle(x, row, await send(x, row), op, true, "payout");
  return current(db, id);
}

/**
 * 重試：只限 pending 或池不足；同一把 key、同一個金額與帳號（絕不重算）。送出前先把列改回 pending、次數加一、先前的查無作廢：
 * 結果不知道時列就停在 pending，要等對帳查無才能取消，不會留在「池不足」被直接取消而漏記一筆已入帳的錢。
 * 條件含讀到的狀態與次數，同一筆同時兩次重試只有一個送得出去。
 * 池不足那筆在排隊時可能被降級、改成不算位置或調低檔位金額：送出前重算，存的金額超過現在還差的就拒絕（409 share_payout_stale），
 * 要取消再重新發放；金額不改（同一把 key 必須同一份本體）。比現在還差的少（升級）照送，差額由下一次請求補。
 * 從 pending 重試不重算：上一次結果未知、可能已入帳，只能原樣再送。
 */
export async function retryPayout(x: Payer, id: string, op: string): Promise<PayoutView> {
  const db = x.env.DB, now = x.now();
  const prior = await replayed(db, x.memberId, op, "retry");
  if (prior) {
    if (prior !== id) throw new HttpError(409, "campaign_operation_repeated");
    return current(db, id);
  }
  const r = await load(db, id);
  if (!r) throw new HttpError(404, "share_payout_not_found");
  if (!OPEN.includes(r.status)) throw new HttpError(409, "share_payout_not_retryable");
  const campaign = await getCampaign(db, r.campaign_id);
  payable(campaign, now);
  await notSelf(db, x.memberId, r.member_id, r.recipient_account_no);
  if (r.status === "blocked_insufficient" && r.amount > (await owed(db, r.content_id, campaign!)).due) throw new HttpError(409, "share_payout_stale");

  let changed = 0;
  try {
    const [upd] = await db.batch([
      db.prepare("UPDATE share_payouts SET status = 'pending', error = NULL, attempts = attempts + 1, checked_absent_at = NULL, updated_at = ? WHERE id = ? AND status = ? AND attempts = ?").bind(now, id, r.status, r.attempts),
      auditStmtIfChanged(db, { subjectKind: "share_payout", subjectId: id, actorMemberId: x.memberId, actorKind: "human", action: "retry", before: { status: r.status, attempts: r.attempts }, after: { status: "pending", attempts: r.attempts + 1 }, operationId: op, now }),
    ]);
    changed = upd!.meta.changes;
  } catch (e) {
    if ((await replayed(db, x.memberId, op, "retry")) === id) return current(db, id);
    throw e;
  }
  if (!changed) {
    if ((await replayed(db, x.memberId, op, "retry")) === id) return current(db, id);
    throw new HttpError(409, "share_payout_not_retryable");
  }
  const row = (await load(db, id))!;
  await settle(x, row, await send(x, row), op, r.status === "blocked_insufficient", "payout");
  return current(db, id);
}

/** 取消：池不足的隨時可以；pending 要建立超過 10 分鐘、而且最近一次送出之後對帳查無。 */
export async function cancelPayout(x: Payer, id: string, reason: string, op: string): Promise<PayoutView> {
  const db = x.env.DB, now = x.now();
  const prior = await replayed(db, x.memberId, op, "cancel");
  if (prior) {
    if (prior !== id) throw new HttpError(409, "campaign_operation_repeated");
    return current(db, id);
  }
  const r = await load(db, id);
  if (!r) throw new HttpError(404, "share_payout_not_found");
  const ok = r.status === "blocked_insufficient" || (r.status === "pending" && now - r.created_at >= TEN_MIN && r.checked_absent_at !== null);
  if (!ok) throw new HttpError(409, "share_payout_not_cancellable");
  let changed = 0;
  try {
    const [upd] = await db.batch([
      db.prepare(`UPDATE share_payouts SET status = 'cancelled', settled_at = ?, updated_at = ? WHERE id = ? AND status = ?
        AND (status = 'blocked_insufficient' OR checked_absent_at IS NOT NULL)`).bind(now, now, id, r.status),
      auditStmtIfChanged(db, { subjectKind: "share_payout", subjectId: id, actorMemberId: x.memberId, actorKind: "human", action: "cancel", reason, before: { status: r.status }, after: { status: "cancelled" }, operationId: op, now }),
    ]);
    changed = upd!.meta.changes;
  } catch (e) {
    if ((await replayed(db, x.memberId, op, "cancel")) === id) return current(db, id);
    throw e;
  }
  if (!changed) {
    if ((await replayed(db, x.memberId, op, "cancel")) === id) return current(db, id);
    throw new HttpError(409, "share_payout_not_cancellable");
  }
  return current(db, id);
}

export type CheckResult = "paid" | "absent" | "unknown";

/**
 * 向 Provider 查一筆 pending：入帳了就照發放的規則記 paid；查無就記下時間（取消要用）；不知道就不動。
 * 查無只有在最近一次送出已超過 10 分鐘時才記：剛送出的那次 Provider 可能還在處理。已記過的不再記（重試會清掉它）。
 * 只讀與條件式寫入，重複查沒有副作用，所以操作編號由伺服器產生。
 */
async function checkRow(x: Payer, r: Row, op: string): Promise<CheckResult> {
  const db = x.env.DB;
  const got = await upstream.getCampaignPayout(x.env, x.bearer, r.id, x.provider).catch(() => ({ kind: "unknown" }) as const);
  if (got.kind === "paid") {
    await settle(x, r, { kind: "paid", entryId: got.entryId, paidAt: got.paidAt, replayed: false }, op, false, "reconcile");
    return "paid";
  }
  if (got.kind === "absent") {
    const now = x.now();
    await db.batch([
      db.prepare("UPDATE share_payouts SET checked_absent_at = ? WHERE id = ? AND status = 'pending' AND checked_absent_at IS NULL AND updated_at <= ?").bind(now, r.id, now - TEN_MIN),
      auditStmtIfChanged(db, { subjectKind: "share_payout", subjectId: r.id, actorMemberId: x.memberId, actorKind: "human", action: "absent", after: { checkedAbsentAt: now }, operationId: op, now }),
    ]);
  }
  await bumpOp(db, "campaign", "reconcile", got.kind === "unknown" ? "error" : "success");
  return got.kind;
}

export async function checkPayout(x: Payer, id: string): Promise<{ result: CheckResult; payout: PayoutView }> {
  const r = await load(x.env.DB, id);
  if (!r) throw new HttpError(404, "share_payout_not_found");
  if (r.status !== "pending") throw new HttpError(409, "share_payout_not_pending");
  const result = await checkRow(x, r, crypto.randomUUID());
  return { result, payout: await current(x.env.DB, id) };
}

/** 對帳：一次最多 20 筆建立、最後一次送出都超過 10 分鐘的 pending（剛重試的還在路上），還沒查無過的優先（舊的查無列不佔名額），逐筆查（Worker 的子請求有上限）。 */
export async function reconcilePayouts(x: Payer): Promise<{ items: { result: CheckResult; payout: PayoutView }[] }> {
  const db = x.env.DB, op = crypto.randomUUID();
  const rows = (await db.prepare(`SELECT ${COLUMNS} WHERE p.status = 'pending' AND p.created_at <= ?1 AND p.updated_at <= ?1 ORDER BY p.checked_absent_at IS NOT NULL, p.created_at, p.id LIMIT ?2`).bind(x.now() - TEN_MIN, BATCH_MAX).all<Row>()).results;
  const items = [];
  for (const r of rows) items.push({ result: await checkRow(x, r, `${op}:${r.id}`), payout: await current(db, r.id) });
  return { items };
}

/** 批次發放：逐筆（Worker 的子請求有上限），一筆被拒不影響其他筆；每筆的操作編號是 `<op>:<i>`。 */
export async function batchPayout(x: Payer, contentIds: string[], op: string) {
  const items: ({ contentId: string; payout: PayoutView } | { contentId: string; error: string })[] = [];
  for (const [i, contentId] of contentIds.entries()) {
    try {
      items.push({ contentId, payout: await requestPayout(x, contentId, `${op}:${i}`) });
    } catch (e) {
      const known = e instanceof HttpError;
      if (!known) console.error("campaign_batch_payout_item_failed", e instanceof Error ? e.message : "unknown");
      await bumpOp(x.env.DB, "campaign", "payout", known && e.status < 500 ? "denied" : "error");
      items.push({ contentId, error: known ? e.message : "internal_error" });
    }
  }
  return { items };
}

/**
 * 核准後自動發放（呼叫端已確認是真人應用管理員）。核准已經成立，這裡的失敗不推翻它：
 * 沒有可發的、已過發獎截止 → payout:null；其他拒絕 → payout:null 加 payoutError 代碼。
 */
export async function autoPayout(x: Payer, placementId: string, op: string): Promise<{ payout: PayoutView | null; payoutError?: string }> {
  const contentId = await x.env.DB.prepare("SELECT content_id FROM share_placements WHERE id = ?").bind(placementId).first<string>("content_id");
  try {
    return { payout: await requestPayout(x, contentId!, `${op}:payout`) };
  } catch (e) {
    if (!(e instanceof HttpError)) throw e;
    if (e.message === "share_nothing_due" || e.message === "campaign_payout_closed") return { payout: null };
    await bumpOp(x.env.DB, "campaign", "payout", e.status < 500 ? "denied" : "error");
    return { payout: null, payoutError: e.message };
  }
}

/** 發放列表（應用管理員）：新的在前，每頁 20 筆。沒有成員 id 與收款帳號，申請人只以 handle 出現。 */
export async function listPayouts(db: D1Database, q: { status?: string; slug?: string; page: number }) {
  if (q.status !== undefined && !(STATUSES as readonly string[]).includes(q.status)) throw new HttpError(400, "share_invalid", undefined, { field: "status" });
  const from = `FROM share_payouts p JOIN share_contents s ON s.id = p.content_id JOIN campaigns c ON c.id = s.campaign_id JOIN members m ON m.id = s.member_id
    WHERE (?1 IS NULL OR p.status = ?1) AND (?2 IS NULL OR c.slug = ?2)`;
  const [total, rows] = await db.batch([
    db.prepare(`SELECT count(*) AS n ${from}`).bind(q.status ?? null, q.slug ?? null),
    db.prepare(`SELECT p.id, p.content_id, s.title, c.slug, m.handle, p.amount, p.target_total, p.status, p.error, p.attempts, p.provider_entry_id, p.checked_absent_at,
      p.created_at, p.updated_at, p.settled_at ${from} ORDER BY p.created_at DESC, p.id DESC LIMIT ?3 OFFSET ?4`).bind(q.status ?? null, q.slug ?? null, PAGE, (q.page - 1) * PAGE),
  ]);
  type L = { id: string; content_id: string; title: string; slug: string; handle: string; amount: number; target_total: number; status: string; error: string | null; attempts: number;
    provider_entry_id: string | null; checked_absent_at: number | null; created_at: number; updated_at: number; settled_at: number | null };
  return {
    total: (total!.results[0] as { n: number }).n,
    items: (rows!.results as L[]).map((r) => ({
      id: r.id, contentId: r.content_id, contentTitle: r.title, campaignSlug: r.slug, applicant: { handle: r.handle }, amount: r.amount, targetTotal: r.target_total,
      status: r.status, error: r.error, attempts: r.attempts, providerEntryId: r.provider_entry_id, checkedAbsentAt: r.checked_absent_at,
      createdAt: r.created_at, updatedAt: r.updated_at, settledAt: r.settled_at,
    })),
  };
}

/**
 * 待發放清單（應用管理員）：有核准位置、還有應發金額、沒有 pending／池不足發放、活動還能發（payable 通過）的內容。
 * 舊的在前，每頁 20 筆。跟發放列表一樣不回成員 id、收款帳號與經手人，申請人只以 handle 出現。
 * ponytail: 候選內容全部讀進記憶體用 payoutAmount 算完再分頁（已發完的也會被讀到）；量大時在 share_contents 存一欄應發金額，改成 SQL 篩選與分頁。
 */
export async function listPayable(db: D1Database, q: { slug?: string; page: number }, now: number) {
  const open = (await listCampaigns(db, { includeDraft: false })).filter((c) => {
    if (q.slug !== undefined && c.slug !== q.slug) return false;
    try {
      payable(c, now);
      return true;
    } catch {
      return false;
    }
  });
  if (!open.length) return { total: 0, items: [] };
  const byId = new Map(open.map((c) => [c.id, c]));
  const candidates = `SELECT s.id FROM share_contents s WHERE s.campaign_id IN (SELECT value FROM json_each(?1))
    AND EXISTS (SELECT 1 FROM share_placements p WHERE p.content_id = s.id AND p.review_status = 'approved')
    AND NOT EXISTS (SELECT 1 FROM share_payouts o WHERE o.content_id = s.id AND o.status IN ('pending', 'blocked_insufficient'))`;
  const ids = JSON.stringify([...byId.keys()]);
  const [contents, placements, paid] = await db.batch([
    db.prepare(`SELECT s.id, s.campaign_id, s.member_id, s.title, m.handle FROM share_contents s JOIN members m ON m.id = s.member_id WHERE s.id IN (${candidates}) ORDER BY s.created_at, s.id`).bind(ids),
    db.prepare(`SELECT content_id, review_status, approved_tier, counts_as_placement FROM share_placements WHERE review_status = 'approved' AND content_id IN (${candidates})`).bind(ids),
    db.prepare(`SELECT content_id, sum(amount) AS n FROM share_payouts WHERE status = 'paid' AND content_id IN (${candidates}) GROUP BY content_id`).bind(ids),
  ]);
  type P = { content_id: string; review_status: string; approved_tier: Tier | null; counts_as_placement: number };
  const byContent = new Map<string, P[]>();
  for (const p of placements!.results as P[]) byContent.set(p.content_id, [...(byContent.get(p.content_id) ?? []), p]);
  const paidOf = new Map((paid!.results as { content_id: string; n: number }[]).map((r) => [r.content_id, r.n]));
  type C = { id: string; campaign_id: string; member_id: string; title: string; handle: string };
  const rows = contents!.results as C[];
  // 隨手分享每週上限：每個活動、這一頁出現的人各算一次
  const caps = new Map<string, number>();
  for (const [cid, campaign] of byId) {
    const members = [...new Set(rows.filter((r) => r.campaign_id === cid).map((r) => r.member_id))];
    for (const [k, v] of await memberLightCaps(db, campaign, members)) caps.set(k, v);
  }
  const due = rows.flatMap((s) => {
    const campaign = byId.get(s.campaign_id)!;
    const paidTotal = paidOf.get(s.id) ?? 0;
    const owe = payoutAmount((byContent.get(s.id) ?? []).map((p) => ({ reviewStatus: p.review_status, approvedTier: p.approved_tier, countsAsPlacement: !!p.counts_as_placement })), campaign, paidTotal, caps.get(s.id));
    return owe.due > 0 ? [{ contentId: s.id, contentTitle: s.title, campaignSlug: campaign.slug, applicant: { handle: s.handle }, target: owe.target, paidTotal, due: owe.due }] : [];
  });
  return { total: due.length, items: due.slice((q.page - 1) * PAGE, q.page * PAGE) };
}
