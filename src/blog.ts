import { auditStmt, auditStmtIfChanged, type ActorKind } from "./audit";
import { bumpOp } from "./ops-metrics";
import { HttpError, type Env } from "./types";

/**
 * 官方部落格（開業活動設計 §6）。寫的人＝manager／owner 審核人（不含 AI 帳號）。
 * 公開判定只在 isPublic 一處：已發布且到了發布時間。定時發布靠讀取時判斷，不開排程。
 * 權限在路由層檢查（canWritePost）；這裡的寫入函式假設呼叫端已經確認過。
 */
export const LOCALES = ["zh-Hant", "zh-Hans", "en", "ja", "ko"] as const;
export type Locale = (typeof LOCALES)[number];
/** 欄目名稱／說明的多語文字，鍵是文章語言（types.ts 的 Localized 是卡片介面用的 zh/en/ja/ko，不同一套）。 */
export type Localized = Partial<Record<Locale, string>>;
export type Actor = { memberId: string; kind: ActorKind };
export type PostStatus = "draft" | "pending_review" | "published" | "unpublished";

export type Column = { id: string; slug: string; name: Localized; description: Localized; sort: number; enabled: boolean };
export type ColumnInput = Omit<Column, "id"> & { id?: string };

export type Post = {
  id: string; columnId: string; columnSlug: string; slug: string; locale: Locale; title: string; excerpt: string;
  coverUrl: string | null; bodyMd: string; shareTitle: string | null; shareDescription: string | null; shareCoverUrl: string | null;
  campaignId: string | null; status: PostStatus; publishAt: number | null; firstPublishedAt: number | null; pinned: boolean;
  commentsClosed: boolean; pinnedCommentId: string | null; authorMemberId: string; version: number; createdAt: number; updatedAt: number;
  /** 對外的「修改時間」：最新一筆內容修訂的時間（置頂、留言開關不算）；沒有修訂退回首次發布。updatedAt 只給管理端。 */
  contentUpdatedAt: number;
  /** 編輯器回存時要帶回的原始 key（coverUrl／shareCoverUrl 是由它算出來的公開網址）。 */
  coverKey: string | null; shareCoverKey: string | null;
};
export type PostCard = Pick<Post, "id" | "columnSlug" | "slug" | "title" | "excerpt" | "coverUrl" | "locale" | "firstPublishedAt" | "pinned" | "campaignId"> & { readMinutes: number; commentCount: number };
export type PostInput = {
  columnId: string; slug: string; locale: Locale; title: string; excerpt: string; bodyMd: string;
  coverKey?: string | null; shareTitle?: string | null; shareDescription?: string | null; shareCoverKey?: string | null; campaignId?: string | null;
};
export type StateChange = { status?: "published" | "unpublished"; publishAt?: number | null; pinned?: boolean; commentsClosed?: boolean; pinnedCommentId?: string | null };

export const PAGE_SIZE = 12;
const PINNED_MAX = 3;

/**
 * 寫作權限的唯一定義：manager／owner 審核人，不含 AI 帳號（審核人身分在，代理標記也沒撤）。
 * 寫成 SQL 片段，讓留言列表一次判斷整頁留言者是不是官方；canWritePost 也走這裡。`member` 是 SQL 運算式。
 */
export const writerSql = (member: string) =>
  `EXISTS (SELECT 1 FROM reviewers wr WHERE wr.member_id = ${member} AND wr.revoked_at IS NULL AND wr.role IN ('manager','owner')
    AND NOT EXISTS (SELECT 1 FROM review_agents wa WHERE wa.member_id = wr.member_id AND wa.revoked_at IS NULL))`;

export async function canWritePost(db: D1Database, memberId: string): Promise<boolean> {
  return !!(await db.prepare(`SELECT ${writerSql("?1")} AS ok`).bind(memberId).first<{ ok: number }>())?.ok;
}

export const isPublic = (p: { status: string; publishAt: number | null }, now: number) =>
  p.status === "published" && p.publishAt !== null && p.publishAt <= now;

/** 中文一分鐘約 400 字、英文約 200 詞；取兩者中較大的估計，至少 1 分鐘。 */
export function readMinutes(md: string): number {
  const cjk = (md.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu) ?? []).length;
  const words = md.replace(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu, " ").split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(Math.max(cjk / 400, words / 200)));
}

// ---- 列與轉換 ----------------------------------------------------------------

type PostRow = {
  id: string; column_id: string; column_slug: string; slug: string; author_member_id: string; locale: Locale; title: string; excerpt: string;
  cover_key: string | null; body_md: string; share_title: string | null; share_description: string | null; share_cover_key: string | null;
  campaign_id: string | null; status: PostStatus; publish_at: number | null; first_published_at: number | null; pinned: number;
  comments_closed: number; pinned_comment_id: string | null; version: number; created_at: number; updated_at: number;
  content_updated_at: number | null;
};
type CardRow = Pick<PostRow, "id" | "column_slug" | "slug" | "title" | "excerpt" | "cover_key" | "locale" | "first_published_at" | "pinned" | "campaign_id" | "body_md"> & { comment_count: number };
type ColumnRow = { id: string; slug: string; name: string; description: string; sort: number; enabled: number };

