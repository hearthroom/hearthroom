import type { CommunitySettings } from "./community-settings";

/**
 * 留言審核（開業活動設計 §7）：大部分留言直接公開，命中風險規則的先攔下、只給本人看。
 * 數字門檻來自運營設定，沒設就不啟用（0 天＝規則開著但永遠不攔，只有沒設才是關）；
 * 兩條固定規則照 spec：24 小時內重複相同內容、近 30 天被移除過。
 */
export type HoldReason = "keyword" | "new_account_link" | "too_many_links" | "duplicate" | "recent_removal";

const DAY = 86_400_000;
const LINK = /\bhttps?:\/\/\S+|\bwww\.\S+/gi;

export function countLinks(text: string): number {
  return (text.match(LINK) ?? []).length;
}

/** 回 false＝沒被禁言；null＝永久；數字＝到期時間（毫秒）。 */
export async function mutedUntil(db: D1Database, memberId: string, now: number): Promise<number | null | false> {
  const row = await db.prepare("SELECT until FROM comment_mutes WHERE member_id = ?").bind(memberId).first<{ until: number | null }>();
  if (!row) return false;
  if (row.until !== null && row.until <= now) return false;
  return row.until;
}

export async function holdReason(db: D1Database, input: { memberId: string; content: string; now: number }, s: CommunitySettings): Promise<HoldReason | null> {
  const lower = input.content.toLowerCase();
  const keywords = await db.prepare("SELECT pattern FROM comment_keywords").all<{ pattern: string }>();
  if (keywords.results.some((k) => lower.includes(k.pattern.toLowerCase()))) return "keyword";
  const links = countLinks(input.content);
  if (s.commentMaxLinks !== null && links > s.commentMaxLinks) return "too_many_links";
  if (s.commentNewAccountDays !== null && links > 0) {
    const m = await db.prepare("SELECT created_at FROM members WHERE id = ?").bind(input.memberId).first<{ created_at: number }>();
    if (m && input.now - m.created_at < s.commentNewAccountDays * DAY) return "new_account_link";
  }
  const dup = await db.prepare("SELECT 1 AS ok FROM comments WHERE member_id = ? AND content = ? AND created_at > ? AND status IN ('visible','held') LIMIT 1").bind(input.memberId, input.content, input.now - DAY).first();
  if (dup) return "duplicate";
  const removed = await db.prepare("SELECT 1 AS ok FROM comments WHERE member_id = ? AND status = 'removed' AND moderated_at > ? LIMIT 1").bind(input.memberId, input.now - 30 * DAY).first();
  if (removed) return "recent_removal";
  return null;
}
