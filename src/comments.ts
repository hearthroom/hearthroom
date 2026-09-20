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
 *   - 讚：一人一則一票，重複按不重複算。
 *   - 只有在榜（approved）的卡能讀寫留言。
 */
import type { ProviderId } from "./providers";
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
  nsfw: boolean;
}

/** 這張卡在榜才有留言區；不在榜一律 404（跟卡片頁一致，不透露卡存不存在）。 */
export async function commentCard(db: D1Database, cardId: string): Promise<CommentCard> {
  const row = await db
    .prepare("SELECT id, provider, author_num_id, nsfw, status, public_blocked FROM cards WHERE id = ?")
    .bind(cardId)
    .first<{ id: string; provider: string; author_num_id: number; nsfw: number; status: string; public_blocked:number }>();
  if (!row || (row.status !== "approved" || row.public_blocked)) throw new HttpError(404, "card not found");
  return { id: row.id, provider: row.provider as ProviderId, authorNumId: row.author_num_id, nsfw: row.nsfw === 1 };
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
  content: string; reply_to_name: string; like_count: number; reply_count: number; created_at: number;
  handle: string; display_name: string | null; avatar_url: string; liked: number;
}

export interface Viewer {
  memberId: string | null;
  /** 站方審核人：能刪任何留言（社群站自己的版務）。 */
  moderator: boolean;
}

/** 回應形狀沿用前端既有的欄位名（留言面板不用改版面）；留言者用本站的公開 ID，不帶任何供應商身分。 */
function view(r: Row, viewer: Viewer, authorMemberId: string | null) {
  const mine = !!viewer.memberId && viewer.memberId === r.member_id;
  return {
    commentId: r.id,
    content: r.content,
    parentId: r.parent_id ?? "",
    rootId: r.root_id ?? "",
    replyToNickName: r.reply_to_name,
    likeCount: r.like_count,
    replyCount: r.reply_count,
    createTime: new Date(r.created_at).toISOString(),
    accountNickName: r.display_name?.trim() || r.handle,
    accountAvatar: r.avatar_url,
    handle: r.handle,
    isLiked: r.liked === 1,
    isOwner: mine,
    isCreator: !!authorMemberId && authorMemberId === r.member_id,
    canDelete: mine || viewer.moderator || (!!viewer.memberId && viewer.memberId === authorMemberId),
  };
}
export type CommentView = ReturnType<typeof view> & { replies?: ReturnType<typeof view>[] };

const SELECT = `SELECT c.id, c.card_id, c.member_id, c.parent_id, c.root_id, c.content, c.reply_to_name, c.like_count, c.reply_count, c.created_at,
  m.handle, m.display_name, m.avatar_url,
  EXISTS (SELECT 1 FROM comment_likes l WHERE l.comment_id = c.id AND l.member_id = ?1) AS liked
  FROM comments c JOIN members m ON m.id = c.member_id`;

export async function listTop(db: D1Database, card: CommentCard, viewer: Viewer, page: number): Promise<{ total: number; comments: CommentView[]; isRoleCreator: boolean }> {
  const author = await cardAuthorMemberId(db, card);
  const offset = (Math.max(1, page) - 1) * COMMENT_PAGE_SIZE;
  const me = viewer.memberId ?? "";
  const [count, tops] = await db.batch<Row & { n: number }>([
    db.prepare("SELECT COUNT(*) AS n FROM comments WHERE card_id = ? AND root_id IS NULL AND deleted_at IS NULL").bind(card.id),
    db.prepare(`${SELECT} WHERE c.card_id = ?2 AND c.root_id IS NULL AND c.deleted_at IS NULL ORDER BY c.created_at DESC, c.id DESC LIMIT ?3 OFFSET ?4`)
      .bind(me, card.id, COMMENT_PAGE_SIZE, offset),
  ]);
  const rows = tops!.results as Row[];
  const comments: CommentView[] = rows.map((r) => view(r, viewer, author));
  // 回覆預覽：讚多的在前，同讚先到先排。一次查完這一頁所有頂層的回覆再分組，不逐則查。
  const withReplies = rows.filter((r) => r.reply_count > 0).map((r) => r.id);
  if (withReplies.length) {
    const holes = withReplies.map((_, i) => `?${i + 2}`).join(",");
    const replies = await db
      .prepare(`${SELECT} WHERE c.root_id IN (${holes}) AND c.deleted_at IS NULL ORDER BY c.like_count DESC, c.created_at ASC, c.id ASC`)
      .bind(me, ...withReplies)
      .all<Row>();
    for (const c of comments) {
      const mine = replies.results.filter((r) => r.root_id === c.commentId).slice(0, REPLY_PREVIEW);
      if (mine.length) c.replies = mine.map((r) => view(r, viewer, author));
    }
  }
  return { total: (count!.results[0] as { n: number }).n, comments, isRoleCreator: !!viewer.memberId && viewer.memberId === author };
}

