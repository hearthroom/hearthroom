import { auditStmt, auditStmtIfChanged } from "./audit";
import { imageUrl } from "./blog";
import { campaignPhase } from "./campaign";
import { ownsAccount } from "./campaign-review";
import { WEEKLY_LIMIT } from "./quota";
import { bumpOp } from "./ops-metrics";
import type { ProviderId } from "./providers";
import { upstream, type PayResult } from "./upstream";
import { HttpError, type Env } from "./types";

/**
 * 發卡獎勵（創作季）：活動期間第一次登記、通過審核的卡，給作者一筆積分。錢只在 Provider（跟分享季同一個點數池），
 * 本站只記發放紀錄；card_rewards.id 就是 Provider 的冪等鍵，同一筆紀錄不管送幾次都是同一把 key、同一個金額與帳號。
 *
 * 一張卡以 work_key 認（同 community_registration_usage）：下架重發、改版重審都是同一個作品，只給一次。
 * 「活動期間」看這個作品第一次登記的時間（跟每週額度同一個時鐘），不看何時過審。
 *
 * 狀態機與 share_payouts 相同（見 campaign-payout.ts 的說明）：pending → paid／blocked_insufficient／failed；
 * 池不足 → paid／failed／cancelled；pending 在對帳查無且夠久之後 → cancelled。刻意不跟分享季共用程式：
 * 那邊的發放綁著內容與檔位，分享季正在線上發錢，不為這期活動改它。
 *
 * 呼叫端（路由）已經確認：真人審核員、Provider 回報是本站應用管理員。令牌只用來呼叫 Provider，不落地、不進日誌。
 */
export type Payer = { env: Env; bearer: string; provider: ProviderId; memberId: string; now: () => number };

const TEN_MIN = 600_000;
const PAGE = 20;
export const BATCH_MAX = 20;
const STATUSES = ["pending", "paid", "blocked_insufficient", "failed", "cancelled"] as const;
const OPEN = ["pending", "blocked_insufficient"];

// ---- 活動設定 -----------------------------------------------------------------

type CampaignRow = {
  id: string; slug: string; title: string; starts_at: number; ends_at: number; payout_deadline: number | null; weekly_limit: number; reward: number; status: "draft" | "active";
  timezone: string; banner_key: string | null; featured: number; featured_rank: number | null;
};
const campaignView = (r: CampaignRow) => ({
  id: r.id, slug: r.slug, title: JSON.parse(r.title) as Record<string, string>, startsAt: r.starts_at, endsAt: r.ends_at, payoutDeadline: r.payout_deadline,
  weeklyLimit: r.weekly_limit, reward: r.reward, status: r.status, timezone: r.timezone, bannerUrl: imageUrl(r.banner_key), featured: r.featured === 1, featuredRank: r.featured_rank,
});
export type RewardCampaign = ReturnType<typeof campaignView>;

export async function getRewardCampaign(db: D1Database, slug: string): Promise<RewardCampaign | null> {
  const r = await db.prepare("SELECT * FROM card_reward_campaigns WHERE slug = ?").bind(slug).first<CampaignRow>();
  return r ? campaignView(r) : null;
}

export async function listRewardCampaigns(db: D1Database): Promise<RewardCampaign[]> {
  return (await db.prepare("SELECT * FROM card_reward_campaigns WHERE status = 'active' ORDER BY starts_at DESC").all<CampaignRow>()).results.map(campaignView);
}

/** 公開列表的一列（同分享活動的 summaryView，多 kind 與排序值）。 */
export const cardRewardSummary = (k: RewardCampaign, now: number) => ({
  kind: "card_reward" as const, slug: k.slug, title: k.title, phase: campaignPhase(k, now), startsAt: k.startsAt, endsAt: k.endsAt, timezone: k.timezone,
  bannerUrl: k.bannerUrl, featured: k.featured, featuredRank: k.featuredRank,
});
/** 公開活動頁：規則卡要的數字。 */
export const cardRewardDetail = (k: RewardCampaign, now: number) => ({
  ...cardRewardSummary(k, now), payoutDeadline: k.payoutDeadline, reward: k.reward, weeklyLimit: k.weeklyLimit, normalWeeklyLimit: WEEKLY_LIMIT,
});

