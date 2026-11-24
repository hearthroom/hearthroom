import { HttpError, type Env } from "./types";
import type { ProviderId } from "./providers";
import { reviewerRole } from "./members";
import { bumpOp } from "./ops-metrics";
import { indexStatements } from "./originality";
import { RATING_RANK_SQL } from "./rating-correction";
import { encodeSnapshot, loadSnapshot, reviewRecord } from "./review-snapshot";
import { upstream } from "./upstream";
import { reviewEventStatement } from "./review-v2";
import { getSubmission, newerAuthorSubmission } from "./review";
import { parseReviewReasons } from "../shared/review-reasons";

/**
 * 駁回改判為通過（ui-flip-approve.md，PM 2026-11-24）。審核員誤駁回時，管理員用同一個送審版本開一張「改判單」：
 *   - 只有管理員能發起；對象是目前結果為駁回、作者送的（非重新審核）、託管版本仍是駁回的單。理由必填。
 *   - 作者之後又送過審（不論結果）就不能再改判：審核以最新版為準。
 *   - 改判單建立時就由發起人領著，只有他能處理（不逾時、別人領不到、不冷凍、不受理也不適用）；
 *     決定只有「通過」（正常兩段式）與「撤回改判」（＝駁回，限管理員，維持原駁回、不通知作者）。
 *   - 作者端在通過前什麼都看不到：改判單待審時不擁有版本列（0152），作者讀到的仍是原本的駁回；
 *     通過那一刻才把版本列轉給它（review.ts adoptFlipVersion），之後照一般核准上架、通知作者。
 *   - 原單的查重指紋在駁回時已刪：改判單用快照重建（快照過了保留期就向 Harbor 讀封存版重做一份）。
 */
export const FLIP_REASON_MAX = 500;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isManager = (role: string | null) => role === "manager" || role === "owner";

export interface FlipStartResult { id: string; flipOf: string; replayed: boolean }

