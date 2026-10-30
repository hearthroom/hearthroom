import { auditStmt, auditStmtIfChanged, type AuditEntry } from "./audit";
import type { CommunitySettings } from "./community-settings";
import { memberNsfw } from "./members";
import { bumpOp } from "./ops-metrics";
import { HttpError, pickLocale, type Localized } from "./types";
import { reportCommentRemoved } from "./reward-events";

/**
 * 留言審核：先發布、後審核（owner 2026-10-30）。每則留言都直接公開，留言任務與獎勵照常算；
 * 命中風險規則只在留言上記一個原因（hold_reason），進後台待審。審核人放行＝清掉原因，移除才撤下；
 * 沒人處理就一直公開。檢舉達門檻、AI 審核帳號標記也一樣只記原因、不隱藏。
 * 數字門檻來自運營設定，沒設就不啟用（0 天＝規則開著但永遠不標記，只有沒設才是關）；
 * 固定規則一條：近 30 天被移除過。不查重複內容：「好玩」「頂」這類短評本來就會重複（owner 2026-10-30）。
 */
export type HoldReason = "keyword" | "new_account_link" | "too_many_links" | "recent_removal";

const DAY = 86_400_000;
/** 檢舉的目標種類跟著留言本身走：掛在文章上的是 post，其餘是 card。`c` 是 comments 的別名。 */
const KIND = "IIF(c.post_id IS NULL, 'card', 'post')";
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
  const removed = await db.prepare("SELECT 1 AS ok FROM comments WHERE member_id = ? AND status = 'removed' AND moderated_at > ? LIMIT 1").bind(input.memberId, input.now - 30 * DAY).first();
  if (removed) return "recent_removal";
  return null;
}

export const REPORT_REASONS = ["spam", "abuse", "sexual", "privacy", "other"] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

/** 檢舉：一人一則一次（重複按不重複算），目標種類依留言掛在卡還是文章。檢舉人數達到設定門檻，留言標記進待審（照常公開）。 */
export async function reportComment(
  db: D1Database,
  input: { commentId: string; reporterId: string; reason: unknown; note: unknown; now: number },
  s: CommunitySettings,
): Promise<{ flagged: boolean }> {
  if (typeof input.reason !== "string" || !(REPORT_REASONS as readonly string[]).includes(input.reason)) throw new HttpError(400, "invalid_report_reason");
  const note = typeof input.note === "string" ? input.note.trim().slice(0, 300) : "";
  const c = await db.prepare(`SELECT member_id, status, ${KIND} AS kind FROM comments c WHERE id = ? AND deleted_at IS NULL`).bind(input.commentId).first<{ member_id: string; status: string; kind: "card" | "post" }>();
  if (!c || c.status === "removed") throw new HttpError(404, "comment not found");
  if (c.member_id === input.reporterId) throw new HttpError(403, "cannot_report_own_comment");
  const res = await db.prepare("INSERT OR IGNORE INTO comment_reports (id, target_kind, comment_id, reporter_member_id, reason, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), c.kind, input.commentId, input.reporterId, input.reason, note, input.now).run();
  if (!res.meta.changes) return { flagged: false };
  await bumpOp(db, "comment_moderation", "report", "success");
  if (c.status !== "visible" || s.commentReportFoldThreshold === null) return { flagged: false };
  const open = await db.prepare("SELECT COUNT(*) AS n FROM comment_reports WHERE target_kind = ? AND comment_id = ? AND resolved_at IS NULL").bind(c.kind, input.commentId).first<{ n: number }>();
  if ((open?.n ?? 0) < s.commentReportFoldThreshold) return { flagged: false };
  return { flagged: await flagVisible(db, input.commentId, "reports", null, "system", "fold:" + input.commentId, input.now) };
}

/**
 * 把一則公開、還沒有標記的留言標記進待審（檢舉達門檻、AI 標記）。留言照常公開，回覆數不動；條件式 UPDATE 讓並發只生效一次。
 */
export async function flagVisible(db: D1Database, commentId: string, reason: "reports" | "ai", actorId: string | null, actorKind: "system" | "ai", operationId: string, now: number, note = ""): Promise<boolean> {
  // 稽核用 changes() 串在條件式 UPDATE 後面：只有真的標記到列，才寫稽核。
  const results = await db.batch([
    db.prepare("UPDATE comments SET hold_reason = ?, moderation_reason = ?, moderated_by = ?, moderated_at = ? WHERE id = ? AND status = 'visible' AND hold_reason IS NULL").bind(reason, note || null, actorId, now, commentId),
    auditStmtIfChanged(db, { subjectKind: "comment", subjectId: commentId, actorMemberId: actorId, actorKind, action: "flag", reason: note || reason, before: { status: "visible" }, after: { status: "visible", holdReason: reason }, operationId, now }),
  ]);
  if (!results[0].meta.changes) return false;
  await bumpOp(db, "comment_moderation", "flag", "success");
  return true;
}

// ---- 審核人處理 -------------------------------------------------------------------

/** 同一個操作編號重送（稽核的 UNIQUE）＝別人或自己已經做過，回衝突，不寫第二次。 */
export async function conflictOnDuplicate<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (/UNIQUE constraint/.test(String(e))) throw new HttpError(409, "moderation_conflict");
    throw e;
  }
}