// ---- 誰該拿 -------------------------------------------------------------------

/** 卡的作品鍵與作者成員；跟 community_registration_usage 同一套對應。不篩審核狀態（作者進度要列審核中與被拒的）。 */
const CARD_BASE = `SELECT c.id AS card_id, c.author_num_id, c.names, c.background_url AS avatar_url, c.provider, c.source_role_id,
  COALESCE((SELECT w.source_provider||':'||w.source_role_id FROM work_copies cp JOIN works w ON w.id=cp.work_id WHERE cp.provider=c.provider AND cp.role_id=c.source_role_id), c.provider||':'||c.source_role_id) AS work_key,
  COALESCE((SELECT owner_member_id FROM member_connections WHERE provider=c.provider AND external_id=CAST(c.author_num_id AS TEXT)),
           (SELECT member_id FROM member_identities WHERE provider=c.provider AND external_id=CAST(c.author_num_id AS TEXT))) AS member_id
  FROM cards c WHERE c.provider = 'harbor'`;
/**
 * 這張卡（同一個上游角色，下架重發也算同一張）的初次上架送審，依過審時間排序。卡下架時 cards 列會刪掉，
 * 送審紀錄靠 hosting_versions 對回角色；只看過審的初審（kind first），改版重審（re）不算上架。
 */
const FIRST_LISTING = `FROM review_submissions s JOIN hosting_versions v ON v.submission_id = s.id
  WHERE s.kind = 'first' AND s.status = 'approved' AND v.provider = cw.provider AND v.source_role_id = cw.source_role_id`;
/** 第一次過審上架的時間（資格的起點，owner 2026-10-17）；從沒過審是 NULL。 */
const LISTED_AT = `(SELECT MIN(s.decided_at) ${FIRST_LISTING})`;
/** 那一次上架是什麼時候送審的（資格的終點：活動結束前送審，之後才過審也算）。 */
const LISTED_SUBMITTED = `(SELECT s.submitted_at ${FIRST_LISTING} ORDER BY s.decided_at LIMIT 1)`;
const LIVE = "('pending', 'blocked_insufficient', 'paid')";

/**
 * 該發而還沒發的卡：審核通過過、沒被站方封鎖、**第一次過審上架**在活動開始之後、那次上架的送審在活動結束之前、
 * 還沒過發獎截止、沒有進行中或已入帳的發放（以作品認，也以卡認）。登記、送審、撤回的時間不看（owner 2026-10-17）。
 * ?1 現在時間，?2 限定一張卡（NULL＝全部）。
 * 卡的 registered_at 是這張卡列第一次過審的時間，不早於第一次上架，所以先用最早的活動開始時間篩掉舊卡。
 */
const DUE = `SELECT x.card_id, x.author_num_id, x.names, x.work_key, x.member_id, x.listed_at, k.id AS campaign_id, k.slug, k.reward
  FROM (SELECT cw.*, ${LISTED_AT} AS listed_at, ${LISTED_SUBMITTED} AS listed_submitted FROM (${CARD_BASE}
    AND (c.status = 'approved' OR c.approved_version_id IS NOT NULL) AND c.public_blocked = 0 AND (?2 IS NULL OR c.id = ?2)
    AND c.registered_at >= (SELECT MIN(starts_at) FROM card_reward_campaigns WHERE status = 'active')) cw) x
  JOIN card_reward_campaigns k ON k.status = 'active' AND k.starts_at <= x.listed_at AND k.ends_at > x.listed_submitted AND (k.payout_deadline IS NULL OR k.payout_deadline > ?1)
  WHERE x.member_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM card_rewards r WHERE r.work_key = x.work_key AND r.status IN ${LIVE})
    AND NOT EXISTS (SELECT 1 FROM card_rewards r WHERE r.card_id = x.card_id AND r.status IN ${LIVE})`;