const POST_SELECT = "SELECT p.*, col.slug AS column_slug, (SELECT MAX(r.created_at) FROM blog_post_revisions r WHERE r.post_id = p.id) AS content_updated_at FROM blog_posts p JOIN blog_columns col ON col.id = p.column_id";
// ponytail: 卡片要算閱讀時長，所以連內文一起讀（一頁 12 篇）；嫌重時改成儲存時算好存一欄。
const CARD_SELECT = `SELECT p.id, col.slug AS column_slug, p.slug, p.title, p.excerpt, p.cover_key, p.locale, p.first_published_at, p.pinned, p.campaign_id, p.body_md,
  (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id AND c.root_id IS NULL AND c.deleted_at IS NULL AND c.status = 'visible') AS comment_count
  FROM blog_posts p JOIN blog_columns col ON col.id = p.column_id`;
/** 已公開（?1 是現在）。欄目啟不啟用另外判斷：列表要看，單篇與前後篇不看。 */
const LIVE = "p.status = 'published' AND p.publish_at IS NOT NULL AND p.publish_at <= ?1";

/** 圖片 key 是 AVATARS bucket 的 blog/<uuid>.webp，公開網址由圖片路由服務。 */
export const IMAGE_KEY = /^blog\/[A-Za-z0-9-]{1,64}\.webp$/;
export const imageUrl = (key: string | null) => (key ? `/v1/blog/images/${key.slice("blog/".length)}` : null);

const toPost = (r: PostRow): Post => ({
  id: r.id, columnId: r.column_id, columnSlug: r.column_slug, slug: r.slug, locale: r.locale, title: r.title, excerpt: r.excerpt,
  coverUrl: imageUrl(r.cover_key), bodyMd: r.body_md, shareTitle: r.share_title, shareDescription: r.share_description,
  shareCoverUrl: imageUrl(r.share_cover_key), campaignId: r.campaign_id, status: r.status, publishAt: r.publish_at,
  firstPublishedAt: r.first_published_at, pinned: !!r.pinned, commentsClosed: !!r.comments_closed, pinnedCommentId: r.pinned_comment_id,
  authorMemberId: r.author_member_id, version: r.version, createdAt: r.created_at, updatedAt: r.updated_at,
  // 草稿先存、之後才發布時，最後一版早於首發；對外的修改時間不早於首發時間。
  contentUpdatedAt: Math.max(r.content_updated_at ?? 0, r.first_published_at ?? r.created_at),
  coverKey: r.cover_key, shareCoverKey: r.share_cover_key,
});
const toCard = (r: CardRow): PostCard => ({
  id: r.id, columnSlug: r.column_slug, slug: r.slug, title: r.title, excerpt: r.excerpt, coverUrl: imageUrl(r.cover_key), locale: r.locale,
  firstPublishedAt: r.first_published_at, pinned: !!r.pinned, campaignId: r.campaign_id, readMinutes: readMinutes(r.body_md), commentCount: r.comment_count,
});
const toColumn = (r: ColumnRow): Column => ({ id: r.id, slug: r.slug, name: JSON.parse(r.name), description: JSON.parse(r.description), sort: r.sort, enabled: !!r.enabled });

async function postRow(db: D1Database, id: string): Promise<PostRow | null> {
  return db.prepare(`${POST_SELECT} WHERE p.id = ?`).bind(id).first<PostRow>();
}
async function mustPost(db: D1Database, id: string): Promise<Post> {
  const r = await postRow(db, id);
  if (!r) throw new HttpError(404, "blog_post_not_found");
  return toPost(r);
}

// ---- 驗證 ---------------------------------------------------------------------

const SLUG = /^[a-z0-9][a-z0-9-]*$/;
const isStr = (v: unknown, max: number, min = 0): v is string => typeof v === "string" && v.length >= min && v.length <= max;
const invalid = (field: string, code = "blog_invalid"): never => { throw new HttpError(400, code, undefined, { field }); };
const optional = <T>(v: T | undefined) => (v === undefined ? null : v);

/** 文章內容（存進文章列與修訂的部分）。欄位名就是資料表欄名。 */
type Content = {
  column_id: string; slug: string; locale: Locale; title: string; excerpt: string; body_md: string;
  cover_key: string | null; share_title: string | null; share_description: string | null; share_cover_key: string | null; campaign_id: string | null;
};
const CONTENT_COLUMNS = ["column_id", "slug", "locale", "title", "excerpt", "body_md", "cover_key", "share_title", "share_description", "share_cover_key", "campaign_id"] as const;