export type Decision = "release" | "remove" | "dismiss" | "flag";

/**
 * 審核人對一則留言的決定。改狀態的動作是條件式 UPDATE（狀態要跟讀到的一樣）＋同一個 batch 的後續寫入：
 * 稽核用 changes() 跟在 UPDATE 後面，其餘寫入以「這一次呼叫的稽核列（自帶的 id）存在」為條件，所以並發時輸的那一方
 * 什麼都不寫，回 409。不能用操作編號找稽核列：同一個操作編號連點時，輸的那一方會找到贏的那一方寫的列。
 */
export async function decide(
  db: D1Database,
  i: { commentId: string; actorId: string; actorKind: "human" | "ai"; action: Decision; reason: string; operationId: string; now: number },
): Promise<{ id: string; status: string }> {
  const c = await db.prepare(`SELECT c.id, c.member_id, c.card_id, c.post_id, c.root_id, c.status, c.hold_reason, k.rating, ${KIND} AS kind
    FROM comments c LEFT JOIN cards k ON k.id = c.card_id WHERE c.id = ? AND (k.id IS NOT NULL OR c.post_id IS NOT NULL)`)
    .bind(i.commentId).first<{ id: string; member_id: string; card_id: string; post_id: string | null; root_id: string | null; status: string; hold_reason: string | null; rating: string | null; kind: "card" | "post" }>();
  if (!c || c.status === "deleted") throw new HttpError(404, "comment not found");
  if (c.member_id === i.actorId) throw new HttpError(403, "moderation_self_review");
  // 成人門檻只有卡片留言有；文章沒有分級。
  if (c.post_id === null && c.rating === "R" && (await memberNsfw(db, i.actorId)).ageVerifiedAt === null) throw new HttpError(403, "age_verification_required");
  const auditId = crypto.randomUUID();
  const entry = (action: string, before: unknown, after: unknown): AuditEntry =>
    ({ id: auditId, subjectKind: "comment", subjectId: c.id, actorMemberId: i.actorId, actorKind: i.actorKind, action, reason: i.reason, before, after, operationId: i.operationId, now: i.now });
  const MINE = "EXISTS (SELECT 1 FROM audit_log WHERE id = ?)";
  const closeReports = (resolution: "released" | "removed" | "dismissed", gated: boolean) =>
    db.prepare(`UPDATE comment_reports SET resolved_at = ?, resolution = ?, resolved_by = ? WHERE target_kind = ? AND comment_id = ? AND resolved_at IS NULL${gated ? " AND " + MINE : ""}`)
      .bind(i.now, resolution, i.actorId, c.kind, c.id, ...(gated ? [auditId] : []));
  const replyDown = () =>
    db.prepare(`UPDATE comments SET reply_count = MAX(0, reply_count - 1) WHERE id = ? AND ${MINE}`).bind(c.root_id, auditId);
  const clearFlag = (extra = "") =>
    // 清掉標記的原因：之後再被標記（例如檢舉達門檻）不會帶著上一次的原因。
    db.prepare(`UPDATE comments SET hold_reason = NULL, moderation_reason = NULL, moderated_by = ?, moderated_at = ? WHERE id = ? AND status = 'visible' AND hold_reason IS NOT NULL${extra}`).bind(i.actorId, i.now, c.id);

  let writes: D1PreparedStatement[];
  let next: string;
  if (i.action === "flag") {
    if (c.status === "visible" && (await conflictOnDuplicate(() => flagVisible(db, c.id, "ai", i.actorId, "ai", i.operationId, i.now, i.reason)))) return { id: c.id, status: "visible" };
    // 已經有標記、或已移除：只記下 AI 的意見（稽核），不改狀態；待審佇列從稽核讀出這次標記之後的 AI 建議。
    const now = await db.prepare("SELECT status FROM comments WHERE id = ?").bind(c.id).first<{ status: string }>();
    next = now?.status ?? c.status;
    await conflictOnDuplicate(() => auditStmt(db, entry("flag", { status: next }, { status: next })).run());
    await bumpOp(db, "comment_moderation", "flag", "success");
    return { id: c.id, status: next };
  } else if (i.action === "release") {
    if (c.status !== "visible" || c.hold_reason === null) throw new HttpError(409, "moderation_conflict");
    next = "visible";
    writes = [clearFlag(), auditStmtIfChanged(db, entry("release", { status: "visible", holdReason: c.hold_reason }, { status: "visible" })), closeReports("released", true)];
  } else if (i.action === "remove") {
    if (c.status !== "visible") throw new HttpError(409, "moderation_conflict");
    next = "removed";
    writes = [
      db.prepare("UPDATE comments SET status = 'removed', deleted_at = ?, moderated_by = ?, moderated_at = ?, moderation_reason = ? WHERE id = ? AND status = ?").bind(i.now, i.actorId, i.now, i.reason, c.id, c.status),
      auditStmtIfChanged(db, entry("remove", { status: c.status }, { status: "removed" })),
      closeReports("removed", true),
      db.prepare(`INSERT OR IGNORE INTO community_notifications (event_key, member_id, kind, path, created_at, card_id, extra, delivered) SELECT ?, ?, 'comment_removed', ?, ?, ?, json_object('reason', ?), 1 WHERE ${MINE}`)
        .bind("removed:" + c.id, c.member_id, c.post_id ? "/blog/p/" + c.post_id : "/cards/" + c.card_id, i.now, c.post_id ? null : c.card_id, i.reason, auditId),
    ];
    if (c.root_id) writes.push(replyDown());
  } else if (c.status === "visible" && c.hold_reason === "reports") {
    // 駁回檢舉：因檢舉達門檻的標記一併清掉。
    next = "visible";
    writes = [clearFlag(" AND hold_reason = 'reports'"), auditStmtIfChanged(db, entry("dismiss", { status: "visible", holdReason: "reports" }, { status: "visible" })), closeReports("dismissed", true)];
  } else {
    // 只結案檢舉、不改狀態：沒有可輸的條件式更新，稽核直接寫。
    next = c.status;
    await conflictOnDuplicate(() => db.batch([closeReports("dismissed", false), auditStmt(db, entry("dismiss", { status: c.status }, { status: c.status }))]));
    await bumpOp(db, "comment_moderation", "dismiss", "success");
    return { id: c.id, status: next };
  }
  const results = await conflictOnDuplicate(() => db.batch(writes));
  if (!results[0].meta.changes) throw new HttpError(409, "moderation_conflict");
  await bumpOp(db, "comment_moderation", i.action, "success");
  // 應用獎勵：被移除的卡片留言報給 Harbor（已發的獎勵不收回，只是之後不再算這則）。留言本身在發表時就報過了，放行不再報。
  if (i.action === "remove" && !c.post_id) await reportCommentRemoved(db, { cardId: String(c.card_id), memberId: c.member_id, commentId: c.id, now: i.now });
  return { id: c.id, status: next };
}