type Due = { card_id: number; author_num_id: number; names: string; work_key: string; member_id: string; listed_at: number; campaign_id: string; slug: string; reward: number };

// ---- 發放紀錄 -----------------------------------------------------------------

type Row = {
  id: string; campaign_id: string; work_key: string; card_id: number; member_id: string; recipient_account_no: number; amount: number; status: string;
  provider_entry_id: string | null; error: string | null; attempts: number; checked_absent_at: number | null; created_at: number; updated_at: number; settled_at: number | null;
};
const view = (r: Row) => ({
  id: r.id, cardId: r.card_id, amount: r.amount, status: r.status, error: r.error, attempts: r.attempts, providerEntryId: r.provider_entry_id,
  checkedAbsentAt: r.checked_absent_at, createdAt: r.created_at, updatedAt: r.updated_at, settledAt: r.settled_at,
});
export type RewardView = ReturnType<typeof view>;

const load = (db: D1Database, id: string) => db.prepare("SELECT * FROM card_rewards WHERE id = ?").bind(id).first<Row>();
const current = async (db: D1Database, id: string) => view((await load(db, id))!);

/** 這個操作編號這個人用過沒有：用過且是同一種動作 → 回那筆的 id；用在別的事上 → 409。衍生編號帶冒號，用戶端送不出來。 */
async function replayed(db: D1Database, actor: string, op: string, action: string): Promise<string | null> {
  const r = await db.prepare("SELECT subject_kind, subject_id, action FROM audit_log WHERE actor_member_id = ? AND operation_id = ?").bind(actor, op)
    .first<{ subject_kind: string; subject_id: string; action: string }>();
  if (!r) return null;
  if (r.subject_kind !== "card_reward" || r.action !== action) throw new HttpError(409, "card_reward_operation_repeated");
  return r.subject_id;
}

/** 錢不能發到操作者自己：卡是自己的，或作者帳號是自己的（登入或連結的）Harbor 帳號。 */
async function notSelf(db: D1Database, actor: string, memberId: string, accountNo: number) {
  if (memberId === actor || (await ownsAccount(db, actor, accountNo))) throw new HttpError(403, "card_reward_self");
}

const send = (x: Payer, r: Row): Promise<PayResult> =>
  upstream.payCampaign(x.env, x.bearer, { key: r.id, accountNo: r.recipient_account_no, amount: r.amount, campaignRef: r.campaign_id, contentRef: r.work_key }, x.provider)
    .catch(() => ({ kind: "unknown" }) as const);

/**
 * 把一次 Provider 結果寫回去（同 campaign-payout.ts 的 settle）：入帳不看次數；其他結果只在列仍是 pending、次數還是這一次時才寫。
 * rejectFails：這次被拒能不能證明這把 key 從沒入帳（第一次送出，或重試前是池不足）。
 */
