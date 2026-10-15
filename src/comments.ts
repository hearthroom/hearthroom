/**
 * 留言：本站自己的資料（migrations/0019）。
 *
 * 留言掛在本站的卡（cards.id）上，寫的人是本站成員；供應商完全不參與——不管玩家是拿哪一家的
 * 帳號登入，同一張卡底下看到的是同一串留言。
 *
 * 規則：
 *   - 兩層：頂層留言與其回覆。回覆可以回頂層、也可以回同一串裡的另一則回覆（顯示成 @對方）。
 *   - 內容 1–500 字；每個成員一分鐘最多 6 則（429 comment_rate_limited）。
 *   - 刪除：留言者本人、這張卡的作者、站方審核人。軟刪；刪頂層連同底下的回覆一起消失。
 *   - 審核：status = visible／held（命中風險規則，只給本人看）／removed（被移除，頂層有回覆時留佔位）／deleted（刪除）。
 *   - 讚：一人一則一票，重複按不重複算。
 *   - 只有在榜（approved）的卡能讀寫留言。
 *
 * 文章留言（post_id 有值、card_id 寫 0）走同一套：只有公開文章有留言區；關閉留言只擋寫；
 * 刪除只有留言者本人（官方文章的作者是職員，刪除走審核移除）；置頂留言讀取時判斷還公不公開。
 */
import type { ProviderId } from "./providers";
import { auditStmtIfChanged } from "./audit";
import { writerSql } from "./blog";
import { holdReason, mutedUntil } from "./comment-moderation";
import { readSettings } from "./community-settings";
import { bumpOp } from "./ops-metrics";
import { HttpError } from "./types";

export const COMMENT_MAX_CHARS = 500;
export const COMMENT_PAGE_SIZE = 20;
/** 列表裡每則頂層留言預覽幾則回覆；其餘按「查看回覆」再翻。 */
export const REPLY_PREVIEW = 3;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 6;

export interface CommentCard {
  id: string;
  provider: ProviderId;
  authorNumId: number;
  /** 成人內容（限制級）：留言區跟卡片頁同一道門 */
  adult: boolean;
}

/** 留言掛在哪裡。文章只帶留言區要用的欄位。 */
export type CommentTarget =
  | { kind: "card"; card: CommentCard }
  | { kind: "post"; post: { id: string; commentsClosed: boolean; authorMemberId: string; pinnedCommentId: string | null } };
export type CommentSort = "new" | "hot";
export const sortOf = (raw: string | undefined): CommentSort => (raw === "hot" ? "hot" : "new");
/** 熱門：讚多的在前，同讚新的在前。 */
const ORDER: Record<CommentSort, string> = { new: "c.created_at DESC, c.id DESC", hot: "c.like_count DESC, c.created_at DESC, c.id DESC" };
const targetOf = (t: CommentTarget) => (t.kind === "card" ? { col: "card_id", id: t.card.id } : { col: "post_id", id: t.post.id });

/** 這張卡在榜才有留言區；不在榜一律 404（跟卡片頁一致，不透露卡存不存在）。 */
export async function commentCard(db: D1Database, cardId: string): Promise<CommentCard> {
  const row = await db
    .prepare("SELECT id, provider, author_num_id, rating, status, public_blocked FROM cards WHERE id = ?")
    .bind(cardId)
    .first<{ id: string; provider: string; author_num_id: number; rating: string | null; status: string; public_blocked:number }>();
  if (!row || (row.status !== "approved" || row.public_blocked)) throw new HttpError(404, "card not found");
  return { id: row.id, provider: row.provider as ProviderId, authorNumId: row.author_num_id, adult: row.rating === "R" };
}

/** 這張卡的作者是哪個成員（連結過帳號的算擁有者那一個）；作者從沒登入過本站就是 null。 */
export async function cardAuthorMemberId(db: D1Database, card: CommentCard): Promise<string | null> {
  const ext = String(card.authorNumId);
  const row = await db
    .prepare(
      `SELECT COALESCE(
         (SELECT owner_member_id FROM member_connections WHERE provider = ?1 AND external_id = ?2),
         (SELECT member_id FROM member_identities WHERE provider = ?1 AND external_id = ?2)
       ) AS member_id`,
    )
    .bind(card.provider, ext)
    .first<{ member_id: string | null }>();
  return row?.member_id ?? null;
}