/** 禁言：只禁止留言。days 為 null＝永久。 */
export async function setMute(db: D1Database, i: { memberId: string; days: 7 | 30 | null; reason: string; actorId: string; operationId: string; now: number }): Promise<{ until: number | null }> {
  const until = i.days === null ? null : i.now + i.days * DAY;
  await conflictOnDuplicate(() => db.batch([
    db.prepare("INSERT INTO comment_mutes (member_id, until, reason, by_member_id, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(member_id) DO UPDATE SET until = excluded.until, reason = excluded.reason, by_member_id = excluded.by_member_id, created_at = excluded.created_at")
      .bind(i.memberId, until, i.reason, i.actorId, i.now),
    auditStmt(db, { subjectKind: "member", subjectId: i.memberId, actorMemberId: i.actorId, actorKind: "human", action: "mute", reason: i.reason, after: { until }, operationId: i.operationId, now: i.now }),
  ]));
  await bumpOp(db, "comment_moderation", "mute", "success");
  return { until };
}

export async function clearMute(db: D1Database, i: { memberId: string; reason: string; actorId: string; operationId: string; now: number }): Promise<void> {
  await conflictOnDuplicate(() => db.batch([
    db.prepare("DELETE FROM comment_mutes WHERE member_id = ?").bind(i.memberId),
    auditStmtIfChanged(db, { subjectKind: "member", subjectId: i.memberId, actorMemberId: i.actorId, actorKind: "human", action: "unmute", reason: i.reason, operationId: i.operationId, now: i.now }),
  ]));
  await bumpOp(db, "comment_moderation", "unmute", "success");
}

