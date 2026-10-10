/**
 * 評分：本站自己的資料（migrations/0058）。
 *
 * 一位成員對一張卡一份 1–5 星：再評一次是改分，收回就刪掉那一筆。作者不能評自己的卡。
 * 跟留言同一個門：只有在榜的卡能讀寫（commentCard），成人卡要過成人內容的門。
 * 星數另外附在留言上（listTop 的 score），讓「寫了幾句」跟「給了幾星」一起看。
 */
import { cardAuthorMemberId, type CommentCard } from "./comments";
import { HttpError } from "./types";

export interface CardScore {
  /** 平均，取到小數一位；沒人評過是 null */
  average: number | null;
  count: number;
  /** 1 星到 5 星各幾筆 */
  histogram: [number, number, number, number, number];
  /** 看的人自己給的分數；訪客或沒評過是 null */
  mine: number | null;
}

export async function readScore(db: D1Database, cardId: string, memberId: string | null): Promise<CardScore> {
  const [groups, mine] = await db.batch<{ score: number; n: number }>([
    db.prepare("SELECT score, COUNT(*) AS n FROM card_scores WHERE card_id = ? GROUP BY score").bind(cardId),
    db.prepare("SELECT score, 1 AS n FROM card_scores WHERE card_id = ? AND member_id = ?").bind(cardId, memberId ?? ""),
  ]);
  const histogram: CardScore["histogram"] = [0, 0, 0, 0, 0];
  let count = 0;
  let sum = 0;
  for (const row of groups!.results) {
    histogram[row.score - 1] = row.n;
    count += row.n;
    sum += row.score * row.n;
  }
  return {
    average: count ? Math.round((sum / count) * 10) / 10 : null,
    count,
    histogram,
    mine: (mine!.results[0] as { score: number } | undefined)?.score ?? null,
  };
}

export async function setScore(db: D1Database, card: CommentCard, memberId: string, score: unknown, now: number): Promise<void> {
  if (typeof score !== "number" || !Number.isInteger(score) || score < 1 || score > 5) throw new HttpError(400, "score_invalid");
  if ((await cardAuthorMemberId(db, card)) === memberId) throw new HttpError(403, "own_card");
  await db
    .prepare(
      `INSERT INTO card_scores (card_id, member_id, score, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)
       ON CONFLICT (card_id, member_id) DO UPDATE SET score = excluded.score, updated_at = excluded.updated_at`,
    )
    .bind(card.id, memberId, score, now)
    .run();
}

export async function clearScore(db: D1Database, cardId: string, memberId: string): Promise<void> {
  await db.prepare("DELETE FROM card_scores WHERE card_id = ? AND member_id = ?").bind(cardId, memberId).run();
}
