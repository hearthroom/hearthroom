import { RATINGS, isRating, type Rating } from "../shared/content-rating";
import { HttpError } from "./types";
import { bumpOp } from "./ops-metrics";

/**
 * 管理員更正分級（owner 2026-11-24）：作者自填分級不符時改成正確分級，寫稽核，並設成這張卡的分級下限。
 * 作者之後送審時，問卷算出的分級比下限低就提到下限（submitHosted 套用）。不通知作者。
 */
const rank = (r: string) => RATINGS.indexOf(r as Rating);

/** SQL 裡比分級高低用（G < P < PG12 < PG15 < R；NULL 與其他值最低） */
export const RATING_RANK_SQL = (col: string) => `(CASE ${col} WHEN 'G' THEN 0 WHEN 'P' THEN 1 WHEN 'PG12' THEN 2 WHEN 'PG15' THEN 3 WHEN 'R' THEN 4 ELSE -1 END)`;

/** 套用這張卡的分級下限：問卷分級比下限低就提到下限 */
export function applyRatingFloor(rating: Rating, floor: string | null): Rating {
  return floor && isRating(floor) && rank(floor) > rank(rating) ? floor : rating;
}

export async function floorForCard(db: D1Database, cardId: number | string): Promise<string | null> {
  return (await db.prepare("SELECT rating FROM review_rating_floors WHERE card_id=?").bind(cardId).first<{ rating: string }>())?.rating ?? null;
}

export async function ratingFloorOf(db: D1Database, provider: string, roleId: string): Promise<string | null> {
  const row = await db.prepare("SELECT f.rating FROM review_rating_floors f JOIN cards c ON c.id=f.card_id WHERE c.provider=? AND c.source_role_id=?").bind(provider, roleId).first<{ rating: string }>();
  return row?.rating ?? null;
}

export async function correctRating(db: D1Database, input: { cardId: number; rating: unknown; reason: unknown; memberId: string; operationId: string; now: number }) {
  if (!isRating(input.rating)) throw new HttpError(400, "invalid_arguments", undefined, { field: "rating" });
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (!/^[0-9a-f-]{36}$/i.test(input.operationId)) throw new HttpError(400, "invalid_arguments", undefined, { field: "operationId" });
  if (!reason || reason.length > 500) throw new HttpError(400, "invalid_arguments", undefined, { field: "reason" });
  const card = await db.prepare("SELECT c.id, c.rating, c.approved_version_id, (SELECT v.rating FROM hosting_versions v WHERE v.version_id=c.approved_version_id) AS version_rating FROM cards c WHERE c.id=?")
    .bind(input.cardId).first<{ id: number; rating: string | null; approved_version_id: string | null; version_rating: string | null }>();
  if (!card) throw new HttpError(404, "card not found");
  // 同一個 operation 已經做過：同一張卡、同一個分級就回當時的結果，否則是衝突。沒記過才往下寫
  const done = await db.prepare("SELECT before_json, after_json, subject_id FROM audit_log WHERE actor_member_id=? AND operation_id=?")
    .bind(input.memberId, input.operationId).first<{ before_json: string; after_json: string; subject_id: string }>();
  if (done) {
    const after = JSON.parse(done.after_json) as { rating?: string };
    if (done.subject_id !== String(card.id) || after.rating !== input.rating) throw new HttpError(409, "moderation_conflict");
    const stored = JSON.parse(done.after_json) as { lockOnly?: boolean };
    return { cardId: done.subject_id, before: JSON.parse(done.before_json), rating: input.rating, floor: input.rating, lockOnly: !!stored.lockOnly };
  }
  const floor = await floorForCard(db, card.id);
  // 分級和下限都已經是這一級才算沒變；分級一樣但下限不同（含沒有下限）＝只鎖定下限，卡片分級不動
  if (card.rating === input.rating && floor === input.rating) {
    await bumpOp(db, "rating_correction", "correct", "unchanged");
    throw new HttpError(409, "rating_unchanged");
  }
  const lockOnly = card.rating === input.rating;
  const before = { rating: card.rating, versionRating: card.version_rating, floor };
  const after = { rating: input.rating, versionRating: card.approved_version_id ? input.rating : null, floor: input.rating, lockOnly };
  const auditId = crypto.randomUUID();
  // 後面每一句都以「這次的稽核列真的寫進去了」為條件：同一個 operation 併發重送時，只有寫進稽核的那一次會改資料
  const mine = "EXISTS (SELECT 1 FROM audit_log WHERE id = ?)";
  const sqlRank = RATING_RANK_SQL;
  await db.batch([
    db.prepare(`INSERT INTO audit_log (id, subject_kind, subject_id, actor_member_id, actor_kind, action, reason, before_json, after_json, operation_id, created_at)
      VALUES (?, 'card', ?, ?, 'human', 'rating_correction', ?, ?, ?, ?, ?) ON CONFLICT(actor_member_id, operation_id) DO NOTHING`)
      .bind(auditId, String(card.id), input.memberId, reason, JSON.stringify(before), JSON.stringify(after), input.operationId, input.now),
    // 作品管理的卡片歷程看得到這次更正
    db.prepare(`INSERT INTO moderation_events(id,provider,source_role_id,actor,action,reason,before_value,after_value,created_at,operation_id)
      SELECT ?,provider,source_role_id,?,?,?,?,?,?,? FROM cards WHERE id=? AND ${mine} ON CONFLICT(actor,operation_id) DO NOTHING`)
      .bind(crypto.randomUUID(), input.memberId, lockOnly ? "rating_floor" : "rating", reason, (lockOnly ? floor : card.rating) ?? "", input.rating, input.now, input.operationId, card.id, auditId),
    // 先設下限：卡片與待審單的 trigger 都看這張表
    db.prepare(`INSERT INTO review_rating_floors (card_id, rating, reason, set_by, set_at) SELECT ?,?,?,?,? WHERE ${mine}
      ON CONFLICT(card_id) DO UPDATE SET rating=excluded.rating, reason=excluded.reason, set_by=excluded.set_by, set_at=excluded.set_at`)
      .bind(card.id, input.rating, reason, input.memberId, input.now, auditId),
    db.prepare(`UPDATE cards SET rating=? WHERE id=? AND ${mine}`).bind(input.rating, card.id, auditId),
    db.prepare(`UPDATE hosting_versions SET rating=? WHERE version_id=? AND ${mine}`).bind(input.rating, card.approved_version_id, auditId),
    // 這張卡其他版本（舊的上架版本、還沒送審完的版本）低於下限的也提上來，退回舊版時才不會帶回低分級
    db.prepare(`UPDATE hosting_versions SET rating=? WHERE card_id=? AND ${sqlRank("rating")} < ${sqlRank("?")} AND ${mine}`).bind(input.rating, String(card.id), input.rating, auditId),
    // 還在待審的單只往上提到下限（作者自己填得更高就不動），審核員看到的分級與年齡門檻才對
    db.prepare(`UPDATE review_submissions SET rating=? WHERE card_id=? AND status='pending' AND ${sqlRank("rating")} < ${sqlRank("?")} AND ${mine}`)
      .bind(input.rating, card.id, input.rating, auditId),
  ]);
  await bumpOp(db, "rating_correction", "correct", "applied");
  return { cardId: String(card.id), before, rating: input.rating, floor: input.rating, lockOnly };
}
