import { auditStmt, auditStmtIfChanged, type ActorKind } from "./audit";
import { campaignPhase, type CampaignStatus } from "./campaign";
import { languageRank, translationListCte } from "./blog-translations";
import { bumpOp } from "./ops-metrics";
import { HttpError, type Env } from "./types";
import { BLOG_PINNED_LIMIT } from "../shared/blog";
import { PRIMARY_HOST } from "../shared/site-hosts";

/**
 * 官方部落格（開業活動設計 §6）。寫的人＝供應商那邊本站應用的 owner／admin（不含 AI 帳號，見 community-admin.ts）。
 * 公開判定只在 isPublic 一處：已發布且到了發布時間。定時發布靠讀取時判斷，不開排程。
 * 權限在路由層檢查（community-admin.ts 的 canWriteBlog）；這裡的寫入函式假設呼叫端已經確認過。
 */
export const LOCALES = ["zh-Hant", "zh-Hans", "en", "ja", "ko"] as const;
export type Locale = (typeof LOCALES)[number];
export const blogLocale = (value?: string): Locale => LOCALES.includes(value as Locale) ? value as Locale : "zh-Hant";
export const optionalBlogLocale = (value?: string | null): Locale | undefined => LOCALES.includes(value as Locale) ? value as Locale : undefined;
/** List eligibility; translations are selected and deduplicated by SQL before pagination. */
export const matchesBlogLocale = (p: Pick<Post,"locale">, locale: Locale) => p.locale===locale || (locale==="zh-Hant"&&p.locale==="zh-Hans") || (locale==="zh-Hans"&&p.locale==="zh-Hant");
/** 欄目名稱／說明的多語文字，鍵是文章語言（types.ts 的 Localized 是卡片介面用的 zh/en/ja/ko，不同一套）。 */
export type Localized = Partial<Record<Locale, string>>;
export type Actor = { memberId: string; kind: ActorKind };
export type PostStatus = "draft" | "pending_review" | "published" | "unpublished";

export type Column = { permalinkLocked?:boolean; id: string; slug: string; name: Localized; description: Localized; sort: number; enabled: boolean; parentId: string | null };
/** 不帶 parentId 視為分組（null）。建立後 parentId 只能換成另一個分組，不能讓分組變欄目或反過來。 */
export type ColumnInput = Omit<Column, "id" | "parentId"> & { id?: string; parentId?: string | null };
export type ColumnNode = Column & { postCount?: number; columns: (Column & { postCount?: number })[] };

export type Post = {
  id: string; columnId: string; columnSlug: string; slug: string; locale: Locale; title: string; excerpt: string;
  coverUrl: string | null; bodyMd: string; shareTitle: string | null; shareDescription: string | null; shareCoverUrl: string | null;
  campaignId: string | null; status: PostStatus; publishAt: number | null; firstPublishedAt: number | null; pinned: boolean;
  commentsClosed: boolean; pinnedCommentId: string | null; authorMemberId: string; version: number; createdAt: number; updatedAt: number;
  /** 對外的「修改時間」：最新一筆內容修訂的時間（置頂、留言開關不算）；沒有修訂退回首次發布。updatedAt 只給管理端。 */
  contentUpdatedAt: number;
  /** 編輯器回存時要帶回的原始 key（coverUrl／shareCoverUrl 是由它算出來的公開網址）。 */
  coverKey: string | null; shareCoverKey: string | null;
  translationGroupId: string; sourceLocale: Locale; groupVersion: number; wasPublic: boolean;
};
/** 公開回應裡的關聯活動：只在活動存在且不是草稿時有，其餘是 null。原始 campaignId 只給管理端。 */
export type CampaignBrief = { slug: string; title: Localized; phase: "upcoming" | "open" | "ended"; startsAt: number | null; endsAt: number | null; timezone: string | null };
export type PostCard = Pick<Post, "id" | "columnSlug" | "slug" | "title" | "excerpt" | "coverUrl" | "locale" | "firstPublishedAt" | "pinned"> & { readMinutes: number; commentCount: number; campaign: CampaignBrief | null; translationGroupId: string; sourceLocale: Locale; fallback: boolean; groupPublishedAt: number | null };
export type PostInput = {
  /** 編輯器的自動儲存：同一人十分鐘內連續的自動儲存併進同一筆修訂，修訂紀錄才不會被幾百個半成品淹沒 */
  autosave?: boolean;
  translationOfPostId?: string;
  expectedTranslationGroupVersion?: number;
  columnId: string; slug: string; locale: Locale; title: string; excerpt: string; bodyMd: string;
  coverKey?: string | null; shareTitle?: string | null; shareDescription?: string | null; shareCoverKey?: string | null; campaignId?: string | null;
};
export type StateChange = { status?: "published" | "unpublished"; publishAt?: number | null; pinned?: boolean; commentsClosed?: boolean; pinnedCommentId?: string | null };

export const PAGE_SIZE = 12;
const PINNED_MAX = BLOG_PINNED_LIMIT;

/**
 * 留言上的「官方」徽章：寫過或改過文章的人。寫作權限本身看供應商的應用團隊（community-admin.ts），
 * 那問不進 SQL；能寫文章的人一定先過了那一關，所以「碰過文章」就是一份不用另外維護的官方名單。
 * 寫成 SQL 片段，讓留言列表一次判斷整頁留言者。`member` 是 SQL 運算式。
 * ponytail: 離開應用團隊的人徽章還在；要收回就得在退出團隊時通知本站，或改成記驗證時間。
 */
export const officialSql = (member: string) =>
  `(EXISTS (SELECT 1 FROM blog_posts op WHERE op.author_member_id = ${member}) OR EXISTS (SELECT 1 FROM blog_post_revisions orv WHERE orv.editor_member_id = ${member}))`;