async function settle(x: Payer, r: Row, res: PayResult, op: string, rejectFails: boolean, metric: "payout" | "reconcile") {
  const db = x.env.DB, now = x.now();
  const audit = (action: string, extra: { reason?: string; after?: unknown } = {}) =>
    ({ subjectKind: "card_reward", subjectId: r.id, actorMemberId: x.memberId, actorKind: "human", action, before: { status: r.status }, operationId: `${op}:settle`, now, ...extra }) as const;
  let writes: D1PreparedStatement[];
  if (res.kind === "paid") {
    writes = [
      db.prepare("UPDATE card_rewards SET status = 'paid', provider_entry_id = ?, error = NULL, settled_at = ?, updated_at = ? WHERE id = ? AND status <> 'paid'").bind(res.entryId, now, now, r.id),
      auditStmtIfChanged(db, audit("paid", { after: { status: "paid", entryId: res.entryId, replayed: res.replayed } })),
    ];
  } else if (res.kind === "insufficient") {
    writes = [
      db.prepare("UPDATE card_rewards SET status = 'blocked_insufficient', error = 'pool_insufficient', updated_at = ? WHERE id = ? AND status = 'pending' AND attempts = ?").bind(now, r.id, r.attempts),
      auditStmtIfChanged(db, audit("insufficient", { after: { status: "blocked_insufficient" } })),
    ];
  } else if (res.kind === "rejected" && rejectFails && res.code !== "idempotency_conflict") {
    writes = [
      db.prepare("UPDATE card_rewards SET status = 'failed', error = ?, settled_at = ?, updated_at = ? WHERE id = ? AND status = 'pending' AND attempts = ?").bind(res.code, now, now, r.id, r.attempts),
      auditStmtIfChanged(db, audit("failed", { reason: res.code, after: { status: "failed" } })),
    ];
  } else if (res.kind === "rejected") {
    writes = [
      db.prepare("UPDATE card_rewards SET error = ? WHERE id = ? AND status = 'pending' AND attempts = ?").bind(res.code, r.id, r.attempts),
      auditStmtIfChanged(db, audit("rejected", { reason: res.code, after: { status: "pending" } })),
    ];
  } else {
    // 不知道有沒有入帳：狀態與次數都不動，只留紀錄。之後用同一把 key 重試或對帳。
    writes = [auditStmt(db, audit("unknown"))];
  }
  await db.batch(writes);
  await bumpOp(db, "card_reward", metric, res.kind === "paid" ? "success" : res.kind === "insufficient" ? "insufficient" : res.kind === "rejected" ? "denied" : "error");
}

const isUnique = (e: unknown) => /UNIQUE constraint failed: card_rewards\./.test(String(e));

/** 發一張卡的獎勵：確認該發，開一筆 pending（同一個作品同時只能有一筆），再送 Provider。 */
export async function requestReward(x: Payer, cardId: number, op: string): Promise<RewardView> {
  const db = x.env.DB, now = x.now();
  const replay = async () => {
    const prior = await replayed(db, x.memberId, op, "request");
    if (!prior) return null;
    const r = await load(db, prior);
    if (!r || r.card_id !== cardId) throw new HttpError(409, "card_reward_operation_repeated");
    return view(r);
  };
  const again = await replay();
  if (again) return again;

  const due = await db.prepare(DUE).bind(now, cardId).first<Due>();
  if (!due) throw new HttpError(409, "card_reward_not_due");
  await notSelf(db, x.memberId, due.member_id, due.author_num_id);

  const id = crypto.randomUUID();
  let inserted = 0;
  try {
    const [ins] = await db.batch([
      db.prepare(`INSERT INTO card_rewards (id, campaign_id, work_key, card_id, member_id, recipient_account_no, amount, status, requested_by, attempts, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, 1, ?, ?)`)
        .bind(id, due.campaign_id, due.work_key, due.card_id, due.member_id, due.author_num_id, due.reward, x.memberId, now, now),
      auditStmtIfChanged(db, { subjectKind: "card_reward", subjectId: id, actorMemberId: x.memberId, actorKind: "human", action: "request", after: { cardId, amount: due.reward }, operationId: op, now }),
    ]);
    inserted = ins!.meta.changes;
  } catch (e) {
    const r = await replay();
    if (r) return r;
    if (isUnique(e)) throw new HttpError(409, "card_reward_in_progress");
    throw e;
  }
  if (!inserted) throw new HttpError(409, "card_reward_in_progress");
  const row = (await load(db, id))!;
  await settle(x, row, await send(x, row), op, true, "payout");
  return current(db, id);
}

/**
 * 審核通過後自動發（呼叫端已確認是真人應用管理員）。過審已經成立，這裡的失敗不推翻它：
 * 不在活動裡的卡 → reward:null；其他拒絕 → reward:null 加 rewardError，卡留在待發放清單。
 */
