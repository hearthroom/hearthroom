/**
 * 官方部落格的公開讀取（/v1/blog）。形狀照 src/blog-routes.ts：作者一律是官方，不帶成員 id。
 * 留言不在這裡：留言面板用 api.ts 的留言函式，傳 { postId } 就掛到文章上。
 */
import { ApiError, describeApiError } from "./api";
import { COMMUNITY_API } from "./config";
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