interface Row {
  id: string; card_id: string; member_id: string; parent_id: string | null; root_id: string | null;
  content: string; reply_to_name: string; like_count: number; reply_count: number; created_at: number; status: string;
  handle: string; display_name: string | null; avatar_url: string; liked: number; score: number | null; official?: number;
}

export interface Viewer {
  memberId: string | null;
  /** 站方審核人：能刪任何留言（社群站自己的版務）。 */
  moderator: boolean;
}

/** 回應形狀沿用前端既有的欄位名（留言面板不用改版面）；留言者用本站的公開 ID，不帶任何供應商身分。 */
function view(r: Row, viewer: Viewer, authorMemberId: string | null, post: boolean) {
  const mine = !!viewer.memberId && viewer.memberId === r.member_id;
  const removed = r.status === "removed" || r.status === "deleted";
  // 被移除的佔位只說「這裡有過一則留言」，不留是誰寫的、評了幾星、多少讚。
  return {
    commentId: r.id,
    status: (r.status === "deleted" ? "removed" : r.status) as "visible" | "held" | "removed",
    removed,
    content: removed ? "" : r.content,
    parentId: r.parent_id ?? "",
    rootId: r.root_id ?? "",
    replyToNickName: r.reply_to_name,
    likeCount: removed ? 0 : r.like_count,
    replyCount: r.reply_count,
    createTime: new Date(r.created_at).toISOString(),
    accountNickName: removed ? "" : r.display_name?.trim() || r.handle,
    accountAvatar: removed ? "" : r.avatar_url,
    handle: removed ? "" : r.handle,
    isLiked: !removed && r.liked === 1,
    isOwner: mine,
    isCreator: !removed && !!authorMemberId && authorMemberId === r.member_id,
    /** 留言者給這張卡的星數（card_scores）；沒評過是 null */
    score: removed ? null : r.score ?? null,
    canDelete: !removed && (mine || (!post && (viewer.moderator || (!!viewer.memberId && viewer.memberId === authorMemberId)))),
    /** 文章留言：留言者有寫作權限（官方） */
    ...(post && { official: !removed && r.official === 1 }),
  };
}
export type CommentView = ReturnType<typeof view> & { replies?: ReturnType<typeof view>[] };

const selectFor = (t: CommentTarget) => `SELECT c.id, c.card_id, c.member_id, c.parent_id, c.root_id, c.content, c.reply_to_name, c.like_count, c.reply_count, c.created_at, c.status,
  m.handle, m.display_name, m.avatar_url,
  EXISTS (SELECT 1 FROM comment_likes l WHERE l.comment_id = c.id AND l.member_id = ?1) AS liked,
  ${t.kind === "post" ? `NULL AS score, ${writerSql("c.member_id")} AS official` : "(SELECT s.score FROM card_scores s WHERE s.card_id = c.card_id AND s.member_id = c.member_id) AS score"}
  FROM comments c JOIN members m ON m.id = c.member_id`;

/** 看得到的留言：公開的，加上本人自己被攔下的（?1 是看的人）；頂層被移除但還有回覆時留佔位。 */
const SHOWN = "(c.deleted_at IS NULL AND (c.status = 'visible' OR (c.status = 'held' AND c.member_id = ?1)))";
const TOP_SHOWN = "((c.deleted_at IS NULL AND (c.status = 'visible' OR (c.status = 'held' AND c.member_id = ?1))) OR (c.status = 'removed' AND c.reply_count > 0))";