export async function autoReward(x: Payer, cardId: number, op: string): Promise<{ reward: RewardView | null; rewardError?: string }> {
  try {
    return { reward: await requestReward(x, cardId, `${op}:reward`) };
  } catch (e) {
    if (e instanceof HttpError && e.message === "card_reward_not_due") return { reward: null };
    // 資料庫出錯也一樣不推翻過審：留了 pending 的由對帳收，沒留的卡還在待發放清單。
    const known = e instanceof HttpError;
    if (!known) console.error("card_reward_auto_failed", e instanceof Error ? e.message : "unknown");
    await bumpOp(x.env.DB, "card_reward", "payout", known && e.status < 500 ? "denied" : "error");
    return { reward: null, rewardError: known ? e.message : "internal_error" };
  }
}

/** 批次發放：逐筆（Worker 的子請求有上限），一筆被拒不影響其他筆；每筆的操作編號是 `<op>:<i>`。 */
export async function batchReward(x: Payer, cardIds: number[], op: string) {
  const items: ({ cardId: number; reward: RewardView } | { cardId: number; error: string })[] = [];
  for (const [i, cardId] of cardIds.entries()) {
    try {
      items.push({ cardId, reward: await requestReward(x, cardId, `${op}:${i}`) });
    } catch (e) {
      const known = e instanceof HttpError;
      if (!known) console.error("card_reward_batch_item_failed", e instanceof Error ? e.message : "unknown");
      await bumpOp(x.env.DB, "card_reward", "payout", known && e.status < 500 ? "denied" : "error");
      items.push({ cardId, error: known ? e.message : "internal_error" });
    }
  }
  return { items };
}

/** 重試：只限 pending 或池不足；同一把 key、同一個金額與帳號（不重算）。規則同分享季的 retryPayout。 */
export async function retryReward(x: Payer, id: string, op: string): Promise<RewardView> {
  const db = x.env.DB, now = x.now();
  const prior = await replayed(db, x.memberId, op, "retry");
  if (prior) {
    if (prior !== id) throw new HttpError(409, "card_reward_operation_repeated");
    return current(db, id);
  }
  const r = await load(db, id);
  if (!r) throw new HttpError(404, "card_reward_not_found");
  if (!OPEN.includes(r.status)) throw new HttpError(409, "card_reward_not_retryable");
  await notSelf(db, x.memberId, r.member_id, r.recipient_account_no);
  const [upd] = await db.batch([
    db.prepare("UPDATE card_rewards SET status = 'pending', error = NULL, attempts = attempts + 1, checked_absent_at = NULL, updated_at = ? WHERE id = ? AND status = ? AND attempts = ?").bind(now, id, r.status, r.attempts),
    auditStmtIfChanged(db, { subjectKind: "card_reward", subjectId: id, actorMemberId: x.memberId, actorKind: "human", action: "retry", before: { status: r.status, attempts: r.attempts }, after: { status: "pending", attempts: r.attempts + 1 }, operationId: op, now }),
  ]);
  if (!upd!.meta.changes) throw new HttpError(409, "card_reward_not_retryable");
  const row = (await load(db, id))!;
  await settle(x, row, await send(x, row), op, r.status === "blocked_insufficient", "payout");
  return current(db, id);
}