export async function isOfficialWriter(db: D1Database, memberId: string): Promise<boolean> {
  return !!(await db.prepare(`SELECT ${officialSql("?1")} AS ok`).bind(memberId).first<{ ok: number }>())?.ok;
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
  translation_group_id: string | null; group_source_locale: Locale | null; group_version: number | null; was_public: number;
};
type CampaignRow = { cmp_slug: string | null; cmp_title: string | null; cmp_status: CampaignStatus | null; cmp_starts_at: number | null; cmp_ends_at: number | null; cmp_timezone: string | null };
type CardRow = Pick<PostRow, "id" | "column_slug" | "slug" | "title" | "excerpt" | "cover_key" | "locale" | "first_published_at" | "pinned" | "body_md"> & { comment_count: number; translation_group_id: string | null; group_pinned?: number; group_published_at?: number; source_locale?: Locale; viewer_locale?: Locale } & CampaignRow;
type ColumnRow = { id: string; slug: string; name: string; description: string; sort: number; enabled: number; parent_id: string | null; permalink_locked?:number };

const POST_SELECT = "SELECT p.*, col.slug AS column_slug, g.source_locale AS group_source_locale, g.version AS group_version, (SELECT MAX(r.created_at) FROM blog_post_revisions r WHERE r.post_id = p.id) AS content_updated_at FROM blog_posts p JOIN blog_columns col ON col.id = p.column_id LEFT JOIN blog_translation_groups g ON g.id=p.translation_group_id";
// ponytail: 卡片要算閱讀時長，所以連內文一起讀（一頁 12 篇）；嫌重時改成儲存時算好存一欄。
// 關聯活動用 LEFT JOIN 一起讀（列表不逐篇查）；草稿活動當作沒有。
const CAMPAIGN_COLUMNS = "cmp.slug AS cmp_slug, cmp.title AS cmp_title, cmp.status AS cmp_status, cmp.starts_at AS cmp_starts_at, cmp.ends_at AS cmp_ends_at, cmp.timezone AS cmp_timezone";
const CARD_FIELDS = `p.translation_group_id, p.id, col.slug AS column_slug, p.slug, p.title, p.excerpt, p.cover_key, p.locale, p.first_published_at, p.pinned, p.body_md, ${CAMPAIGN_COLUMNS},
  (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id AND c.root_id IS NULL AND c.deleted_at IS NULL AND c.status = 'visible') AS comment_count`;
const CARD_FROM = `FROM blog_posts p JOIN blog_columns col ON col.id = p.column_id LEFT JOIN campaigns cmp ON cmp.id = p.campaign_id AND cmp.status <> 'draft'`;
const CARD_SELECT = `SELECT ${CARD_FIELDS} ${CARD_FROM}`;
const CHOSEN_CARDS = `SELECT ${CARD_FIELDS}, chosen.source_locale, chosen.group_pinned, chosen.group_published_at, ?2 AS viewer_locale ${CARD_FROM} JOIN chosen ON chosen.id=p.id`;
/** 已公開（?1 是現在）。欄目啟不啟用另外判斷：列表要看，單篇與前後篇不看。 */
const LIVE = "p.status = 'published' AND p.publish_at IS NOT NULL AND p.publish_at <= ?1";
/** 公開列表看得到的欄目（別名 col）：是欄目、自己啟用、所屬分組也啟用。單篇不看這條（舊連結不失效）。 */
export const VISIBLE_COLUMN = "col.enabled = 1 AND col.parent_id IS NOT NULL AND EXISTS (SELECT 1 FROM blog_columns grp WHERE grp.id = col.parent_id AND grp.enabled = 1)";

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
  translationGroupId: r.translation_group_id ?? r.id, sourceLocale: r.group_source_locale ?? r.locale, groupVersion: r.group_version ?? 0, wasPublic: !!r.was_public,
});
const toBrief = (r: CampaignRow, now: number): CampaignBrief | null => {
  if (r.cmp_slug === null || r.cmp_status === null || r.cmp_status === "draft") return null;
  const phase = campaignPhase({ status: r.cmp_status, startsAt: r.cmp_starts_at, endsAt: r.cmp_ends_at }, now) as CampaignBrief["phase"];
  return { slug: r.cmp_slug, title: JSON.parse(r.cmp_title ?? "{}"), phase, startsAt: r.cmp_starts_at, endsAt: r.cmp_ends_at, timezone: r.cmp_timezone };
};
const toCard = (now: number) => (r: CardRow): PostCard => ({
  id: r.id, columnSlug: r.column_slug, slug: r.slug, title: r.title, excerpt: r.excerpt, coverUrl: imageUrl(r.cover_key), locale: r.locale,
  firstPublishedAt: r.first_published_at, pinned: !!(r.group_pinned ?? r.pinned), readMinutes: readMinutes(r.body_md), commentCount: r.comment_count, campaign: toBrief(r, now),
  translationGroupId:r.translation_group_id ?? r.id,sourceLocale:r.source_locale ?? r.locale,fallback:r.viewer_locale!==undefined && r.locale!==r.viewer_locale,groupPublishedAt:r.group_published_at ?? r.first_published_at,
});
const toColumn = (r: ColumnRow): Column => ({ id: r.id, slug: r.slug, name: JSON.parse(r.name), description: JSON.parse(r.description), sort: r.sort, enabled: !!r.enabled, parentId: r.parent_id, ...(r.permalink_locked!==undefined?{permalinkLocked:!!r.permalink_locked}:{}) });

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
    const guard = msg.match(/blog_(?:permalink_locked|translation_[a-z_]+)/)?.[0];
    if (guard) throw new HttpError(409, guard);
    if (!/UNIQUE constraint failed/.test(msg)) throw e;
    const prior = await priorSubject(db, actor, operationId, kind);
    if (prior) return { replay: prior };
    if (/blog_posts.translation_group_id/.test(msg)) throw new HttpError(409, "blog_translation_locale_taken");
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
/** 自動儲存併進前一筆修訂的時間窗 */
const AUTOSAVE_MERGE_MS = 10 * 60_000;

