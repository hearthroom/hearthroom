import { COMMUNITY_API, UPSTREAM_API } from "./config";
import { currentSurface } from "./track";
import { i18n } from "./i18n";
import type { Author, AuthorSort, CardPage, CommunityCard, MyRole, Sort, Zone } from "./types";
import type { RoleDocumentFields, TalkExampleEntry, WorldbookEntryDraft } from "./role-draft";

export class ApiError extends Error {
  /** 上游回的穩定錯誤碼（例如 image_in_use）。畫面要分情況說話時看它，不看訊息文字。 */
  constructor(readonly status: number, message: string, readonly code = "") {
    super(message);
  }
}

/**
 * 錯誤訊息給人看，不給狀態碼。伺服器回的原文是英文的內部字串（card not found），
 * 對五種語言的使用者都沒有意義；按狀態碼翻成他的語言，原文只在開發時附在後面。
 */
const ERROR_KEY: Record<number, string> = { 401: "auth.expired", 403: "state.forbidden", 404: "state.notFound" };

/**
 * 上游回的穩定錯誤碼裡，使用者做得了事的那幾個各給一句人話。沒列到的碼照狀態碼講，
 * 但把碼附在後面——只講「請求失敗」的話，使用者連該改哪裡、該回報什麼都不知道
 * （2026-09-07 一位作者存卡失敗，畫面只有「請求失敗」，他以為是名字太長）。
 */
const CODE_KEY: Record<string, string> = {
  invalid_arguments: "error.invalidArguments",
  invalid_argument: "error.invalidArguments",
  role_in_review: "error.roleInReview",
  visibility_requires_review: "error.visibilityRequiresReview",
  public_role_requires_clone: "error.publicRoleRequiresClone",
  permission_denied: "state.forbidden",
  not_found: "state.notFound",
};
/** 本站自己的 API 回的碼（不是供應商契約的一部分，所以不進 docs/provider-protocol.md）。 */
const SITE_CODE_KEY: Record<string, string> = {
  adult_content: "card.gate.title",
  nsfw_required: "error.nsfwRequired",
  birthdate_required: "error.birthdateRequired",
  invalid_birthdate: "error.invalidBirthdate",
  underage: "error.underage",
  age_verification_required: "error.ageVerificationRequired",
};
const looksLikeCode = (raw: string): boolean => /^[a-z][a-z0-9_]*$/.test(raw);

export function describeApiError(status: number, raw: string): string {
  const text = (raw || "").trim();
  if (text && (CODE_KEY[text] || SITE_CODE_KEY[text])) return i18n.global.t((CODE_KEY[text] ?? SITE_CODE_KEY[text])!);
  // 不是錯誤碼的就是伺服器寫給人看的句子（例如內容審核的原因），原樣講。
  if (text && !looksLikeCode(text)) return text;
  const msg = i18n.global.t(ERROR_KEY[status] ?? (status >= 500 ? "state.serverBusy" : "state.requestFailed"));
  return text ? `${msg} (${text})` : msg;
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    const raw = body.error ?? body.message ?? "";
    throw new ApiError(res.status, describeApiError(res.status, raw), body.error ?? "");
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

/**
 * 「看的人開了成人內容嗎」。session 在載好本站身分後把它接上（開了才回 token），登出時拆掉；
 * 這裡不直接 import session，避免 api ↔ session 互相引用。
 * 開了的請求帶 ?nsfw=1 加 token，伺服器驗過才給成人內容，且回應不進邊緣快取。
 */
let nsfwViewer: (() => Promise<string | null>) | null = null;
export function setNsfwViewer(fn: (() => Promise<string | null>) | null): void { nsfwViewer = fn; }
async function viewerAccess(): Promise<{ param: string; headers: Record<string, string> }> {
  const token = nsfwViewer ? await nsfwViewer().catch(() => null) : null;
  return token ? { param: "nsfw=1", headers: authHeaders(token) } : { param: "", headers: {} };
}

// ---- 社群 API（同源）------------------------------------------------------

export interface BoardQuery { zone?: Zone | "all"; q?: string; tag?: string; sort?: Sort; /** 作者的本站公開 ID */ author?: string; limit?: number; offset?: number; lang?: string }

export async function fetchBoard(query: BoardQuery = {}): Promise<CardPage> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== "") params.set(k, String(v));
  const viewer = await viewerAccess();
  if (viewer.param) params.set("nsfw", "1");
  return json<CardPage>(await fetch(`${COMMUNITY_API}/cards?${params}`, { headers: { ...from(), ...viewer.headers } }));
}