export async function listTop(
  db: D1Database, target: CommentTarget, viewer: Viewer, page: number, sort: CommentSort = "new",
): Promise<{ total: number; comments: CommentView[]; isRoleCreator: boolean; pinnedCommentId?: string | null; mutedUntil?: number | null }> {
  const author = target.kind === "card" ? await cardAuthorMemberId(db, target.card) : null;
  const { col, id } = targetOf(target);
  const SELECT = selectFor(target);
  const post = target.kind === "post";
  const me = viewer.memberId ?? "";
  // 置頂留言（文章）：還公開才算；第一頁最上面放一次，列表本身排除它，所以翻頁不重複、每頁仍是 20 則。
  const pinId = post ? target.post.pinnedCommentId : null;
  const pin = pinId
    ? await db.prepare(`${SELECT} WHERE c.id = ?2 AND c.post_id = ?3 AND c.root_id IS NULL AND c.deleted_at IS NULL AND c.status = 'visible'`).bind(me, pinId, id).first<Row>()
    : null;
  const p = Math.max(1, page);
  const shift = pin ? 1 : 0;
  const [count, tops] = await db.batch<Row & { n: number }>([
    db.prepare(`SELECT COUNT(*) AS n FROM comments WHERE ${col} = ? AND root_id IS NULL AND ((deleted_at IS NULL AND status = 'visible') OR (status = 'removed' AND reply_count > 0))`).bind(id),
    db.prepare(`${SELECT} WHERE c.${col} = ?2 AND c.root_id IS NULL AND ${TOP_SHOWN} AND c.id <> ?5 ORDER BY ${ORDER[sort]} LIMIT ?3 OFFSET ?4`)
      .bind(me, id, COMMENT_PAGE_SIZE - (p === 1 ? shift : 0), Math.max(0, (p - 1) * COMMENT_PAGE_SIZE - shift), pin?.id ?? ""),
  ]);
  const rows = [...(pin && p === 1 ? [pin] : []), ...(tops!.results as Row[])];
  const comments: CommentView[] = rows.map((r) => view(r, viewer, author, post));
  // 回覆預覽：讚多的在前，同讚先到先排。一次查完這一頁所有頂層的回覆再分組，不逐則查。
  // 登入的人還要查自己被攔下的回覆（不計入 reply_count），所以登入時整頁都查；訪客只查有公開回覆的。
  const withReplies = rows.filter((r) => viewer.memberId || r.reply_count > 0).map((r) => r.id);
  if (withReplies.length) {
    const holes = withReplies.map((_, i) => `?${i + 2}`).join(",");
    const replies = await db
      .prepare(`${SELECT} WHERE c.root_id IN (${holes}) AND ${SHOWN} ORDER BY c.like_count DESC, c.created_at ASC, c.id ASC`)
      .bind(me, ...withReplies)
      .all<Row>();
    for (const c of comments) {
      const mine = replies.results.filter((r) => r.root_id === c.commentId).slice(0, REPLY_PREVIEW);
      if (mine.length) c.replies = mine.map((r) => view(r, viewer, author, post));
    }
  }
  const total = (count!.results[0] as { n: number }).n;
  const isRoleCreator = !!viewer.memberId && viewer.memberId === author;
  // 被禁言的本人：前端據此收起發表與回覆，不必等送出才被擋。只回給本人，別人看不到誰被禁言。
  const muted = viewer.memberId ? await mutedUntil(db, viewer.memberId, Date.now()) : false;
  const mutedField = muted === false ? {} : { mutedUntil: muted };
  return post ? { total, comments, isRoleCreator, pinnedCommentId: pin?.id ?? null, ...mutedField } : { total, comments, isRoleCreator, ...mutedField };
}

export async function listReplies(db: D1Database, target: CommentTarget, rootId: string, viewer: Viewer, page: number) {
  const author = target.kind === "card" ? await cardAuthorMemberId(db, target.card) : null;
  const { col, id } = targetOf(target);
  const offset = (Math.max(1, page) - 1) * COMMENT_PAGE_SIZE;
  const [count, rows] = await db.batch<Row & { n: number }>([
    db.prepare(`SELECT COUNT(*) AS n FROM comments WHERE ${col} = ? AND root_id = ? AND deleted_at IS NULL AND status = 'visible'`).bind(id, rootId),
    db.prepare(`${selectFor(target)} WHERE c.${col} = ?2 AND c.root_id = ?3 AND ${SHOWN} ORDER BY c.created_at ASC, c.id ASC LIMIT ?4 OFFSET ?5`)
      .bind(viewer.memberId ?? "", id, rootId, COMMENT_PAGE_SIZE, offset),
  ]);
  return { total: (count!.results[0] as { n: number }).n, replies: (rows!.results as Row[]).map((r) => view(r, viewer, author, target.kind === "post")) };
}

export async function countTop(db: D1Database, target: CommentTarget): Promise<number> {
  const { col, id } = targetOf(target);
  const row = await db.prepare(`SELECT COUNT(*) AS n FROM comments WHERE ${col} = ? AND root_id IS NULL AND deleted_at IS NULL AND status = 'visible'`).bind(id).first<{ n: number }>();
  return row?.n ?? 0;
}