export async function listKeywords(db: D1Database): Promise<{ id: string; pattern: string; createdAt: number }[]> {
  return (await db.prepare("SELECT id, pattern, created_at AS createdAt FROM comment_keywords ORDER BY created_at DESC, id").all<{ id: string; pattern: string; createdAt: number }>()).results;
}

export async function addKeyword(db: D1Database, i: { pattern: unknown; actorId: string; operationId: string; now: number }): Promise<void> {
  const pattern = typeof i.pattern === "string" ? i.pattern.trim() : "";
  if (!pattern || [...pattern].length > 100) throw new HttpError(400, "invalid_arguments");
  const id = crypto.randomUUID();
  await conflictOnDuplicate(() => db.batch([
    db.prepare("INSERT OR IGNORE INTO comment_keywords (id, pattern, created_by, created_at) VALUES (?, ?, ?, ?)").bind(id, pattern, i.actorId, i.now),
    auditStmtIfChanged(db, { subjectKind: "comment_keyword", subjectId: id, actorMemberId: i.actorId, actorKind: "human", action: "add", after: { pattern }, operationId: i.operationId, now: i.now }),
  ]));
  await bumpOp(db, "comment_moderation", "keyword", "success");
}

export async function removeKeyword(db: D1Database, i: { id: string; actorId: string; operationId: string; now: number }): Promise<void> {
  const row = await db.prepare("SELECT pattern FROM comment_keywords WHERE id = ?").bind(i.id).first<{ pattern: string }>();
  if (!row) throw new HttpError(404, "keyword not found");
  await conflictOnDuplicate(() => db.batch([
    db.prepare("DELETE FROM comment_keywords WHERE id = ?").bind(i.id),
    auditStmtIfChanged(db, { subjectKind: "comment_keyword", subjectId: i.id, actorMemberId: i.actorId, actorKind: "human", action: "remove", before: { pattern: row.pattern }, operationId: i.operationId, now: i.now }),
  ]));
  await bumpOp(db, "comment_moderation", "keyword", "success");
}

// ---- 佇列與統計 -------------------------------------------------------------------

export type QueueTab = "held" | "reported" | "removed";
const QUEUE_PAGE = 20;
/** 待審＝公開且有標記；被檢舉＝公開、沒有標記、有未結檢舉（有標記的已經在待審，不重複出現）。 */
export const FLAGGED = "c.status = 'visible' AND c.hold_reason IS NOT NULL";
const TABS: Record<QueueTab, { where: string; order: string }> = {
  held: { where: FLAGGED, order: "c.created_at DESC" },
  reported: { where: `c.status = 'visible' AND c.hold_reason IS NULL AND EXISTS (SELECT 1 FROM comment_reports r WHERE r.target_kind = ${KIND} AND r.comment_id = c.id AND r.resolved_at IS NULL)`, order: "open_reports DESC, c.created_at DESC" },
  removed: { where: "c.status = 'removed'", order: "c.moderated_at DESC" },
};

