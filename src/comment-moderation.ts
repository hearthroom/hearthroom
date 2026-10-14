import { auditStmtIfChanged } from "./audit";
import type { CommunitySettings } from "./community-settings";
import { bumpOp } from "./ops-metrics";
import { HttpError } from "./types";

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

export const REPORT_REASONS = ["spam", "abuse", "sexual", "privacy", "other"] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

/** 檢舉：一人一則一次（重複按不重複算）。檢舉人數達到設定門檻，公開的留言轉成待審並摺疊。 */
export async function reportComment(
  db: D1Database,
  input: { commentId: string; targetKind: "card"; reporterId: string; reason: unknown; note: unknown; now: number },
  s: CommunitySettings,
): Promise<{ folded: boolean }> {
  if (typeof input.reason !== "string" || !(REPORT_REASONS as readonly string[]).includes(input.reason)) throw new HttpError(400, "invalid_report_reason");
  const note = typeof input.note === "string" ? input.note.trim().slice(0, 300) : "";
  const c = await db.prepare("SELECT member_id, status FROM comments WHERE id = ? AND deleted_at IS NULL").bind(input.commentId).first<{ member_id: string; status: string }>();
  if (!c || c.status === "removed") throw new HttpError(404, "comment not found");
  if (c.member_id === input.reporterId) throw new HttpError(403, "cannot_report_own_comment");
  const res = await db.prepare("INSERT OR IGNORE INTO comment_reports (id, target_kind, comment_id, reporter_member_id, reason, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), input.targetKind, input.commentId, input.reporterId, input.reason, note, input.now).run();
  if (!res.meta.changes) return { folded: c.status === "held" };
  await bumpOp(db, "comment_moderation", "report", "success");
  if (c.status !== "visible" || s.commentReportFoldThreshold === null) return { folded: c.status === "held" };
  const open = await db.prepare("SELECT COUNT(*) AS n FROM comment_reports WHERE target_kind = ? AND comment_id = ? AND resolved_at IS NULL").bind(input.targetKind, input.commentId).first<{ n: number }>();
  if ((open?.n ?? 0) < s.commentReportFoldThreshold) return { folded: false };
  await holdVisible(db, input.commentId, "reports", null, "system", "fold:" + input.commentId, input.now);
  return { folded: true };
}

/**
 * 把一則公開留言轉成待審（檢舉達門檻、AI 標記）。回覆數同步減一；條件式 UPDATE 讓並發只生效一次。
 */
export async function holdVisible(db: D1Database, commentId: string, reason: "reports" | "ai", actorId: string | null, actorKind: "system" | "ai", operationId: string, now: number, note = ""): Promise<boolean> {
  const row = await db.prepare("SELECT root_id FROM comments WHERE id = ? AND status = 'visible'").bind(commentId).first<{ root_id: string | null }>();
  if (!row) return false;
  // 三條寫入同一個 batch、用 changes() 串起來：只有第一條條件式 UPDATE 真的改到列，稽核與回覆數才會跟著動。
  const writes = [
    db.prepare("UPDATE comments SET status = 'held', hold_reason = ?, moderation_reason = ?, moderated_by = ?, moderated_at = ? WHERE id = ? AND status = 'visible'").bind(reason, note || null, actorId, now, commentId),
    auditStmtIfChanged(db, { subjectKind: "comment", subjectId: commentId, actorMemberId: actorId, actorKind, action: reason === "ai" ? "flag" : "hold", reason: note || reason, before: { status: "visible" }, after: { status: "held", holdReason: reason }, operationId, now }),
  ];
  if (row.root_id) writes.push(db.prepare("UPDATE comments SET reply_count = MAX(0, reply_count - 1) WHERE id = ? AND changes() > 0").bind(row.root_id));
  const results = await db.batch(writes);
  if (!results[0].meta.changes) return false;
  await bumpOp(db, "comment_moderation", reason === "ai" ? "flag" : "hold", "success");
  return true;
}
