import { COMMUNITY_API, UPSTREAM_API } from "./config";
import { currentSurface } from "./track";
import { i18n } from "./i18n";
import type { Author, AuthorSort, CardPage, CommunityCard, MyRole, Sort, Zone } from "./types";
import type { RoleDocumentFields, TalkExampleEntry, WorldbookEntryDraft } from "./role-draft";

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/**
 * 錯誤訊息給人看，不給狀態碼。伺服器回的原文是英文的內部字串（card not found），
 * 對五種語言的使用者都沒有意義；按狀態碼翻成他的語言，原文只在開發時附在後面。
 */
const ERROR_KEY: Record<number, string> = { 401: "auth.expired", 403: "state.forbidden", 404: "state.notFound" };

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    const key = ERROR_KEY[res.status] ?? (res.status >= 500 ? "state.serverBusy" : "state.requestFailed");
    const msg = i18n.global.t(key);
    const raw = body.error ?? body.message;
    throw new ApiError(res.status, import.meta.env.DEV && raw ? `${msg} (${raw})` : msg);
  }
  return (await res.json()) as T;
}

const authHeaders = (token?: string): Record<string, string> =>
  token ? { Authorization: `Bearer ${token}` } : {};

/**
 * 「這個請求是從哪一頁發的」。
 *
 * SPA 的站內跳轉不產生文件請求，而同源 fetch 帶的 Referer 是當前頁自己的網址——所以服務端
 * 沒有任何辦法知道使用者是從榜單、搜尋還是分享連結走到這張卡的。顯式送一個頭是唯一的解法。
 *
 * 不影響邊緣快取：快取鍵是 URL，而存進去的回應沒有設 Vary，所以請求頭不參與比對。
 */
const from = (): Record<string, string> => ({ "X-From": currentSurface() });

// ---- 社群 API（同源）------------------------------------------------------

export interface BoardQuery { zone?: Zone | "all"; q?: string; tag?: string; sort?: Sort; author?: number; limit?: number; offset?: number; lang?: string }

export async function fetchBoard(query: BoardQuery = {}): Promise<CardPage> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== "") params.set(k, String(v));
  return json<CardPage>(await fetch(`${COMMUNITY_API}/cards?${params}`, { headers: from() }));
}

export async function fetchCard(id: string, lang?: string): Promise<CommunityCard> {
  const q = lang ? `?lang=${encodeURIComponent(lang)}` : "";
  return json<CommunityCard>(await fetch(`${COMMUNITY_API}/cards/${encodeURIComponent(id)}${q}`, { headers: from() }));
}

/** 這一區最常見的標籤，給榜單的類型篩選列。 */
export async function fetchTags(zone: Zone | "all"): Promise<{ tag: string; n: number }[]> {
  const res = await json<{ items: { tag: string; n: number }[] }>(await fetch(`${COMMUNITY_API}/tags?zone=${zone}`, { headers: from() }));
  return res.items;
}

export interface AuthorPage { items: Author[]; hasNext: boolean; limit: number; offset: number; sort: AuthorSort }

export async function fetchAuthors(query: { zone?: Zone | "all"; q?: string; sort?: AuthorSort; limit?: number; offset?: number } = {}): Promise<AuthorPage> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== "") params.set(k, String(v));
  return json<AuthorPage>(await fetch(`${COMMUNITY_API}/authors?${params}`, { headers: from() }));
}

export async function fetchAuthor(accountNumId: number): Promise<Author> {
  return json<Author>(await fetch(`${COMMUNITY_API}/authors/${accountNumId}`, { headers: from() }));
}

/** 登記只送 roleId：內容由服務端自己去上游取，作者塞不進任何欄位。 */
export async function registerCard(roleId: string, token: string): Promise<CommunityCard> {
  return json<CommunityCard>(
    await fetch(`${COMMUNITY_API}/cards`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...from(), ...authHeaders(token) },
      body: JSON.stringify({ roleId }),
    }),
  );
}