/**
 * 審核佇列：卡片與文章的留言一起排；自己的留言不出現；沒做年齡驗證的人看不到成人卡上的留言（文章沒有分級）。
 * reason：只看待審分頁裡這個原因的標記；null 是全部。
 */
export async function moderationQueue(db: D1Database, viewerId: string, tab: QueueTab, page: number, reason: FlagReason | null = null) {
  const age = Number((await memberNsfw(db, viewerId)).ageVerifiedAt !== null);
  const t = TABS[tab];
  const from = `FROM comments c LEFT JOIN cards k ON k.id = c.card_id LEFT JOIN blog_posts p ON p.id = c.post_id LEFT JOIN blog_columns col ON col.id = p.column_id
    JOIN members m ON m.id = c.member_id WHERE ${t.where} AND c.member_id <> ?1 AND (k.id IS NOT NULL OR p.id IS NOT NULL) AND (c.post_id IS NOT NULL OR k.rating IS NOT 'R' OR ?2) AND (?5 IS NULL OR c.hold_reason = ?5)`;
  const filter = tab === "held" ? reason : null;
  const [total, rows] = await db.batch([
    db.prepare(`SELECT COUNT(*) AS n ${from}`).bind(viewerId, age, null, null, filter),
    // ai_reason：這次標記之後（標記時間起算）AI 最近一次的標記理由；只看還有標記的，放行過的舊標記不算。
    db.prepare(`SELECT c.id, c.card_id, c.content, c.status, c.hold_reason, c.created_at, c.moderated_at, c.moderation_reason, m.handle, m.display_name, k.names, c.post_id, p.title AS post_title, p.slug AS post_slug, col.slug AS column_slug,
      (SELECT a.reason FROM audit_log a WHERE ${FLAGGED} AND a.subject_kind = 'comment' AND a.subject_id = c.id AND a.action = 'flag' AND a.actor_kind = 'ai' AND a.created_at >= COALESCE(c.moderated_at, c.created_at) ORDER BY a.created_at DESC LIMIT 1) AS ai_reason,
      (SELECT num FROM card_numbers n WHERE n.provider = k.provider AND n.source_role_id = k.source_role_id) AS card_number,
      (SELECT COUNT(*) FROM comment_reports r WHERE r.target_kind = ${KIND} AND r.comment_id = c.id AND r.resolved_at IS NULL) AS open_reports
      ${from} ORDER BY ${t.order} LIMIT ?3 OFFSET ?4`).bind(viewerId, age, QUEUE_PAGE, (page - 1) * QUEUE_PAGE, filter),
  ]);
  type Row = { id: string; card_id: string; content: string; status: string; hold_reason: string | null; created_at: number; moderated_at: number | null; moderation_reason: string | null; ai_reason: string | null; handle: string; display_name: string | null; names: string | null; card_number: number | null;
    post_id: string | null; post_title: string | null; post_slug: string | null; column_slug: string | null };
  const items = rows.results as Row[];
  // 待處理的分頁看未結的檢舉；已移除的分頁看當時全部的檢舉。
  const reports = items.length
    ? (await db.prepare(`SELECT comment_id, reason, COUNT(*) AS n FROM comment_reports WHERE target_kind IN ('card','post') AND comment_id IN (SELECT value FROM json_each(?)) AND (resolved_at IS NULL OR ?) GROUP BY comment_id, reason`)
        .bind(JSON.stringify(items.map((r) => r.id)), Number(tab === "removed")).all<{ comment_id: string; reason: string; n: number }>()).results
    : [];
  return {
    total: (total.results[0] as { n: number }).n,
    items: items.map((r) => {
      const mine = reports.filter((x) => x.comment_id === r.id);
      return {
        id: r.id,
        target: r.post_id
          ? { kind: "post" as const, id: r.post_id, title: r.post_title!, column: r.column_slug!, slug: r.post_slug! }
          : { kind: "card" as const, id: String(r.card_id), title: pickLocale(JSON.parse(r.names!) as Localized, "zh-Hant"), cardNumber: r.card_number },
        author: { handle: r.handle, displayName: r.display_name?.trim() || r.handle },
        content: r.content,
        status: r.status,
        holdReason: r.hold_reason,
        reports: { total: mine.reduce((a, x) => a + x.n, 0), byReason: Object.fromEntries(mine.map((x) => [x.reason, x.n])) as Record<string, number> },
        createdAt: r.created_at,
        moderatedAt: r.moderated_at,
        moderationReason: r.moderation_reason ?? r.ai_reason,
        suggestedBy: r.ai_reason !== null ? ("ai" as const) : null,
      };
    }),
  };
}

