import { COMMUNITY_API, UPSTREAM_API } from "./config";
import { i18n } from "./i18n";
import type { Author, AuthorSort, CardPage, CommunityCard, MyRole, Sort, Zone } from "./types";

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    throw new ApiError(res.status, body.error ?? body.message ?? i18n.global.t("state.requestFailed", { status: res.status }));
  }
  return (await res.json()) as T;
}

const authHeaders = (token?: string): Record<string, string> =>
  token ? { Authorization: `Bearer ${token}` } : {};

// ---- 社群 API（同源）------------------------------------------------------

export interface BoardQuery { zone?: Zone | "all"; q?: string; tag?: string; sort?: Sort; author?: number; limit?: number; offset?: number; lang?: string }

export async function fetchBoard(query: BoardQuery = {}): Promise<CardPage> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== "") params.set(k, String(v));
  return json<CardPage>(await fetch(`${COMMUNITY_API}/cards?${params}`));
}

export async function fetchCard(id: string, lang?: string): Promise<CommunityCard> {
  const q = lang ? `?lang=${encodeURIComponent(lang)}` : "";
  return json<CommunityCard>(await fetch(`${COMMUNITY_API}/cards/${encodeURIComponent(id)}${q}`));
}

/** 這一區最常見的標籤，給榜單的類型篩選列。 */
export async function fetchTags(zone: Zone | "all"): Promise<{ tag: string; n: number }[]> {
  const res = await json<{ items: { tag: string; n: number }[] }>(await fetch(`${COMMUNITY_API}/tags?zone=${zone}`));
  return res.items;
}

export interface AuthorPage { items: Author[]; hasNext: boolean; limit: number; offset: number; sort: AuthorSort }

export async function fetchAuthors(query: { zone?: Zone | "all"; q?: string; sort?: AuthorSort; limit?: number; offset?: number } = {}): Promise<AuthorPage> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== "") params.set(k, String(v));
  return json<AuthorPage>(await fetch(`${COMMUNITY_API}/authors?${params}`));
}

export async function fetchAuthor(accountNumId: number): Promise<Author> {
  return json<Author>(await fetch(`${COMMUNITY_API}/authors/${accountNumId}`));
}

/** 登記只送 roleId：內容由服務端自己去上游取，作者塞不進任何欄位。 */
export async function registerCard(roleId: string, token: string): Promise<CommunityCard> {
  return json<CommunityCard>(
    await fetch(`${COMMUNITY_API}/cards`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders(token) },
      body: JSON.stringify({ roleId }),
    }),
  );
}

export async function unregisterCard(roleId: string, token: string): Promise<void> {
  const res = await fetch(`${COMMUNITY_API}/cards/${encodeURIComponent(roleId)}`, {
    method: "DELETE",
    headers: authHeaders(token),
  });
  if (!res.ok && res.status !== 204) await json(res);
}

// ---- 上游開放 API（跨網域）---------------------------------------------------

export interface Me { accountNumId: number; nickName: string; avatar: string }

export interface MyCard {
  roleId: string;
  zone: Zone | "all";
  name: string;
  summary: string;
  avatarUrl: string | null;
  visibility: string;
  talkNum: number;
  registered: boolean;
}

export interface MyCardPage {
  items: MyCard[];
  /** 一共有幾張。看「已登記」那組時是 null——那條路不問上游，也就不知道這個數字。 */
  total: number | null;
  /** 已登記幾張。全域的數字，不是這一頁數出來的。 */
  registeredTotal: number;
  page: number;
  pageSize: number;
  hasNext: boolean;
}

/**
 * 作者自己的卡片。走本站的 API 而不是直接打上游——伺服器端才有地方放邊緣快取，
 * 也才能把回應裁到只剩畫面需要的欄位。
 *
 * fresh：剛改過卡之後帶上，繞過快取。前端知道自己寫過，比任何 TTL 都準。
 */
export async function fetchMyCards(
  token: string,
  opts: { page?: number; pageSize?: number; fresh?: boolean; filter?: "all" | "listed" | "unlisted" } = {},
): Promise<MyCardPage> {
  const params = new URLSearchParams();
  if (opts.page) params.set("page", String(opts.page));
  if (opts.pageSize) params.set("pageSize", String(opts.pageSize));
  if (opts.fresh) params.set("fresh", "1");
  if (opts.filter && opts.filter !== "all") params.set("filter", opts.filter);
  return json<MyCardPage>(
    await fetch(`${COMMUNITY_API}/me/cards?${params}`, { headers: authHeaders(token) }),
  );
}

export async function fetchMe(token: string): Promise<Me> {
  return json<Me>(await fetch(`${UPSTREAM_API}/open/v1/me`, { headers: authHeaders(token) }));
}

/** 角色卡詳情。未登入的訪客也讀得到，所以 token 是選填的。 */
export async function fetchRoleDetail(roleId: string, token?: string, lang = "zh-Hans"): Promise<Record<string, unknown>> {
  return json<Record<string, unknown>>(
    await fetch(`${UPSTREAM_API}/open/v1/role/detail?roleId=${encodeURIComponent(roleId)}`, {
      headers: { language: lang, ...authHeaders(token) },
    }),
  );
}