export async function fetchCard(id: string, lang?: string): Promise<CommunityCard> {
  const params = new URLSearchParams();
  if (lang) params.set("lang", lang);
  const viewer = await viewerAccess();
  if (viewer.param) params.set("nsfw", "1");
  const q = params.size ? `?${params}` : "";
  return json<CommunityCard>(await fetch(`${COMMUNITY_API}/cards/${encodeURIComponent(id)}${q}`, { headers: { ...from(), ...viewer.headers } }));
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

export async function fetchAuthor(handle: string): Promise<Author> {
  const viewer = await viewerAccess();
  const q = viewer.param ? `?${viewer.param}` : "";
  return json<Author>(await fetch(`${COMMUNITY_API}/authors/${encodeURIComponent(handle)}${q}`, { headers: { ...from(), ...viewer.headers } }));
}

/** 登記只送 roleId：內容由服務端自己去上游取，作者塞不進任何欄位。 */
/** 登記／提交。nsfw 是作者對這張卡的分級宣告，必填（沒宣告伺服器不收）。 */
export async function registerCard(roleId: string, token: string, nsfw: boolean): Promise<CommunityCard> {
  return json<CommunityCard>(
    await fetch(`${COMMUNITY_API}/cards`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...from(), ...authHeaders(token) },
      body: JSON.stringify({ roleId, nsfw }),
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

// ---- 社群審核（同源）--------------------------------------------------------

/** 卡片在本站的審核狀態。approved 才在榜上；其餘只有作者自己在「我的卡片」看得到。 */
export type CardStatus = "pending" | "approved" | "rejected" | "needs_review" | "unshared";

export interface ReviewQueueItem {
  id: string;
  kind: "first" | "re";
  submittedAt: number;
  card: { id: string; roleId: string; name: string; summary: string; avatarUrl: string | null; zone: Zone | "all"; tags: string[] };
  stamps: { approve: number; required: number };
  /** 作者宣告：成人內容 */
  nsfw: boolean;
  claim: "free" | "mine" | "other";
  stampedByMe: boolean;
}

/** 主站的分享讀取回的整份設定（見主站 /open/v1/share/role/detail）。作者身分已在服務端拿掉。 */
export interface ReviewDetail {
  submission: {
    id: string; kind: "first" | "re"; status: string; contentHash: string; submittedAt: number;
    /** 作者宣告：成人內容 */
    nsfw: boolean;
    claimedByMe: boolean; required: number;
    stamps: { verdict: "approve" | "reject"; note: string; at: number }[];
  };
  card: { id: string; roleId: string };
  detail: {
    document: {
      roleName: string; userName: string; roleDesc: string; roleAvatar: string; roleBackground: string;
      roleDetailDesc: string; roleTag: string; roleType: string; roleSex: string; roleSpeech: string;
      language: string; isR18: boolean; jailbreak: string; talkExample: string; roleOutputContract: string;
    };
    greetings: { welcome: string; alternates: string[]; prologue: string[] };
    worldbook: {
      worldbookId: string; name: string; description: string; format: string;
      entries: {
        entryId: string; name: string; content: string; keywords: string[]; secondaryKeywords: string[];
        category: string; isEnabled: boolean; isConstant: boolean; triggerRegion: string;
      }[];
    } | null;
    worldbookAvailable: boolean;
    authorAsset: {
      rules: { id: string; name: string; find: string; replace: string; enabled: boolean }[];
      mountTrigger: string; mountLayer: string; pageMode: string; status: string; version: number;
    };
    hashes: { card: string; welcome: string; worldbook: string; authorAsset: string; content: string };
    costProfile: {
      personaChars: number; worldbookEntryCount: number; worldbookEnabledCount: number; worldbookConstantCount: number;
      worldbookChars: number; worldbookConstantChars: number; estimatedConstantTokens: number; estimatedMaxTokens: number;
    };
  };
}

export async function fetchReviewMe(token: string): Promise<{ reviewer: boolean }> {
  return json(await fetch(`${COMMUNITY_API}/review/me`, { headers: { ...from(), ...authHeaders(token) } }));
}

export async function fetchReviewQueue(token: string, lang?: string): Promise<{ items: ReviewQueueItem[]; claimTtlMs: number }> {
  const q = lang ? `?lang=${encodeURIComponent(lang)}` : "";
  return json(await fetch(`${COMMUNITY_API}/review/queue${q}`, { headers: { ...from(), ...authHeaders(token) } }));
}

async function reviewAction<T>(id: string, action: string, token: string, body?: unknown): Promise<T> {
  const res = await fetch(`${COMMUNITY_API}/review/${encodeURIComponent(id)}/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...from(), ...authHeaders(token) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  return json<T>(res);
}

export const claimReview = (id: string, token: string) => reviewAction<{ id: string; claimedAt: number }>(id, "claim", token);
export const releaseReview = (id: string, token: string) => reviewAction<void>(id, "release", token);
export const stampReview = (id: string, token: string, body: { verdict: "approve" | "reject"; note?: string }) =>
  reviewAction<{ id: string; status: string; cardStatus: CardStatus; stamps: { approve: number; required: number } }>(id, "stamp", token, body);

export async function fetchReviewDetail(id: string, token: string): Promise<ReviewDetail> {
  return json(await fetch(`${COMMUNITY_API}/review/${encodeURIComponent(id)}/detail`, { headers: { ...from(), ...authHeaders(token) } }));
}

// ---- 上游開放 API（跨網域）---------------------------------------------------

export interface Me { accountNumId: number; nickName: string; avatar: string }

/** 登入者在本站的身分（不是供應商那邊的）：公開 ID、加入時間、連結了哪些供應商帳號。 */
export interface SiteMe {
  handle: string;
  memberSince: number;
  reviewer: boolean;
  identities: { provider: string; externalId: number; linkedAt: number }[];
  /** 成人內容開關（要先驗過年齡） */
  showNsfw: boolean;
  ageVerified: boolean;
}

/** 成人內容開關。第一次開要帶生日（YYYY-MM-DD），伺服器只看一眼、不存。 */
export async function updateSiteSettings(input: { showNsfw: boolean; birthdate?: string }, token: string): Promise<{ showNsfw: boolean; ageVerified: boolean }> {
  return json(
    await fetch(`${COMMUNITY_API}/me/settings`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...from(), ...authHeaders(token) },
      body: JSON.stringify(input),
    }),
  );
}

export async function fetchSiteMe(token: string): Promise<SiteMe> {
  return json<SiteMe>(await fetch(`${COMMUNITY_API}/me`, { headers: { ...from(), ...authHeaders(token) } }));
}

export interface MyCard {
  roleId: string;
  zone: Zone | "all";
  name: string;
  summary: string;
  avatarUrl: string | null;
  visibility: string;
  talkNum: number;
  registered: boolean;
  /** 本站的審核狀態；只有 registered 時才有。 */
  status?: CardStatus;
  /** 最近一次駁回給作者的說明。 */
  note?: string;
  /** 作者宣告的分級；只有 registered 時才有。 */
  nsfw?: boolean;
}

export interface ListingQuota {
  limit: number;
  used: number;
  /** 週的起點，毫秒 */
  weekStart: number;
  /** 下週的起點，毫秒；額度在這一刻重置 */
  weekEnd: number;
}

export interface MyCardPage {
  items: MyCard[];
  /** 一共有幾張。看「已登記」那組時是 null——那條路不問上游，也就不知道這個數字。 */
  total: number | null;
  /** 已登記幾張。全域的數字，不是這一頁數出來的。 */
  registeredTotal: number;
  /** 這週的登記額度。週是 UTC 週一到下週一，畫面上換成本地日期顯示。 */
  quota: ListingQuota;
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

/**
 * 建立一張私有卡。建好之後仍要作者自己決定要不要登記上榜。
 *
 * origin 自報「在本站建的」：上游把它記在卡上，本站的「我的卡片」與登記榜單只認這一種，
 * 作者在主站建的卡不會混進來。
 */
export async function createRole(draft: { roleName: string; language?: string }, token: string): Promise<{ roleId?: string }> {
  return json<{ roleId?: string }>(
    await fetch(`${UPSTREAM_API}/open/v1/role`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders(token) },
      body: JSON.stringify({ ...draft, origin: "hearthroom" }),
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

// ---- 使用者設定：遊玩時的人設（上游帳號層級，所有卡共用）-------------------------

export interface PlayerPersona { userName: string; userSex: string; userDefine: string }

export async function fetchPlayerPersona(token: string): Promise<PlayerPersona & { nickName: string; exists: boolean }> {
  const raw = await json<Partial<PlayerPersona> & { nickName?: string; exists?: boolean }>(
    await fetch(`${UPSTREAM_API}/open/v1/player/persona`, { headers: authHeaders(token) }),
  );
  return {
    userName: String(raw.userName || ""), userSex: String(raw.userSex || ""), userDefine: String(raw.userDefine || ""),
    nickName: String(raw.nickName || ""), exists: !!raw.exists,
  };
}

/** 只送動到的欄位：上游每個欄位都是指標，沒送＝不動；空字串是有意義的值（清掉）。 */
export async function savePlayerPersona(patch: Partial<PlayerPersona>, token: string): Promise<PlayerPersona> {
  const raw = await json<Partial<PlayerPersona>>(
    await fetch(`${UPSTREAM_API}/open/v1/player/persona/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders(token) },
      body: JSON.stringify(patch),
    }),
  );
  return { userName: String(raw.userName || ""), userSex: String(raw.userSex || ""), userDefine: String(raw.userDefine || "") };
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
/**
 * 刪掉自己的一張卡。上游連同它的對話、世界書綁定、搜尋索引一起清，不可逆——
 * 呼叫前一定要走過「輸入角色名稱」的確認（CardEditorPage.remove）。
 */
export async function deleteRole(roleId: string, token: string): Promise<void> {
  await json<{ message?: string }>(
    await fetch(`${UPSTREAM_API}/open/v1/role/${encodeURIComponent(roleId)}`, { method: "DELETE", headers: authHeaders(token) }),
  );
}

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
export async function uploadImage(file: File, token: string, roleId?: string, folderIds: string[] = []): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  if (roleId) form.append("roleId", roleId);
  for (const id of folderIds) form.append("folderIds", id);
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
  /**
   * 改書名時要原樣送回去的那幾個欄位。上游的更新是整份覆蓋——只送 name 會把
   * 描述、圖示、標籤、可見性一起清成空的。這條路是唯一帶著 token 又拿得到它們的地方
   * （/worldbook/detail 認的是 accountId 標頭，社群站帶的是 token，讀不到自己的私人書）。
   */
  iconUrl?: string;
  visibility?: string;
  tags?: string;
}