function cleanPost(input: PostInput): Content {
  const bad = invalid;
  if (!isStr(input.columnId, 64, 1)) bad("columnId");
  if (!isStr(input.slug, 80, 1) || !SLUG.test(input.slug)) bad("slug");
  if (!(LOCALES as readonly unknown[]).includes(input.locale)) bad("locale");
  if (!isStr(input.title, 120, 1) || !input.title.trim()) bad("title");
  if (!isStr(input.excerpt, 300)) bad("excerpt");
  if (!isStr(input.bodyMd, 60000)) bad("bodyMd");
  const nullable = (v: unknown, field: string, ok: (s: string) => boolean): string | null => {
    const x = optional(v);
    if (x !== null && (typeof x !== "string" || !ok(x))) bad(field);
    return x as string | null;
  };
  return {
    column_id: input.columnId, slug: input.slug, locale: input.locale, title: input.title, excerpt: input.excerpt, body_md: input.bodyMd,
    cover_key: nullable(input.coverKey, "coverKey", (s) => IMAGE_KEY.test(s)),
    share_title: nullable(input.shareTitle, "shareTitle", (s) => s.length <= 120),
    share_description: nullable(input.shareDescription, "shareDescription", (s) => s.length <= 300),
    share_cover_key: nullable(input.shareCoverKey, "shareCoverKey", (s) => IMAGE_KEY.test(s)),
    campaign_id: nullable(input.campaignId, "campaignId", (s) => s.length >= 1 && s.length <= 64),
  };
}

/** 多語文字的唯一驗證（活動設定也用）；不合法丟 400 code，extra.field 是欄位名。 */
export function cleanLocalized(v: unknown, field: string, max: number, required: boolean, code = "blog_invalid"): Localized {
  if (!v || typeof v !== "object" || Array.isArray(v)) invalid(field, code);
  const out: Localized = {};
  for (const [k, s] of Object.entries(v as Record<string, unknown>)) {
    if (!(LOCALES as readonly string[]).includes(k) || !isStr(s, max)) invalid(field, code);
    if ((s as string).trim()) out[k as Locale] = s as string;
  }
  if (required && !out["zh-Hant"]) invalid(field, code);
  return out;
}

/**
 * 同一個操作編號已經做過（連點、斷線重試）：回那一次的主體 id，呼叫端照原樣回現況、不再寫。
 * 編號被別種主體用過不是重送，回衝突。
 */
async function priorSubject(db: D1Database, actor: Actor, operationId: string, kind: "blog_post" | "blog_column"): Promise<string | null> {
  const r = await db.prepare("SELECT subject_kind, subject_id FROM audit_log WHERE actor_member_id = ? AND operation_id = ?").bind(actor.memberId, operationId).first<{ subject_kind: string; subject_id: string }>();
  if (!r) return null;
  if (r.subject_kind !== kind) throw new HttpError(409, "blog_operation_repeated");
  return r.subject_id;
}

/**
 * 執行 batch。並發的同一次重送會在唯一鍵（稽核、slug）或版本條件上輸掉：先看是不是已經做過，是就回 replay；
 * 不是才把 slug 衝突轉成 409。第一條是條件式 UPDATE 而改到 0 列時，同樣先排除重送，剩下的才是版本衝突。
 */
async function commit(db: D1Database, writes: D1PreparedStatement[], actor: Actor, operationId: string, kind: "blog_post" | "blog_column", slugTaken: string): Promise<{ replay: string } | { changes: number }> {
  try {
    const [first] = await db.batch(writes);
    const changes = first!.meta.changes;
    const prior = changes ? null : await priorSubject(db, actor, operationId, kind);
    return prior ? { replay: prior } : { changes };
  } catch (e) {
    const msg = String(e);
    if (!/UNIQUE constraint failed/.test(msg)) throw e;
    const prior = await priorSubject(db, actor, operationId, kind);
    if (prior) return { replay: prior };
    if (/blog_(posts|columns)/.test(msg)) throw new HttpError(409, slugTaken);
    throw e;
  }
}

// ---- 文章寫入 -----------------------------------------------------------------

const conflict = async (db: D1Database, id: string): Promise<never> => {
  const r = await db.prepare("SELECT version FROM blog_posts WHERE id = ?").bind(id).first<{ version: number }>();
  if (!r) throw new HttpError(404, "blog_post_not_found");
  throw new HttpError(409, "blog_version_conflict", undefined, { version: r.version });
};
const auditView = (r: { title: string; slug: string; column_id: string; version: number }) => ({ title: r.title, slug: r.slug, columnId: r.column_id, version: r.version });

/**
 * 寫入內容＋一筆修訂＋稽核，同一個 batch。更新是條件式（版本號沒變才寫），修訂與稽核用 changes() 串在後面：
 * 輸掉的那一方三條都不留。
 */