export const FLAG_REASONS = ["keyword", "new_account_link", "too_many_links", "recent_removal", "reports", "ai"] as const;
export type FlagReason = (typeof FLAG_REASONS)[number];

export async function moderationStats(db: D1Database, now: number) {
  const since = now - 7 * DAY;
  const [held, open, removed, handled, reasons, holds, reports] = await db.batch([
    db.prepare(`SELECT COUNT(*) AS n FROM comments c WHERE ${FLAGGED}`),
    db.prepare("SELECT COUNT(DISTINCT r.comment_id) AS n FROM comment_reports r JOIN comments c ON c.id = r.comment_id WHERE r.resolved_at IS NULL AND c.status = 'visible'"),
    db.prepare("SELECT COUNT(*) AS n FROM comments WHERE status = 'removed' AND moderated_at > ?").bind(since),
    // 公開、沒有標記、有處理時間＝被放行過；已移除＝被移除。還有標記的，moderated_at 是標記的時間，不算處理。
    db.prepare("SELECT moderated_at - created_at AS ms FROM comments WHERE ((status = 'visible' AND hold_reason IS NULL) OR status = 'removed') AND moderated_at > ? ORDER BY moderated_at DESC LIMIT 500").bind(since),
    // 每一次標記都有一筆稽核（發表時的規則、檢舉達門檻、AI 標記），依當時的原因分組。
    db.prepare("SELECT json_extract(after_json, '$.holdReason') AS reason, COUNT(*) AS n FROM audit_log WHERE subject_kind = 'comment' AND action IN ('hold','flag') AND created_at > ? GROUP BY reason").bind(since),
    // 標記率：近 7 天新留言中「曾被標記」的比例。放行會清掉 hold_reason，所以看標記的稽核（同上，每次標記都有一筆），不看欄位。
    // 只算真的標記到的那幾筆（after 有 holdReason）：AI 對已有標記或已移除的留言再標記，只記意見，不算標記。
    // 舊稽核的 action 是 hold（2026-10-30 前留言會被藏起來），一起算。
    // ponytail: 這條與下一條（近 7 天檢舉）依 created_at 掃整張表；量大時給 comments、comment_reports 補 created_at 索引。
    db.prepare(`SELECT COUNT(*) AS total, COALESCE(SUM(EXISTS (SELECT 1 FROM audit_log a WHERE a.subject_kind = 'comment' AND a.subject_id = c.id AND a.action IN ('hold','flag')
        AND json_extract(a.after_json, '$.holdReason') IS NOT NULL)), 0) AS held
      FROM comments c WHERE c.created_at > ?`).bind(since),
    db.prepare("SELECT COUNT(*) AS n FROM comment_reports WHERE created_at > ?").bind(since),
  ]);
  const n = (r: D1Result) => (r.results[0] as { n: number }).n;
  const ms = (handled.results as { ms: number }[]).map((r) => r.ms).sort((a, b) => a - b);
  const mid = ms.length >> 1;
  const holdReasons7d = Object.fromEntries(FLAG_REASONS.map((k) => [k, 0])) as Record<FlagReason, number>;
  const fresh = holds.results[0] as { total: number; held: number };
  for (const r of reasons.results as { reason: string | null; n: number }[]) if (r.reason && r.reason in holdReasons7d) holdReasons7d[r.reason as keyof typeof holdReasons7d] = r.n;
  return {
    held: n(held),
    openReports: n(open),
    removed7d: n(removed),
    medianHandleMs7d: ms.length ? (ms.length % 2 ? ms[mid] : Math.round((ms[mid - 1] + ms[mid]) / 2)) : null,
    holdReasons7d,
    holdRate7d: fresh.total ? fresh.held / fresh.total : null,
    reports7d: n(reports),
  };
}