/** 玩家面的作者資產（正則規則、功能欄、簡繁對照）。目前上游要登入才給；沒 token 或被拒就當沒有資產。 */
export interface PlayerAsset {
  rules: unknown[];
  mountTrigger: string;
  mountLayer: string;
  cardFormat?: string;
  variants?: unknown;
}

export async function fetchPlayerAsset(roleId: string, token?: string): Promise<PlayerAsset | null> {
  const res = await fetch(`${UPSTREAM_API}/open/v1/role/author-asset/serve?roleId=${encodeURIComponent(roleId)}`, {
    headers: authHeaders(token),
  });
  if (!res.ok) return null;
  const body = (await res.json().catch(() => null)) as Partial<PlayerAsset> | null;
  if (!body || !Array.isArray(body.rules)) return null;
  return { rules: body.rules, mountTrigger: String(body.mountTrigger ?? ""), mountLayer: String(body.mountLayer ?? ""), cardFormat: body.cardFormat, variants: body.variants ?? null };
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
  type Row = Omit<WorldbookEntryDraft, "keywords" | "secondaryKeywords" | "matchOptions" | "category" | "triggerRegion"> & { keywords?: unknown; secondaryKeywords?: unknown; matchOptions?: unknown; category?: unknown; triggerRegion?: unknown };
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
    secondaryKeywords: readKeywordList(entry.secondaryKeywords),
    // 原生條目是 null；酒館格式的條目帶作者的匹配選項，儲存時原樣送回。
    ...(entry.matchOptions && typeof entry.matchOptions === "object"
      ? { matchOptions: entry.matchOptions as WorldbookEntryDraft["matchOptions"] }
      : {}),
    isEnabled: entry.isEnabled !== false,
    isConstant: entry.isConstant === true,
    category: typeof entry.category === "string" ? entry.category : "",
    triggerRegion: typeof entry.triggerRegion === "string" ? entry.triggerRegion : "",
    ...(typeof entry.activationCount === "number" ? { activationCount: entry.activationCount } : {}),
  }));
}