export async function startFlip(env: Env, input: { id: string; memberId: string; operationId: unknown; reason: unknown; now: number }): Promise<FlipStartResult> {
  const db = env.DB;
  if (typeof input.operationId !== "string" || !UUID.test(input.operationId)) throw new HttpError(400, "invalid_arguments", undefined, { field: "operationId" });
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (!reason || reason.length > FLIP_REASON_MAX) throw new HttpError(400, "invalid_arguments", undefined, { field: "reason" });
  const replay = await replayOf(db, input.memberId, input.operationId, input.id);
  if (replay) { await bumpOp(db, "review_flip", "start", "replay"); return replay; }
  if (!isManager(await reviewerRole(db, input.memberId))) throw new HttpError(403, "review_flip_manager_required");

  const s = await getSubmission(db, input.id);
  if (s.status !== "rejected" || s.reopen_of) throw new HttpError(409, "review_flip_not_rejected");
  const newer = await newerAuthorSubmission(db, s.id);
  if (newer) throw new HttpError(409, "review_flip_superseded", undefined, { latestSubmissionId: newer.id, latestSubmittedAt: newer.submittedAt });
  const open = await db.prepare("SELECT id FROM review_submissions WHERE flip_of = ? AND status IN ('pending', 'approved') LIMIT 1").bind(s.id).first<{ id: string }>();
  if (open) throw new HttpError(409, "review_flip_exists", undefined, { flipId: open.id });
  const v = await db.prepare("SELECT version_id, work_id, member_id, state FROM hosting_versions WHERE submission_id = ?").bind(s.id)
    .first<{ version_id: string; work_id: string; member_id: string; state: string }>();
  if (!v || v.state !== "rejected") throw new HttpError(409, "review_flip_unavailable");
  // 託管作品：上架許可要還是駁回時留下的「已準備」那一張，核准時才能照常提交
  if (await db.prepare("SELECT 1 FROM managed_work_access WHERE work_id = ?").bind(v.work_id).first()
    && !await db.prepare("SELECT 1 FROM work_publication_permits WHERE version_id = ? AND state = 'prepared'").bind(v.version_id).first()) {
    throw new HttpError(409, "review_flip_unavailable");
  }

  // 審核副本（查重原文與統計）：原單的快照還在就照抄，過了保留期就向 Harbor 讀作者送審的那一版重做
  let record = await loadSnapshot(db, s.id);
  if (!record) {
    try { record = reviewRecord(await upstream.readSealedForReview(env, s.source_role_id, s.provider as ProviderId)); }
    catch { throw new HttpError(503, "review_flip_snapshot_unavailable"); }
  }
  const doc = (record.document ?? {}) as Record<string, unknown>;
  const packed = await encodeSnapshot(record as never);

  const flipId = crypto.randomUUID(), auditId = crypto.randomUUID();
  // 後面每一句都以「這次的稽核列真的寫進去了」為條件：同一個 operation 併發重送、或兩位管理員同時發起，只有一次會建單
  const mine = "EXISTS (SELECT 1 FROM audit_log WHERE id = ?)";
  await db.batch([
    db.prepare(`INSERT INTO audit_log (id, subject_kind, subject_id, actor_member_id, actor_kind, action, reason, before_json, after_json, operation_id, created_at)
      SELECT ?, 'review_submission', s.id, ?, 'human', 'review_flip_approve', ?, json_object('status', s.status, 'decidedAt', s.decided_at),
        json_object('flipId', ?, 'cardId', s.card_id, 'versionId', ?), ?, ?
      FROM review_submissions s WHERE s.id = ? AND s.status = 'rejected'
      AND EXISTS (SELECT 1 FROM hosting_versions v WHERE v.submission_id = s.id AND v.state = 'rejected')
      AND NOT EXISTS (SELECT 1 FROM review_submissions f WHERE f.flip_of = s.id AND f.status IN ('pending', 'approved'))
      AND NOT EXISTS (SELECT 1 FROM review_submissions n WHERE n.card_id = s.card_id AND n.id <> s.id AND n.flip_of IS NULL AND n.reopen_of IS NULL
        AND (n.submitted_at > s.submitted_at OR (n.submitted_at = s.submitted_at AND n.rowid > s.rowid)))
      ON CONFLICT(actor_member_id, operation_id) DO NOTHING`)
      .bind(auditId, input.memberId, reason, flipId, v.version_id, input.operationId, input.now, s.id),
    db.prepare(`INSERT INTO review_submissions (id, card_id, provider, source_role_id, kind, status, content_hash, submitted_at, rating, rating_descriptors, rating_answers,
        review_length_total, review_worldbook_entries, review_regex_rules, flip_of, flip_by, flip_reason, claimed_by, claimed_at, claim_generation)
      SELECT ?, card_id, provider, source_role_id, kind, 'pending', content_hash, ?,
        -- 管理員更正過分級的卡：改判單分級不低於下限（審核員的年齡門檻看這一欄）
        COALESCE((SELECT f.rating FROM review_rating_floors f WHERE f.card_id = o.card_id AND ${RATING_RANK_SQL("f.rating")} > ${RATING_RANK_SQL("o.rating")}), rating),
        rating_descriptors, rating_answers, review_length_total, review_worldbook_entries, review_regex_rules, id, ?, ?, ?, ?, ?
      FROM review_submissions o WHERE o.id = ? AND ${mine}`)
      .bind(flipId, input.now, input.memberId, reason, input.memberId, input.now, crypto.randomUUID(), s.id, auditId),
    db.prepare("INSERT INTO review_snapshots (submission_id, detail, created_at) SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM review_submissions WHERE id = ?)")
      .bind(flipId, packed, input.now, flipId),
    // 查重：原單駁回時指紋已刪。重建時用原單的送審時間，查重頁「誰先送審」才不會因為改判變晚
    ...indexStatements(db, { submissionId: flipId, cardId: String(s.card_id), memberId: v.member_id, text: String(doc.roleDetailDesc ?? ""), names: [String(doc.roleName ?? ""), String(doc.userName ?? "")], now: s.submitted_at }),
    // 更新差異沿用原單送審時固定的基準
    db.prepare(`INSERT OR IGNORE INTO review_submission_diffs (submission_id, base_kind, base_revision, state, summary, attempts, created_at, computed_at)
      SELECT ?, base_kind, base_revision, state, summary, attempts, created_at, computed_at FROM review_submission_diffs WHERE submission_id = ?
      AND EXISTS (SELECT 1 FROM review_submissions WHERE id = ?)`).bind(flipId, s.id, flipId),
    reviewEventStatement(db, { key: "flip:" + flipId, submissionId: flipId, cardId: s.card_id, at: input.now, action: "flip", from: "rejected", to: "pending", actorKind: "reviewer", actorMemberId: input.memberId, requireSubmission: true }),
  ]);
  if (await db.prepare("SELECT 1 FROM review_submissions WHERE id = ?").bind(flipId).first()) {
    await bumpOp(db, "review_flip", "start", "success");
    return { id: flipId, flipOf: s.id, replayed: false };
  }
  // 沒建成：同一個 operation 剛被另一個請求做完，或條件在這之間變了
  const raced = await replayOf(db, input.memberId, input.operationId, input.id);
  if (raced) return raced;
  await bumpOp(db, "review_flip", "start", "conflict");
  const now = await db.prepare("SELECT id FROM review_submissions WHERE flip_of = ? AND status IN ('pending', 'approved') LIMIT 1").bind(s.id).first<{ id: string }>();
  if (now) throw new HttpError(409, "review_flip_exists", undefined, { flipId: now.id });
  throw new HttpError(409, "moderation_conflict");
}

