import { HttpError } from "./types";

/**
 * 活動歸因（開業活動設計 §8.1、計畫 6 架構裁定 1–2）。
 * - 訪客計數：瀏覽器第一次帶某個分享碼進站（同碼同日一次）送來，依「分享碼＋UTC 日」累加；只存碼、日、次數。
 * - 歸因：登入後送一次「第一次點的碼與時間」。每人一列、寫了就不改；只算點了之後才第一次來本站的人
 *   （`members.created_at` 不早於點擊 10 分鐘以上，比照推薦碼的時鐘誤差），自己的內容不算。
 * 回應只有結論，不含成員 id。
 */
export const SHARE_CODE = /^[A-Z0-9]{8}$/;
const DAY = 86_400_000;
/** 瀏覽器與伺服器的鐘差：點擊時間是瀏覽器的鐘。 */
const CLOCK_SLACK = 10 * 60_000;
/** 跟瀏覽器記錄的保存期限相同。 */
const WINDOW = 30 * DAY;

export const utcDay = (ms: number) => Math.floor(ms / DAY);

/** 碼存在才累加；不存在或格式不對什麼都不寫。一次往返。 */
export async function countVisit(db: D1Database, s: unknown, now: number): Promise<void> {
  if (typeof s !== "string" || !SHARE_CODE.test(s)) return;
  // SELECT 後接 upsert 要有 WHERE 子句，SQLite 才不會把 ON CONFLICT 當成 join 條件。
  await db.prepare(
    `INSERT INTO campaign_share_visits (share_code, day, visits)
     SELECT ?1, ?2, 1 WHERE EXISTS (SELECT 1 FROM share_contents WHERE share_code = ?1)
     ON CONFLICT (share_code, day) DO UPDATE SET visits = visits + 1`,
  ).bind(s, utcDay(now)).run();
}

export type AttributionResult = { bound: true } | { bound: false; reason: "unknown" | "existing" | "not_new" | "own" };

export async function bindAttribution(db: D1Database, memberId: string, body: Record<string, unknown>, now: number): Promise<AttributionResult> {
  const { s, firstSeenAt } = body;
  if (typeof s !== "string" || !SHARE_CODE.test(s)) throw new HttpError(400, "invalid_arguments");
  // 未來只容許時鐘誤差：瀏覽器的鐘快幾分鐘、剛點完就登入的人不該被拒。
  if (typeof firstSeenAt !== "number" || !Number.isSafeInteger(firstSeenAt) || firstSeenAt > now + CLOCK_SLACK || firstSeenAt < now - WINDOW) {
    throw new HttpError(400, "invalid_arguments");
  }
  const row = await db.prepare(
    `SELECT m.created_at AS registered_at, c.id AS content_id, c.campaign_id, c.member_id AS owner,
            EXISTS (SELECT 1 FROM campaign_attributions WHERE member_id = m.id) AS existing
     FROM members m LEFT JOIN share_contents c ON c.share_code = ? WHERE m.id = ?`,
  ).bind(s, memberId).first<{ registered_at: number; content_id: string | null; campaign_id: string; owner: string; existing: number }>();
  if (!row?.content_id) return { bound: false, reason: "unknown" };
  if (row.existing) return { bound: false, reason: "existing" };
  if (row.owner === memberId) return { bound: false, reason: "own" };
  if (row.registered_at < firstSeenAt - CLOCK_SLACK) return { bound: false, reason: "not_new" };
  // 主鍵是成員：並發的兩次只有一次寫得進去，另一次看 changes 回 existing。
  const res = await db.prepare(
    `INSERT OR IGNORE INTO campaign_attributions (member_id, share_code, content_id, campaign_id, first_seen_at, registered_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(memberId, s, row.content_id, row.campaign_id, firstSeenAt, row.registered_at, now).run();
  return res.meta.changes ? { bound: true } : { bound: false, reason: "existing" };
}
