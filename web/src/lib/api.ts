import { COMMUNITY_API, UPSTREAM_API } from "./config";
import type { Author, CardPage, CommunityCard, MyRole, Sort } from "./types";

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    throw new ApiError(res.status, body.error ?? body.message ?? `請求失敗（${res.status}）`);
  }
  return (await res.json()) as T;
}

const authHeaders = (token?: string): Record<string, string> =>
  token ? { Authorization: `Bearer ${token}` } : {};

// ---- 社群 API（同源）------------------------------------------------------

export interface BoardQuery { q?: string; tag?: string; sort?: Sort; author?: number; limit?: number; offset?: number; lang?: string }

export async function fetchBoard(query: BoardQuery = {}): Promise<CardPage> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== "") params.set(k, String(v));
  return json<CardPage>(await fetch(`${COMMUNITY_API}/cards?${params}`));
}

export async function fetchCard(id: string, lang?: string): Promise<CommunityCard> {
  const q = lang ? `?lang=${encodeURIComponent(lang)}` : "";
  return json<CommunityCard>(await fetch(`${COMMUNITY_API}/cards/${encodeURIComponent(id)}${q}`));
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
  name: string;
  summary: string;
  avatarUrl: string | null;
  visibility: string;
  talkNum: number;
  registered: boolean;
}

export interface MyCardPage {
  items: MyCard[];
  total: number;
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
  opts: { page?: number; pageSize?: number; fresh?: boolean } = {},
): Promise<MyCardPage> {
  const params = new URLSearchParams();
  if (opts.page) params.set("page", String(opts.page));
  if (opts.pageSize) params.set("pageSize", String(opts.pageSize));
  if (opts.fresh) params.set("fresh", "1");
  return json<MyCardPage>(
    await fetch(`${COMMUNITY_API}/me/cards?${params}`, { headers: authHeaders(token) }),
  );
}

export async function fetchMe(token: string): Promise<Me> {
  return json<Me>(await fetch(`${UPSTREAM_API}/open/v1/me`, { headers: authHeaders(token) }));
}

/** 角色卡詳情。未登入的訪客也讀得到，所以 token 是選填的。 */
export async function fetchRoleDetail(roleId: string, token?: string): Promise<Record<string, unknown>> {
  return json<Record<string, unknown>>(
    await fetch(`${UPSTREAM_API}/open/v1/role/detail?roleId=${encodeURIComponent(roleId)}`, {
      headers: { language: "zh-Hans", ...authHeaders(token) },
    }),
  );
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