export async function postComment(
  db: D1Database,
  input: { target: CommentTarget; memberId: string; content: unknown; parentId?: unknown; rootId?: unknown; now: number },
): Promise<{ commentId: string; status: "visible" | "held" }> {
  const { target } = input;
  if (target.kind === "post" && target.post.commentsClosed) throw new HttpError(403, "blog_comments_closed");
  const { col, id: targetId } = targetOf(target);
  const content = typeof input.content === "string" ? input.content.trim() : "";
  if (!content) throw new HttpError(400, "comment_required");
  if ([...content].length > COMMENT_MAX_CHARS) throw new HttpError(400, "comment_too_long");
  const muted = await mutedUntil(db, input.memberId, input.now);
  if (muted !== false) throw new HttpError(403, "comment_muted", undefined, { until: muted });
  const recent = await db
    .prepare("SELECT COUNT(*) AS n FROM comments WHERE member_id = ? AND created_at > ?")
    .bind(input.memberId, input.now - RATE_WINDOW_MS)
    .first<{ n: number }>();
  if ((recent?.n ?? 0) >= RATE_MAX) throw new HttpError(429, "comment_rate_limited");

  let rootId: string | null = null;
  let parentId: string | null = null;
  let replyToName = "";
  const rawRoot = typeof input.rootId === "string" ? input.rootId : "";
  const rawParent = typeof input.parentId === "string" ? input.parentId : "";
  if (rawRoot || rawParent) {
    // 回覆：頂層要活著、屬於這張卡（這篇文章）；回的那一則要在同一串裡。客戶端送來的「回給誰」不採信，名字由這裡查。
    const root = await db
      .prepare(`SELECT id FROM comments WHERE id = ? AND ${col} = ? AND root_id IS NULL AND deleted_at IS NULL AND status = 'visible'`)
      .bind(rawRoot || rawParent, targetId)
      .first<{ id: string }>();
    if (!root) throw new HttpError(404, "comment not found");
    rootId = root.id;
    parentId = rawParent || root.id;
    const parent = await db
      .prepare(
        `SELECT c.id, m.handle, m.display_name FROM comments c JOIN members m ON m.id = c.member_id
         WHERE c.id = ? AND c.deleted_at IS NULL AND c.status = 'visible' AND (c.id = ? OR c.root_id = ?)`,
      )
      .bind(parentId, rootId, rootId)
      .first<{ id: string; handle: string; display_name: string | null }>();
    if (!parent) throw new HttpError(404, "comment not found");
    replyToName = parent.display_name?.trim() || parent.handle;
  }

  const id = crypto.randomUUID();
  const reason = await holdReason(db, { memberId: input.memberId, content, now: input.now }, await readSettings(db));
  const status = reason ? "held" : "visible";
  const postId = target.kind === "post" ? target.post.id : null;
  // 文章在讀取之後才關閉留言：條件式 INSERT 寫不進去，後面的寫入用 changes() 串在它後面一起不動。
  const writes = [
    db.prepare(
      `INSERT INTO comments (id, card_id, post_id, member_id, parent_id, root_id, content, reply_to_name, created_at, status, hold_reason)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11 WHERE ?3 IS NULL OR EXISTS (SELECT 1 FROM blog_posts WHERE id = ?3 AND comments_closed = 0)`,
    ).bind(id, target.kind === "card" ? target.card.id : 0, postId, input.memberId, parentId, rootId, content, replyToName, input.now, status, reason),
  ];
  if (rootId && !reason) writes.push(db.prepare("UPDATE comments SET reply_count = reply_count + 1 WHERE id = ? AND changes() > 0").bind(rootId));
  if (reason) writes.push(auditStmtIfChanged(db, { subjectKind: "comment", subjectId: id, actorMemberId: null, actorKind: "system", action: "hold", reason, after: { status: "held", holdReason: reason }, operationId: `hold:${id}`, now: input.now }));
  const results = await db.batch(writes);
  if (!results[0].meta.changes) throw new HttpError(403, "blog_comments_closed");
  if (reason) await bumpOp(db, "comment_moderation", "hold", "success");
  return { commentId: id, status };
}

