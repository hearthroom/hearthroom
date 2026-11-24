import { RATINGS, isRating, type Rating } from "../shared/content-rating";
import { HttpError } from "./types";
import { bumpOp } from "./ops-metrics";

/**
 * 管理員更正分級（owner 2026-11-24）：作者自填分級不符時改成正確分級，寫稽核，並設成這張卡的分級下限。
 * 作者之後送審時，問卷算出的分級比下限低就提到下限（submitHosted 套用）。不通知作者。
 */
const rank = (r: string) => RATINGS.indexOf(r as Rating);

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
  if (card.rating === input.rating) {
    await bumpOp(db, "rating_correction", "correct", "unchanged");
    throw new HttpError(409, "rating_unchanged");
  }
  const before = { rating: card.rating, versionRating: card.version_rating };
  const after = { rating: input.rating, versionRating: card.approved_version_id ? input.rating : null, floor: input.rating };
  await db.batch([
    db.prepare(`INSERT INTO audit_log (id, subject_kind, subject_id, actor_member_id, actor_kind, action, reason, before_json, after_json, operation_id, created_at)
      VALUES (?, 'card', ?, ?, 'human', 'rating_correction', ?, ?, ?, ?, ?) ON CONFLICT(actor_member_id, operation_id) DO NOTHING`)
      .bind(crypto.randomUUID(), String(card.id), input.memberId, reason, JSON.stringify(before), JSON.stringify(after), input.operationId, input.now),
    // 作品管理的卡片歷程看得到這次更正
    db.prepare(`INSERT INTO moderation_events(id,provider,source_role_id,actor,action,reason,before_value,after_value,created_at,operation_id)
      SELECT ?,provider,source_role_id,?,'rating',?,?,?,?,? FROM cards WHERE id=? ON CONFLICT(actor,operation_id) DO NOTHING`)
      .bind(crypto.randomUUID(), input.memberId, reason, card.rating ?? "", input.rating, input.now, input.operationId, card.id),
    db.prepare("UPDATE cards SET rating=? WHERE id=?").bind(input.rating, card.id),
    db.prepare("UPDATE hosting_versions SET rating=? WHERE version_id=?").bind(input.rating, card.approved_version_id),
    // 還在待審的單一起改，審核員看到的就是更正後的分級
    db.prepare("UPDATE review_submissions SET rating=? WHERE card_id=? AND status='pending'").bind(input.rating, card.id),
    db.prepare(`INSERT INTO review_rating_floors (card_id, rating, reason, set_by, set_at) VALUES (?,?,?,?,?)
      ON CONFLICT(card_id) DO UPDATE SET rating=excluded.rating, reason=excluded.reason, set_by=excluded.set_by, set_at=excluded.set_at`)
      .bind(card.id, input.rating, reason, input.memberId, input.now),
  ]);
  await bumpOp(db, "rating_correction", "correct", "applied");
  return { cardId: String(card.id), before, rating: input.rating, floor: input.rating };
}