async function replayOf(db: D1Database, memberId: string, operationId: string, id: string): Promise<FlipStartResult | null> {
  const done = await db.prepare("SELECT action, subject_id, after_json FROM audit_log WHERE actor_member_id = ? AND operation_id = ?")
    .bind(memberId, operationId).first<{ action: string; subject_id: string; after_json: string }>();
  if (!done) return null;
  if (done.action !== "review_flip_approve" || done.subject_id !== id) throw new HttpError(409, "moderation_conflict");
  return { id: String((JSON.parse(done.after_json) as { flipId: string }).flipId), flipOf: id, replayed: true };
}

/**
 * 撤回改判（＝駁回這張改判單）：只有發起的管理員能撤回，不必先領取。原本的駁回結果不變、不通知作者（0152 的通知 trigger）。
 * 已記下託管核准決定、正在同步的單不能撤回（等同定案）。
 */
export async function withdrawFlip(db: D1Database, input: { id: string; memberId: string; now: number }): Promise<void> {
  const s = await getSubmission(db, input.id);
  if (!s.flip_of) throw new HttpError(409, "review_not_flip");
  if (!isManager(await reviewerRole(db, input.memberId))) throw new HttpError(403, "review_flip_manager_required");
  if (s.flip_by !== input.memberId) throw new HttpError(403, "review_flip_initiator_only");
  if (s.status !== "pending" || await db.prepare("SELECT 1 FROM work_review_decisions WHERE submission_id = ?").bind(s.id).first()) throw new HttpError(409, "submission already decided");
  const closed = "EXISTS (SELECT 1 FROM review_submissions WHERE id = ? AND status = 'rejected' AND decided_at = ?)";
  const [update] = await db.batch([
    db.prepare(`UPDATE review_submissions SET status = 'rejected', decided_at = ?, note = '', claimed_by = NULL, claimed_at = NULL, claim_generation = ''
      WHERE id = ? AND status = 'pending' AND NOT EXISTS (SELECT 1 FROM work_review_decisions WHERE submission_id = ?)`).bind(input.now, s.id, s.id),
    db.prepare(`INSERT INTO audit_log (id, subject_kind, subject_id, actor_member_id, actor_kind, action, reason, before_json, after_json, operation_id, created_at)
      SELECT ?, 'review_submission', ?, ?, 'human', 'review_flip_withdraw', '', '{}', json_object('flipId', ?), ?, ? WHERE ${closed}`)
      .bind(crypto.randomUUID(), s.flip_of, input.memberId, s.id, crypto.randomUUID(), input.now, s.id, input.now),
    reviewEventStatement(db, { key: "flip_withdraw:" + s.id, submissionId: s.id, cardId: s.card_id, at: input.now, action: "flip_withdraw", from: "pending", to: "rejected", actorKind: "reviewer", actorMemberId: input.memberId,
      guard: { sql: closed, args: [s.id, input.now] } }),
    db.prepare(`DELETE FROM review_snapshots WHERE submission_id = ? AND ${closed}`).bind(s.id, s.id, input.now),
  ]);
  if (!update.meta.changes) throw new HttpError(409, "submission already decided");
}