/** 取消：池不足的隨時可以；pending 要建立超過 10 分鐘、而且最近一次送出之後對帳查無。取消後這張卡回到待發放。 */
export async function cancelReward(x: Payer, id: string, reason: string, op: string): Promise<RewardView> {
  const db = x.env.DB, now = x.now();
  const prior = await replayed(db, x.memberId, op, "cancel");
  if (prior) {
    if (prior !== id) throw new HttpError(409, "card_reward_operation_repeated");
    return current(db, id);
  }
  const r = await load(db, id);
  if (!r) throw new HttpError(404, "card_reward_not_found");
  const ok = r.status === "blocked_insufficient" || (r.status === "pending" && now - r.created_at >= TEN_MIN && r.checked_absent_at !== null);
  if (!ok) throw new HttpError(409, "card_reward_not_cancellable");
  const [upd] = await db.batch([
    db.prepare(`UPDATE card_rewards SET status = 'cancelled', settled_at = ?, updated_at = ? WHERE id = ? AND status = ?
      AND (status = 'blocked_insufficient' OR checked_absent_at IS NOT NULL)`).bind(now, now, id, r.status),
    auditStmtIfChanged(db, { subjectKind: "card_reward", subjectId: id, actorMemberId: x.memberId, actorKind: "human", action: "cancel", reason, before: { status: r.status }, after: { status: "cancelled" }, operationId: op, now }),
  ]);
  if (!upd!.meta.changes) throw new HttpError(409, "card_reward_not_cancellable");
  return current(db, id);
}

export type CheckResult = "paid" | "absent" | "unknown";

/** 向 Provider 查一筆 pending：入帳了就記 paid；最近一次送出超過 10 分鐘仍查無就記下時間（取消要用）；不知道就不動。 */
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
      db.prepare("UPDATE card_rewards SET checked_absent_at = ? WHERE id = ? AND status = 'pending' AND checked_absent_at IS NULL AND updated_at <= ?").bind(now, r.id, now - TEN_MIN),
      auditStmtIfChanged(db, { subjectKind: "card_reward", subjectId: r.id, actorMemberId: x.memberId, actorKind: "human", action: "absent", after: { checkedAbsentAt: now }, operationId: op, now }),
    ]);
  }
  await bumpOp(db, "card_reward", "reconcile", got.kind === "unknown" ? "error" : "success");
  return got.kind;
}

/** 對帳：一次最多 20 筆建立與最後一次送出都超過 10 分鐘的 pending，還沒查無過的優先。 */
export async function reconcileRewards(x: Payer): Promise<{ items: { result: CheckResult; reward: RewardView }[] }> {
  const db = x.env.DB, op = crypto.randomUUID();
  const rows = (await db.prepare("SELECT * FROM card_rewards WHERE status = 'pending' AND created_at <= ?1 AND updated_at <= ?1 ORDER BY checked_absent_at IS NOT NULL, created_at, id LIMIT ?2")
    .bind(x.now() - TEN_MIN, BATCH_MAX).all<Row>()).results;
  const items = [];
  for (const r of rows) items.push({ result: await checkRow(x, r, `${op}:${r.id}`), reward: await current(db, r.id) });
  return { items };
}

// ---- 後台清單 -----------------------------------------------------------------

const cardName = (names: string) => {
  try {
    const n = JSON.parse(names) as Record<string, string>;
    return n.zh || n["zh-Hant"] || Object.values(n).find(Boolean) || "";
  } catch {
    return "";
  }
};

/** 待發放（應用管理員）：舊的在前，每頁 20 筆。作者只以 handle 出現，不回成員 id 與收款帳號。 */
export async function listDue(db: D1Database, page: number, now: number) {
  const [total, rows] = await db.batch([
    db.prepare(`SELECT count(*) AS n FROM (${DUE})`).bind(now, null),
    db.prepare(`SELECT d.*, m.handle FROM (${DUE}) d JOIN members m ON m.id = d.member_id ORDER BY d.listed_at, d.card_id LIMIT ?3 OFFSET ?4`).bind(now, null, PAGE, (page - 1) * PAGE),
  ]);
  return {
    total: (total!.results[0] as { n: number }).n,
    items: (rows!.results as (Due & { handle: string })[]).map((d) => ({ cardId: d.card_id, cardName: cardName(d.names), campaignSlug: d.slug, author: { handle: d.handle }, listedAt: d.listed_at, amount: d.reward })),
  };
}