/** 角色的正則規則文件。沒有規則時 doc 是 null、version 是 0。 */
/**
 * 作者資產：上游對「正則規則 + 功能欄」的稱呼。rules 是逐條「找到→換成」，
 * mountTrigger 是功能欄那串標記，mountLayer 是它掛在哪一層（under = 輸入框之下）。
 * 沒設過回 status=none、version=0。
 */
export interface AuthorAsset {
  rules: unknown[];
  mountTrigger: string;
  mountLayer: string;
  pageMode: string;
  status: string;
  version: number;
}
const asAuthorAsset = (b: Partial<AuthorAsset>): AuthorAsset => ({
  rules: Array.isArray(b.rules) ? b.rules : [],
  mountTrigger: b.mountTrigger ?? "",
  mountLayer: b.mountLayer ?? "",
  pageMode: b.pageMode ?? "",
  status: b.status ?? "none",
  version: b.version ?? 0,
});
export async function fetchAuthorAsset(roleId: string, token: string): Promise<AuthorAsset> {
  return asAuthorAsset(await json<Partial<AuthorAsset>>(
    await fetch(`${UPSTREAM_API}/open/v1/role/author-asset?roleId=${encodeURIComponent(roleId)}`, { headers: authHeaders(token) }),
  ));
}

/** 整份覆寫，帶樂觀鎖（body.version 是讀到的版本）。版本不符上游回 409。 */
export async function saveAuthorAsset(roleId: string, body: Omit<AuthorAsset, "status">, token: string): Promise<AuthorAsset> {
  return asAuthorAsset(await json<Partial<AuthorAsset>>(
    await fetch(`${UPSTREAM_API}/open/v1/role/${encodeURIComponent(roleId)}/author-asset`, {
      method: "PUT",
      headers: writeHeaders(token),
      body: JSON.stringify(body),
    }),
  ));
}