export async function unregisterCard(roleId: string, token: string): Promise<void> {
  const res = await fetch(`${COMMUNITY_API}/cards/${encodeURIComponent(roleId)}`, {
    method: "DELETE",
    headers: { ...from(), ...authHeaders(token) },
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
    await fetch(`${COMMUNITY_API}/me/cards?${params}`, { headers: { ...from(), ...authHeaders(token) } }),
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

// ---- 建卡工作台：上游的寫入面 ------------------------------------------------

/** 上游回的欄位上限與阻斷項。前端拿它畫字數計數與送審前的檢查清單。 */
export interface ValidationReport {
  status: string;
  blockers: string[];
  warnings: string[];
  tokenBudget?: {
    limits?: {
      roleDescMaxChars?: number;
      roleDetailDescMaxChars?: number;
      roleWelcomeMaxChars?: number;
      roleOutputContractMaxChars?: number;
      jailbreakMaxChars?: number;
    };
  };
}

const writeHeaders = (token: string): Record<string, string> => ({
  "Content-Type": "application/json",
  ...authHeaders(token),
});

/** 一次寫入表單上的所有欄位。沒送的欄位上游完全不碰。 */
export async function patchRoleDocument(roleId: string, fields: RoleDocumentFields, token: string): Promise<unknown> {
  return json<unknown>(
    await fetch(`${UPSTREAM_API}/open/v1/role/${encodeURIComponent(roleId)}/document`, {
      method: "POST",
      headers: writeHeaders(token),
      body: JSON.stringify({ fields }),
    }),
  );
}

/**
 * 開場白正文 + 備選開場白 + 開場選項。
 *
 * 後兩者是全量覆寫：不傳＝不動，傳空陣列＝清空。所以呼叫端一定要把當前的完整清單送上，
 * 只送正文的話上游不會動它們，但只送一半就會少掉。
 */
export async function patchRoleWelcome(
  roleId: string,
  patch: { roleWelcome: string; alternates: string[]; prologue: string[] },
  token: string,
): Promise<unknown> {
  return json<unknown>(
    await fetch(`${UPSTREAM_API}/open/v1/role/${encodeURIComponent(roleId)}/welcome`, {
      method: "PATCH",
      headers: writeHeaders(token),
      body: JSON.stringify(patch),
    }),
  );
}

export async function fetchRoleValidation(roleId: string, token: string): Promise<ValidationReport> {
  return json<ValidationReport>(
    await fetch(`${UPSTREAM_API}/open/v1/role/validate?roleId=${encodeURIComponent(roleId)}`, {
      headers: authHeaders(token),
    }),
  );
}

/** 送審。確認摘要是給審核方看的，上游要求至少 8 個字，所以不能送空字串。 */
export async function submitRoleForReview(
  roleId: string,
  confirmationSummary: string,
  token: string,
): Promise<{ reviewStatus?: string }> {
  return json<{ reviewStatus?: string }>(
    await fetch(`${UPSTREAM_API}/open/v1/role/${encodeURIComponent(roleId)}/publish`, {
      method: "POST",
      headers: writeHeaders(token),
      body: JSON.stringify({ userConfirmed: true, confirmationSummary }),
    }),
  );
}

/** 已公開的卡收回私有，好讓作者能再編輯。轉公開只能走送審，上游會擋。 */
export async function unpublishRole(roleId: string, token: string): Promise<unknown> {
  return json<unknown>(
    await fetch(`${UPSTREAM_API}/open/v1/role/${encodeURIComponent(roleId)}/visibility`, {
      method: "POST",
      headers: writeHeaders(token),
      body: JSON.stringify({ visibility: "private" }),
    }),
  );
}

/**
 * 上傳圖片，拿回一個網址。
 *
 * 送的是 bytes 不是網址：型別與大小上限只有服務端擋得住，前端校驗繞得過去，而且
 * 客戶端塞任意外部網址進圖庫等於開一個盜連面。roleId 是選填的——建立中的卡還沒有 id。
 */
export async function uploadImage(file: File, token: string, roleId?: string): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  if (roleId) form.append("roleId", roleId);
  const res = await fetch(`${UPSTREAM_API}/open/v1/image/upload`, {
    method: "POST",
    headers: authHeaders(token),
    body: form,
  });
  const body = await json<{ data?: { imageUrl?: string; url?: string } }>(res);
  const url = body.data?.imageUrl ?? body.data?.url ?? "";
  if (!url) throw new ApiError(res.status, i18n.global.t("state.uploadFailed"));
  return url;
}

// ---- 世界書 ------------------------------------------------------------------

export interface WorldbookSummary {
  worldbookId: string;
  name: string;
  description: string;
  entryCount: number;
}

export async function fetchMyWorldbooks(token: string, q = ""): Promise<WorldbookSummary[]> {
  const params = new URLSearchParams({ pageSize: "50" });
  if (q) params.set("q", q);
  const body = await json<{ worldbooks?: WorldbookSummary[] }>(
    await fetch(`${UPSTREAM_API}/open/v1/worldbook/mine?${params}`, { headers: authHeaders(token) }),
  );
  return body.worldbooks ?? [];
}

/**
 * 這張卡綁了哪些世界書。
 *
 * 綁定關係只有上游知道。拿世界書的名字去跟角色名比對是猜的：會綁錯本，或一本都找不到，
 * 而且錯得無聲無息——作者編了半天存下去，發現改的是另一張卡的設定。
 */
export async function fetchRoleWorldbooks(roleId: string, token: string): Promise<WorldbookSummary[]> {
  const body = await json<{ bindings?: { worldbookId: string; name?: string; entryCount?: number }[] }>(
    await fetch(`${UPSTREAM_API}/open/v1/worldbook/bindings?roleId=${encodeURIComponent(roleId)}`, {
      headers: authHeaders(token),
    }),
  );
  return (body.bindings ?? []).map((b) => ({
    worldbookId: b.worldbookId,
    name: b.name ?? "",
    description: "",
    entryCount: b.entryCount ?? 0,
  }));
}

/** 上游把關鍵詞存成 JSON 字串（`'["a","b"]'`），也可能已經是陣列。兩種都要吃得下。 */
export function readKeywordList(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((k) => String(k).trim()).filter(Boolean);
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map((k) => String(k).trim()).filter(Boolean) : [];
  } catch {
    return raw.split(/[,，、\n]+/).map((k) => k.trim()).filter(Boolean);
  }
}

/**
 * 條目清單。上游這條路回的是 `{ list: [...] }`，關鍵詞是 JSON 字串——
 * 第一版讀的是 `entries` 與陣列，於是編輯頁永遠看到零條（線上實測 2026-09-06 抓到的）。
 */
export async function fetchWorldbookEntries(worldbookId: string, token: string): Promise<WorldbookEntryDraft[]> {
  type Row = Omit<WorldbookEntryDraft, "keywords"> & { keywords?: unknown };
  const body = await json<{ list?: Row[]; entries?: Row[] }>(
    await fetch(`${UPSTREAM_API}/open/v1/worldbook/entry/list?worldbookId=${encodeURIComponent(worldbookId)}`, {
      headers: authHeaders(token),
    }),
  );
  return (body.list ?? body.entries ?? []).map((entry) => ({
    entryId: entry.entryId,
    name: entry.name ?? "",
    content: entry.content ?? "",
    keywords: readKeywordList(entry.keywords),
    isEnabled: entry.isEnabled !== false,
    isConstant: entry.isConstant === true,
  }));
}

export async function createWorldbook(
  book: { name: string; description?: string; language?: string },
  token: string,
): Promise<string> {
  const body = await json<{ worldbookId?: string }>(
    await fetch(`${UPSTREAM_API}/open/v1/worldbook`, {
      method: "POST",
      headers: writeHeaders(token),
      body: JSON.stringify(book),
    }),
  );
  if (!body.worldbookId) throw new ApiError(500, i18n.global.t("state.saveFailed"));
  return body.worldbookId;
}

export interface WorldbookDocumentEntry {
  op: "create" | "update" | "delete";
  entryId?: string;
  name?: string;
  content?: string;
  keywords?: string[];
  isEnabled?: boolean;
  isConstant?: boolean;
}

/**
 * 一次寫入條目的增刪改與角色綁定。
 *
 * 逐條建立的話，中途失敗會留下一本只有一半條目的世界書，而作者看不出少了哪幾條。
 */
export async function patchWorldbookDocument(
  worldbookId: string,
  document: { entries?: WorldbookDocumentEntry[]; binding?: { roleId: string } },
  token: string,
): Promise<unknown> {
  return json<unknown>(
    await fetch(`${UPSTREAM_API}/open/v1/worldbook/${encodeURIComponent(worldbookId)}/document`, {
      method: "POST",
      headers: writeHeaders(token),
      body: JSON.stringify(document),
    }),
  );
}

export type { TalkExampleEntry };