/** 發放紀錄（應用管理員）：新的在前，每頁 20 筆。 */
export async function listRewards(db: D1Database, q: { status?: string; page: number }) {
  if (q.status !== undefined && !(STATUSES as readonly string[]).includes(q.status)) throw new HttpError(400, "card_reward_invalid", undefined, { field: "status" });
  const [total, rows] = await db.batch([
    db.prepare("SELECT count(*) AS n FROM card_rewards WHERE ?1 IS NULL OR status = ?1").bind(q.status ?? null),
    db.prepare(`SELECT r.*, m.handle, k.slug, c.names FROM card_rewards r JOIN members m ON m.id = r.member_id JOIN card_reward_campaigns k ON k.id = r.campaign_id
      LEFT JOIN cards c ON c.id = r.card_id WHERE ?1 IS NULL OR r.status = ?1 ORDER BY r.created_at DESC, r.id DESC LIMIT ?2 OFFSET ?3`).bind(q.status ?? null, PAGE, (q.page - 1) * PAGE),
  ]);
  type L = Row & { handle: string; slug: string; names: string | null };
  return {
    total: (total!.results[0] as { n: number }).n,
    items: (rows!.results as L[]).map((r) => ({ ...view(r), cardName: cardName(r.names ?? "{}"), campaignSlug: r.slug, author: { handle: r.handle } })),
  };
}

// ---- 作者自己的進度 -------------------------------------------------------------

/**
 * 這期活動裡作者的卡，新的在上；每張的審核狀態與獎勵。算進來的是：第一次過審上架在活動開始之後、那次送審在活動結束之前；
 * 還沒上架過的（審核中、未通過）看這張卡目前的送審是不是在活動結束之前（之後過審就符合資格）。
 * 活動開始前就上架過的卡不列（下架重發也不再給）。已過審而還沒發的 reward 是 null，畫面顯示「已通過」。
 */
export async function myProgress(db: D1Database, memberId: string, campaign: RewardCampaign) {
  type P = { card_id: number; names: string; avatar_url: string | null; status: string; approved_version_id: string | null; submitted_at: number; reward_status: string | null; amount: number | null };
  const rows = (await db.prepare(`SELECT x.card_id, x.names, x.avatar_url, c.status, c.approved_version_id,
      COALESCE(x.listed_submitted, x.current_submitted) AS submitted_at,
      (SELECT r.status FROM card_rewards r WHERE r.work_key = x.work_key AND r.status IN ${LIVE}) AS reward_status,
      (SELECT r.amount FROM card_rewards r WHERE r.work_key = x.work_key AND r.status IN ${LIVE}) AS amount
    FROM (SELECT cw.*, ${LISTED_AT} AS listed_at, ${LISTED_SUBMITTED} AS listed_submitted,
            (SELECT MAX(s.submitted_at) FROM review_submissions s WHERE s.card_id = cw.card_id AND s.kind = 'first') AS current_submitted
          FROM (${CARD_BASE}) cw WHERE cw.member_id = ?1) x
    JOIN cards c ON c.id = x.card_id
    WHERE (x.listed_at >= ?2 AND x.listed_submitted < ?3) OR (x.listed_at IS NULL AND x.current_submitted < ?3)
    ORDER BY submitted_at DESC, x.card_id DESC`).bind(memberId, campaign.startsAt, campaign.endsAt).all<P>()).results;
  const items = rows.map((r) => ({
    cardId: r.card_id, name: cardName(r.names), avatarUrl: r.avatar_url, submittedAt: r.submitted_at,
    review: r.status === "approved" || r.approved_version_id ? "approved" : r.status === "rejected" ? "rejected" : "pending",
    reward: r.reward_status ? { status: r.reward_status === "paid" ? "paid" : "pending", amount: r.amount! } : null,
  }));
  return {
    approvedCount: items.filter((i) => i.review === "approved").length,
    pendingCount: items.filter((i) => i.review === "pending").length,
    creditsPaid: items.reduce((n, i) => n + (i.reward?.status === "paid" ? i.reward.amount : 0), 0),
    items,
  };
}