async function writeContent(db: D1Database, before: PostRow | null, c: Content, actor: Actor, operationId: string, now: number, action: "create" | "save" | "restore", auto = false, translation?: { id: string; version: number }): Promise<Post> {
  const id = before?.id ?? crypto.randomUUID();
  const version = (before?.version ?? 0) + 1;
  const meta = JSON.stringify({ slug: c.slug, excerpt: c.excerpt, shareTitle: c.share_title, shareDescription: c.share_description, shareCoverKey: c.share_cover_key, coverKey: c.cover_key, locale: c.locale, columnId: c.column_id, ...(auto ? { auto: true } : {}) });
  // 前一筆也是同一人、十分鐘內的自動儲存：改寫那一筆，不另起一版（手動儲存與還原一律另起）
  const mergeInto = auto && before
    ? await db.prepare("SELECT id FROM blog_post_revisions WHERE post_id = ? AND editor_member_id = ? AND created_at > ? AND json_extract(meta_json, '$.auto') = 1 AND version = (SELECT MAX(version) FROM blog_post_revisions WHERE post_id = ?)")
      .bind(id, actor.memberId, now - AUTOSAVE_MERGE_MS, id).first<{ id: string }>()
    : null;
  const groupId = before?.translation_group_id ?? translation?.id ?? id;
  const values = CONTENT_COLUMNS.map((k) => c[k]);
  const audit = { subjectKind: "blog_post" as const, subjectId: id, actorMemberId: actor.memberId, actorKind: actor.kind, action, before: before ? auditView(before) : {}, after: {...auditView({ ...c, version }),translationGroupId:groupId,...(translation?{translationOf:true}:{})}, operationId, now };
  const revision = "INSERT INTO blog_post_revisions (id, post_id, editor_member_id, title, body_md, meta_json, version, created_at)";
  const writes = before
    ? [
        db.prepare(`UPDATE blog_posts SET ${CONTENT_COLUMNS.map((k) => `${k} = ?`).join(", ")}, version = version + 1, updated_at = ?, translation_group_id = ? WHERE id = ? AND version = ? ${!before.translation_group_id?"AND changes()>0":""}`).bind(...values, now, groupId, id, before.version),
        mergeInto
          ? db.prepare("UPDATE blog_post_revisions SET title = ?, body_md = ?, meta_json = ?, version = ?, created_at = ? WHERE id = ? AND changes() > 0").bind(c.title, c.body_md, meta, version, now, mergeInto.id)
          : db.prepare(`${revision} SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() > 0`).bind(crypto.randomUUID(), id, actor.memberId, c.title, c.body_md, meta, version, now),
        auditStmtIfChanged(db, audit),
      ]
    : [
        db.prepare(`INSERT INTO blog_posts (id, author_member_id, created_at, updated_at, translation_group_id, ${CONTENT_COLUMNS.join(", ")}) SELECT ?, ?, ?, ?, ?, ${CONTENT_COLUMNS.map(() => "?").join(", ")} WHERE changes()>0`).bind(id, actor.memberId, now, now, groupId, ...values),
        db.prepare(`${revision} SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE changes()>0`).bind(crypto.randomUUID(), id, actor.memberId, c.title, c.body_md, meta, version, now),
        auditStmtIfChanged(db, audit),
      ];
  if (!before || !before.translation_group_id) {
    if (translation) writes.unshift(db.prepare("UPDATE blog_translation_groups SET version=version+1 WHERE id=? AND version=?").bind(translation.id, translation.version));
    else writes.unshift(db.prepare(`INSERT INTO blog_translation_groups(id,source_locale,created_at) SELECT ?,?,? ${before ? "WHERE EXISTS(SELECT 1 FROM blog_posts WHERE id=? AND version=? AND translation_group_id IS NULL)" : ""}`).bind(groupId,c.locale,now,...(before ? [before.id,before.version] : [])));
  }
  const done = await commit(db, writes, actor, operationId, "blog_post", "blog_slug_taken");
  if ("replay" in done) return mustPost(db, done.replay);
  if (!done.changes) { if (translation) throw new HttpError(409, "blog_translation_group_changed"); await conflict(db, id); }
  await keepImages(db, c);
  if(translation)await bumpOp(db,"blog","translation","success");
  await bumpOp(db, "blog", action === "restore" ? "restore" : "save", "success");
  return mustPost(db, id);
}