export async function createWorldbook(
  book: { name: string; description?: string; language?: string; format?: "tavern" },
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

/** 整份覆蓋：沒帶到的欄位會被清空，所以改一個欄位也要把其餘的原樣送回。 */
export interface WorldbookMetadataPatch {
  name: string;
  description: string;
  iconUrl: string;
  visibility: string;
  tags: string[];
}

export interface WorldbookDocumentEntry {
  op: "create" | "update" | "delete";
  entryId?: string;
  name?: string;
  content?: string;
  keywords?: string[];
  secondaryKeywords?: string[];
  matchOptions?: WorldbookEntryDraft["matchOptions"];
  isEnabled?: boolean;
  isConstant?: boolean;
  category?: string;
  triggerRegion?: string;
}

/**
 * 一次寫入條目的增刪改與角色綁定。
 *
 * 逐條建立的話，中途失敗會留下一本只有一半條目的世界書，而作者看不出少了哪幾條。
 */
export interface WorldbookPatchResult {
  /** 這次 create 的條目拿到的 id，照送出的順序。 */
  createdEntryIds?: string[];
}

export async function patchWorldbookDocument(
  worldbookId: string,
  document: { metadata?: WorldbookMetadataPatch; entries?: WorldbookDocumentEntry[]; binding?: { roleId: string } },
  token: string,
): Promise<WorldbookPatchResult> {
  return json<WorldbookPatchResult>(
    await fetch(`${UPSTREAM_API}/open/v1/worldbook/${encodeURIComponent(worldbookId)}/document`, {
      method: "POST",
      headers: writeHeaders(token),
      body: JSON.stringify(document),
    }),
  );
}

/**
 * 條目順序。常駐條目每輪有上限，擠不下時上游留的是排在前面的那幾條——
 * 不送這一趟的話順序在上游是全 0，實際留誰退到按條目 id 比大小。
 */
export async function reorderWorldbookEntries(worldbookId: string, entryIds: string[], token: string): Promise<void> {
  await json(
    await fetch(`${UPSTREAM_API}/open/v1/worldbook/${encodeURIComponent(worldbookId)}/entries/reorder`, {
      method: "POST",
      headers: writeHeaders(token),
      body: JSON.stringify({ entryIds }),
    }),
  );
}

export type { TalkExampleEntry };

// ── 素材圖庫（「我的資源」）────────────────────────────────────────
//
// 上游的圖床：作者上傳的圖片與自訂資料夾。網址是公開的 CDN 位址，作者拿去寫進正則規則的
// HTML 裡（狀態欄、頭像框、背景）。回應包在 {code, data} 裡，這裡拆掉。

/** 素材的種類：表名還叫 image，但四種檔都住那裡。 */
export type LibraryKind = "image" | "video" | "audio" | "font";

export interface LibraryImage {
  id: number;
  imageUrl: string;
  kind: LibraryKind;
  mimeType?: string;
  /** 上傳時的位元組數；2026-09 前的存量圖是 0。 */
  byteSize: number;
  /** pending＝審核中、pass＝通過、reject＝被駁回；舊圖是 legacy，當通過看。 */
  moderationState: string;
  pixelWidth: number;
  pixelHeight: number;
  createTime: string;
}

export interface LibraryFolder {
  folderId: string;
  name: string;
  imageCount: number;
}

export interface LibraryPage {
  items: LibraryImage[];
  total: number;
  /** 帳號的張數上限。 */
  quota: number;
  /** 已用容量與容量上限（位元組）。已用只算有記體積的檔。 */
  usedBytes: number;
  byteQuota: number;
}

/** 看哪一組：全部、沒歸進任何資料夾的、某個資料夾。 */
export type LibraryScope = { kind: "all" } | { kind: "unfiled" } | { kind: "folder"; folderId: string };

async function libraryJson<T>(res: Response): Promise<T> {
  const body = await json<{ data?: T }>(res);
  return (body.data ?? {}) as T;
}

function libraryPost(path: string, payload: unknown, token: string): Promise<Response> {
  return fetch(`${UPSTREAM_API}/open/v1/image/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify(payload),
  });
}

/** kind 不給就是全部種類；上游那邊不給才是「只看圖片」，所以這裡一律明說。 */
export async function fetchLibraryImages(scope: LibraryScope, page: number, pageSize: number, token: string, kind: LibraryKind | "all" = "all"): Promise<LibraryPage> {
  const q = new URLSearchParams({ scope: scope.kind, kind, pageNum: String(page), pageSize: String(pageSize) });
  if (scope.kind === "folder") q.set("folderId", scope.folderId);
  const res = await fetch(`${UPSTREAM_API}/open/v1/image/list?${q}`, { headers: authHeaders(token) });
  const data = await libraryJson<{ imageList?: LibraryImage[]; total?: number; quota?: number; usedBytes?: number; byteQuota?: number }>(res);
  return {
    items: (data.imageList ?? []).map((i) => ({ ...i, kind: i.kind || "image", byteSize: Number(i.byteSize ?? 0) })),
    total: Number(data.total ?? 0),
    quota: Number(data.quota ?? 0),
    usedBytes: Number(data.usedBytes ?? 0),
    byteQuota: Number(data.byteQuota ?? 0),
  };
}

export async function fetchLibraryFolders(token: string): Promise<LibraryFolder[]> {
  const res = await fetch(`${UPSTREAM_API}/open/v1/image/folder/list`, { headers: authHeaders(token) });
  return (await libraryJson<{ folders?: LibraryFolder[] }>(res)).folders ?? [];
}

export async function createLibraryFolder(name: string, token: string): Promise<LibraryFolder> {
  return libraryJson<LibraryFolder>(await libraryPost("folder/create", { name }, token));
}

export async function renameLibraryFolder(folderId: string, name: string, token: string): Promise<void> {
  await libraryJson(await libraryPost("folder/rename", { folderId, name }, token));
}

/** 刪資料夾不刪圖：圖回到「未歸檔」。 */
export async function deleteLibraryFolder(folderId: string, token: string): Promise<void> {
  await libraryJson(await libraryPost("folder/delete", { folderId }, token));
}

export async function addImagesToFolder(folderId: string, imageIds: number[], token: string): Promise<void> {
  await libraryJson(await libraryPost("folder/addItems", { folderId, imageIds }, token));
}

export async function removeImagesFromFolder(folderId: string, imageIds: number[], token: string): Promise<void> {
  await libraryJson(await libraryPost("folder/removeItems", { folderId, imageIds }, token));
}

/** 正被某張卡當頭像／背景的圖刪不掉：上游回 image_in_use，畫面照碼說話。 */
export async function deleteLibraryImages(imageIds: number[], token: string): Promise<void> {
  await libraryJson(await libraryPost("delete", { imageIds }, token));
}