export async function deleteComment(db: D1Database, commentId: string, viewer: Viewer, now: number): Promise<void> {
  const row = await db
    .prepare(
      `SELECT c.id, c.member_id, c.root_id, c.status, c.post_id, k.id AS card_id, k.provider, k.author_num_id
       FROM comments c LEFT JOIN cards k ON k.id = c.card_id WHERE c.id = ? AND c.deleted_at IS NULL AND (k.id IS NOT NULL OR c.post_id IS NOT NULL)`,
    )
    .bind(commentId)
    .first<{ id: string; member_id: string; root_id: string | null; status: string; post_id: string | null; card_id: string; provider: string; author_num_id: number }>();
  if (!row) throw new HttpError(404, "comment not found");
  const isOwner = viewer.memberId === row.member_id;
  // 文章留言只有本人能刪；職員要拿掉別人的留言走審核移除（有理由、有通知）。
  if (row.post_id && !isOwner) throw new HttpError(403, "not allowed to delete this comment");
  let isAuthor = false;
  if (!isOwner && viewer.memberId) {
    const author = await cardAuthorMemberId(db, { id: row.card_id, provider: row.provider as ProviderId, authorNumId: row.author_num_id, adult: false });
    isAuthor = author === viewer.memberId;
  }
  if (!viewer.moderator && !isOwner && !isAuthor) throw new HttpError(403, "not allowed to delete this comment");
  // 刪掉的留言（刪頂層連同回覆）上未結的檢舉一起結案，不留在佇列與統計裡。
  // 之後的寫入用 changes() 串在刪除那條後面（順序不能換）：並發時輸的那一方沒刪到列，稽核與回覆數都不動。
  const writes = [
    db.prepare("UPDATE comment_reports SET resolved_at = ?1, resolution = 'deleted', resolved_by = ?2 WHERE target_kind = ?4 AND resolved_at IS NULL AND comment_id IN (SELECT id FROM comments WHERE id = ?3 OR root_id = ?3)").bind(now, viewer.memberId, row.id, row.post_id ? "post" : "card"),
    db.prepare("UPDATE comments SET deleted_at = ?1, status = 'deleted' WHERE (id = ?2 OR root_id = ?2) AND deleted_at IS NULL").bind(now, row.id),
  ];
  if (!isOwner) {
    writes.push(auditStmtIfChanged(db, { subjectKind: "comment", subjectId: row.id, actorMemberId: viewer.memberId, actorKind: "human", action: viewer.moderator ? "delete_by_moderator" : "delete_by_author", before: { status: row.status }, after: { status: "deleted" }, operationId: `delete:${row.id}`, now }));
  }
  if (row.root_id && row.status === "visible") writes.push(db.prepare("UPDATE comments SET reply_count = MAX(0, reply_count - 1) WHERE id = ? AND changes() > 0").bind(row.root_id));
  const results = await db.batch(writes);
  // 本人重複刪除當成已完成；別人的並發刪除回衝突（跟審核處理一致）。
  if (!results[1].meta.changes && !isOwner) throw new HttpError(409, "comment already deleted");
}

/** 讚／收回讚。重複按不重複算：計數只在那一票真的新增或真的刪掉時才動。 */
export async function setLike(db: D1Database, commentId: string, memberId: string, like: boolean, now: number): Promise<void> {
  const exists = await db.prepare("SELECT 1 AS ok FROM comments WHERE id = ? AND deleted_at IS NULL AND status = 'visible'").bind(commentId).first<{ ok: number }>();
  if (!exists) throw new HttpError(404, "comment not found");
  if (like) {
    const res = await db.prepare("INSERT OR IGNORE INTO comment_likes (comment_id, member_id, created_at) VALUES (?, ?, ?)").bind(commentId, memberId, now).run();
    if (res.meta.changes) await db.prepare("UPDATE comments SET like_count = like_count + 1 WHERE id = ?").bind(commentId).run();
  } else {
    const res = await db.prepare("DELETE FROM comment_likes WHERE comment_id = ? AND member_id = ?").bind(commentId, memberId).run();
    if (res.meta.changes) await db.prepare("UPDATE comments SET like_count = MAX(0, like_count - 1) WHERE id = ?").bind(commentId).run();
  }
}