export async function listReplies(db: D1Database, card: CommentCard, rootId: string, viewer: Viewer, page: number) {
  const author = await cardAuthorMemberId(db, card);
  const offset = (Math.max(1, page) - 1) * COMMENT_PAGE_SIZE;
  const [count, rows] = await db.batch<Row & { n: number }>([
    db.prepare("SELECT COUNT(*) AS n FROM comments WHERE card_id = ? AND root_id = ? AND deleted_at IS NULL").bind(card.id, rootId),
    db.prepare(`${SELECT} WHERE c.card_id = ?2 AND c.root_id = ?3 AND c.deleted_at IS NULL ORDER BY c.created_at ASC, c.id ASC LIMIT ?4 OFFSET ?5`)
      .bind(viewer.memberId ?? "", card.id, rootId, COMMENT_PAGE_SIZE, offset),
  ]);
  return { total: (count!.results[0] as { n: number }).n, replies: (rows!.results as Row[]).map((r) => view(r, viewer, author)) };
}

export async function countTop(db: D1Database, cardId: string): Promise<number> {
  const row = await db.prepare("SELECT COUNT(*) AS n FROM comments WHERE card_id = ? AND root_id IS NULL AND deleted_at IS NULL").bind(cardId).first<{ n: number }>();
  return row?.n ?? 0;
}

export async function postComment(
  db: D1Database,
  input: { card: CommentCard; memberId: string; content: unknown; parentId?: unknown; rootId?: unknown; now: number },
): Promise<{ commentId: string }> {
  const content = typeof input.content === "string" ? input.content.trim() : "";
  if (!content) throw new HttpError(400, "content is required");
  if ([...content].length > COMMENT_MAX_CHARS) throw new HttpError(400, "comment_too_long");
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
    // 回覆：頂層要活著、屬於這張卡；回的那一則要在同一串裡。客戶端送來的「回給誰」不採信，名字由這裡查。
    const root = await db
      .prepare("SELECT id FROM comments WHERE id = ? AND card_id = ? AND root_id IS NULL AND deleted_at IS NULL")
      .bind(rawRoot || rawParent, input.card.id)
      .first<{ id: string }>();
    if (!root) throw new HttpError(404, "comment not found");
    rootId = root.id;
    parentId = rawParent || root.id;
    const parent = await db
      .prepare(
        `SELECT c.id, m.handle, m.display_name FROM comments c JOIN members m ON m.id = c.member_id
         WHERE c.id = ? AND c.deleted_at IS NULL AND (c.id = ? OR c.root_id = ?)`,
      )
      .bind(parentId, rootId, rootId)
      .first<{ id: string; handle: string; display_name: string | null }>();
    if (!parent) throw new HttpError(404, "comment not found");
    replyToName = parent.display_name?.trim() || parent.handle;
  }

  const id = crypto.randomUUID();
  const writes = [
    db.prepare("INSERT INTO comments (id, card_id, member_id, parent_id, root_id, content, reply_to_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(id, input.card.id, input.memberId, parentId, rootId, content, replyToName, input.now),
  ];
  if (rootId) writes.push(db.prepare("UPDATE comments SET reply_count = reply_count + 1 WHERE id = ?").bind(rootId));
  await db.batch(writes);
  return { commentId: id };
}

export async function deleteComment(db: D1Database, commentId: string, viewer: Viewer, now: number): Promise<void> {
  const row = await db
    .prepare(
      `SELECT c.id, c.member_id, c.root_id, k.id AS card_id, k.provider, k.author_num_id
       FROM comments c JOIN cards k ON k.id = c.card_id WHERE c.id = ? AND c.deleted_at IS NULL`,
    )
    .bind(commentId)
    .first<{ id: string; member_id: string; root_id: string | null; card_id: string; provider: string; author_num_id: number }>();
  if (!row) throw new HttpError(404, "comment not found");
  let allowed = viewer.moderator || viewer.memberId === row.member_id;
  if (!allowed && viewer.memberId) {
    const author = await cardAuthorMemberId(db, { id: row.card_id, provider: row.provider as ProviderId, authorNumId: row.author_num_id, nsfw: false });
    allowed = author === viewer.memberId;
  }
  if (!allowed) throw new HttpError(403, "not allowed to delete this comment");
  const writes = [db.prepare("UPDATE comments SET deleted_at = ? WHERE (id = ?2 OR root_id = ?2) AND deleted_at IS NULL").bind(now, row.id)];
  if (row.root_id) writes.push(db.prepare("UPDATE comments SET reply_count = MAX(0, reply_count - 1) WHERE id = ?").bind(row.root_id));
  await db.batch(writes);
}

/** 讚／收回讚。重複按不重複算：計數只在那一票真的新增或真的刪掉時才動。 */
export async function setLike(db: D1Database, commentId: string, memberId: string, like: boolean, now: number): Promise<void> {
  const exists = await db.prepare("SELECT 1 AS ok FROM comments WHERE id = ? AND deleted_at IS NULL").bind(commentId).first<{ ok: number }>();
  if (!exists) throw new HttpError(404, "comment not found");
  if (like) {
    const res = await db.prepare("INSERT OR IGNORE INTO comment_likes (comment_id, member_id, created_at) VALUES (?, ?, ?)").bind(commentId, memberId, now).run();
    if (res.meta.changes) await db.prepare("UPDATE comments SET like_count = like_count + 1 WHERE id = ?").bind(commentId).run();
  } else {
    const res = await db.prepare("DELETE FROM comment_likes WHERE comment_id = ? AND member_id = ?").bind(commentId, memberId).run();
    if (res.meta.changes) await db.prepare("UPDATE comments SET like_count = MAX(0, like_count - 1) WHERE id = ?").bind(commentId).run();
  }
}