export async function savePost(db: D1Database, input: PostInput & { id?: string; expectedVersion?: number }, actor: Actor, operationId: string, now: number): Promise<Post> {
  const prior = await priorSubject(db, actor, operationId, "blog_post");
  if (prior) return mustPost(db, prior);
  const c = cleanPost(input);
  if (!(await db.prepare("SELECT 1 AS ok FROM blog_columns WHERE id = ? AND parent_id IS NOT NULL").bind(c.column_id).first())) invalid("columnId");
  if (input.id === undefined) {
    let target: {id:string;version:number} | undefined;
    if (input.translationOfPostId !== undefined) {
      const source = await mustPost(db,input.translationOfPostId);
      if (source.columnId !== c.column_id) throw new HttpError(409,"blog_translation_column_mismatch");
      if (!source.groupVersion) throw new HttpError(503,"blog_translation_backfill_pending");
      if (input.expectedTranslationGroupVersion !== undefined && input.expectedTranslationGroupVersion !== source.groupVersion) throw new HttpError(409,"blog_translation_group_changed");
      target={id:source.translationGroupId,version:source.groupVersion};
    }
    return writeContent(db, null, c, actor, operationId, now, "create",false,target);
  }
  if (input.translationOfPostId !== undefined) invalid("translationOfPostId");
  if (!Number.isInteger(input.expectedVersion)) invalid("expectedVersion");
  const before = await postRow(db, input.id);
  if (!before) throw new HttpError(404, "blog_post_not_found");
  if (before.version !== input.expectedVersion) await conflict(db, before.id);
  return writeContent(db, before, c, actor, operationId, now, "save", input.autosave === true);
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
  const keepUrl = !!before.was_public || isPublic({status:before.status,publishAt:before.publish_at},now) || (await db.prepare("SELECT COUNT(*) AS n FROM blog_posts WHERE translation_group_id=?").bind(before.translation_group_id).first<{n:number}>())!.n > 1;
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

/** p 留給文章短網址 /blog/p/<id>，g 留給分組頁 /blog/g/<分組>：同名欄目會被那兩條路由蓋掉 */
const RESERVED_SLUGS = new Set(["p", "g"]);

export async function saveColumn(db: D1Database, input: ColumnInput, actor: Actor, operationId: string, now: number): Promise<Column> {
  const prior = await priorSubject(db, actor, operationId, "blog_column");
  if (prior) return mustColumn(db, prior);
  if (!isStr(input.slug, 40, 1) || !SLUG.test(input.slug) || RESERVED_SLUGS.has(input.slug)) invalid("slug");
  const name = cleanLocalized(input.name, "name", 40, true);
  const description = cleanLocalized(input.description, "description", 300, false);
  if (!Number.isSafeInteger(input.sort)) invalid("sort");
  if (typeof input.enabled !== "boolean") invalid("enabled");
  const parentId = input.parentId ?? null;
  if (parentId !== null) {
    const parent = isStr(parentId, 64, 1) ? await db.prepare("SELECT parent_id FROM blog_columns WHERE id = ?").bind(parentId).first<{ parent_id: string | null }>() : null;
    if (!parent || parent.parent_id !== null) invalid("parentId");
  }
  const values = [input.slug, JSON.stringify(name), JSON.stringify(description), input.sort, input.enabled ? 1 : 0, parentId];
  const after = { slug: input.slug, name, description, sort: input.sort, enabled: input.enabled, parentId };
  let id: string, writes: D1PreparedStatement[];
  if (input.id === undefined) {
    id = crypto.randomUUID();
    writes = [
      db.prepare("INSERT INTO blog_columns (id, slug, name, description, sort, enabled, parent_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(id, ...values, now, now),
      auditStmt(db, { subjectKind: "blog_column", subjectId: id, actorMemberId: actor.memberId, actorKind: actor.kind, action: "column_create", after, operationId, now }),
    ];
  } else {
    id = input.id;
    const before = await db.prepare("SELECT * FROM blog_columns WHERE id = ?").bind(id).first<ColumnRow>();
    if (!before) throw new HttpError(404, "blog_column_not_found");
    // 分組與欄目不互換：分組底下的欄目會變三級，欄目裡的文章會掛到分組上
    if ((before.parent_id === null) !== (parentId === null)) invalid("parentId");
    const { id: _, ...prev } = toColumn(before);
    writes = [
      db.prepare("UPDATE blog_columns SET slug = ?, name = ?, description = ?, sort = ?, enabled = ?, parent_id = ?, updated_at = ? WHERE id = ?").bind(...values, now, id),
      auditStmtIfChanged(db, { subjectKind: "blog_column", subjectId: id, actorMemberId: actor.memberId, actorKind: actor.kind, action: "column_save", before: prev, after, operationId, now }),
    ];
  }
  const done = await commit(db, writes, actor, operationId, "blog_column", "blog_column_slug_taken");
  if ("replay" in done) return mustColumn(db, done.replay);
  await bumpOp(db, "blog", "column", "success");
  return { id, ...after };
}

/**
 * 刪一個空的分組或欄目：裡面有文章（欄目）或有欄目（分組）就回 409。條件寫在 DELETE 裡，
 * 檢查與刪除之間有人新增文章也刪不掉；稽核用 changes() 串在後面，刪不掉就不留。
 */
export async function deleteColumn(db: D1Database, id: string, actor: Actor, operationId: string, now: number): Promise<{ id: string }> {
  const prior = await priorSubject(db, actor, operationId, "blog_column");
  if (prior) return { id: prior };
  const before = await db.prepare("SELECT * FROM blog_columns WHERE id = ?").bind(id).first<ColumnRow>();
  if (!before) throw new HttpError(404, "blog_column_not_found");
  const { id: _, ...prev } = toColumn(before);
  const done = await commit(db, [
    db.prepare("DELETE FROM blog_columns WHERE id = ?1 AND NOT EXISTS (SELECT 1 FROM blog_posts WHERE column_id = ?1) AND NOT EXISTS (SELECT 1 FROM blog_columns WHERE parent_id = ?1)").bind(id),
    auditStmtIfChanged(db, { subjectKind: "blog_column", subjectId: id, actorMemberId: actor.memberId, actorKind: actor.kind, action: "column_delete", before: prev, after: {}, operationId, now }),
  ], actor, operationId, "blog_column", "blog_column_slug_taken");
  if ("replay" in done) return { id: done.replay };
  if (!done.changes) throw new HttpError(409, "blog_column_not_empty");
  await bumpOp(db, "blog", "column", "success");
  return { id };
}

async function mustColumn(db: D1Database, id: string): Promise<Column> {
  const r = await db.prepare("SELECT * FROM blog_columns WHERE id = ?").bind(id).first<ColumnRow>();
  if (!r) throw new HttpError(404, "blog_column_not_found");
  return toColumn(r);
}

/**
 * 分組與欄目的樹，依 sort、建立時間排。公開：只列啟用的分組裡啟用的欄目，沒有欄目可看的分組不列。
 * 管理：全列（含停用），每項帶文章數（含草稿），分組的數字是底下欄目的合計。
 */
export async function columnTree(db: D1Database, opts: { admin: boolean }): Promise<ColumnNode[]> {
  const count = opts.admin ? "(SELECT COUNT(*) FROM blog_posts p WHERE p.column_id = c.id)" : "0";
  const rows = (await db.prepare(`SELECT c.*, ${count} AS post_count, EXISTS(SELECT 1 FROM blog_posts p WHERE p.column_id=c.id AND (p.was_public=1 OR (p.status='published' AND p.publish_at<=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)))) AS permalink_locked FROM blog_columns c ORDER BY c.sort, c.created_at, c.id`).all<ColumnRow & { post_count: number }>()).results;
  const shown = (r: ColumnRow) => opts.admin || r.enabled === 1;
  const withCount = (r: ColumnRow & { post_count: number }): Column & { postCount?: number } => (opts.admin ? { ...toColumn(r), postCount: r.post_count } : toColumn(r));
  return rows
    .filter((g) => g.parent_id === null && shown(g))
    .map((g) => {
      const columns = rows.filter((c) => c.parent_id === g.id && shown(c)).map(withCount);
      const node: ColumnNode = { ...toColumn(g), columns };
      if (opts.admin) node.postCount = columns.reduce((n, c) => n + (c.postCount ?? 0), 0);
      return node;
    })
    .filter((g) => opts.admin || g.columns.length > 0);
}

// ---- 公開讀取 -----------------------------------------------------------------

/**
 * 公開列表：看得到的欄目（VISIBLE_COLUMN）裡已公開的文章。columnSlug 只看那一欄；groupSlug 只看那一組；
 * 兩個都給時以欄目為準。置頂的最多 3 篇另列在 pinned，其餘依發布時間新到舊分頁；total 是 items 那一群的總數。
 */
export async function publicPosts(db: D1Database, opts: { locale?: Locale; columnSlug?: string; groupSlug?: string; page: number; now: number }): Promise<{ total: number; pinned: PostCard[]; items: PostCard[] }> {
  const args = [opts.now,opts.locale ?? "zh-Hant",opts.columnSlug ?? null,opts.columnSlug ? null : opts.groupSlug ?? null];
  const cte=translationListCte();
  const pinned=(await db.prepare(`${cte} ${CHOSEN_CARDS} WHERE chosen.group_pinned=1 ORDER BY chosen.group_published_at DESC,chosen.group_key DESC LIMIT ${PINNED_MAX}`).bind(...args).all<CardRow>()).results;
  const skip=JSON.stringify(pinned.map(p=>p.id));const page=Math.max(1,Math.floor(opts.page)||1);
  const [count,items]=await db.batch<CardRow & {n:number}>([
    db.prepare(`${cte} SELECT COUNT(*) AS n FROM chosen WHERE id NOT IN(SELECT value FROM json_each(?5))`).bind(...args,skip),
    db.prepare(`${cte} ${CHOSEN_CARDS} WHERE p.id NOT IN(SELECT value FROM json_each(?5)) ORDER BY chosen.group_published_at DESC,chosen.group_key DESC LIMIT ?6 OFFSET ?7`).bind(...args,skip,PAGE_SIZE,(page-1)*PAGE_SIZE),
  ]);
  return {total:count!.results[0]!.n,pinned:pinned.map(toCard(opts.now)),items:items!.results.map(toCard(opts.now))};
}

/** 單篇：欄目停用也能開（舊連結不失效），只看公開判定。 */
export async function publicPost(db: D1Database, columnSlug: string, slug: string, now: number): Promise<Post | null> {
  return (await resolveArticleRoute(db,{columnSlug,slug,now}))?.post ?? null;
}

// ---- 閱讀數與喜歡 ---------------------------------------------------------------

/** 閱讀數滿這個數才公開；後台一律看精確數字。 */
export const VIEWS_PUBLIC_MIN = 50;
const LIVE_BY_ID = `SELECT p.id FROM blog_posts p JOIN blog_columns col ON col.id = p.column_id WHERE p.id = ?2 AND ${LIVE} AND ${VISIBLE_COLUMN}`;
export type Engagement = { views: number | null; likes: number; liked: boolean };

async function engagement(db: D1Database, postId: string, memberId: string | null): Promise<Engagement> {
  const r = (await db.prepare("SELECT view_count, like_count, EXISTS (SELECT 1 FROM blog_post_likes WHERE post_id = ?1 AND member_id = ?2) AS liked FROM blog_posts WHERE id = ?1")
    .bind(postId, memberId).first<{ view_count: number; like_count: number; liked: number }>())!;
  return { views: r.view_count >= VIEWS_PUBLIC_MIN ? r.view_count : null, likes: r.like_count, liked: !!r.liked };
}

/**
 * 文章頁進來一次：count 為真才加一（同一個瀏覽器一天只送一次真，由前台判斷）。不公開的文章回 null。
 * ponytail: 沒有伺服器端去重，腳本能灌數字；數字只是展示，被灌再加 KV 一天過期的 IP 雜湊去重。
 */
export async function recordView(db: D1Database, postId: string, count: boolean, memberId: string | null, now: number): Promise<Engagement | null> {
  if (!(await db.prepare(LIVE_BY_ID).bind(now, postId).first())) return null;
  if (count) await db.prepare("UPDATE blog_posts SET view_count = view_count + 1 WHERE id = ?").bind(postId).run();
  return engagement(db, postId, memberId);
}

/** 喜歡／收回：一個 batch，計數只在那一票真的新增或刪掉時才動，同時按也不會多算。不公開的文章回 null。 */
export async function setPostLike(db: D1Database, postId: string, memberId: string, like: boolean, now: number): Promise<{ likes: number; liked: boolean } | null> {
  if (!(await db.prepare(LIVE_BY_ID).bind(now, postId).first())) return null;
  await db.batch(like
    ? [db.prepare("INSERT OR IGNORE INTO blog_post_likes (post_id, member_id, created_at) VALUES (?, ?, ?)").bind(postId, memberId, now),
       db.prepare("UPDATE blog_posts SET like_count = like_count + 1 WHERE id = ? AND changes() > 0").bind(postId)]
    : [db.prepare("DELETE FROM blog_post_likes WHERE post_id = ? AND member_id = ?").bind(postId, memberId),
       db.prepare("UPDATE blog_posts SET like_count = MAX(0, like_count - 1) WHERE id = ? AND changes() > 0").bind(postId)]);
  const { likes, liked } = await engagement(db, postId, memberId);
  return { likes, liked };
}

/** 最新的公開文章（Atom 用）：停用欄目的不列，與公開列表一致。 */
export async function recentPosts(db: D1Database, now: number, limit: number, locale?: Locale): Promise<Post[]> {
  const rows=locale
    ? await db.prepare(`${translationListCte()} ${POST_SELECT} JOIN chosen ON chosen.id=p.id ORDER BY chosen.group_published_at DESC,chosen.group_key DESC LIMIT ?5`).bind(now,locale,null,null,limit).all<PostRow>()
    : await db.prepare(`${POST_SELECT} WHERE ${LIVE} AND ${VISIBLE_COLUMN} ORDER BY p.publish_at DESC,p.id DESC LIMIT ?2`).bind(now,limit).all<PostRow>();
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
export async function publicPostById(db: D1Database, id: string, now: number): Promise<{ column: string; slug: string; locale: Locale } | null> {
  const requested=await postRow(db,id);if(!requested)return null;
  const result=await resolveArticleRoute(db,{post:toPost(requested),now});
  return result ? {column:result.post.columnSlug,slug:result.post.slug,locale:result.post.locale} : null;
}

async function groupPublishedAt(db:D1Database,post:Post,now:number):Promise<number>{
  const r=await db.prepare("SELECT MIN(first_published_at) AS at FROM blog_posts WHERE COALESCE(translation_group_id,id)=? AND (was_public=1 OR (status='published' AND publish_at<=?))").bind(post.translationGroupId,now).first<{at:number|null}>();
  return r?.at ?? post.firstPublishedAt ?? post.publishAt ?? post.createdAt;
}
export async function adjacentPosts(db:D1Database,post:Post,now:number,locale:Locale=post.locale):Promise<{prev:PostCard|null;next:PostCard|null}>{
  const at=await groupPublishedAt(db,post,now);const cte=translationListCte(false);
  const one=(cmp:"<"|">",dir:"ASC"|"DESC")=>db.prepare(`${cte} ${CHOSEN_CARDS} WHERE chosen.group_key<>?5 AND (chosen.group_published_at ${cmp} ?6 OR (chosen.group_published_at=?6 AND chosen.group_key ${cmp} ?5)) ORDER BY chosen.group_published_at ${dir},chosen.group_key ${dir} LIMIT 1`).bind(now,locale,post.columnSlug,null,post.translationGroupId,at);
  const [prev,next]=await db.batch<CardRow>([one("<","DESC"),one(">","ASC")]);
  return {prev:prev!.results[0]?toCard(now)(prev!.results[0]):null,next:next!.results[0]?toCard(now)(next!.results[0]):null};
}
export async function relatedPosts(db:D1Database,post:Post,now:number,limit=3,locale:Locale=post.locale):Promise<PostCard[]>{
  const rows=await db.prepare(`${translationListCte(false)} ${CHOSEN_CARDS} WHERE chosen.group_key<>?5 ORDER BY chosen.group_published_at DESC,chosen.group_key DESC LIMIT ?6`).bind(now,locale,post.columnSlug,null,post.translationGroupId,limit).all<CardRow>();return rows.results.map(toCard(now));
}

export type TranslationBrief={id:string;locale:Locale;columnSlug:string;slug:string;canonicalUrl:string};
export type ArticleResolution={requestedContentLocale:Locale|null;contentLocale:Locale;reason:"exact"|"preferred_missing"|"requested_unavailable"};
const canonical=(p:Pick<Post,"locale"|"columnSlug"|"slug">)=>`https://${PRIMARY_HOST}${p.locale==="zh-Hant"?"":`/${p.locale}`}/blog/${encodeURIComponent(p.columnSlug)}/${encodeURIComponent(p.slug)}`;
export const translationBrief=(p:Post):TranslationBrief=>({id:p.id,locale:p.locale,columnSlug:p.columnSlug,slug:p.slug,canonicalUrl:canonical(p)});
export async function publicTranslations(db:D1Database,post:Post,now:number):Promise<Post[]>{
  const rows=await db.prepare(`${POST_SELECT} WHERE COALESCE(p.translation_group_id,p.id)=?2 AND ${LIVE} ORDER BY p.first_published_at,p.id`).bind(now,post.translationGroupId).all<PostRow>();return rows.results.map(toPost);
}
export async function resolveArticleRoute(db:D1Database,opts:{columnSlug?:string;slug?:string;post?:Post;now:number;viewerLocale?:Locale;preferredLocale?:Locale}):Promise<{post:Post;translations:TranslationBrief[];resolution:ArticleResolution}|null>{
  const requested=opts.post ?? (opts.columnSlug&&opts.slug?await postBySlug(db,opts.columnSlug,opts.slug):null);
  if(!requested)return null;const exact=isPublic(requested,opts.now);
  if(!exact&&!requested.wasPublic)return null;
  const versions=await publicTranslations(db,requested,opts.now);if(!versions.length)return null;
  const preferred=opts.preferredLocale ?? opts.viewerLocale ?? requested.locale;
  const sorted=[...versions].sort((a,b)=>languageRank(a.locale,preferred,requested.sourceLocale)-languageRank(b.locale,preferred,requested.sourceLocale)||(a.firstPublishedAt??a.createdAt)-(b.firstPublishedAt??b.createdAt)||a.id.localeCompare(b.id));
  const selected=exact&&!opts.preferredLocale?requested:sorted[0]!;
  return {post:selected,translations:versions.map(translationBrief),resolution:{requestedContentLocale:opts.preferredLocale ?? (!exact?requested.locale:null),contentLocale:selected.locale,reason:!exact?"requested_unavailable":opts.preferredLocale&&selected.locale!==opts.preferredLocale?"preferred_missing":"exact"}};
}

// ---- 對外形狀 -----------------------------------------------------------------

/** 公開回應不帶成員 id、原始 key 與原始活動 id：作者一律是官方，活動換成摘要（草稿活動是 null）。 */
export async function publicView(db: D1Database, { authorMemberId: _a, coverKey: _c, shareCoverKey: _s, wasPublic:_w, groupVersion:_g, campaignId, ...p }: Post, now: number) {
  const r = campaignId ? await db.prepare(`SELECT ${CAMPAIGN_COLUMNS} FROM campaigns cmp WHERE cmp.id = ?`).bind(campaignId).first<CampaignRow>() : null;
  return { ...p, official: true as const, readMinutes: readMinutes(p.bodyMd), campaign: r ? toBrief(r, now) : null };
}

/** 管理回應：作者換成公開 ID（handle），不給成員 id。 */
export async function adminView(db: D1Database, { authorMemberId, ...p }: Post) {
  const m = await db.prepare("SELECT handle FROM members WHERE id = ?").bind(authorMemberId).first<{ handle: string }>();
  return { ...p, authorHandle: m?.handle ?? "", translations: await adminTranslations(db,{...p,authorMemberId}) };
}

export async function adminPost(db: D1Database, id: string) {
  return adminView(db, await mustPost(db, id));
}

const STATUSES: readonly string[] = ["draft", "pending_review", "published", "unpublished"];
type AdminRow = Pick<PostRow, "id" | "column_id" | "column_slug" | "slug" | "locale" | "title" | "status" | "publish_at" | "first_published_at" | "pinned" | "comments_closed" | "version" | "updated_at"> & { author_handle: string; editor_handle: string; view_count: number; like_count: number; comment_count: number };

/** 管理列表：所有狀態，最近改過的在前。column 是欄目 id 或 slug；group 是分組 id。editorHandle 是最後一次存內容的人。 */
export async function adminPosts(db: D1Database, opts: { status?: string; column?: string; group?: string; page: number }) {
  const status = opts.status || null;
  if (status !== null && !STATUSES.includes(status)) invalid("status");
  const where = "(?1 IS NULL OR p.status = ?1) AND (?2 IS NULL OR col.id = ?2 OR col.slug = ?2) AND (?3 IS NULL OR col.parent_id = ?3)";
  const from = "FROM blog_posts p JOIN blog_columns col ON col.id = p.column_id";
  const page = Math.max(1, Math.floor(opts.page) || 1);
  const binds = [status, opts.column || null, opts.group || null];
  const [count, rows] = await db.batch<AdminRow & { n: number }>([
    db.prepare(`SELECT COUNT(*) AS n ${from} WHERE ${where}`).bind(...binds),
    db.prepare(`SELECT p.id, p.column_id, col.slug AS column_slug, p.slug, p.locale, p.title, p.status, p.publish_at, p.first_published_at, p.pinned, p.comments_closed, p.version, p.updated_at, p.view_count, p.like_count,
      (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id AND c.root_id IS NULL AND c.deleted_at IS NULL AND c.status = 'visible') AS comment_count,
      COALESCE((SELECT handle FROM members WHERE id = p.author_member_id), '') AS author_handle,
      COALESCE((SELECT m.handle FROM blog_post_revisions r JOIN members m ON m.id = r.editor_member_id WHERE r.post_id = p.id ORDER BY r.version DESC LIMIT 1), '') AS editor_handle ${from} WHERE ${where} ORDER BY p.updated_at DESC, p.id DESC LIMIT ?4 OFFSET ?5`).bind(...binds, PAGE_SIZE, (page - 1) * PAGE_SIZE),
  ]);
  return {
    total: (count!.results[0] as { n: number }).n,
    items: (rows!.results as AdminRow[]).map((r) => ({
      id: r.id, columnId: r.column_id, columnSlug: r.column_slug, slug: r.slug, locale: r.locale, title: r.title, status: r.status, publishAt: r.publish_at,
      firstPublishedAt: r.first_published_at, pinned: !!r.pinned, commentsClosed: !!r.comments_closed, version: r.version, updatedAt: r.updated_at, authorHandle: r.author_handle, editorHandle: r.editor_handle,
      viewCount: r.view_count, likeCount: r.like_count, commentCount: r.comment_count,
    })),
  };
}

export type AssociationInput = { expectedVersion:number; expectedGroupVersion:number; targetPostId:string|null; expectedTargetGroupVersion?:number };

/** Only membership and CAS versions change. Body, URLs and engagement remain version-owned. */
export async function changeTranslation(db:D1Database,id:string,input:AssociationInput,actor:Actor,operationId:string,now:number):Promise<Post>{
  const prior=await priorSubject(db,actor,operationId,"blog_post");if(prior)return mustPost(db,prior);
  if(!Number.isInteger(input.expectedVersion)||!Number.isInteger(input.expectedGroupVersion)||(input.targetPostId!==null&&typeof input.targetPostId!=="string"))invalid("translation");
  const before=await mustPost(db,id);
  if(before.version!==input.expectedVersion)await conflict(db,id);
  if(before.groupVersion!==input.expectedGroupVersion)throw new HttpError(409,"blog_translation_group_changed");
  const target=input.targetPostId===null?null:await mustPost(db,input.targetPostId);
  if(target&&(!Number.isInteger(input.expectedTargetGroupVersion)||target.groupVersion!==input.expectedTargetGroupVersion))throw new HttpError(409,"blog_translation_group_changed");
  if(target&&target.columnId!==before.columnId)throw new HttpError(409,"blog_translation_column_mismatch");
  if(target?.translationGroupId===before.translationGroupId)throw new HttpError(409,"blog_translation_same_group");
  const groupId=target?.translationGroupId??crypto.randomUUID();
  const condition="id=? AND version=? AND translation_group_id=? AND EXISTS(SELECT 1 FROM blog_translation_groups WHERE id=? AND version=?)";
  const cas=[id,input.expectedVersion,before.translationGroupId,before.translationGroupId,input.expectedGroupVersion];
  const writes:D1PreparedStatement[]=[];
  if(!target)writes.push(db.prepare(`INSERT INTO blog_translation_groups(id,source_locale,created_at) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM blog_posts WHERE ${condition})`).bind(groupId,before.locale,now,...cas));
  writes.push(db.prepare(`UPDATE blog_posts SET translation_group_id=?,version=version+1,updated_at=? WHERE ${condition} ${target?"AND EXISTS(SELECT 1 FROM blog_translation_groups WHERE id=? AND version=?)":"AND changes()>0"}`).bind(groupId,now,...cas,...(target?[groupId,input.expectedTargetGroupVersion!]:[])));
  writes.push(db.prepare("UPDATE blog_translation_groups SET version=version+1 WHERE id=? AND changes()>0").bind(before.translationGroupId));
  if(target)writes.push(db.prepare("UPDATE blog_translation_groups SET version=version+1 WHERE id=? AND changes()>0").bind(groupId));
  writes.push(auditStmtIfChanged(db,{subjectKind:"blog_post",subjectId:id,actorMemberId:actor.memberId,actorKind:actor.kind,operationId,now,action:target?"translation_attach":"translation_detach",before:{translationGroupId:before.translationGroupId,version:before.version,groupVersion:before.groupVersion},after:{translationGroupId:groupId,version:before.version+1}}));
  writes.push(db.prepare("DELETE FROM blog_translation_groups WHERE id=? AND NOT EXISTS(SELECT 1 FROM blog_posts WHERE translation_group_id=?) AND EXISTS(SELECT 1 FROM audit_log WHERE actor_member_id=? AND operation_id=?)").bind(before.translationGroupId,before.translationGroupId,actor.memberId,operationId));
  const done=await commit(db,writes,actor,operationId,"blog_post","blog_slug_taken");
  if("replay"in done)return mustPost(db,done.replay);
  if(!done.changes)throw new HttpError(409,"blog_translation_group_changed");
  await bumpOp(db,"blog","translation","success");
  return mustPost(db,id);
}

export async function adminTranslations(db:D1Database,post:Post){
  const rows=await db.prepare(`${POST_SELECT.replace("SELECT p.*,",`SELECT p.*,p.view_count,p.like_count,
  (SELECT COUNT(*) FROM comments c WHERE c.post_id=p.id AND c.root_id IS NULL AND c.status='visible' AND c.deleted_at IS NULL) AS comment_count,
  COALESCE((SELECT handle FROM members WHERE id=p.author_member_id),'') AS author_handle,
  COALESCE((SELECT m.handle FROM blog_post_revisions r JOIN members m ON m.id=r.editor_member_id WHERE r.post_id=p.id ORDER BY r.version DESC LIMIT 1),'') AS editor_handle,`)} WHERE COALESCE(p.translation_group_id,p.id)=? ORDER BY p.locale`).bind(post.translationGroupId).all<PostRow & {view_count:number;like_count:number;comment_count:number;author_handle:string;editor_handle:string}>();
  return rows.results.map(r=>({id:r.id,locale:r.locale,title:r.title,status:r.status,publishAt:r.publish_at,version:r.version,wasPublic:!!r.was_public,columnId:r.column_id,columnSlug:r.column_slug,slug:r.slug,pinned:!!r.pinned,updatedAt:r.updated_at,authorHandle:r.author_handle,editorHandle:r.editor_handle,viewCount:r.view_count,likeCount:r.like_count,commentCount:r.comment_count}));
}

/** A group qualifies when any member matches filters; return all slots, including unpublished ones. */
export async function adminTranslationGroups(db:D1Database,opts:{page:number;query?:string;column?:string;status?:string;group?:string;missingLocale?:string}){
  if(opts.status&&!STATUSES.includes(opts.status))invalid("status");
  if(opts.missingLocale&&!LOCALES.includes(opts.missingLocale as Locale))invalid("locale");
  const from="FROM blog_posts p JOIN blog_columns col ON col.id=p.column_id";
  const where=`(?1 IS NULL OR instr(lower(p.title),lower(?1))>0) AND (?2 IS NULL OR col.id=?2 OR col.slug=?2) AND (?3 IS NULL OR p.status=?3) AND (?4 IS NULL OR col.parent_id=?4) AND (?5 IS NULL OR NOT EXISTS(SELECT 1 FROM blog_posts q WHERE COALESCE(q.translation_group_id,q.id)=COALESCE(p.translation_group_id,p.id) AND q.locale=?5))`;
  const binds=[opts.query||null,opts.column||null,opts.status||null,opts.group||null,opts.missingLocale||null];
  const page=Math.max(1,Math.floor(opts.page)||1);
  const [count,rows]=await db.batch<{n:number;id:string}>([
    db.prepare(`SELECT COUNT(DISTINCT COALESCE(p.translation_group_id,p.id)) AS n ${from} WHERE ${where}`).bind(...binds),
    db.prepare(`SELECT COALESCE(p.translation_group_id,p.id) AS id ${from} WHERE ${where} GROUP BY COALESCE(p.translation_group_id,p.id) ORDER BY MAX(p.updated_at) DESC,id DESC LIMIT ?6 OFFSET ?7`).bind(...binds,PAGE_SIZE,(page-1)*PAGE_SIZE),
  ]);
  const items=await Promise.all(rows!.results.map(async({id})=>{
    const row=await db.prepare(`${POST_SELECT} WHERE COALESCE(p.translation_group_id,p.id)=? ORDER BY CASE WHEN p.locale=g.source_locale THEN 0 ELSE 1 END,p.id LIMIT 1`).bind(id).first<PostRow>();
    const post=toPost(row!);return {id,sourceLocale:post.sourceLocale,version:post.groupVersion,title:post.title,columnId:post.columnId,versions:await adminTranslations(db,post)};
  }));
  return {total:count!.results[0]!.n,items};
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
  `(EXISTS (SELECT 1 FROM blog_posts WHERE cover_key = ${key} OR share_cover_key = ${key} OR instr(body_md, '/v1/blog/images/' || substr(${key}, 6)) > 0) OR EXISTS (SELECT 1 FROM campaigns WHERE banner_key = ${key}) OR EXISTS (SELECT 1 FROM card_reward_campaigns WHERE banner_key = ${key}) OR EXISTS (SELECT 1 FROM campaigns c,json_each(c.posters) p WHERE json_extract(p.value,'$.key')=${key}) OR EXISTS (SELECT 1 FROM card_reward_campaigns c,json_each(c.posters) p WHERE json_extract(p.value,'$.key')=${key}))`;

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