async function writeContent(db: D1Database, before: PostRow | null, c: Content, actor: Actor, operationId: string, now: number, action: "create" | "save" | "restore"): Promise<Post> {
  const id = before?.id ?? crypto.randomUUID();
  const version = (before?.version ?? 0) + 1;
  const meta = JSON.stringify({ slug: c.slug, excerpt: c.excerpt, shareTitle: c.share_title, shareDescription: c.share_description, shareCoverKey: c.share_cover_key, coverKey: c.cover_key, locale: c.locale, columnId: c.column_id });
  const values = CONTENT_COLUMNS.map((k) => c[k]);
  const audit = { subjectKind: "blog_post" as const, subjectId: id, actorMemberId: actor.memberId, actorKind: actor.kind, action, before: before ? auditView(before) : {}, after: auditView({ ...c, version }), operationId, now };
  const revision = "INSERT INTO blog_post_revisions (id, post_id, editor_member_id, title, body_md, meta_json, version, created_at)";
  const writes = before
    ? [
        db.prepare(`UPDATE blog_posts SET ${CONTENT_COLUMNS.map((k) => `${k} = ?`).join(", ")}, version = version + 1, updated_at = ? WHERE id = ? AND version = ?`).bind(...values, now, id, before.version),
        db.prepare(`${revision} SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() > 0`).bind(crypto.randomUUID(), id, actor.memberId, c.title, c.body_md, meta, version, now),
        auditStmtIfChanged(db, audit),
      ]
    : [
        db.prepare(`INSERT INTO blog_posts (id, author_member_id, created_at, updated_at, ${CONTENT_COLUMNS.join(", ")}) VALUES (?, ?, ?, ?, ${CONTENT_COLUMNS.map(() => "?").join(", ")})`).bind(id, actor.memberId, now, now, ...values),
        db.prepare(`${revision} VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(crypto.randomUUID(), id, actor.memberId, c.title, c.body_md, meta, version, now),
        auditStmt(db, audit),
      ];
  const done = await commit(db, writes, actor, operationId, "blog_post", "blog_slug_taken");
  if ("replay" in done) return mustPost(db, done.replay);
  if (!done.changes) await conflict(db, id);
  await keepImages(db, c);
  await bumpOp(db, "blog", action === "restore" ? "restore" : "save", "success");
  return mustPost(db, id);
}

export async function savePost(db: D1Database, input: PostInput & { id?: string; expectedVersion?: number }, actor: Actor, operationId: string, now: number): Promise<Post> {
  const prior = await priorSubject(db, actor, operationId, "blog_post");
  if (prior) return mustPost(db, prior);
  const c = cleanPost(input);
  if (!(await db.prepare("SELECT 1 AS ok FROM blog_columns WHERE id = ?").bind(c.column_id).first())) invalid("columnId");
  if (input.id === undefined) return writeContent(db, null, c, actor, operationId, now, "create");
  if (!Number.isInteger(input.expectedVersion)) invalid("expectedVersion");
  const before = await postRow(db, input.id);
  if (!before) throw new HttpError(404, "blog_post_not_found");
  if (before.version !== input.expectedVersion) await conflict(db, before.id);
  return writeContent(db, before, c, actor, operationId, now, "save");
}

export async function restoreRevision(db: D1Database, postId: string, revisionId: string, actor: Actor, operationId: string, now: number): Promise<Post> {
  const prior = await priorSubject(db, actor, operationId, "blog_post");
  if (prior) return mustPost(db, prior);
  const before = await postRow(db, postId);
  if (!before) throw new HttpError(404, "blog_post_not_found");
  const rev = await db.prepare("SELECT title, body_md, meta_json FROM blog_post_revisions WHERE id = ? AND post_id = ?").bind(revisionId, postId).first<{ title: string; body_md: string; meta_json: string }>();
  if (!rev) throw new HttpError(404, "blog_revision_not_found");
  const m = JSON.parse(rev.meta_json) as Record<string, unknown>;
  const pick = <T>(key: string, fallback: T): T => (key in m ? m[key] : fallback) as T;
  // 已發布（含排程）的文章網址（欄目、slug、語言前綴）不跟著還原動，其餘照還原
  const keepUrl = before.status === "published";
  const c: Content = {
    column_id: keepUrl ? before.column_id : pick("columnId", before.column_id), slug: keepUrl ? before.slug : pick("slug", before.slug), locale: keepUrl ? before.locale : pick("locale", before.locale), title: rev.title,
    excerpt: pick("excerpt", before.excerpt), body_md: rev.body_md, cover_key: pick("coverKey", before.cover_key), share_title: pick("shareTitle", before.share_title),
    share_description: pick("shareDescription", before.share_description), share_cover_key: pick("shareCoverKey", before.share_cover_key), campaign_id: before.campaign_id,
  };
  return writeContent(db, before, c, actor, operationId, now, "restore");
}

/** 每次只改一種狀態：發布（可帶時間）、撤下、置頂、留言開關、置頂留言。版本號 +1。 */
export async function setPostState(db: D1Database, id: string, change: StateChange, actor: Actor, operationId: string, now: number): Promise<Post> {
  const prior = await priorSubject(db, actor, operationId, "blog_post");
  if (prior) return mustPost(db, prior);
  const before = await postRow(db, id);
  if (!before) throw new HttpError(404, "blog_post_not_found");
  const keys = Object.keys(change).filter((k) => change[k as keyof StateChange] !== undefined);
  const bad = () => invalid(keys.join(","));
  let set: string, binds: unknown[], action: string, metric: "publish" | "unpublish" | "pin" | "comments", from: object, to: object;
  if (change.status === "published") {
    if (keys.some((k) => k !== "status" && k !== "publishAt")) bad();
    const at = change.publishAt ?? now;
    if (!Number.isSafeInteger(at) || at < 0) bad();
    [set, binds, action, metric] = ["status = 'published', publish_at = ?, first_published_at = COALESCE(first_published_at, ?)", [at, at], "publish", "publish"];
    [from, to] = [{ status: before.status, publishAt: before.publish_at }, { status: "published", publishAt: at }];
  } else if (change.status === "unpublished") {
    if (keys.length !== 1) bad();
    [set, binds, action, metric] = ["status = 'unpublished'", [], "unpublish", "unpublish"];
    [from, to] = [{ status: before.status }, { status: "unpublished" }];
  } else if (change.status !== undefined || keys.length !== 1) {
    return bad();
  } else if (keys[0] === "pinned") {
    if (typeof change.pinned !== "boolean") bad();
    [set, binds, action, metric] = ["pinned = ?", [change.pinned ? 1 : 0], change.pinned ? "pin" : "unpin", "pin"];
    [from, to] = [{ pinned: !!before.pinned }, { pinned: change.pinned }];
  } else if (keys[0] === "commentsClosed") {
    if (typeof change.commentsClosed !== "boolean") bad();
    [set, binds, action, metric] = ["comments_closed = ?", [change.commentsClosed ? 1 : 0], change.commentsClosed ? "comments_close" : "comments_open", "comments"];
    [from, to] = [{ commentsClosed: !!before.comments_closed }, { commentsClosed: change.commentsClosed }];
  } else if (keys[0] === "pinnedCommentId") {
    const cid = change.pinnedCommentId ?? null;
    if (cid !== null) {
      const ok = typeof cid === "string" && (await db.prepare("SELECT 1 AS ok FROM comments WHERE id = ? AND post_id = ? AND root_id IS NULL AND deleted_at IS NULL AND status = 'visible'").bind(cid, id).first());
      if (!ok) invalid("pinnedCommentId");
    }
    [set, binds, action, metric] = ["pinned_comment_id = ?", [cid], "pin_comment", "pin"];
    [from, to] = [{ pinnedCommentId: before.pinned_comment_id }, { pinnedCommentId: cid }];
  } else {
    return bad();
  }
  const done = await commit(db, [
    db.prepare(`UPDATE blog_posts SET ${set}, version = version + 1, updated_at = ? WHERE id = ? AND version = ?`).bind(...binds, now, id, before.version),
    auditStmtIfChanged(db, { subjectKind: "blog_post", subjectId: id, actorMemberId: actor.memberId, actorKind: actor.kind, action, before: { ...from, version: before.version }, after: { ...to, version: before.version + 1 }, operationId, now }),
  ], actor, operationId, "blog_post", "blog_slug_taken");
  if ("replay" in done) return mustPost(db, done.replay);
  if (!done.changes) await conflict(db, id);
  await bumpOp(db, "blog", metric, "success");
  return mustPost(db, id);
}

export async function listRevisions(db: D1Database, postId: string): Promise<{ id: string; editorHandle: string; title: string; createdAt: number }[]> {
  const rows = await db
    .prepare("SELECT r.id, COALESCE(m.handle, '') AS editor_handle, r.title, r.created_at FROM blog_post_revisions r LEFT JOIN members m ON m.id = r.editor_member_id WHERE r.post_id = ? ORDER BY r.created_at DESC, r.version DESC")
    .bind(postId)
    .all<{ id: string; editor_handle: string; title: string; created_at: number }>();
  return rows.results.map((r) => ({ id: r.id, editorHandle: r.editor_handle, title: r.title, createdAt: r.created_at }));
}

/** 一個修訂當時的標題與內文（編輯器的修訂側欄點開看）。 */
export async function getRevision(db: D1Database, postId: string, revisionId: string): Promise<{ id: string; editorHandle: string; title: string; bodyMd: string; createdAt: number }> {
  const r = await db
    .prepare("SELECT r.id, COALESCE(m.handle, '') AS editor_handle, r.title, r.body_md, r.created_at FROM blog_post_revisions r LEFT JOIN members m ON m.id = r.editor_member_id WHERE r.id = ? AND r.post_id = ?")
    .bind(revisionId, postId)
    .first<{ id: string; editor_handle: string; title: string; body_md: string; created_at: number }>();
  if (!r) throw new HttpError(404, "blog_revision_not_found");
  return { id: r.id, editorHandle: r.editor_handle, title: r.title, bodyMd: r.body_md, createdAt: r.created_at };
}

// ---- 欄目 ---------------------------------------------------------------------

export async function saveColumn(db: D1Database, input: ColumnInput, actor: Actor, operationId: string, now: number): Promise<Column> {
  const prior = await priorSubject(db, actor, operationId, "blog_column");
  if (prior) return mustColumn(db, prior);
  // p 留給文章短網址 /blog/p/<id>：同名欄目會被那條路由蓋掉
  if (!isStr(input.slug, 40, 1) || !SLUG.test(input.slug) || input.slug === "p") invalid("slug");
  const name = cleanLocalized(input.name, "name", 40, true);
  const description = cleanLocalized(input.description, "description", 300, false);
  if (!Number.isSafeInteger(input.sort)) invalid("sort");
  if (typeof input.enabled !== "boolean") invalid("enabled");
  const values = [input.slug, JSON.stringify(name), JSON.stringify(description), input.sort, input.enabled ? 1 : 0];
  const after = { slug: input.slug, name, description, sort: input.sort, enabled: input.enabled };
  let id: string, writes: D1PreparedStatement[];
  if (input.id === undefined) {
    id = crypto.randomUUID();
    writes = [
      db.prepare("INSERT INTO blog_columns (id, slug, name, description, sort, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(id, ...values, now, now),
      auditStmt(db, { subjectKind: "blog_column", subjectId: id, actorMemberId: actor.memberId, actorKind: actor.kind, action: "column_create", after, operationId, now }),
    ];
  } else {
    id = input.id;
    const before = await db.prepare("SELECT * FROM blog_columns WHERE id = ?").bind(id).first<ColumnRow>();
    if (!before) throw new HttpError(404, "blog_column_not_found");
    const { id: _, ...prev } = toColumn(before);
    writes = [
      db.prepare("UPDATE blog_columns SET slug = ?, name = ?, description = ?, sort = ?, enabled = ?, updated_at = ? WHERE id = ?").bind(...values, now, id),
      auditStmtIfChanged(db, { subjectKind: "blog_column", subjectId: id, actorMemberId: actor.memberId, actorKind: actor.kind, action: "column_save", before: prev, after, operationId, now }),
    ];
  }
  const done = await commit(db, writes, actor, operationId, "blog_column", "blog_column_slug_taken");
  if ("replay" in done) return mustColumn(db, done.replay);
  await bumpOp(db, "blog", "column", "success");
  return { id, ...after };
}

async function mustColumn(db: D1Database, id: string): Promise<Column> {
  const r = await db.prepare("SELECT * FROM blog_columns WHERE id = ?").bind(id).first<ColumnRow>();
  if (!r) throw new HttpError(404, "blog_column_not_found");
  return toColumn(r);
}

export async function listColumns(db: D1Database, opts: { includeDisabled: boolean }): Promise<Column[]> {
  const rows = await db.prepare(`SELECT * FROM blog_columns ${opts.includeDisabled ? "" : "WHERE enabled = 1"} ORDER BY sort, created_at, id`).all<ColumnRow>();
  return rows.results.map(toColumn);
}

// ---- 公開讀取 -----------------------------------------------------------------

/**
 * 公開列表：停用欄目的文章不列（選停用欄目回空列表）。置頂的最多 3 篇另列在 pinned，
 * items 是其餘公開文章依發布時間新到舊分頁；total 是 items 這一群的總數。
 */
export async function publicPosts(db: D1Database, opts: { columnSlug?: string; page: number; now: number }): Promise<{ total: number; pinned: PostCard[]; items: PostCard[] }> {
  const where = `${LIVE} AND col.enabled = 1 AND (?2 IS NULL OR col.slug = ?2)`;
  const column = opts.columnSlug ?? null;
  const pinned = (await db.prepare(`${CARD_SELECT} WHERE ${where} AND p.pinned = 1 ORDER BY p.publish_at DESC, p.id DESC LIMIT ${PINNED_MAX}`).bind(opts.now, column).all<CardRow>()).results;
  const skip = JSON.stringify(pinned.map((r) => r.id));
  const page = Math.max(1, Math.floor(opts.page) || 1);
  const rest = `${where} AND p.id NOT IN (SELECT value FROM json_each(?3))`;
  const [count, items] = await db.batch<CardRow & { n: number }>([
    db.prepare(`SELECT COUNT(*) AS n FROM blog_posts p JOIN blog_columns col ON col.id = p.column_id WHERE ${rest}`).bind(opts.now, column, skip),
    db.prepare(`${CARD_SELECT} WHERE ${rest} ORDER BY p.publish_at DESC, p.id DESC LIMIT ?4 OFFSET ?5`).bind(opts.now, column, skip, PAGE_SIZE, (page - 1) * PAGE_SIZE),
  ]);
  return { total: (count!.results[0] as { n: number }).n, pinned: pinned.map(toCard), items: (items!.results as CardRow[]).map(toCard) };
}

/** 單篇：欄目停用也能開（舊連結不失效），只看公開判定。 */
export async function publicPost(db: D1Database, columnSlug: string, slug: string, now: number): Promise<Post | null> {
  const post = await postBySlug(db, columnSlug, slug);
  return post && isPublic(post, now) ? post : null;
}

/** 最新的公開文章（Atom 用）：停用欄目的不列，與公開列表一致。 */
export async function recentPosts(db: D1Database, now: number, limit: number): Promise<Post[]> {
  const rows = await db.prepare(`${POST_SELECT} WHERE ${LIVE} AND col.enabled = 1 ORDER BY p.publish_at DESC, p.id DESC LIMIT ?2`).bind(now, limit).all<PostRow>();
  return rows.results.map(toPost);
}

/** 不看公開與否（預覽用）。 */
export async function postBySlug(db: D1Database, columnSlug: string, slug: string): Promise<Post | null> {
  const r = await db.prepare(`${POST_SELECT} WHERE col.slug = ? AND p.slug = ?`).bind(columnSlug, slug).first<PostRow>();
  return r ? toPost(r) : null;
}

/** 公開的那一篇（依 id）；未公開或不存在是 null。 */
export async function livePost(db: D1Database, id: string, now: number): Promise<Post | null> {
  const r = await postRow(db, id);
  return r && isPublic({ status: r.status, publishAt: r.publish_at }, now) ? toPost(r) : null;
}

/** 短網址：公開文章的欄目與 slug。 */
export async function publicPostById(db: D1Database, id: string, now: number): Promise<{ column: string; slug: string } | null> {
  const r = await postRow(db, id);
  return r && isPublic({ status: r.status, publishAt: r.publish_at }, now) ? { column: r.column_slug, slug: r.slug } : null;
}

/** 同欄目已公開的前一篇（較舊）與後一篇（較新）。 */
export async function adjacentPosts(db: D1Database, post: Post, now: number): Promise<{ prev: PostCard | null; next: PostCard | null }> {
  if (post.publishAt === null) return { prev: null, next: null };
  const one = (cmp: "<" | ">", dir: "DESC" | "ASC") =>
    db.prepare(`${CARD_SELECT} WHERE ${LIVE} AND p.column_id = ?2 AND (p.publish_at ${cmp} ?3 OR (p.publish_at = ?3 AND p.id ${cmp} ?4)) ORDER BY p.publish_at ${dir}, p.id ${dir} LIMIT 1`).bind(now, post.columnId, post.publishAt, post.id);
  const [prev, next] = await db.batch<CardRow>([one("<", "DESC"), one(">", "ASC")]);
  const card = (r: D1Result<CardRow> | undefined) => (r?.results[0] ? toCard(r.results[0]) : null);
  return { prev: card(prev), next: card(next) };
}

/** 同欄目最新的幾篇（排除自己）。 */
export async function relatedPosts(db: D1Database, post: Post, now: number, limit = 3): Promise<PostCard[]> {
  const rows = await db.prepare(`${CARD_SELECT} WHERE ${LIVE} AND p.column_id = ?2 AND p.id <> ?3 ORDER BY p.publish_at DESC, p.id DESC LIMIT ?4`).bind(now, post.columnId, post.id, limit).all<CardRow>();
  return rows.results.map(toCard);
}

// ---- 對外形狀 -----------------------------------------------------------------

/** 公開回應不帶成員 id 與原始 key：作者一律是官方。 */
export function publicView({ authorMemberId: _a, coverKey: _c, shareCoverKey: _s, ...p }: Post) {
  return { ...p, official: true as const, readMinutes: readMinutes(p.bodyMd) };
}

/** 管理回應：作者換成公開 ID（handle），不給成員 id。 */
export async function adminView(db: D1Database, { authorMemberId, ...p }: Post) {
  const m = await db.prepare("SELECT handle FROM members WHERE id = ?").bind(authorMemberId).first<{ handle: string }>();
  return { ...p, authorHandle: m?.handle ?? "" };
}

export async function adminPost(db: D1Database, id: string) {
  return adminView(db, await mustPost(db, id));
}

const STATUSES: readonly string[] = ["draft", "pending_review", "published", "unpublished"];
type AdminRow = Pick<PostRow, "id" | "column_id" | "column_slug" | "slug" | "locale" | "title" | "status" | "publish_at" | "first_published_at" | "pinned" | "comments_closed" | "version" | "updated_at"> & { author_handle: string; editor_handle: string };

/** 管理列表：所有狀態，最近改過的在前。column 可以是欄目 id 或 slug。editorHandle 是最後一次存內容的人。 */
export async function adminPosts(db: D1Database, opts: { status?: string; column?: string; page: number }) {
  const status = opts.status || null;
  if (status !== null && !STATUSES.includes(status)) invalid("status");
  const where = "(?1 IS NULL OR p.status = ?1) AND (?2 IS NULL OR col.id = ?2 OR col.slug = ?2)";
  const from = "FROM blog_posts p JOIN blog_columns col ON col.id = p.column_id";
  const page = Math.max(1, Math.floor(opts.page) || 1);
  const binds = [status, opts.column || null];
  const [count, rows] = await db.batch<AdminRow & { n: number }>([
    db.prepare(`SELECT COUNT(*) AS n ${from} WHERE ${where}`).bind(...binds),
    db.prepare(`SELECT p.id, p.column_id, col.slug AS column_slug, p.slug, p.locale, p.title, p.status, p.publish_at, p.first_published_at, p.pinned, p.comments_closed, p.version, p.updated_at,
      COALESCE((SELECT handle FROM members WHERE id = p.author_member_id), '') AS author_handle,
      COALESCE((SELECT m.handle FROM blog_post_revisions r JOIN members m ON m.id = r.editor_member_id WHERE r.post_id = p.id ORDER BY r.version DESC LIMIT 1), '') AS editor_handle ${from} WHERE ${where} ORDER BY p.updated_at DESC, p.id DESC LIMIT ?3 OFFSET ?4`).bind(...binds, PAGE_SIZE, (page - 1) * PAGE_SIZE),
  ]);
  return {
    total: (count!.results[0] as { n: number }).n,
    items: (rows!.results as AdminRow[]).map((r) => ({
      id: r.id, columnId: r.column_id, columnSlug: r.column_slug, slug: r.slug, locale: r.locale, title: r.title, status: r.status, publishAt: r.publish_at,
      firstPublishedAt: r.first_published_at, pinned: !!r.pinned, commentsClosed: !!r.comments_closed, version: r.version, updatedAt: r.updated_at, authorHandle: r.author_handle, editorHandle: r.editor_handle,
    })),
  };
}

// ---- 圖片 ---------------------------------------------------------------------

const RASTER = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/apng"]);
export const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const IMAGE_GRACE = 24 * 3600_000;
const INLINE_IMAGE = /\/v1\/blog\/images\/([A-Za-z0-9-]{1,64}\.webp)/g;

/**
 * 存一張公開點陣圖：轉 WebP、最長邊 1600，存 AVATARS 的 blog/<uuid>.webp（部落格與活動橫幅共用）。
 * 先登記 24 小時後清理（沿用頭像的清理表與排程），被文章或活動引用時清理會跳過；沒被用上的自然被清掉。
 * 錯誤碼是中性的 image_invalid／image_unavailable，呼叫端用 imageErrorAs 換成自己的前綴。
 */
export async function storeRasterImage(env: Env, file: unknown, now: number): Promise<{ key: string; url: string }> {
  if (!(file instanceof File) || !file.size || file.size > IMAGE_MAX_BYTES || !RASTER.has(file.type)) throw new HttpError(400, "image_invalid");
  if (!env.AVATARS || !env.IMAGES) throw new HttpError(503, "image_unavailable");
  let output: ArrayBuffer;
  try {
    const info = await env.IMAGES.info(file.stream());
    if (!RASTER.has(info.format) || !("width" in info) || info.width * info.height > 40_000_000) throw new Error("invalid image");
    const out = await env.IMAGES.input(file.stream()).transform({ width: 1600, height: 1600, fit: "scale-down" }).output({ format: "image/webp", quality: 82, anim: true });
    output = await out.response().arrayBuffer();
  } catch {
    throw new HttpError(400, "image_invalid");
  }
  const key = `blog/${crypto.randomUUID()}.webp`;
  await env.DB.prepare("INSERT INTO avatar_cleanup (key, delete_after) VALUES (?, ?)").bind(key, now + IMAGE_GRACE).run();
  try {
    await env.AVATARS.put(key, output, { httpMetadata: { contentType: "image/webp" } });
  } catch {
    throw new HttpError(503, "image_unavailable");
  }
  return { key, url: imageUrl(key)! };
}

/** storeRasterImage 的中性錯誤碼加上功能前綴（blog_image_invalid、campaign_image_unavailable…），其他錯照原樣拋。 */
export const imageErrorAs = (prefix: string) => (e: unknown): never => {
  throw e instanceof HttpError && (e.message === "image_invalid" || e.message === "image_unavailable") ? new HttpError(e.status, `${prefix}_${e.message}`) : e;
};

/** 上傳一張文章圖片。 */
export async function uploadImage(env: Env, file: unknown, now: number): Promise<{ key: string; url: string }> {
  const stored = await storeRasterImage(env, file, now).catch(imageErrorAs("blog"));
  await bumpOp(env.DB, "blog", "image", "success");
  return stored;
}

/** 這個 key（SQL 運算式）被引用：某篇文章的封面、分享封面或內文，或某個活動的橫幅。圖片路由與清理排程共用。 */
export const imageReferenced = (key: string) =>
  `(EXISTS (SELECT 1 FROM blog_posts WHERE cover_key = ${key} OR share_cover_key = ${key} OR instr(body_md, '/v1/blog/images/' || substr(${key}, 6)) > 0) OR EXISTS (SELECT 1 FROM campaigns WHERE banner_key = ${key}))`;

/** 圖片可以對外：被某篇文章引用，或上傳不到 24 小時。 */
export async function imageServable(db: D1Database, key: string, now: number): Promise<boolean> {
  if (!IMAGE_KEY.test(key)) return false;
  const r = await db.prepare(`SELECT 1 AS ok WHERE ${imageReferenced("?1")} OR EXISTS (SELECT 1 FROM avatar_cleanup WHERE key = ?1 AND delete_after > ?2)`).bind(key, now).first();
  return !!r;
}

/**
 * 存檔用到的圖從清理表除名。之後就算文章不再引用也留著：修訂紀錄還原時要讀得到。
 * ponytail: 不再被任何版本引用的圖會留在 bucket；量大時改成掃修訂再清。
 */
async function keepImages(db: D1Database, c: Content): Promise<void> {
  const keys = [c.cover_key, c.share_cover_key, ...[...c.body_md.matchAll(INLINE_IMAGE)].map((m) => `blog/${m[1]}`)].filter((k): k is string => !!k);
  if (keys.length) await db.prepare("DELETE FROM avatar_cleanup WHERE key IN (SELECT value FROM json_each(?))").bind(JSON.stringify(keys)).run();
}
