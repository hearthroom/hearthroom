/**
 * 官方部落格的公開讀取（/v1/blog）與後台管理（/v1/blog/admin）。形狀照 src/blog-routes.ts：公開的作者一律是官方，不帶成員 id。
 * 留言不在這裡：留言面板用 api.ts 的留言函式，傳 { postId } 就掛到文章上。
 */
import { ApiError, describeApiError } from "./api";
import { COMMUNITY_API } from "./config";
import { i18n } from "./i18n";
import { currentProvider } from "./provider";
import { currentSurface } from "./track";

/** 欄目名稱的多語文字，鍵是 zh-Hant／zh-Hans／en／ja／ko。 */
export type Localized = Partial<Record<string, string>>;
export interface BlogColumn { id: string; slug: string; name: Localized; description: Localized; sort: number; enabled: boolean }

export interface PostCard {
  id: string; columnSlug: string; slug: string; title: string; excerpt: string; coverUrl: string | null; locale: string;
  firstPublishedAt: number | null; pinned: boolean; campaignId: string | null; readMinutes: number; commentCount: number;
}
export interface BlogPost extends Omit<PostCard, "commentCount"> {
  columnId: string; bodyMd: string; status: string; publishAt: number | null; commentsClosed: boolean; pinnedCommentId: string | null;
  createdAt: number; updatedAt: number; official: true;
}
export interface PostPage { post: BlogPost; adjacent: { prev: PostCard | null; next: PostCard | null }; related: PostCard[] }

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${COMMUNITY_API}${path}`, { headers: { "X-From": currentSurface() } });
  if (!res.ok) {
    const code = ((await res.json().catch(() => ({}))) as { error?: string }).error ?? "";
    throw new ApiError(res.status, describeApiError(res.status, code), code);
  }
  return (await res.json()) as T;
}

export const fetchColumns = () => get<{ items: BlogColumn[] }>("/blog/columns");

export const fetchPosts = (column: string | undefined, page: number) =>
  get<{ total: number; pinned: PostCard[]; items: PostCard[] }>(`/blog/posts?${column ? `column=${encodeURIComponent(column)}&` : ""}page=${page}`);

/** preview 是編輯器發的預覽碼：帶著它讀得到還沒公開的那一篇。 */
export const fetchPost = (column: string, slug: string, preview?: string) =>
  get<PostPage>(`/blog/posts/${encodeURIComponent(column)}/${encodeURIComponent(slug)}${preview ? `?preview=${encodeURIComponent(preview)}` : ""}`);

/** 短網址 /blog/p/<id> 指向的正式網址。 */
export const resolveShortLink = (id: string) => get<{ column: string; slug: string }>(`/blog/p/${encodeURIComponent(id)}`);

/** 欄目在這個語言的名字；沒有這一語就退回正體、再退回任何一個，都沒有就用網址上的代號。 */
export function columnName(column: BlogColumn | undefined, locale: string, fallback = ""): string {
  if (!column) return fallback;
  return column.name[locale] || column.name["zh-Hant"] || Object.values(column.name).find(Boolean) || column.slug;
}

export const postPath = (p: { columnSlug: string; slug: string }) => `/blog/${p.columnSlug}/${p.slug}`;

// ---- 管理（/v1/blog/admin）：manager／owner 才進得去，權限由服務端判 ----------------------

export const POST_LOCALES = ["zh-Hant", "zh-Hans", "en", "ja", "ko"] as const;
export type PostStatus = "draft" | "pending_review" | "published" | "unpublished";
export interface AdminPostRow {
  id: string; columnId: string; columnSlug: string; slug: string; locale: string; title: string; status: PostStatus; publishAt: number | null;
  firstPublishedAt: number | null; pinned: boolean; commentsClosed: boolean; version: number; updatedAt: number; authorHandle: string;
  /** 最後一次存內容的人（公開 ID）；狀態變更不算 */
  editorHandle?: string;
}
export interface AdminPost extends AdminPostRow {
  excerpt: string; bodyMd: string; coverKey: string | null; coverUrl: string | null; shareTitle: string | null; shareDescription: string | null;
  shareCoverKey: string | null; shareCoverUrl: string | null; campaignId: string | null; pinnedCommentId: string | null; createdAt: number;
}
export interface PostInput {
  columnId: string; slug: string; locale: string; title: string; excerpt: string; bodyMd: string; coverKey: string | null;
  shareTitle: string | null; shareDescription: string | null; shareCoverKey: string | null; campaignId: string | null;
}
export type StateChange = { status: "published"; publishAt?: number } | { status: "unpublished" } | { pinned: boolean } | { commentsClosed: boolean };
export interface Revision { id: string; editorHandle: string; title: string; createdAt: number }

/** 表單上對應錯誤欄位的標籤；沒列到的欄位講通用的那句。 */
const FIELD_LABEL: Record<string, string> = {
  title: "blog.admin.postTitle", slug: "blog.admin.slug", columnId: "blog.admin.columns", excerpt: "blog.admin.excerpt", bodyMd: "blog.admin.body",
  shareTitle: "blog.admin.shareTitle", shareDescription: "blog.admin.shareDescription", campaignId: "blog.admin.campaign", name: "blog.admin.columnName",
  description: "blog.admin.columnDescription", sort: "blog.admin.sort", locale: "blog.admin.locale", coverKey: "blog.admin.cover",
  shareCoverKey: "blog.admin.shareCover", publishAt: "blog.admin.schedule",
};
const CODE_MESSAGE: Record<string, string> = {
  blog_write_forbidden: "blog.admin.managersOnly", blog_version_conflict: "blog.admin.conflict", blog_slug_taken: "blog.admin.slugTaken", blog_column_slug_taken: "blog.admin.columnSlugTaken",
  blog_preview_unavailable: "blog.admin.previewUnavailable", blog_image_invalid: "blog.admin.uploadFailed", blog_image_unavailable: "blog.admin.uploadFailed",
};

async function admin<T>(token: string, path: string, method = "GET", body?: unknown): Promise<T> {
  const json = body !== undefined && !(body instanceof FormData);
  const res = await fetch(`${COMMUNITY_API}/blog/admin${path}`, {
    method,
    headers: { "X-From": currentSurface(), "X-Provider": currentProvider(), Authorization: `Bearer ${token}`, ...(json ? { "Content-Type": "application/json" } : {}) },
    body: json ? JSON.stringify(body) : (body as FormData | undefined),
  });
  if (!res.ok) {
    const b = (await res.json().catch(() => ({}))) as { error?: string; field?: string };
    const code = b.error ?? "";
    const t = i18n.global.t;
    const label = FIELD_LABEL[b.field ?? ""];
    const message = code === "blog_invalid"
      ? label ? t("blog.admin.invalid", { field: t(label) }) : t("blog.admin.invalidAny")
      : CODE_MESSAGE[code] ? t(CODE_MESSAGE[code]!) : describeApiError(res.status, code);
    throw new ApiError(res.status, message, code);
  }
  return (await res.json()) as T;
}

export const fetchAdminPosts = (token: string, q: { status?: string; column?: string; page: number }) =>
  admin<{ total: number; items: AdminPostRow[] }>(token, `/posts?${new URLSearchParams({ ...(q.status ? { status: q.status } : {}), ...(q.column ? { column: q.column } : {}), page: String(q.page) })}`);
export const fetchAdminPost = (token: string, id: string) => admin<AdminPost>(token, `/posts/${encodeURIComponent(id)}`);
/** 沒有 id 是新文章；有 id 要帶上次讀到的版本號，別人先存過會回 blog_version_conflict。 */
export const savePost = (token: string, input: PostInput, operationId: string, id?: string, expectedVersion?: number) =>
  id ? admin<AdminPost>(token, `/posts/${encodeURIComponent(id)}`, "PUT", { ...input, expectedVersion, operationId }) : admin<AdminPost>(token, "/posts", "POST", { ...input, operationId });
export const setPostState = (token: string, id: string, change: StateChange, operationId: string) =>
  admin<AdminPost>(token, `/posts/${encodeURIComponent(id)}/state`, "POST", { change, operationId });
export const fetchRevisions = (token: string, id: string) => admin<{ items: Revision[] }>(token, `/posts/${encodeURIComponent(id)}/revisions`);
export const fetchRevision = (token: string, id: string, rev: string) =>
  admin<Revision & { bodyMd: string }>(token, `/posts/${encodeURIComponent(id)}/revisions/${encodeURIComponent(rev)}`);
export const restoreRevision = (token: string, id: string, rev: string, operationId: string) =>
  admin<AdminPost>(token, `/posts/${encodeURIComponent(id)}/revisions/${encodeURIComponent(rev)}/restore`, "POST", { operationId });
export const createPreview = (token: string, id: string) => admin<{ token: string; url: string }>(token, `/posts/${encodeURIComponent(id)}/preview`, "POST", {});
export const fetchAdminColumns = (token: string) => admin<{ items: BlogColumn[] }>(token, "/columns");
export const saveColumn = (token: string, input: Omit<BlogColumn, "id"> & { id?: string }, operationId: string) => {
  const { id, ...rest } = input;
  return id ? admin<BlogColumn>(token, `/columns/${encodeURIComponent(id)}`, "PUT", { ...rest, operationId }) : admin<BlogColumn>(token, "/columns", "POST", { ...rest, operationId });
};
export function uploadBlogImage(token: string, file: File) {
  const form = new FormData();
  form.append("file", file);
  return admin<{ key: string; url: string }>(token, "/images", "POST", form);
}

/** 圖片 key（blog/<uuid>.webp）的公開網址，跟服務端 imageUrl 同一個規則。 */
export const imageUrlOf = (key: string | null) => (key ? `${COMMUNITY_API}/blog/images/${key.slice("blog/".length)}` : null);

/** 發布了但時間還沒到＝排程中；其餘照存的狀態。 */
export const displayStatus = (p: { status: string; publishAt: number | null }, now = Date.now()) =>
  p.status === "published" && p.publishAt !== null && p.publishAt > now ? "scheduled" : p.status;