// ---- 角色主頁：作者裝修過的版面 --------------------------------------------------

export interface PreviewPage { doc: unknown; version: number; skinId?: string }

/** 沒裝修或還沒過審時 doc 是 null，那就用預設版面。 */
export async function fetchPreviewPage(roleId: string): Promise<PreviewPage> {
  return json<PreviewPage>(await fetch(`${UPSTREAM_API}/open/v1/role/preview-page?roleId=${encodeURIComponent(roleId)}`));
}

// ---- 評論：跟作品所在的服務共用同一個評論池 -----------------------------------------

export interface Comment {
  commentId: string;
  content: string;
  parentId: string;
  rootId: string;
  replyToNickName: string;
  likeCount: number;
  replyCount: number;
  isPinned: boolean;
  isCreatorReply: boolean;
  createTime: string;
  accountNickName: string;
  accountAvatar: string;
  accountNumId: number;
  isLiked: boolean;
  isOwner: boolean;
  isCreator: boolean;
  canDelete: boolean;
  replies?: Comment[];
}

export async function fetchComments(roleId: string, page: number, lang: string, token?: string) {
  const q = `roleId=${encodeURIComponent(roleId)}&pageNum=${page}&pageSize=20`;
  return json<{ total: number; comments: Comment[]; isRoleCreator: boolean }>(
    await fetch(`${UPSTREAM_API}/open/v1/comment/list?${q}`, { headers: { language: lang, ...authHeaders(token) } }),
  );
}

export async function fetchReplies(roleId: string, rootId: string, page: number, lang: string, token?: string) {
  const q = `roleId=${encodeURIComponent(roleId)}&rootId=${encodeURIComponent(rootId)}&pageNum=${page}&pageSize=20`;
  return json<{ total: number; replies: Comment[] }>(
    await fetch(`${UPSTREAM_API}/open/v1/comment/replies?${q}`, { headers: { language: lang, ...authHeaders(token) } }),
  );
}

export async function createComment(
  body: { roleId: string; content: string; parentId?: string; rootId?: string; replyToNickName?: string },
  token: string,
  lang: string,
): Promise<{ commentId: string }> {
  return json<{ commentId: string }>(
    await fetch(`${UPSTREAM_API}/open/v1/comment`, {
      method: "POST",
      headers: { "Content-Type": "application/json", language: lang, ...authHeaders(token) },
      body: JSON.stringify(body),
    }),
  );
}

export async function deleteComment(commentId: string, roleId: string, token: string): Promise<void> {
  await json(await fetch(`${UPSTREAM_API}/open/v1/comment/delete`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({ commentId, roleId }),
  }));
}

export async function likeComment(commentId: string, like: boolean, token: string): Promise<void> {
  await json(await fetch(`${UPSTREAM_API}/open/v1/comment/like`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({ commentId, action: like ? "like" : "unlike" }),
  }));
}

export interface RoleDraft {
  roleName?: string;
  roleDesc?: string;
  roleDetailDesc?: string;
  roleTag?: string[];
  userName?: string;
}

/** 建立一張私有卡。建好之後仍要作者自己決定要不要登記上榜。 */
export async function createRole(draft: { roleName: string; language?: string }, token: string): Promise<{ roleId?: string }> {
  return json<{ roleId?: string }>(
    await fetch(`${UPSTREAM_API}/open/v1/role`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders(token) },
      body: JSON.stringify(draft),
    }),
  );
}

/** 只送有改動的欄位：沒送的區塊上游不會碰，避免空值洗掉原本的內容。 */
export async function patchRole(roleId: string, patch: RoleDraft, token: string): Promise<unknown> {
  return json<unknown>(
    await fetch(`${UPSTREAM_API}/open/v1/role/${encodeURIComponent(roleId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...authHeaders(token) },
      body: JSON.stringify(patch),
    }),
  );
}

// ---- 錢包：積分、會員、流水（都是呼叫者自己的；充值在原站完成）------------------

export type PlanTier = "unlimited" | "member" | "trial";
export interface Wallet {
  score: number;
  tempScore: number;
  plans: { tier: PlanTier; expiresAt: number }[];
}

export async function fetchWallet(token: string): Promise<Wallet> {
  return json<Wallet>(await fetch(`${UPSTREAM_API}/open/v1/me/wallet`, { headers: authHeaders(token) }));
}

export interface ScoreRecord {
  id: number;
  record: string;
  recordType: "add" | "sub" | string;
  score: number;
  createTime: string;
}
export interface ScoreRecordPage {
  total: number;
  pages: number;
  hasNextPage: boolean;
  records: ScoreRecord[];
}

export async function fetchScoreRecords(token: string, page = 1, pageSize = 20): Promise<ScoreRecordPage> {
  return json<ScoreRecordPage>(
    await fetch(`${UPSTREAM_API}/open/v1/me/score/records?pageNum=${page}&pageSize=${pageSize}`, {
      headers: authHeaders(token),
    }),
  );
}

/** 原站的充值頁。本站不碰付款，只把人送過去。 */
export const TOP_UP_URL = `${UPSTREAM_API.replace("api.", "")}/pages/mine/vippay`;