/** 審核清單、詳情、作品管理共用：這張單改判的狀態（SQL 欄位，s 是 review_submissions 的別名） */
export const FLIP_COLUMNS = (s: string) => `(SELECT f.id FROM review_submissions f WHERE f.flip_of = ${s}.id AND f.status = 'pending' LIMIT 1) AS flip_pending_id,
  (SELECT f.id FROM review_submissions f WHERE f.flip_of = ${s}.id AND f.status = 'approved' LIMIT 1) AS flip_approved_id,
  EXISTS (SELECT 1 FROM hosting_versions fv WHERE fv.submission_id = ${s}.id AND fv.state = 'rejected') AS flip_version_rejected`;
export interface FlipColumns { flip_pending_id: string | null; flip_approved_id: string | null; flip_version_rejected: number }
export interface FlipState {
  /** 改判單還在審（目前結果：改判審核中） */
  pendingId: string | null;
  /** 已改判為通過 */
  approvedId: string | null;
  /** 管理員看得到「改判為通過」入口（作者已改稿重送時仍出現，表單裡停用並說明） */
  canStart: boolean;
}
export function flipState(r: FlipColumns & { status: string; reopen_of?: string | null; reopen?: number | boolean | null }, manager: boolean): FlipState {
  const pendingId = r.flip_pending_id ?? null, approvedId = r.flip_approved_id ?? null;
  return { pendingId, approvedId, canStart: manager && r.status === "rejected" && !r.reopen_of && !r.reopen && !!r.flip_version_rejected && !pendingId && !approvedId };
}

/** 詳情頁：這張單若是改判單，回改判說明；若是可改判的駁回單，回作者是否已改稿重送 */
export async function flipDetail(db: D1Database, s: { id: string; status: string; reopen_of: string | null; flip_of?: string | null; flip_by?: string | null; flip_reason?: string; submitted_at: number }, memberId: string) {
  const manager = isManager(await reviewerRole(db, memberId));
  const cols = await db.prepare(`SELECT ${FLIP_COLUMNS("s")} FROM review_submissions s WHERE s.id = ?`).bind(s.id).first<FlipColumns>();
  const state = flipState({ ...cols!, status: s.status, reopen_of: s.reopen_of }, manager);
  const supersededBy = state.canStart ? await newerAuthorSubmission(db, s.id) : null;
  let flip = null;
  if (s.flip_of) {
    const o = await db.prepare(`SELECT o.decided_at, o.reject_reasons, o.note, COALESCE(NULLIF(m.display_name, ''), m.handle) AS name
      FROM review_submissions o LEFT JOIN members m ON m.id = ? WHERE o.id = ?`).bind(s.flip_by ?? "", s.flip_of)
      .first<{ decided_at: number | null; reject_reasons: string | null; note: string; name: string | null }>();
    flip = {
      of: s.flip_of, by: (o?.name ?? "").slice(0, 80), mine: s.flip_by === memberId, at: s.submitted_at,
      rejectedAt: o?.decided_at ?? null, reasons: parseReviewReasons(o?.reject_reasons ?? null), note: o?.note ?? "",
      // 改判理由只給管理員（發起人本身是管理員）
      ...(manager ? { reason: s.flip_reason ?? "" } : {}),
    };
  }
  return { flip, flipState: { ...state, supersededBy } };
}
