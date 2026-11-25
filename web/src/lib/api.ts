import {formatReviewLength} from './review-length';
import type {ReviewLength, ReviewLengthStatus} from '../../../shared/review-length';
import {parseUpdateIntent,type UpdateIntent} from '../../../shared/card-update';
import {publicationOperationKey as publicationKey,notePublicationOperation} from './publication-operation';
import {retentionParams} from './reward-retention';
import { deviceToken } from "./reward-device";
import { isRating, type Rating, type RatingAnswers, type Topic } from "../../../shared/content-rating";
import { COMMUNITY_API, UPSTREAM_API } from "./config";
import { apiBaseOf, oauthBaseOf, currentProvider, type ProviderId } from "./provider";
import { hideParam } from "./hidden-tags";
import { currentSurface } from "./track";
import { i18n } from "./i18n";
import { dateTime } from "./format";
import { canonicalType } from "./media-type";
import { stateLimitParams, type StatePayload } from "./card-state";
import { rememberCard, rememberCards } from "./card-memory";
import type { Author, AuthorSort, CardPage, CommunityCard, FollowersVisibility, FollowingVisibility, FollowListPage, MyRole, Sort, Zone } from "./types";
import type { CardHonor, Honor } from "./honors";
import type { AnnualBoard } from "../../../shared/annual-honors";
import type { AchievementBoard, AchievementBoardKind } from "../../../shared/achievements";
import type { RoleDocumentFields, TalkExampleEntry, WorldbookEntryDraft } from "./role-draft";

export class ApiError extends Error {
  /** 上游回的穩定錯誤碼（例如 image_in_use）。畫面要分情況說話時看它，不看訊息文字。 */
  /** reason：同一個碼底下更細的原因（例如預設格式錯在哪），上游有給才有。 */
  /** noteInternal：給作者看的說明命中內部字詞（400 author_note_internal）時，命中了哪些類別、在哪一句 */
  constructor(readonly status: number, message: string, readonly code = "", readonly reviewLength?:ReviewLength, readonly reason = "", readonly noteInternal?: AuthorNoteInternal) {
    super(message);
  }
}

/** 400 author_note_internal 的內容：term 是伺服器的類別名，matches 帶原句片段與命中字在片段裡的位置（舊版伺服器沒有 matches） */
export interface AuthorNoteInternal { terms: string[]; matches: { term: string; snippet: string; start: number; length: number }[] }

/**
 * 錯誤訊息給人看，不給狀態碼。伺服器回的原文是英文的內部字串（card not found），
 * 對五種語言的使用者都沒有意義；按狀態碼翻成他的語言，原文只在開發時附在後面。
 */
const ERROR_KEY: Record<number, string> = { 401: "auth.expired", 403: "state.forbidden", 404: "state.notFound", 413: "error.payloadTooLarge" };

/**
 * 上游回的穩定錯誤碼裡，使用者做得了事的那幾個各給一句人話。沒列到的碼照狀態碼講，
 * 但把碼附在後面——只講「請求失敗」的話，使用者連該改哪裡、該回報什麼都不知道
 * （2026-09-07 一位作者存卡失敗，畫面只有「請求失敗」，他以為是名字太長）。
 */
const CODE_KEY: Record<string, string> = {
  image_in_use: "editor.image.libraryImagePinned",
  external_image_upload_required: "editor.image.externalImageUpload",
  media_folder_not_empty: "resource.folderNotEmpty",
  media_folder_exists: "resource.folderExists",
  media_path_taken: "resource.pathTaken",
  invalid_arguments: "error.invalidArguments",
  invalid_argument: "error.invalidArguments",
  role_in_review: "error.roleInReview",
  visibility_requires_review: "error.visibilityRequiresReview",
  public_role_requires_clone: "error.publicRoleRequiresClone",
  permission_denied: "state.forbidden",
  not_found: "state.notFound",
  validate_reject: "error.validateReject",
  role_desc_too_long: "error.fieldTooLong",
  role_detail_too_long: "error.fieldTooLong",
  role_welcome_too_long: "error.fieldTooLong",
  custom_instructions_too_long: "error.fieldTooLong",
  role_output_contract_too_long: "error.fieldTooLong",
  upload_invalid: "error.uploadRetry",
  upload_expired: "error.uploadExpired",
  upload_missing: "error.uploadRetry",
  upload_size_mismatch: "error.uploadRetry",
  quota_image_exceeded: "error.quotaImageExceeded",
  quota_bytes_exceeded: "error.quotaBytesExceeded",
  // 第二家的碼表另起一套（它說 forbidden，上面那批說 permission_denied）。意思一樣的
  // 就共用同一句，不必為了碼名多寫一份文案。
  invalid_request: "error.invalidArguments",
  forbidden: "state.forbidden",
  not_the_author: "state.forbidden",
  role_not_found: "state.notFound",
  asset_not_found: "state.notFound",
  account_not_found: "state.notFound",
  grantee_not_found: "state.notFound",
  unauthorized: "auth.expired",
  role_not_passed_review: "error.roleInReview",
  temporarily_unavailable: "state.serverBusy",
  file_too_large: "error.payloadTooLarge",
  upload_not_found: "error.uploadRetry",
  size_mismatch: "error.uploadRetry",
  // 這幾件事上面那批沒有對應的說法，各給一句
  insufficient_scope: "error.insufficientScope",
  unsupported_media_type: "error.unsupportedMediaType",
  invalid_cursor: "error.invalidCursor",
  quota_exceeded: "error.quotaExceeded",
  asset_not_passed_review: "error.assetNotPassedReview",
  // 我的預設（/presets、/preset-imports）
  preset_invalid: "preset.error.format",
  preset_conflict: "preset.error.revisionConflict",
  preset_preview_expired: "preset.import.expired",
  preset_profile_required: "preset.error.profileRequired",
};

/** 上游驗證失敗附的明細（作者資產、試玩卡）：哪一條、多大、上限多少。 */
export interface LimitDetail { reviewLength?:ReviewLength; reason?: string; field?: string; index?: number; name?: string; max?: number; actual?: number; unit?: string }

/**
 * 有明細就照明細講：整份多大、上限多少；或第幾條叫什麼、多大。沒有對應文案的 reason
 * 退回通用的那句。2026-09-11 一位作者存 1.18 MB 的規則只看到「請求失敗 (validate_reject)」。
 */
function describeLimit(code: string, detail: LimitDetail | undefined): string | null {
  // 作者資產的明細用 reason（哪一條規則）、角色欄位的用 field（哪個欄位）：同一條路翻。
  const which = detail?.reason ?? detail?.field;
  if (!detail || !which) return null;
  const key = `${CODE_KEY[code] ?? "error.validateReject"}.${which}`;
  if (!i18n.global.te(key)) return null;
  const bytes = detail.actual ?? 0;
  const max = detail.max ?? 0;
  return i18n.global.t(key, {
    index: (detail.index ?? -1) + 1,
    name: detail.name ?? "",
    actual: bytes,
    max,
    sizeKB: Math.ceil(bytes / 1024),
    maxKB: Math.round(max / 1024),
    sizeMB: (bytes / 1024 / 1024).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1),
    // 1 MB 以下的上限（例如開場網頁的 512 KB）印成 0.5，不印成 0。
    maxMB: max >= 10 * 1024 * 1024 ? Math.round(max / 1024 / 1024) : Number((max / 1024 / 1024).toFixed(1)),
  });
}
/** 本站自己的 API 回的碼（不是供應商契約的一部分，所以不進 docs/provider-protocol.md）。 */
const SITE_CODE_KEY: Record<string, string> = {
  visibility_operation_conflict: "workspace.submitConflict",
  visibility_provider_unavailable: "visibility.loadFailed",
  visibility_sync_pending: "visibility.operation.unknown",
  review_correction_manager_required:'review.correction.managerRequired',
  review_correction_not_final:'review.correction.notFinal',
  review_correction_changed:'review.correction.changed',
  review_correction_reward_pending:'review.correction.rewardPending',
  visibility_read_budget_exceeded: "state.serverBusy",
  visibility_disabled: "visibility.loadFailed",
  visibility_restricted: "state.forbidden",
  publication_operation_not_found: "state.notFound",
  visibility_operation_not_found: "state.notFound",
  review_required: "state.requestFailed",
  comment_rate_limited: "comment.error.rateLimited",
  comment_too_long: "comment.error.tooLong",
  comment_required: "comment.error.required",
  comment_muted: "comment.error.muted",
  invalid_report_reason: "error.invalidArguments",
  cannot_report_own_comment: "comment.error.reportOwn",
  blog_comments_closed: "comment.closed",
  // 問不到 HarperHarbor 這個人是不是應用管理員：不是沒權限，是暫時確認不了
  community_admin_unavailable: "state.serverBusy",
  // 留言審核（/v1/moderation 底下的留言佇列、禁言、關鍵詞、運營設定）
  moderation_reason_required: "moderation.error.moderation_reason_required",
  moderation_conflict: "moderation.error.moderation_conflict",
  moderation_self_review: "moderation.error.moderation_self_review",
  agent_not_allowed: "moderation.error.agent_not_allowed",
  community_admin_required: "moderation.settings.readOnly",
  invalid_settings: "error.invalidArguments",
  hosting_requires_uploaded_media: "workspace.uploadMedia",
  submission_pending: "workspace.alreadyPending",
  hosting_unavailable: "workspace.submitUnavailable",
  hosting_seal_failed: "workspace.submitUnavailable",
  hosting_read_failed: "workspace.submitUnavailable",
  hosting_receipt_invalid: "workspace.submitUnavailable",
  hosting_operation_conflict: "workspace.submitConflict",
  hosting_preparation_unfinished: "workspace.submitUnfinished",
  publication_use_original: "error.publicationUseOriginal",
  adult_content: "card.gate.title",
  region_unavailable: "region.unavailable.title",
  rating_required: "error.ratingRequired",
  rating_answers_invalid: "error.ratingRequired",
  rating_version_outdated: "error.ratingOutdated",
  cover_required: "error.coverRequired",
  publication_fields_required: "error.publicationFieldsRequired",
  preset_tag_required: "error.presetTagRequired",
  birthdate_required: "error.birthdateRequired",
  invalid_birthdate: "error.invalidBirthdate",
  underage: "error.underage",
  consent_required: "error.consentRequired",
  age_verification_required: "error.ageVerificationRequired",
};
const looksLikeCode = (raw: string): boolean => /^[a-z][a-z0-9_]*$/.test(raw);
/**
 * 伺服器寫給開發者的短語（「comment not found」「claim changed」）：全小寫英文、只有字母與空白。
 * 給人看的句子（內容審核的原因等）會有大寫、標點或其他文字。前者按狀態碼講使用者的語言，不夾英文。
 */
const looksInternal = (raw: string): boolean => /^[a-z]+( [a-z]+)+$/.test(raw);

export const MP3_CONTENT_MISMATCH = "mp3_content_mismatch";

export function describeApiError(status: number, raw: string, detail?: LimitDetail): string {
  // .mov：資源庫不收 QuickTime，請作者匯出成 MP4。上傳前的檢查也講同一句。
  if (detail?.reason === "quicktime") return i18n.global.t("res.error.mov");
  if (raw === "invalid_param" && detail?.reason === MP3_CONTENT_MISMATCH) return i18n.global.t("res.error.mp3Content");
  if(raw==='review_length_insufficient'&&detail?.reviewLength)return i18n.global.t('reviewLength.insufficient',formatReviewLength(detail.reviewLength,String(i18n.global.locale.value)));
  const legacy = (raw || "").trim();
  const text = legacy === "jailbreak_too_long" ? "custom_instructions_too_long" : legacy;
  const byDetail = text ? describeLimit(text, detail) : null;
  if (byDetail) return byDetail;
  if (text && (CODE_KEY[text] || SITE_CODE_KEY[text])) return i18n.global.t((CODE_KEY[text] ?? SITE_CODE_KEY[text])!);
  // 不是錯誤碼的就是伺服器寫給人看的句子（例如內容審核的原因），原樣講。
  if (text && !looksLikeCode(text) && !looksInternal(text)) return text;
  const msg = i18n.global.t(ERROR_KEY[status] ?? (status >= 500 ? "state.serverBusy" : "state.requestFailed"));
  return text && looksLikeCode(text) ? `${msg} (${text})` : msg;
}

export async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; reason?: string; message?: string; detail?: LimitDetail; until?: number | null;publicUntil?:string;publicDays?:number;requiredCredits?:number;availableCredits?:number;shortfallCredits?:number };
    if (body.detail?.field === "customInstructions") body.detail.field = "jailbreak";
    const raw = body.error ?? body.message ?? "";
    // 禁言帶著到期時間：null＝永久。沒帶（舊回應）就用不講期限的那一句。
    const retained=body.publicUntil&&body.publicDays&&body.requiredCredits?{publicUntil:body.publicUntil,days:body.publicDays,recoveryCredits:body.requiredCredits}:null;
    const said = retained&&raw==='card_reward_recovery_insufficient'&&body.availableCredits!==undefined&&body.shortfallCredits!==undefined ? i18n.global.t('rewardRetention.delete.insufficient',retentionParams(retained,body.availableCredits,body.shortfallCredits))+' '+i18n.global.t('rewardRetention.delete.insufficientLater',retentionParams(retained))
      :retained&&raw==='card_reward_recovery_required'?i18n.global.t('rewardRetention.delete.reward',retentionParams(retained))+' '+i18n.global.t('rewardRetention.delete.later',retentionParams(retained))
      :retained&&raw==='card_reward_public_locked'?i18n.global.t('rewardRetention.lock.error',retentionParams(retained))
      : raw === "weekly_quota_exceeded"
      ? i18n.global.t(body.reason === "device_shared" ? "mine.quota.exceededDevice" : "mine.quota.exceeded")
      : raw === "comment_muted" && body.until !== undefined
      ? body.until === null ? i18n.global.t("comment.error.mutedPermanent") : i18n.global.t("comment.error.mutedUntil", { date: dateTime(body.until) })
      : describeApiError(res.status, raw, body.detail);
    const reason = raw === "validate_reject" ? body.detail?.reason ?? body.reason : body.reason;
    const internal = raw === "author_note_internal" ? noteInternalOf(body) : undefined;
    throw new ApiError(res.status, said, body.error ?? (body as { code?: string }).code ?? "", body.detail?.reviewLength, typeof reason === "string" ? reason : "", internal);
  }
  return (await res.json()) as T;
}

/** 命中內部字詞的回應：terms 與 matches 跟 error 並列放在回應本體；讀不懂的項目丟掉 */
function noteInternalOf(body: unknown): AuthorNoteInternal {
  const b = (body ?? {}) as { terms?: unknown; matches?: unknown };
  const terms = Array.isArray(b.terms) ? b.terms.filter((x): x is string => typeof x === "string") : [];
  const matches = (Array.isArray(b.matches) ? b.matches : []).filter((m): m is AuthorNoteInternal["matches"][number] =>
    !!m && typeof m.term === "string" && typeof m.snippet === "string" && Number.isInteger(m.start) && Number.isInteger(m.length));
  return { terms, matches };
}

export const authHeaders = (token?: string): Record<string, string> =>
  token ? { Authorization: `Bearer ${token}` } : {};

/**
 * 「這個請求是從哪一頁發的」。
 *
 * SPA 的站內跳轉不產生文件請求，而同源 fetch 帶的 Referer 是當前頁自己的網址——所以服務端
 * 沒有任何辦法知道使用者是從榜單、搜尋還是分享連結走到這張卡的。顯式送一個頭是唯一的解法。
 *
 * 不影響邊緣快取：快取鍵是 URL，而存進去的回應沒有設 Vary，所以請求頭不參與比對。
 */
// 每個對本站的請求都說清楚自己是哪一家：兩家的榜單、卡片、會員完全分開，
// 後端不從 token 反推（兩家的格式沒有互斥保證）。
const from = (): Record<string, string> => ({ "X-From": currentSurface(), "X-Provider": currentProvider() });

/**
 * 「看的人開了成人內容嗎」。session 在載好本站身分後把它接上（開了才回 token），登出時拆掉；
 * 這裡不直接 import session，避免 api ↔ session 互相引用。
 * 開了的請求帶 ?nsfw=1 加 token，伺服器驗過才給成人內容，且回應不進邊緣快取。
 */
let nsfwViewer: (() => Promise<string | null>) | null = null;
export function setNsfwViewer(fn: (() => Promise<string | null>) | null): void { nsfwViewer = fn; }
/**
 * 「看的人登入了嗎」。卡片頁帶著它，作者才看得到自己還沒上榜的卡（伺服器只對作者本人放行）。
 * 同樣由 session 接上、登出時拆掉；沒登入就不帶，公開讀取照常走邊緣快取。
 */
let loginViewer: (() => Promise<string | null>) | null = null;
export function setLoginViewer(fn: (() => Promise<string | null>) | null): void { loginViewer = fn; }
/**
 * 「看的人不想看的類型」。同樣由 session 接上（等本站身分載好再回名單），登出時拆掉。
 * 榜單與搜尋帶 ?hide=鍵,鍵 由伺服器過濾；不用 token——這不是權限，只是這個人的口味，回應照常進公開快取。
 */
let hiddenTagsViewer: (() => Promise<string[]>) | null = null;
export function setViewerHiddenTags(fn: (() => Promise<string[]>) | null): void { hiddenTagsViewer = fn; }
async function viewerHide(): Promise<string> {
  const keys = hiddenTagsViewer ? await hiddenTagsViewer().catch(() => []) : [];
  return hideParam(keys);
}
async function viewerAccess(): Promise<{ param: string; headers: Record<string, string> }> {
  const token = nsfwViewer ? await nsfwViewer().catch(() => null) : null;
  return token ? { param: "nsfw=1", headers: authHeaders(token) } : { param: "", headers: {} };
}

// ---- 社群 API（同源）------------------------------------------------------

export interface BoardQuery { zone?: Zone | "all"; q?: string; tag?: string | string[]; /** 原作（寫法不拘，繁簡與別名都算同一個） */ fandom?: string; period?: string; sort?: Sort; /** 作者的本站公開 ID */ author?: string; limit?: number; offset?: number; cursor?:string; lang?: string }

export async function fetchBoard(query: BoardQuery = {}): Promise<CardPage> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== "") {
    if (Array.isArray(v)) v.forEach(value => params.append(k, value));
    else params.set(k, String(v));
  }
  const viewer = await viewerAccess();
  if (viewer.param) params.set("nsfw", "1");
  // 作者頁不套：看一個人的作品時，口味不是篩選條件
  if (!query.author) { const hide = await viewerHide(); if (hide) params.set("hide", hide); }
  const res = await fetch(`${COMMUNITY_API}/cards?${params}`, { headers: { ...from(), ...viewer.headers } });
  const adult = res.headers.get("X-Adult-Content");
  const page = await json<CardPage>(res);
  if (adult !== null) page.adult = adult === "1";
  // 列出來的卡先記著：點進卡片頁時直接畫，不必再等一次往返（見 card-memory）
  rememberCards(page.items);
  return page;
}

/**
 * 類型列每顆籤後面的張數：條件跟榜單一樣（語區、已選的類型、成人內容、不想看的類型），
 * 每個數字是「再加上這一類會剩幾張」。ratings 是各級的張數（不套分級本身，給分級選單用；none＝沒標分級）。
 */
export async function fetchTagCounts(query: { zone: string; tag: string[]; rating?: string }): Promise<{ counts: Record<string, number>; ratings: Record<string, number> }> {
  const params = new URLSearchParams({ zone: query.zone });
  query.tag.forEach((tag) => params.append("tag", tag));
  if (query.rating) params.set("rating", query.rating);
  const viewer = await viewerAccess();
  if (viewer.param) params.set("nsfw", "1");
  const hide = await viewerHide();
  if (hide) params.set("hide", hide);
  const res = await fetch(`${COMMUNITY_API}/tags/counts?${params}`, { headers: { ...from(), ...viewer.headers } });
  return json<{ counts: Record<string, number>; ratings: Record<string, number> }>(res);
}

/** opts.quiet：不算一次瀏覽（對話頁為了換 manifest 讀卡片資料時用）。 */
export async function fetchCard(id: string, lang?: string, opts: { quiet?: boolean } = {}): Promise<CommunityCard> {
  const params = new URLSearchParams();
  if (lang) params.set("lang", lang);
  if (opts.quiet) params.set("view", "0");
  const viewer = await viewerAccess();
  if (viewer.param) params.set("nsfw", "1");
  const q = params.size ? `?${params}` : "";
  // 成人內容那條已經帶了 token 就不重複；否則登入了就帶，作者才看得到自己還沒上榜的卡
  const login = viewer.headers.Authorization ? null : loginViewer ? await loginViewer().catch(() => null) : null;
  const card = await json<CommunityCard>(await fetch(`${COMMUNITY_API}/cards/${encodeURIComponent(id)}${q}`, { headers: { ...from(), ...viewer.headers, ...authHeaders(login ?? undefined) } }));
  rememberCard(card);
  return card;
}

/** Authoring identity lookup never uses the public card-viewing gate. */
export async function fetchEditorCardReference(id: string, token: string, provider: ProviderId = currentProvider()): Promise<{num:number;provider:ProviderId;sourceRoleId:string;fandom?:string;fandomKey?:string}> {
  return json(await fetch(`${COMMUNITY_API}/me/cards/${encodeURIComponent(id)}/author-reference?lang=${encodeURIComponent(String(i18n.global.locale.value))}`, {
    headers: { ...from(), "X-Provider": provider, ...authHeaders(token) },
  }));
}

/** 卡片頁「全部榮譽」：這張卡在兩條榜、各期別結算出的全部榮譽，新頒發的在前。看得到卡的人才看得到（成人卡同 fetchCard）。 */
export async function fetchCardHonors(id: string): Promise<CardHonor[]> {
  const viewer = await viewerAccess();
  const q = viewer.param ? "?nsfw=1" : "";
  return (await json<{ items: CardHonor[] }>(await fetch(`${COMMUNITY_API}/cards/${encodeURIComponent(id)}/honors${q}`, { headers: { ...from(), ...viewer.headers } }))).items;
}

/** 首頁「年度」分頁：年度榜單積分（年冠）。結算前是暫定排名。 */
export async function fetchAnnualBoard(zone: "all" | "clean", year?: number): Promise<AnnualBoard> {
  const q = new URLSearchParams({ zone, ...(year ? { year: String(year) } : {}) });
  return json<AnnualBoard>(await fetch(`${COMMUNITY_API}/rankings/annual?${q}`, { headers: from() }));
}

/** 首頁「成就」分頁：作者成就／綜合成就榜，period 是 all 或 YYYY-MM。 */
export async function fetchAchievementBoard(board: AchievementBoardKind, period: string): Promise<AchievementBoard> {
  return json<AchievementBoard>(await fetch(`${COMMUNITY_API}/rankings/achievements?${new URLSearchParams({ board, period })}`, { headers: from() }));
}

export interface CardVersion {
 versionId:string;publishedAt:number|null;publicationTimeSource:'published'|'review'|'unknown';updateKind:'minor'|'major';updateNote:string;
}
export interface CardVersionPage {items:CardVersion[];page:number;hasMore:boolean;target?:CardVersion|null}
export async function fetchCardVersions(id:string,page=1,target?:string):Promise<CardVersionPage>{
 const viewer=await viewerAccess();const params=new URLSearchParams({page:String(page)});
 if(viewer.param)params.set('nsfw','1');if(target)params.set('target',target);
 return json<CardVersionPage>(await fetch(`${COMMUNITY_API}/cards/${encodeURIComponent(id)}/versions?${params}`,{cache:'no-store',headers:{...from(),...viewer.headers}}));
}

/** 這一區最常見的標籤，給榜單的類型篩選列。 */
export async function fetchTags(zone: Zone | "all"): Promise<{ tag: string; n: number }[]> {
  const res = await json<{ items: { tag: string; n: number }[] }>(await fetch(`${COMMUNITY_API}/tags?zone=${zone}`, { headers: from() }));
  return res.items;
}

/** 一個原作在清單裡的樣子：key 是篩選用的鍵（對到 Wikidata 的是 wd:Q…），labels 是它各語言的名字 */
export interface FandomItem { key: string; fandom: string; labels?: Record<string, string>; n: number }
/** 這一區的原作清單（有幾張卡）。 */
export async function fetchFandoms(zone: Zone | "all", q = "", lang?: string): Promise<FandomItem[]> {
  const params = new URLSearchParams({ zone });
  if (q) params.set("q", q);
  if (lang) params.set("lang", lang);
  const res = await json<{ items: FandomItem[] }>(await fetch(`${COMMUNITY_API}/fandoms?${params}`, { headers: from() }));
  return res.items;
}

/** 填原作時的候選（Wikidata）：編號、名字、一句說明。 */
export async function fetchFandomLookup(q: string): Promise<{ id: string; label: string; description: string }[]> {
  const res = await json<{ items: { id: string; label: string; description: string }[] }>(await fetch(`${COMMUNITY_API}/fandom-lookup?${new URLSearchParams({ q })}`, { headers: from() }));
  return res.items;
}

export interface Suggestions { tags: { tag: string; n: number }[]; fandoms: FandomItem[]; cards: { num: number; name: string; avatarUrl: string | null }[] }
/** 搜尋框打字時的建議。只有一般內容；看的人藏起來的類型照榜單的規則排除。 */
export async function fetchSuggest(zone: Zone | "all", q: string, lang?: string): Promise<Suggestions> {
  const params = new URLSearchParams({ zone, q });
  if (lang) params.set("lang", lang);
  const hide = await viewerHide();
  if (hide) params.set("hide", hide);
  return json<Suggestions>(await fetch(`${COMMUNITY_API}/suggest?${params}`, { headers: from() }));
}

export interface TagPage { items: { tag: string; n: number }[]; hasNext: boolean; limit: number; offset: number }
export async function searchTags(zone: Zone | "all", q: string, offset = 0): Promise<TagPage> {
  const params = new URLSearchParams({ zone, q, offset: String(offset) });
  return json<TagPage>(await fetch(`${COMMUNITY_API}/tags?${params}`, { headers: from() }));
}

export interface AuthorPage { items: Author[]; hasNext: boolean; limit: number; offset: number; sort: AuthorSort }

export async function fetchAuthors(query: { zone?: Zone | "all"; q?: string; sort?: AuthorSort; limit?: number; offset?: number } = {}): Promise<AuthorPage> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== "") params.set(k, String(v));
  const viewer = await viewerAccess();
  if (viewer.param) params.set("nsfw", "1");
  return json<AuthorPage>(await fetch(`${COMMUNITY_API}/authors?${params}`, { headers: { ...from(), ...viewer.headers } }));
}

/** 作者的關注／粉絲名單（作者公開名單才有；不公開回 403 list_not_public）。 */
export async function fetchFollowList(handle: string, kind: "following" | "followers", offset = 0): Promise<FollowListPage> {
  return json<FollowListPage>(await fetch(`${COMMUNITY_API}/authors/${encodeURIComponent(handle)}/${kind}?offset=${offset}`, { headers: from() }));
}

/** 本人看自己的粉絲（不受自己的設定影響）。 */
export async function fetchOwnFollowers(token: string, offset = 0): Promise<FollowListPage> {
  return json<FollowListPage>(await fetch(`${COMMUNITY_API}/me/followers?offset=${offset}`, { headers: { ...from(), ...authHeaders(token) } }));
}

export async function fetchAuthor(handle: string): Promise<Author> {
  const viewer = await viewerAccess();
  const q = viewer.param ? `?${viewer.param}` : "";
  return json<Author>(await fetch(`${COMMUNITY_API}/authors/${encodeURIComponent(handle)}${q}`, { headers: { ...from(), ...viewer.headers } }));
}

// Persist only the opaque operation, never credentials. Reload/network retries
// resume the same snapshot; beginning an edit explicitly retires that operation.
const publicationOperations=new Map<string,string>();
type PublicationConsent={operationId:string;intentHash:string;expected:{policyRevision:string;approvalRevision:string}|null};
const publicationConsents=new Map<string,PublicationConsent>();
function publicationOperation(key:string):string {
 let id=publicationOperations.get(key);
 try{id ||= localStorage.getItem(key)||undefined}catch{}
 id ||= crypto.randomUUID();publicationOperations.set(key,id);
 notePublicationOperation(key,true);
 try{localStorage.setItem(key,id)}catch{}
 return id;
}
function clearPublicationOperation(key:string){publicationOperations.delete(key);publicationConsents.delete(key);try{localStorage.removeItem(key);localStorage.removeItem(key+':consent')}catch{}notePublicationOperation(key,false);}
async function publicationConsent(key:string,operationId:string,intent:unknown,expected?:PublicationConsent['expected']):Promise<{consent:PublicationConsent;prior:boolean;changed:boolean}>{
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(intent)));
 const intentHash=[...new Uint8Array(digest)].map(n=>n.toString(16).padStart(2,'0')).join('');
 let saved=publicationConsents.get(key);
 if(!saved){try{const raw=localStorage.getItem(key+':consent');if(raw)saved=JSON.parse(raw) as PublicationConsent;}catch{}}
 if(saved?.operationId===operationId){
  if(saved.intentHash!==intentHash){
    const value=intent as Record<string,unknown>,{updateKind,updateNote,...legacy}=value;
    const legacyHash=updateKind==='minor'&&updateNote===''?await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(legacy))):null;
    const compatible=legacyHash&&[...new Uint8Array(legacyHash)].map(n=>n.toString(16).padStart(2,'0')).join('')===saved.intentHash;
    if(!compatible)return {consent:saved,prior:true,changed:true};
    saved.intentHash=intentHash;publicationConsents.set(key,saved);try{localStorage.setItem(key+':consent',JSON.stringify(saved))}catch{}
  }
  return {consent:saved,prior:true,changed:false};
 }
 const value={operationId,intentHash,expected:expected??null};publicationConsents.set(key,value);
 try{localStorage.setItem(key+':consent',JSON.stringify(value))}catch{}
 return {consent:value,prior:false,changed:false};
}

/** 登記只送 roleId：內容由服務端自己去上游取，作者塞不進任何欄位。 */
/** 登記／提交。必附分級問卷（沒附伺服器不收）；成人旗標由伺服器從級別推導。 */
/** distribute：其他已登入渠道的 token，登記成功後站台在背景把卡同步過去（登記即分發）。 */
export async function registerCard(
  roleId: string,
  token: string,
  /** 分級問卷答案（shared/content-rating.ts）；級別由伺服器算 */
  ratingAnswers: RatingAnswers,
  distribute: { provider: ProviderId; token: string }[] = [],
  provider: ProviderId = currentProvider(),
  /** 原作（選填）；沒給就是沒有。fandomId 是對到的 Wikidata 編號，有它就以它為準 */
  fandom?: string,
  fandomId?: string,
  expected?: { policyRevision:string; approvalRevision:string },
  update?:UpdateIntent,
): Promise<CommunityCard> {
  const intent=parseUpdateIntent(update??{});
  const key=publicationKey(provider,roleId);
  const operationId=publicationOperation(key);
  const {consent,prior,changed}=await publicationConsent(key,operationId,{roleId,ratingAnswers,fandom:fandom??'',fandomId:fandomId??'',distribute:distribute.map(d=>d.provider),...intent},expected);
  const conflict=()=>new ApiError(409,i18n.global.t('workspace.submitConflict'),'visibility_operation_conflict');
  if(prior&&provider==='harbor'){
    const response=await fetch(`${COMMUNITY_API}/me/cards/${encodeURIComponent(roleId)}/publication/operations/${encodeURIComponent(operationId)}`,{method:'GET',cache:'no-store',headers:{...from(),'X-Provider':provider,...authHeaders(token)}});
    const body=await response.json().catch(()=>null) as {error?:string;operation?:{operationId?:string;state?:string};card?:CommunityCard;workVisibility?:{policyRevision:string;approvalRevision:string;syncState:string;actions:string[]}}|null;
    if(response.status===404&&body?.error==='publication_operation_not_found'){
      if(consent.expected){
        const latest=body.workVisibility;
        if(!latest||latest.syncState!=='complete')throw new ApiError(503,describeApiError(503,''),'visibility_sync_pending');
        if(latest.policyRevision!==consent.expected.policyRevision||latest.approvalRevision!==consent.expected.approvalRevision||!latest.actions.some(a=>a==='submit_review'||a==='submit_update'))throw conflict();
      }
    }else{
      if(!response.ok)throw new ApiError(response.status,describeApiError(response.status,body?.error??''),body?.error??'');
      if(body?.operation?.operationId!==operationId||!['pending','complete','conflict'].includes(body.operation.state??''))throw new ApiError(503,describeApiError(503,''),'visibility_sync_pending');
      if(body.operation.state==='conflict')throw conflict();
      if(body.operation.state==='complete'){
        if(!body.card?.id)throw new ApiError(503,describeApiError(503,''),'visibility_sync_pending');
        // The accepted prior submission must never be mistaken for this
        // changed form. Keep its key and the form until an explicit edit.
        if(changed)throw new ApiError(409,i18n.global.t('workspace.submitPreviousAccepted'),'publication_completed_different_intent');
        clearPublicationOperation(key);return body.card;
      }
    }
  }
  // An accepted submission wins over stale form contents. A still-unresolved
  // operation must keep its original intent until an explicit edit fences it.
  if(changed)throw new ApiError(409,i18n.global.t('workspace.submitUnfinished'),'visibility_operation_conflict');
  let result:CommunityCard;
  try{result=await json<CommunityCard>(
    await fetch(`${COMMUNITY_API}/cards`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...from(), "X-Provider": provider, "X-Device-Token": deviceToken(), ...authHeaders(token) },
      body: JSON.stringify({ roleId, ratingAnswers, operationId, ...intent, ...(consent.expected ? {expectedPolicyRevision:consent.expected.policyRevision,expectedApprovalRevision:consent.expected.approvalRevision} : {}), ...(fandom !== undefined ? { fandom } : {}), ...(fandomId ? { fandomId } : {}), ...(distribute.length ? { distribute } : {}) }),
    }),
  );
  }catch(error){
    if(error instanceof ApiError&&['publication_fields_required','cover_required','preset_tag_required','review_length_insufficient','update_notification_cooldown','update_note_invalid','update_kind_invalid','update_notification_unavailable'].includes(error.code)&&publicationOperations.get(key)===operationId)clearPublicationOperation(key);
    throw error;
  }
  clearPublicationOperation(key);
  return result;
}

/** 改卡前先通知本站：resubmit＝存完要重新送審；ratingAnswers＝上一版的分級問卷（沒有就要作者重填）；ratingFloor＝管理員更正分級後的分級下限。 */
export async function beginCardEdit(roleId:string,token:string,provider:ProviderId):Promise<{resubmit:boolean;ratingAnswers?:RatingAnswers;fandom?:string;fandomId?:string;ratingFloor?:string}> {
  const result=await json<{resubmit:boolean;ratingAnswers?:RatingAnswers;fandom?:string;fandomId?:string;ratingFloor?:string}>(await fetch(`${COMMUNITY_API}/cards/${encodeURIComponent(roleId)}/edit`, {
    method:'POST',headers:{...from(),'X-Provider':provider,...authHeaders(token)},
  }));
  clearPublicationOperation(publicationKey(provider,roleId));
  return result;
}

export interface RatingDraft { answers: RatingAnswers | null; ratingFloor: Rating | null }
/**
 * 作者先存著的分級評測（每位作者、每張卡一份）；問卷改版後的舊草稿 answers 回 null。
 * ratingFloor＝管理員更正分級後這張卡的分級下限（只回給卡片作者），開問卷前就能停用較低的選項。
 */
export async function fetchRatingDraft(roleId: string, token: string, provider: ProviderId = currentProvider()): Promise<RatingDraft> {
  const res = await json<{ answers: RatingAnswers | null; ratingFloor?: string }>(await fetch(`${COMMUNITY_API}/cards/${encodeURIComponent(roleId)}/rating-draft`, {
    headers: { ...from(), "X-Provider": provider, ...authHeaders(token) },
  }));
  return { answers: res.answers ?? null, ratingFloor: isRating(res.ratingFloor) ? res.ratingFloor : null };
}

export async function saveRatingDraft(roleId: string, answers: RatingAnswers, token: string, provider: ProviderId = currentProvider()): Promise<void> {
  await json(await fetch(`${COMMUNITY_API}/cards/${encodeURIComponent(roleId)}/rating-draft`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...from(), "X-Provider": provider, ...authHeaders(token) },
    body: JSON.stringify(answers),
  }));
}

export async function unregisterCard(roleId: string, token: string, provider: ProviderId = currentProvider()): Promise<void> {
  const res = await fetch(`${COMMUNITY_API}/cards/${encodeURIComponent(roleId)}`, {
    method: "DELETE",
    headers: { ...from(), "X-Provider": provider, ...authHeaders(token) },
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
  /** 同一張卡第幾次送審（1＝首送）；舊版伺服器不帶 */
  attempt?: number;
  card: { id: string; roleId: string; name: string; summary: string; avatarUrl: string | null; zone: Zone | "all"; tags: string[] };
  stamps: { approve: number; required: number };
  /** 作者問卷算出的級別；問卷上線前送的單是 null */
  rating?: Rating | null;
  claim: "free" | "mine" | "other";
  stampedByMe: boolean;
  claimGeneration?: string;
  /** 送審當下的有效字數與現行門檻；null 或沒有＝算不出來，清單上不標 */
  reviewLength?: ReviewLengthStatus | null;
  lengthExempt?:boolean;
  /** 世界書全部條目數、正規表示式全部規則數（含停用）；null 或沒有＝不知道，不標 */
  worldbookEntries?: number | null;
  regexRules?: number | null;
  /** 冷凍並討論：有人把這張卡擋下來了；null 或沒有＝沒冷凍 */
  hold?: ReviewHold | null;
  /** 審核員對已發布的卡發起的重新審核 */
  reopen?: boolean;
  /** 送審類型；舊版伺服器不帶就退回 kind */
  type?: ReviewSubmissionType;
  /** 審卡 V2：不受理後作者改版重送 */
  afterDrop?: boolean;
  /** 作者標記與同裝置帳號數（只給審核員，不帶身分）；舊流程的單是 null */
  authorMark?: ReviewAuthorMark | null;
  /** 快速審：優質作者、沒有疑似量產。只是排序前移與預設重點檢查 */
  fast?: boolean;
  /** 審卡 V2 第二批：更新差異的摘要（只有更新單有）。pending＝還沒算；no_base／unreadable＝無法比較 */
  diff?: { state: "pending" | "done" | "no_base" | "unreadable"; summary: ReviewDiffSummary | null } | null;
  /** 改判單（駁回改判為通過）：發起人、發起時間、原本駁回的時間；改判理由只給管理員。舊版伺服器不帶 */
  flip?: ReviewQueueFlip | null;
}

export interface ReviewQueueFlip { by: string; at: number; rejectedAt: number | null; mine: boolean; reason?: string; canTakeOver?: boolean }
/** 一張駁回單的改判狀態：改判審核中、已改判為通過，以及管理員看不看得到「改判為通過」入口 */
export interface ReviewFlipState { pendingId: string | null; approvedId: string | null; canStart: boolean }

/** 更新差異的純數字摘要（伺服器 src/review-diff.ts DiffSummary）：不含卡片原文 */
export interface ReviewDiffSummary {
  changedFields: string[];
  setting: { charsAdded: number; charsRemoved: number };
  opening: { changed: boolean; charsBefore: number; charsAfter: number };
  worldbook: { added: number; removed: number; modified: number };
  rules: { added: number; removed: number; modified: number };
  tags: { added: number; removed: number };
  totalChanged: number;
  unchanged: boolean;
}
export interface ReviewDiffEntry { name: string; content: string; keywords: string[]; isEnabled: boolean; isConstant: boolean }
export type ReviewDiffChange = "added" | "removed" | "modified";
/** 審核頁的完整差異。fields 的 key：name、summary、setting…，作者資產的欄位帶 asset. 前綴 */
export interface ReviewDiff {
  summary: ReviewDiffSummary;
  fields: { key: string; before: string; after: string }[];
  worldbook: { added: ReviewDiffEntry[]; removed: ReviewDiffEntry[]; modified: { before: ReviewDiffEntry; after: ReviewDiffEntry }[] };
  rules: { added: number; removed: number; modified: number; items: { change: ReviewDiffChange; label: string }[] };
}
/** no_base＝沒有過審或駁回過的版本可比；unreadable／missing＝讀不到，無法比較 */
export type ReviewDiffResult =
  | { state: "no_base" | "unreadable" | "missing" }
  | { state: "ready"; baseKind: "approved" | "rejected"; diff: ReviewDiff };

/** 更新差異：只在待審期間讀（定案後 410）；跟審核頁同一道門 */
export async function fetchReviewDiff(id: string, token: string): Promise<ReviewDiffResult> {
  return json(await fetch(`${COMMUNITY_API}/review/${encodeURIComponent(id)}/diff`, { headers: { ...from(), ...authHeaders(token) } }));
}

export type ReviewAuthorTier = "new" | "stable" | "top" | "general" | "unknown";
export interface ReviewAuthorMark { tier: ReviewAuthorTier; manualTier: boolean; batchSuspected: boolean; deviceAccounts: number | null }

/** 審核頁的作者側寫：標記、依據與人工覆寫。null 的依據＝量不到 */
export interface ReviewAuthorProfile {
  tier: ReviewAuthorTier; autoTier: ReviewAuthorTier; batchSuspected: boolean; autoBatch: boolean;
  manual: { tier?: { expiresAt: number }; batch?: { expiresAt: number } };
  basis: { works: number | null; decidedWorks: number | null; firstPassRate: number | null; qualityScore: number | null; memberSince: number | null; deviceAccounts: number | null; deviceRecentWorks: number | null; dropCases90d: number | null; marks90d?: Record<string, number>; suggestions90d?: number };
  pendingSameAuthor: number | null; pendingSameDevice: number | null;
}

export interface ReviewQueueCounts { new: number; updates: number; dropped: number }
export interface ReviewBatchGroup { scope: "device"; anchorId: string; count: number }

/** 首次送審／更新（上次通過）／退回後再送（上次駁回）／審核員發起的重新審核 */
export type ReviewSubmissionType = "first" | "update" | "resubmit" | "reopen";

/** 原作者（只給審核頁）：Harbor 帳號名稱、數字帳號 ID、本站代號與他登記過的卡數 */
export interface ReviewAuthor { name: string; communityName: string | null; handle: string | null; accountNumId: number; avatar: string; cardCount: number }

/** 同一位作者的一張卡與它的審核狀態 */
export interface ReviewAuthorCard {
  id: string; name: string | null; coverUrl: string | null; adultHidden: boolean;
  status: "pending" | "approved" | "rejected" | "needs_review" | "unshared" | string;
  publicBlocked: boolean; boardHidden: boolean; held: boolean; reReview: boolean;
  decided: number; rejected: number;
  latest: { id: string; status: string; submittedAt: number; decidedAt: number | null; reopen: boolean } | null;
  current: boolean;
}

export async function fetchReviewAuthorCards(id: string, token: string, lang?: string): Promise<{ items: ReviewAuthorCard[]; total: number }> {
  const q = lang ? `?lang=${encodeURIComponent(lang)}` : "";
  return json(await fetch(`${COMMUNITY_API}/review/${encodeURIComponent(id)}/author-cards${q}`, { headers: { ...from(), ...authHeaders(token) } }));
}

/** 作者行為的異常代碼（伺服器 src/review-ai.ts authorActivity 判定；畫面只顯示結果與數字） */
export type ReviewActivityAnomalyCode = "burst_long" | "quota_full" | "quick_gap" | "device" | "device_heavy";

/** 審核頁的作者行為（只給審核員）：只有數字與狀態，沒有帳號或裝置識別碼。null＝量不到 */
export interface ReviewAuthorActivity {
  anomalies: { code: ReviewActivityAnomalyCode | string; value: number | null }[];
  weekly: { used: number; limit: number; deviceShared: boolean };
  submissions7d: number;
  submissions24h: number;
  pendingNow: number;
  avgGapHours: number | null;
  minutesSincePrevious: number | null;
  /** 近 7 天的送審，新的在前 */
  recent: { at: number; chars: number | null; status: string; kind: string; current: boolean }[];
  deviceAccounts: number | null;
  priorApproved: number | null;
  accountAgeDays: number | null;
}

/** 作者行為：跟審核頁同一道門（403／404／409 時畫面直接不顯示這一區） */
export async function fetchReviewAuthorActivity(id: string, token: string): Promise<ReviewAuthorActivity> {
  return json(await fetch(`${COMMUNITY_API}/review/${encodeURIComponent(id)}/author-activity`, { headers: { ...from(), ...authHeaders(token) } }));
}

/** 冷凍：holder 是冷凍人的顯示名；canRelease＝我能解凍（冷凍人自己，或管理員） */
export interface ReviewHold { holder: string; at: number; byMe: boolean; canRelease: boolean }

/** 送審當下本站替這張單存的整份設定（快照）。作者身分不在快照裡，另放在 author。partial＝同步開的重審單，只有公開資料。 */
export interface ReviewDetail {
  submission: {
    lengthExempt?:boolean;
    id: string; kind: "first" | "re"; status: string; contentHash: string; submittedAt: number;
    /** 定案時間（改判為通過的表單寫「原本結果：已駁回（日期）」）；舊版伺服器不帶 */
    decidedAt?: number | null;
    /** 作者問卷算出的級別、情節名稱與每題答案；問卷上線前送的單是 null */
    rating?: Rating | null;
    ratingDescriptors?: Topic[];
    ratingAnswers?: RatingAnswers | null;
    claimedByMe: boolean;
    /** 我在這張單上蓋過章：可以回頭唯讀查看，不必再領 */
    stampedByMe?: boolean;
    claimGeneration?: string; required: number;
    hold?: ReviewHold | null;
    /** 重新審核：已發布的卡回到待審；reopenReason 是發起理由（只給審核員） */
    reopen?: boolean; reopenReason?: string;
    /** mine＝我蓋的那一章；舊版伺服器不帶 */
    /** finalSource：兩段式定案實際記下的來源（只在我蓋的那一章；無 AI 對照但 AI 剛好判完會記成 modified；舊的定案可能是 blind） */
    stamps: { verdict: "approve" | "reject"; note: string; at: number; mine?: boolean; finalSource?: ReviewFinalSource | null }[];
    canCorrect?:boolean;manager?:boolean;deadline?:number|null;
    correction?:{note:string;at:number;state:'pending'|'complete'|'conflict';operationId:string;publicState:string|null;canResume:boolean}|null;
    /** 這張是改判單：改判的那張、發起人、原駁回日期與理由、改判理由（只給管理員）。舊版伺服器不帶 */
    flip?: { of: string; by: string; mine: boolean; at: number; rejectedAt: number | null; reasons: string[]; note: string; reason?: string; canTakeOver?: boolean } | null;
    /** 這張的改判狀態；supersededBy＝作者之後又送過審（入口停用並連到最新那張） */
    flipState?: ReviewFlipState & { supersededBy: { id: string; submittedAt: number } | null };
    /** 同一張卡第幾次送審，與它之前最近一次定案的結果；舊版伺服器不帶 */
    attempt?: number;
    /** reasons：上次駁回的理由代碼。伺服器目前還沒帶（只有 note），帶了「更新內容」分頁才列出逐項對照 */
    previous?: { status: "approved" | "rejected"; note: string; submittedAt: number; decidedAt: number | null; reasons?: string[] } | null;
    type?: ReviewSubmissionType;
  };
  /** 原作者；舊版伺服器不帶 */
  author?: ReviewAuthor | null;
  /** 審卡 V2：作者側寫（只有待審單）、是否在不受理清單（唯讀）、送審特徵、駁回理由 */
  authorProfile?: ReviewAuthorProfile | null;
  dropped?: boolean;
  features?: { openingChars?: number; settingChars?: number; totalChars?: number; worldbookEntries?: number; regexRules?: number; hasFandom?: boolean; afterDrop?: boolean } | null;
  rejectReasons?: string[];
  rejectCoaching?: boolean;
  /** 定案後內容與查重保留到什麼時候（毫秒）；過期是 null（只剩公開資料）；待審單與舊版伺服器不帶 */
  retainUntil?: number | null;
  /** tags：榜上會用的那一份（審核人可能改過）；舊版伺服器不帶就退回作者勾的。fandom：作者宣告或審核人改過的原作。 */
  card: { id: string; roleId: string; tags?: string[]; fandom?: string; fandomId?: string };
  detail: {
    partial?: boolean;
    /** 已定案：私有設定已刪，只剩公開資料 */
    closed?: boolean;
    document: {
      roleName: string; userName: string; roleDesc: string; roleAvatar: string; roleBackground: string;
      roleDetailDesc: string; roleTag: string; roleType: string; roleSex: string; roleSpeech: string;
      language: string; customInstructions?: string; jailbreak?: string; talkExample: string; roleOutputContract: string;
      /** 分享圖（選填）：有才帶 */
      roleShareImage?: string;
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
      cardFormat?: string;
      /** 首屏網頁（作者 HTML，開新對話時畫布最上方）；沒有就不帶。 */
      openingPage?: string;
      cardCss?: string;
      cardCssDialect?: string;
      /** 開局呈現：只在跟卡片格式的預設不同時才帶（見 card-transfer-resources）。 */
      openingMode?: string;
    };
    hashes: { card: string; welcome: string; worldbook: string; authorAsset: string; content: string };
    reviewLength?:ReviewLength;
    costProfile: {
      personaChars: number; worldbookEntryCount: number; worldbookEnabledCount: number; worldbookConstantCount: number;
      worldbookChars: number; worldbookConstantChars: number; estimatedConstantTokens: number; estimatedMaxTokens: number;
    };
  };
}

/** 精選：呼叫者在供應商那邊是不是本站的社群代表，以及本站精選名額用了多少。老供應商沒有這條路時是 null。 */
export interface FeaturedStatus { admin: boolean; featuredUsed: number; featuredQuota: number }

export interface ReviewMe { reviewer: boolean; pending?:number; reviews?:number; cases?:number; comments?:number; role?:"reviewer"|"manager"|"owner"; featured?: FeaturedStatus | null; blogWriter?: boolean }
export interface HeaderSummary { review: ReviewMe | null; notifications: { unread: number } | null }

export async function fetchReviewMe(token: string, provider = currentProvider(), signal?: AbortSignal): Promise<ReviewMe> {
  return json(await fetch(`${COMMUNITY_API}/review/me`, { headers: { ...from(), "X-Provider": provider, ...authHeaders(token) }, signal }));
}

export async function fetchHeaderSummary(token: string, provider: ProviderId, lang: string): Promise<HeaderSummary | null> {
  const query = new URLSearchParams({ lang });
  const response = await fetch(`${COMMUNITY_API}/me/header-summary?${query}`, {
    headers: { ...from(), "X-Provider": provider, ...authHeaders(token), "X-Device-Token": deviceToken() },
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 404 && response.headers.get("Content-Type")?.startsWith("text/plain")
    && (await response.clone().text()) === "404 Not Found") return null;
  return json<HeaderSummary>(response);
}

export async function fetchReviewQueue(token: string, lang?: string, tab?: "new" | "updates"): Promise<{ items: ReviewQueueItem[]; claimTtlMs: number; counts?: ReviewQueueCounts; batchGroups?: ReviewBatchGroup[] }> {
  const query = new URLSearchParams();
  if (lang) query.set("lang", lang);
  if (tab) query.set("tab", tab);
  const q = query.size ? `?${query}` : "";
  return json(await fetch(`${COMMUNITY_API}/review/queue${q}`, { headers: { ...from(), ...authHeaders(token) } }));
}

export interface ReviewTimelineItem {
  at: number; action: "submit" | "approve" | "reject" | "reopen" | "reopen_withdraw" | "drop" | "restore" | "hold" | "unhold" | "superseded" | "flip" | "flip_withdraw";
  round: number; actor: string | null; mine: boolean; source?: string | null; system?: "ai_fast_track"; reasons?: string[]; note?: string; marks?: string[]; suggestions?: string[]; current: boolean;
}
/** 單卡審核紀錄；coverageFrom＝事件紀錄的起點（之前的冷凍與不受理沒有紀錄） */
export async function fetchReviewTimeline(id: string, token: string): Promise<{ items: ReviewTimelineItem[]; coverageFrom: number | null }> {
  return json(await fetch(`${COMMUNITY_API}/review/${encodeURIComponent(id)}/timeline`, { headers: { ...from(), ...authHeaders(token) } }));
}

/** 不受理清單的一列；droppedSince 是案件起點（作者原樣重送沿用第一次的時間） */
export interface ReviewDroppedItem {
  id: string; cardId: string; name: string; avatarUrl: string | null; adultHidden: boolean; rating: Rating | null;
  source: "single" | "author_batch" | "device_batch" | "auto_same_content"; droppedSince: number; submittedAt: number; actor: string | null;
}
export type ReviewDroppedFilter = "all" | "single" | "batch" | "auto" | "aged";
export async function fetchDroppedReviews(token: string, lang: string, filter: ReviewDroppedFilter): Promise<{ items: ReviewDroppedItem[]; total: number }> {
  return json(await fetch(`${COMMUNITY_API}/review/dropped?${new URLSearchParams({ lang, filter })}`, { headers: { ...from(), ...authHeaders(token) } }));
}
export const dropReview = (id: string, token: string, marks?: string[]) => reviewAction<{ caseId: string }>(id, "drop", token, marks?.length ? { marks } : {});
export const restoreReview = (id: string, token: string) => reviewAction<{ restored: boolean }>(id, "restore", token, {});

export interface ReviewGroupItem { id: string; cardId: string; name: string; coverUrl: string | null; openingLine: string; adultHidden: boolean; dropped: boolean; held: boolean; claimedByOther: boolean }
export async function fetchReviewGroup(id: string, token: string, lang: string, scope: "author" | "device"): Promise<{ scope: "author" | "device"; items: ReviewGroupItem[] }> {
  return json(await fetch(`${COMMUNITY_API}/review/${encodeURIComponent(id)}/group?${new URLSearchParams({ lang, scope })}`, { headers: { ...from(), ...authHeaders(token) } }));
}
async function reviewPost<T>(path: string, token: string, body: unknown): Promise<T> {
  return json<T>(await fetch(`${COMMUNITY_API}/review/${path}`, { method: "POST", headers: { "Content-Type": "application/json", ...from(), ...authHeaders(token) }, body: JSON.stringify(body) }));
}
export interface ReviewBatchResult { batchId: string; dropped: string[]; skipped: { id: string; reason: string }[] }
/** 批量不受理（限管理員）。batchId 由呼叫端產生：結果不明時重送同一個批次不會多做 */
export const dropReviewBatch = (token: string, body: { anchorId: string; scope: "author" | "device"; ids: string[]; batchId: string }) => reviewPost<ReviewBatchResult>("drop-batch", token, body);
export const restoreReviewBatch = (token: string, batchId: string) => reviewPost<{ restored: string[] }>("restore-batch", token, { batchId });
export const markReviewAuthor = (id: string, token: string, body: { kind: "tier" | "batch"; value: string; reasonCode: string; note?: string }) =>
  reviewAction<{ id: string; expiresAt: number; profile: ReviewAuthorProfile | null }>(id, "author-mark", token, body);
/** 取消標記：撤銷人工覆寫，恢復自動標記 */
export const revokeReviewAuthorMark = (id: string, token: string, kind: "tier" | "batch") =>
  reviewAction<{ revoked: true; profile: ReviewAuthorProfile | null }>(id, "author-mark", token, { kind, revoke: true });

async function reviewAction<T>(id: string, action: string, token: string, body?: unknown): Promise<T> {
  const res = await fetch(`${COMMUNITY_API}/review/${encodeURIComponent(id)}/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...from(), ...authHeaders(token) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  return json<T>(res);
}

/** HearthRoom 精選卡：社群代表替社群把一張在榜的卡標成精選（或取消）；先同步到供應商，成功本站才記。 */
export async function setCardFeatured(cardId: string, featured: boolean, token: string, provider = currentProvider()): Promise<{ id: string; featured: boolean; featuredAt: number | null }> {
  const res = await fetch(`${COMMUNITY_API}/review/cards/${encodeURIComponent(cardId)}/featured`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...from(), "X-Provider": provider, ...authHeaders(token) },
    body: JSON.stringify({ featured }),
  });
  return json(res);
}

export const claimReview = (id: string, token: string) => reviewAction<{ id: string; claimedAt: number; generation: string }>(id, "claim", token);
export const releaseReview = (id: string, token: string, generation?:string) => reviewAction<void>(id, "release", token, {generation});
export const holdReview = (id: string, token: string, generation?: string) => reviewAction<{ hold: ReviewHold }>(id, "hold", token, { generation });
/** 管理員解凍別人冷凍的卡要帶理由 */
export const unholdReview = (id: string, token: string, reason?: string) => reviewAction<{ hold: null }>(id, "unhold", token, { reason });
/** 撤銷重新審核（限管理員，要寫理由） */
export const withdrawReopen = (id: string, token: string, reason: string) => reviewAction<{ status: string }>(id, "withdraw", token, { reason });
/** 審核決定的內容（蓋章與改了 AI 的定案共用同一組欄位） */
export interface ReviewDecisionBody { verdict: "approve" | "reject"; note?: string; reasons?: string[]; coaching?: boolean; marks?: string[]; suggestions?: string[] }
/** 定案的來源：照 AI、改了 AI、無 AI 對照；blind（舊雙盲「用我的」）只會出現在舊的定案上 */
/** ai_fast_track：AI 快速通道（已上架卡的更新，分級不變、AI 通過無標記，由系統核准）；只會出現在系統那一章，審核員不能送 */
export type ReviewFinalSource = "blind" | "ai" | "modified" | "human_no_ai" | "ai_fast_track";
/** 這張單目前判準版本的 AI 判斷：已判、交人，或還沒判 */
export type ReviewAiState = { state: "ready" | "handoff"; suggestion: ReviewAiSuggestion } | { state: "pending"; suggestion: null };
export interface ReviewAiSuggestion {
  id: string; criteriaVersion: string; model: string; verdict: "pass" | "reject" | "handoff" | null; reasons: string[]; flags: string[];
  confidence: number | null; handoffCause: string | null; note: string; phase: string; at: number;
  /** AI 寫給作者的說明草稿（只講卡片本身）；note 是只有審核員看得到的內部說明。舊版伺服器不帶 */
  authorNote?: string;
}
/**
 * 蓋章。一般待審單（AI 為主，ui-ai-first.md）帶 finalSource：ai＝照 AI 定案（不必帶決定內容；要帶審核標記時連結論一起帶）、
 * modified＝改了 AI 的建議、human_no_ai＝沒有 AI 建議，後兩種帶這次的決定。有 AI 建議時帶畫面上那一筆的 id 與時間：
 * AI 在這之間重判過，伺服器回 409 ai_changed，不會蓋成沒看過的結論。aiInaccurate＝審核員標「AI 判斷不準確」。
 * 回應的 finalSource 是實際記下的來源。重新審核照舊只帶決定。
 */
export const stampReview = (id: string, token: string, body: Partial<ReviewDecisionBody> & { generation?: string; finalSource?: ReviewFinalSource; aiNoteTypes?: string[]; aiNote?: string; aiSuggestionId?: string; aiSuggestionAt?: number; authorNote?: string; aiInaccurate?: boolean }) =>
  reviewAction<{ id: string; status: string; cardStatus: CardStatus; stamps: { approve: number; required: number }; finalSource?: ReviewFinalSource }>(id, "stamp", token, body);

export interface ReviewDecision {id:string;status:string;kind:string;verdict:'approve'|'reject';note:string;at:number;submittedAt:number;decidedAt:number|null;versionId:string|null;card:{id:string;name:string};canCorrect:boolean;corrected?:boolean;flip?:ReviewFlipState;finalSource?:'ai_fast_track'}
/** q：純數字＝卡號精確比對，其他＝卡名包含；伺服器搜全部紀錄。source=ai_fast_track（限管理員）：改列 AI 快速通道核准的單 */
export async function fetchReviewDecisions(token:string,lang:string,before?:number,q?:string,source?:'ai_fast_track'):Promise<{items:ReviewDecision[];nextCursor:number|null}>{
 const query=new URLSearchParams({lang});if(before)query.set('before',String(before));if(q)query.set('q',q);if(source)query.set('source',source);
 return json(await fetch(`${COMMUNITY_API}/review/decisions?${query}`,{headers:{...from(),...authHeaders(token)}}));
}
/** 駁回改判為通過（限管理員）：用同一個送審版本建一張改判單，由自己領著。同一個 operationId 重送回同一張單 */
export const startReviewFlip=(id:string,token:string,body:{operationId:string;reason:string})=>reviewAction<{id:string;flipOf:string;replayed:boolean}>(id,'flip',token,body);
/** 撤回改判（限發起的管理員）：維持原本的駁回、不通知作者 */
export const withdrawReviewFlip=(id:string,token:string)=>reviewAction<{status:'rejected'}>(id,'flip/withdraw',token,{});
export const correctReviewDecision=(id:string,token:string,body:{operationId:string;note:string})=>reviewAction<{status:'rejected';publicVersionId:string|null;publicState:'previous_version'|'unpublished'|'unchanged';operationId:string;replayed:boolean}>(id,'correction',token,body);
export interface AuthorReviewResult {name:string;status:string;note:string;submittedAt:number;decidedAt:number|null;versionId:string;corrected:boolean;correctedAt:number|null;rewardKept?:boolean;
 /** 審卡 V2：駁回理由代碼（舊單是空陣列）、是否附完整改法、送審種類（re＝更新） */
 reasons?:string[];coaching?:boolean;kind?:string;
 /** 通過並附改進建議的理由代碼；沒附是空陣列 */
 suggestions?:string[];
 /** 卡號與來源平台：「修改這張卡」連到編輯器 */
 cardNumber?:number;provider?:string}
export async function fetchAuthorReviewResult(id:string,token:string,lang:string):Promise<AuthorReviewResult>{
 return json(await fetch(`${COMMUNITY_API}/mine/reviews/${encodeURIComponent(id)}?lang=${encodeURIComponent(lang)}`,{headers:{...from(),...authHeaders(token)}}));
}

/** 審核時直接改標籤：要領著這張單。回傳存下去的那一份（去空白、去重後）。 */
export const updateReviewTags = (id: string, token: string, body: { tags: string[]; fandom?: string; fandomId?: string; generation?: string }) =>
  reviewAction<{ tags: string[]; fandom?: string; fandomId?: string }>(id, "tags", token, body);

export async function fetchReviewDetail(id: string, token: string): Promise<ReviewDetail> {
  return json(await fetch(`${COMMUNITY_API}/review/${encodeURIComponent(id)}/detail`, { headers: { ...from(), ...authHeaders(token) } }));
}

export interface OriginalitySource {
  cardId: string; name: string; status: "approved" | "pending" | "removed";
  firstSeenAt: number; earlier: boolean; similarity: number;
  /** 這張待審卡角色設定裡與該來源重複的原文區段 [start, end) */
  segments: [number, number][];
}
export type ReviewOriginality =
  | { available: false; reason: "no_snapshot" | "too_short" }
  | { available: true; similarity: number; units: number; comparedCards: number; segments: [number, number][]; sources: OriginalitySource[] };

/** 角色設定查重（只有審核人看得到）。 */
export async function fetchReviewOriginality(id: string, token: string): Promise<ReviewOriginality> {
  return json(await fetch(`${COMMUNITY_API}/review/${encodeURIComponent(id)}/originality`, { headers: { ...from(), ...authHeaders(token) } }));
}

// ---- 上游開放 API（跨網域）---------------------------------------------------

export interface Me { accountNumId: number; nickName: string; avatar: string; email?: string; analytics?: import("../../../shared/ga4").AnalyticsIdentity }

/** 登入者在本站的身分（不是供應商那邊的）：公開 ID、加入時間、連結了哪些供應商帳號。 */
export interface SiteMe {
  displayName?: string;
  bio?: string;
  avatarUrl?: string;
  handle: string;
  memberSince: number;
  reviewer: boolean;
  /** 審核人的角色；不是審核人就是 null（舊回應沒有這欄） */
  reviewerRole?: "reviewer" | "manager" | "owner" | null;
  identities: { provider: string; externalId: number; linkedAt: number; founding?: boolean }[];
  /** 成人內容開關（要先驗過年齡） */
  showNsfw: boolean;
  ageVerified: boolean;
  /** 同意過目前這一版成人內容聲明；沒有的話打開前要先走聲明窗 */
  adultConsent: boolean;
  /** 不想看的類型（目錄鍵）：榜單與搜尋不列這些類型的卡 */
  hiddenTags: string[];
  /** 打賞連結（標準網址） */
  tipLinks?: string[];
  /** 國家／地區（lib/country-region 的代碼）；舊回應沒有這欄 */
  countryRegion?: string;
  /** 主頁封面（shared/profile-covers.ts 的 id）；空字串＝用預設那張。舊回應沒有這欄 */
  cover?: string;
  /** 他人看我的關注／粉絲；舊回應沒有這兩欄 */
  followingVisibility?: FollowingVisibility;
  followersVisibility?: FollowersVisibility;
  /** 本人看的真實人數 */
  followers?: number;
  following?: number;
}

export interface SiteSettings { showNsfw: boolean; ageVerified: boolean; adultConsent: boolean; hiddenTags: string[]; followingVisibility?: FollowingVisibility; followersVisibility?: FollowersVisibility; countryRegion?: string }

/**
 * 本站的個人設定，可以只送其中一樣：成人內容開關（第一次開要帶生日 YYYY-MM-DD，伺服器只看一眼、不存；
 * 沒同意過目前這一版聲明要帶 consentVersion）、
 * 不想看的類型（完整清單，整份換掉）。回應永遠是三樣齊的現況。
 */
export async function updateSiteSettings(input: { showNsfw?: boolean; birthdate?: string; consentVersion?: number; hiddenTags?: string[]; followingVisibility?: FollowingVisibility; followersVisibility?: FollowersVisibility; countryRegion?: string }, token: string): Promise<SiteSettings> {
  return json(
    await fetch(`${COMMUNITY_API}/me/settings`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...from(), ...authHeaders(token) },
      body: JSON.stringify(input),
    }),
  );
}

/**
 * 遊客的成人內容開關（伺服器發加密 cookie 憑證，見 src/account-auth.ts 的 guestAdult）。
 * 沒帶 showNsfw 只回現況。跟其他 /v1/auth/* 一樣只收同源 POST、要帶 X-Hearthroom-Request。
 */
export async function updateGuestAdult(input: { showNsfw?: boolean; birthdate?: string; consentVersion?: number } = {}): Promise<Omit<SiteSettings, "hiddenTags">> {
  return json(
    await fetch("/v1/auth/adult", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "Content-Type": "application/json", "X-Hearthroom-Request": "1" },
      body: JSON.stringify(input),
    }),
  );
}

/**
 * 沙箱卡的存檔（舞台代作者腳本讀寫）：每個成員每張卡最多 10 個 key、單值 64 KB。
 * 錯誤碼 key_invalid／value_too_large／saves_full 由舞台那側翻成作者看得懂的 sdk 錯誤。
 */
export async function fetchCardSaves(roleId: string, token: string, provider: ProviderId = currentProvider()): Promise<Record<string, unknown>> {
  const body = await json<{ saves: Record<string, unknown> }>(
    await fetch(`${COMMUNITY_API}/me/cards/${encodeURIComponent(roleId)}/saves`, { headers: { ...from(), "X-Provider": provider, ...authHeaders(token) } }),
  );
  return body.saves ?? {};
}

export async function putCardSave(roleId: string, key: string, value: unknown, token: string, provider: ProviderId = currentProvider()): Promise<void> {
  await json(
    await fetch(`${COMMUNITY_API}/me/cards/${encodeURIComponent(roleId)}/saves/${encodeURIComponent(key)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...from(), "X-Provider": provider, "X-Device-Token": deviceToken(), ...authHeaders(token) },
      body: JSON.stringify({ value }),
    }),
  );
}

export async function deleteCardSave(roleId: string, key: string, token: string, provider: ProviderId = currentProvider()): Promise<void> {
  await json(
    await fetch(`${COMMUNITY_API}/me/cards/${encodeURIComponent(roleId)}/saves/${encodeURIComponent(key)}`, {
      method: "DELETE",
      headers: { ...from(), "X-Provider": provider, ...authHeaders(token) },
    }),
  );
}

/** language：目前的介面語言。新成員的國家／地區預設在第一次讀取時決定，要照介面語言，不照瀏覽器語言。 */
export async function fetchSiteMe(token: string): Promise<SiteMe> {
  return json<SiteMe>(await fetch(`${COMMUNITY_API}/me`, { headers: { ...from(), language: String(i18n.global.locale.value), ...authHeaders(token) } }));
}

export async function registerCardIdentity(roleId: string, token: string, provider: ProviderId = currentProvider()): Promise<{id:string;num:number;provider:ProviderId;sourceRoleId:string}> {
  return json(await fetch(`${COMMUNITY_API}/me/card-identities`, {
    method:'POST', headers:{...from(),'X-Provider':provider,...authHeaders(token),'Content-Type':'application/json'}, body:JSON.stringify({roleId}),
  }));
}

/** 卡片頁給作者本人的草稿狀態（GET /v1/me/cards/:roleId/draft）：草稿有沒有改了還沒送審、新版在不在審。 */
export interface DraftState { status?: string; updateStatus?: string; draftChanged: boolean }
/**
 * 卡片的共用狀態（玩家投票與計數），作者本人的設定（Worker src/card-state-routes.ts）。
 * live 是玩家的數字，draft 是作者自己試玩的那一份；宣告讀不到時伺服器回 503，不回空設定。
 */
export type SharedItem =
  | { kind: "poll"; counts: Record<string, number>; total: number }
  | { kind: "counter"; total: number; goal?: number; reachedAt?: number | null; previous?: number };
export interface SharedDeclaration { polls: Record<string, { options: string[]; share?: boolean }>; counters: Record<string, { goal?: number; maxStep: number; perMember: number; period?: string }> }
export interface SharedStateSettings {
  platformEnabled: boolean;
  authorOff: boolean;
  platformOff: boolean;
  declaration: SharedDeclaration;
  live: Record<string, SharedItem>;
  draft: Record<string, SharedItem>;
}
const sharedPath = (roleId: string) => `${COMMUNITY_API}/me/cards/${encodeURIComponent(roleId)}/shared-state`;
export async function fetchSharedStateSettings(roleId: string, token: string, provider: ProviderId = currentProvider()): Promise<SharedStateSettings> {
  return json(await fetch(sharedPath(roleId), { headers: { ...from(), "X-Provider": provider, ...authHeaders(token) } }));
}
export async function setSharedStateEnabled(roleId: string, enabled: boolean, token: string, provider: ProviderId = currentProvider()): Promise<{ authorOff: boolean }> {
  return json(await fetch(sharedPath(roleId), { method: "PUT", headers: { ...writeHeaders(token), "X-Provider": provider }, body: JSON.stringify({ enabled }) }));
}
/** ns 一定明確給：live 是玩家數字，draft 是作者自己試玩的那一份。 */
export async function resetSharedStateKey(roleId: string, key: string, ns: "live" | "draft", token: string, provider: ProviderId = currentProvider()): Promise<void> {
  await json(await fetch(`${sharedPath(roleId)}/${encodeURIComponent(key)}/reset`, { method: "POST", headers: { ...writeHeaders(token), "X-Provider": provider }, body: JSON.stringify({ ns }) }));
}
export async function clearSharedStateDraft(roleId: string, token: string, provider: ProviderId = currentProvider()): Promise<void> {
  await json(await fetch(`${sharedPath(roleId)}/draft/clear`, { method: "POST", headers: { ...writeHeaders(token), "X-Provider": provider }, body: "{}" }));
}

export async function fetchDraftState(roleId: string, token: string, provider: ProviderId = currentProvider()): Promise<DraftState> {
  return json(await fetch(`${COMMUNITY_API}/me/cards/${encodeURIComponent(roleId)}/draft`, { headers: { ...from(), "X-Provider": provider, ...authHeaders(token) } }));
}

export interface MyCard {
  num?: number;
  provider?: import("./provider").ProviderId;
  workId?: string;
  detailId?: string;
  sourceProvider?: import("./provider").ProviderId;
  sourceRoleId?: string;
  roleId: string;
  zone: Zone | "all";
  name: string;
  summary: string;
  avatarUrl: string | null;
  /** Portrait background; optional for cached and older responses. */
  backgroundUrl?: string | null;
  visibility: string;
  workVisibility?: import("./work-visibility").WorkVisibility;
  talkNum: number;
  registered: boolean;
  /** 本站的審核狀態；只有 registered 時才有。 */
  status?: CardStatus;
  updateStatus?: string;
  /** 審核員對這張已發布的卡發起了重新審核（卡照常公開）；理由與發起人不給作者 */
  reReview?: boolean;
  /** 最近一次駁回給作者的說明。 */
  note?: string;
  /** 過審那一版的級別（只有 registered 時才有）；null＝評級缺失（問卷上線前上架的一般卡），下次送審要補 */
  rating?: Rating | null;
  /** 已發布，但作者之後改過、還沒送審（草稿的內容版本跟過審那一版不同）；只在是的時候才有。 */
  draftChanged?: boolean;
  /** 作者還沒看過的新評論數；0 或看過就不帶。 */
  newComments?: number;
}

export interface ListingQuota {
  limit: number;
  used: number;
  /** 週的起點，毫秒 */
  weekStart: number;
  /** 下週的起點，毫秒；額度在這一刻重置 */
  weekEnd: number;
  /** 補充包還剩幾張：管理員發的額外登記次數，不隨週重置，免費額度用完才扣 */
  packRemaining: number;
  /** 同裝置其他帳號本週也佔用了共用免費額度（僅為 true 時存在） */
  deviceShared?: boolean;
}

export interface MyCardPage {
  items: MyCard[];
  /** 符合目前搜尋與篩選的張數（翻頁用）。 */
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
  opts: { provider?: import("./provider").ProviderId; page?: number; pageSize?: number; fresh?: boolean; filter?: "all" | "listed" | "unlisted"; access?: import("./work-visibility").WorkAccess; q?: string } = {},
): Promise<MyCardPage> {
  const params = new URLSearchParams();
  if (opts.page) params.set("page", String(opts.page));
  if (opts.pageSize) params.set("pageSize", String(opts.pageSize));
  if (opts.fresh) params.set("fresh", "1");
  if (opts.filter && opts.filter !== "all") params.set("filter", opts.filter);
  if (opts.q) params.set("q", opts.q);
  if (opts.access) params.set("access", opts.access);
  return json<MyCardPage>(
    await fetch(`${COMMUNITY_API}/me/cards?${params}`, { headers: { ...from(), ...(opts.provider ? {"X-Provider":opts.provider} : {}), "X-Device-Token": deviceToken(), ...authHeaders(token) } }),
  );
}

export async function fetchMe(token: string): Promise<Me> {
  return json<Me>(await fetch(`${UPSTREAM_API}/open/v1/me`, { headers: authHeaders(token) }));
}

/** 對指定的那一家問「我是誰」。已連接但目前沒在用的那一家，要靠它才問得到。 */
export async function fetchMeAt(apiBase: string, token: string): Promise<Me> {
  return json<Me>(await fetch(`${apiBase}/open/v1/me`, { headers: authHeaders(token) }));
}

/** 角色卡詳情。未登入的訪客也讀得到，所以 token 是選填的。 */
export async function fetchRoleDetail(roleId: string, token?: string, lang = "zh-Hans", provider: ProviderId = currentProvider()): Promise<Record<string, unknown>> {
  return json<Record<string, unknown>>(
    await fetch(`${provider === currentProvider() ? UPSTREAM_API : apiBaseOf(provider)}/open/v1/role/detail?roleId=${encodeURIComponent(roleId)}`, {
      headers: { language: lang, ...authHeaders(token) },
    }),
  );
}

// ---- 留言：本站自己的資料，掛在本站的卡上 -------------------------------------------

export interface Comment {
  commentId: string;
  content: string;
  parentId: string;
  rootId: string;
  replyToNickName: string;
  likeCount: number;
  replyCount: number;
  createTime: string;
  accountNickName: string;
  accountAvatar: string;
  /** 留言者在本站的公開 ID（作者頁網址用的那一個）。 */
  handle: string;
  isLiked: boolean;
  isOwner: boolean;
  isCreator: boolean;
  isPinned?: boolean;
  canPin?: boolean;
  canDelete: boolean;
  /** 留言者給這張卡的星數；沒評過是 null。舊版回應沒有這一欄。 */
  score?: number | null;
  /** removed＝頂層被移除但還有回覆，只留佔位（content 是空的）。被標記待審的留言照常是 visible。 */
  status: "visible" | "removed";
  removed: boolean;
  /** 文章留言：留言者是官方（寫文章的人）。卡片留言沒有這一欄。 */
  official?: boolean;
  replies?: Comment[];
}

/**
 * 留言的讀寫都打本站；登入的人帶自己那一家的 token，本站據此認出是哪個成員。
 * 成人內容的卡：留言區跟卡片頁同一道門，過了門的人帶 ?nsfw=1（見 viewerAccess）。
 */
const commentHeaders = (token?: string) => ({ ...from(), ...(token ? authHeaders(token) : {}) });
/** 留言掛在哪：本站的卡 id，或一篇部落格文章（文章沒有成人門，不帶 viewerAccess）。 */
export type CommentOn = string | { postId: string } | { workshopId: string };
export type CommentSort = "hot" | "new";
async function commentUrl(on: CommentOn, tail = "", query = ""): Promise<{ url: string; headers: Record<string, string> }> {
  if (typeof on !== "string" && "postId" in on) return { url: `${COMMUNITY_API}/blog/posts/${encodeURIComponent(on.postId)}/comments${tail}${query ? `?${query}` : ""}`, headers: {} };
  // 卡片與擴充都跟著成人門：看的人開了成人內容才帶權限（擴充的可達性由伺服器照原卡＋擴充一起判）
  const root = typeof on === "string" ? `${COMMUNITY_API}/cards/${encodeURIComponent(on)}` : `${COMMUNITY_API}/workshops/${encodeURIComponent(on.workshopId)}`;
  const access = await viewerAccess();
  const q = [query, access.param].filter(Boolean).join("&");
  return { url: `${root}/comments${tail}${q ? `?${q}` : ""}`, headers: access.headers };
}

export async function fetchComments(on: CommentOn, page: number, token?: string, sort?: CommentSort) {
  const { url, headers } = await commentUrl(on, "", sort ? `page=${page}&sort=${sort}` : `page=${page}`);
  return json<{ total: number; comments: Comment[]; isRoleCreator: boolean; pinnedCommentId?: string | null; mutedUntil?: number | null }>(await fetch(url, { headers: { ...headers, ...commentHeaders(token) } }));
}

export async function fetchReplies(on: CommentOn, rootId: string, page: number, token?: string) {
  const { url, headers } = await commentUrl(on, `/${encodeURIComponent(rootId)}/replies`, `page=${page}`);
  return json<{ total: number; replies: Comment[] }>(await fetch(url, { headers: { ...headers, ...commentHeaders(token) } }));
}

export async function createComment(on: CommentOn, body: { content: string; parentId?: string; rootId?: string }, token: string): Promise<{ commentId: string; status: "visible" }> {
  const { url } = await commentUrl(on);
  return json<{ commentId: string; status: "visible" }>(
    await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...commentHeaders(token) }, body: JSON.stringify(body) }),
  );
}

/** Card-author action; the server validates ownership and the public root target. */
export async function setCardCommentPin(cardId:string,commentId:string,pin:boolean,token:string):Promise<{isPinned:boolean}> {
 return json(await fetch(`${COMMUNITY_API}/cards/${encodeURIComponent(cardId)}/comments/${encodeURIComponent(commentId)}/pin`, {method:pin?'PUT':'DELETE',headers:commentHeaders(token)}));
}

export async function deleteComment(commentId: string, token: string): Promise<void> {
  const res = await fetch(`${COMMUNITY_API}/comments/${encodeURIComponent(commentId)}`, { method: "DELETE", headers: commentHeaders(token) });
  if (res.status !== 204) await json(res);
}

export async function likeComment(commentId: string, like: boolean, token: string): Promise<void> {
  await json(await fetch(`${COMMUNITY_API}/comments/${encodeURIComponent(commentId)}/like`, { method: like ? "PUT" : "DELETE", headers: commentHeaders(token) }));
}

export const REPORT_REASONS = ["spam", "abuse", "sexual", "privacy", "other"] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export async function reportComment(commentId: string, body: { reason: ReportReason; note: string }, token: string): Promise<{ ok: boolean }> {
  return json(await fetch(`${COMMUNITY_API}/comments/${encodeURIComponent(commentId)}/report`, { method: "POST", headers: { "Content-Type": "application/json", ...commentHeaders(token) }, body: JSON.stringify(body) }));
}

// ---- 留言審核：審核人（含 AI 審核帳號）處理留言；權限由服務端判 ----------------------

/** held＝待審：公開、被規則／檢舉／AI 標記的留言；放行清掉標記，移除才撤下。 */
export type CommentQueueTab = "held" | "reported" | "removed";
/** 待審的原因（comment-moderation.ts 的 FLAG_REASONS） */
export const COMMENT_FLAG_REASONS = ["keyword", "new_account_link", "too_many_links", "recent_removal", "reports", "ai"] as const;
export type CommentFlagReason = (typeof COMMENT_FLAG_REASONS)[number];
export interface QueuedComment {
  id: string;
  /** 卡片底下的留言，或部落格文章底下的留言（文章連到短網址 /blog/p/<id>）。 */
  target: { kind: "card"; id: string; title: string; cardNumber: number | null } | { kind: "post"; id: string; title: string; column: string; slug: string };
  author: { handle: string; displayName: string };
  content: string;
  status: string;
  holdReason: string | null;
  reports: { total: number; byReason: Record<string, number> };
  createdAt: number;
  moderatedAt: number | null;
  moderationReason: string | null;
  suggestedBy: "ai" | null;
}
/** held：待審數；holdRate7d：近 7 天新留言中曾被標記的比例，沒有新留言時 null；reports7d：近 7 天的檢舉數。 */
export interface CommentStats { held: number; openReports: number; removed7d: number; medianHandleMs7d: number | null; holdReasons7d: Record<string, number>; holdRate7d: number | null; reports7d: number }
/** 沒設（null）＝那條規則不啟用。 */
export interface CommentSettings { commentNewAccountDays: number | null; commentMaxLinks: number | null; commentReportFoldThreshold: number | null }
export interface CommentKeyword { id: string; pattern: string; createdAt: number }

async function staffRequest<T>(path: string, token: string, method = "GET", body?: unknown): Promise<T> {
  const res = await fetch(`${COMMUNITY_API}/moderation${path}`, {
    method,
    headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...from(), ...authHeaders(token) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  return json<T>(res);
}

export const fetchCommentQueue = (tab: CommentQueueTab, page: number, token: string, reason: CommentFlagReason | null = null) =>
  staffRequest<{ total: number; items: QueuedComment[] }>(`/comments?tab=${tab}&page=${page}${reason ? `&reason=${reason}` : ""}`, token);
export const fetchCommentStats = (token: string) => staffRequest<CommentStats>("/comments/stats", token);
export const decideComment = (id: string, body: { action: "release" | "remove" | "dismiss" | "flag"; reason: string; operationId: string }, token: string) =>
  staffRequest<{ id: string; status: string }>(`/comments/${encodeURIComponent(id)}/decision`, token, "POST", body);
export const muteMember = (handle: string, body: { days: 7 | 30 | null; reason: string; operationId: string }, token: string) =>
  staffRequest<{ until: number | null }>(`/members/${encodeURIComponent(handle)}/comment-mute`, token, "PUT", body);
export const unmuteMember = (handle: string, body: { reason: string; operationId: string }, token: string) =>
  staffRequest<void>(`/members/${encodeURIComponent(handle)}/comment-mute`, token, "DELETE", body);
export const fetchKeywords = (token: string) => staffRequest<{ items: CommentKeyword[] }>("/comment-keywords", token);
export const addKeyword = (pattern: string, operationId: string, token: string) =>
  staffRequest<{ items: CommentKeyword[] }>("/comment-keywords", token, "POST", { pattern, operationId });
export const removeKeyword = (id: string, operationId: string, token: string) =>
  staffRequest<{ items: CommentKeyword[] }>(`/comment-keywords/${encodeURIComponent(id)}`, token, "DELETE", { operationId });
export const fetchSettings = (token: string) => staffRequest<{ settings: CommentSettings; canEdit: boolean }>("/settings", token);
export const saveSettings = (settings: CommentSettings, operationId: string, token: string) =>
  staffRequest<{ settings: CommentSettings; canEdit: boolean }>("/settings", token, "PUT", { settings, operationId });

// ---- 評分：本站自己的資料，一位成員對一張卡一份 1–5 星 ----------------------------

export interface CardScore {
  /** 平均（小數一位）；沒人評過是 null */
  average: number | null;
  count: number;
  /** 評分人數是否已達公開顯示平均分的門檻 */
  sufficient?: boolean;
  /** 1 星到 5 星各幾筆 */
  histogram: number[];
  /** 自己給的分數；訪客或沒評過是 null */
  mine: number | null;
  /** Only the authenticated viewer's verified play progress. */
  eligibility?: ScoreEligibility | { unavailable: true };
}

export interface ScoreEligibility {
  eligible: boolean;
  turns: number;
  credits: string;
  requiredTurns: number;
  paidTurns: number;
  requiredCredits: string;
}

async function scoreUrl(cardId: string): Promise<{ url: string; headers: Record<string, string> }> {
  const access = await viewerAccess();
  return { url: `${COMMUNITY_API}/cards/${encodeURIComponent(cardId)}/score${access.param ? `?${access.param}` : ""}`, headers: access.headers };
}

export async function fetchCardScore(cardId: string, token?: string): Promise<CardScore> {
  const { url, headers } = await scoreUrl(cardId);
  return json<CardScore>(await fetch(url, { headers: { ...headers, ...commentHeaders(token) } }));
}

/** score 為 null 是收回評分。 */
export async function saveCardScore(cardId: string, score: number | null, token: string): Promise<void> {
  const { url, headers } = await scoreUrl(cardId);
  const res = await fetch(url, score === null
    ? { method: "DELETE", headers: { ...headers, ...commentHeaders(token) } }
    : { method: "PUT", headers: { "Content-Type": "application/json", ...headers, ...commentHeaders(token) }, body: JSON.stringify({ score }) });
  // 成功是 204 沒有內文：只在失敗時讀錯誤
  if (!res.ok) await json(res);
}

export interface RoleDraft {
  roleName?: string;
  roleDesc?: string;
  roleDetailDesc?: string;
  roleTag?: string[];
  userName?: string;
}

/**
 * 建立一張卡，預設有連結的人可玩。建好之後仍要作者自己決定要不要登記上榜。
 *
 * origin 自報「在本站建的」：上游把它記在卡上，本站的「我的卡片」與登記榜單只認這一種，
 * 作者在主站建的卡不會混進來。
 */
export async function createRole(draft: { roleName: string; language?: string; visibility?: "private" | "unlisted" }, token: string): Promise<{ roleId?: string }> {
  return json<{ roleId?: string }>(
    await fetch(`${UPSTREAM_API}/open/v1/role`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders(token) },
      body: JSON.stringify({ roleName: draft.roleName, language: draft.language, origin: "hearthroom", visibility: draft.visibility ?? "unlisted" }),
    }),
  );
}

/** Persist operationId before sending; a lost response reuses the same private card. */
export async function provisionRole(draft: { operationId: string; roleName: string; language: string }, token: string): Promise<{ roleId?: string; provisioning?: boolean }> {
  return json(await fetch(`${UPSTREAM_API}/open/v1/role/provision`, {
    method: "POST", headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({ ...draft, origin: "hearthroom" }),
  }));
}
export async function completeRoleProvision(roleId: string, draft: { roleName: string; language: string; visibility: "private" | "unlisted" }, token: string): Promise<unknown> {
  return json(await fetch(`${UPSTREAM_API}/open/v1/role/${encodeURIComponent(roleId)}/provisionComplete`, {
    method: "POST", headers: { "Content-Type": "application/json", ...authHeaders(token) }, body: JSON.stringify(draft),
  }));
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
/** 一筆限時積分：剩下的量、到期時刻、來源類別（Harper V0.2c；`kind` 是給玩家看的來源，見錢包的來源表）。 */
export interface ExpiryBatch { amount: number; expiresAt: string; kind?: string }
export interface Wallet {
  score: number;
  tempScore: number;
  plans: { tier: PlanTier; expiresAt: number }[];
  /** 限時積分逐筆明細，最早到期的在前；沒有就是空陣列。 */
  expiries?: ExpiryBatch[];
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

export async function fetchWallet(token: string, provider: ProviderId = currentProvider()): Promise<Wallet> {
  const raw = await json<Wallet & {available?:number;expiring?:number;expiries?:ExpiryBatch[]}>(await fetch(`${provider === currentProvider() ? UPSTREAM_API : apiBaseOf(provider)}/open/v1/me/wallet`, {headers:authHeaders(token)}));
  if (provider !== 'harbor') return raw;
  const expiriesSorted = () => [...(raw.expiries ?? [])].sort((a, b) => new Date(a.expiresAt).getTime() - new Date(b.expiresAt).getTime());
  // 契約形狀（score／tempScore／expiries，hearthroom openapi）：照收
  if (typeof raw.available !== 'number') return { score: raw.score ?? 0, tempScore: raw.tempScore ?? 0, plans: raw.plans ?? [], expiries: expiriesSorted() };
  // Harbor 現行形狀：能用的是 available（已扣掉凍結中的）。凍結先吃最早到期的限時積分，所以限時那一份以能用的為上限。
  const available = raw.available;
  const tempScore = Math.min(raw.expiring ?? 0, available);
  return { score: available - tempScore, tempScore, plans: [], expiries: expiriesSorted() };
}

/** 推薦：自己的推薦碼、規則（數字由服務決定，畫面不寫死）、邀請成果；不含任何被邀請人的身分。 */
export interface ReferralTerms { firstChatCredits?: number; firstChatDays?: number; inviterCredits?: number; inviterDays?: number; inviterStartAt?: string; inviterEndAt?: string; welcomeCredits: number; welcomeDays: number; firstPercent: number; firstCap: number; inviteePercent: number; rebatePercent: number; rebateDays: number; bindDays: number }
export interface ReferralInvite {
  boundAt: string; firstChat: "waiting" | "done" | "expired"; firstChatBy: string;
  credited: number; pending: number; pendingUntil: string | null;
}
export interface ReferralSummary {
  enabled: boolean; code: string; terms: ReferralTerms; referred: boolean; welcomeCredits: number;
  canRedeem: boolean; redeemUntil?: string; registeredAt: string; invited: number; purchased: number; earned: number;
  invites?: ReferralInvite[]; invitesTotal?: number;
}
export async function fetchReferral(token: string, provider: ProviderId = currentProvider()): Promise<ReferralSummary> {
  return json<ReferralSummary>(await fetch(`${apiBaseOf(provider)}/open/v1/me/referral`, { headers: authHeaders(token) }));
}
/**
 * 填別人的推薦碼。綁定後不能改，所以按鈕旁要講清楚。
 * via=link 是註冊前點過的分享連結帶進來的碼：服務把它當暫定的，本人之後手動填一次可以換掉。
 */
export async function redeemReferral(token: string, code: string, provider: ProviderId = currentProvider(), via: "manual" | "link" = "manual"): Promise<ReferralSummary> {
  return json<ReferralSummary>(await fetch(`${apiBaseOf(provider)}/open/v1/me/referral/redeem`, {
    method: "POST", headers: { ...authHeaders(token), "Content-Type": "application/json" }, body: JSON.stringify({ code, ...(via === "link" ? { via } : {}), deviceToken: deviceToken() }),
  }));
}

export interface ScoreRecord {
 rewardRecovery?:boolean;
  playerNote?: string;
  id: number | string;
  record: string;
  recordType: "add" | "sub" | string;
  score: number;
  createTime: string;
  /** 高頻返點（rebate／self_rebate）按台北時間整點彙總時的筆數與整點起點 */
  count?: number;
  hourStart?: string;
  /** 獎勵入帳與它的到期：是哪一種獎勵（checkin／task／newcomer／referral…），Harper V0.2c B3 起 */
  rewardKind?: string;
  /** 榜單獎勵那一列：是哪一個榜單榮譽（record 仍是 campaign）；其他列不帶 */
  rankHonor?: Honor;
  /** 限時積分入帳的到期時刻 */
  expiresAt?: string;
  /** 月卡的列：daily 每日、bonus 首張加贈；退款收回它們的那一列帶同樣的值（record 是 refund） */
  planKind?: "daily" | "bonus" | string;
  /** 支出列當時扣點的模型與線路，名字跟模型選單一樣、依 language 標頭；目錄對不到的舊列沒有 */
  modelName?: string;
  laneName?: string;
  /** 記憶壓縮另外扣的點數（和那一輪對話分開記帳） */
  memoryCompaction?: boolean;
  /** 一次消費從哪幾種積分來源扣、各扣多少（伺服器已合併同一次消費的扣款；見 lib/ledger-parts） */
  parts?: { source: string; amount: number }[];
}
export interface ScoreRecordPage {
  total: number;
  pages: number;
  hasNextPage: boolean;
  records: ScoreRecord[];
}

export async function fetchScoreRecords(token: string, page = 1, pageSize = 20, provider: ProviderId = currentProvider(), lang = "zh-Hant"): Promise<ScoreRecordPage> {
  return json<ScoreRecordPage>(
    await fetch(`${provider === currentProvider() ? UPSTREAM_API : apiBaseOf(provider)}/open/v1/me/score/records?pageNum=${page}&pageSize=${pageSize}`, {
      headers: { language: lang, ...authHeaders(token) },
    }),
  );
}

/** 某一天在本站的收支：spent／earned 都是正數，count 是那天的流水筆數。 */
export interface ScoreDay { date: string; spent: number; earned: number; count: number }

/** 最近幾天的每日收支，按瀏覽器所在時區切日，最舊的在前、沒有動靜的日子也有一格。範圍跟積分流水一致。 */
export async function fetchScoreSummary(token: string, days = 30, provider: ProviderId = currentProvider()): Promise<ScoreDay[]> {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const raw = await json<{ days: ScoreDay[] }>(
    await fetch(`${provider === currentProvider() ? UPSTREAM_API : apiBaseOf(provider)}/open/v1/me/score/summary?days=${days}&timezone=${encodeURIComponent(timezone)}`, {
      headers: authHeaders(token),
    }),
  );
  return raw.days;
}

/** 原站的充值頁。本站不碰付款，只把人送過去。 */
export const TOP_UP_URL = `${oauthBaseOf().replace("api.", "")}/pages/mine/vippay`;

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
      customInstructionsMaxChars?: number; jailbreakMaxChars?: number;
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
      body: JSON.stringify({ fields: (() => {
        const { jailbreak, ...rest } = fields;
        return jailbreak === undefined ? rest : { ...rest, customInstructions: jailbreak };
      })() }),
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
 * Worker 先向 Provider 刪除來源卡並全額收回期限內的獎勵，成功才撤下社群列表。
 * 呼叫前須輸入角色名稱，並明確確認當次實際收回金額。
 */
export interface CardDeletionState {sourceRoleId:string;rewardRecoveryCredits:number;state:'pending'|'confirmed'|'complete'}
export async function fetchCardDeletion(roleId:string,token:string):Promise<{deletion:CardDeletionState|null}>{
 return json(await fetch(`${COMMUNITY_API}/me/cards/${encodeURIComponent(roleId)}/delete`,{headers:authHeaders(token),cache:'no-store'}));
}

export async function deleteRole(roleId: string, token: string,rewardRecoveryCredits=0): Promise<void> {
  await json<{ message?: string }>(
    await fetch(`${COMMUNITY_API}/me/cards/${encodeURIComponent(roleId)}/delete`, { method: "POST", headers:{...authHeaders(token),"Content-Type":"application/json"},body:JSON.stringify({rewardRecoveryCredits}) }),
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
/**
 * 上傳一個檔到「我的資源」，回它的網址。
 *
 * 走三步：向上游要一個限時的上傳位址 → 瀏覽器把檔直接放進儲存 → 告訴上游「放好了」，
 * 它核對大小與真實型別後登記。位元組不經過上游的代理，所以沒有代理那個 125 秒的上限——
 * 之前慢一點的網路傳幾十 MB 的音檔就在那裡被切斷（2026-09-11）。
 *
 * 備援：上游還沒有這條路（404）、或直接放進儲存那一步根本連不上（跨站規則沒開、網路
 * 擋掉）就改走舊的一次送上去。已經放進儲存但登記失敗**不**備援——那會傳兩次。
 */
export async function uploadImage(file: File, token: string, roleId?: string, folderIds: string[] = [], onProgress?: (fraction: number) => void): Promise<string> {
  if (roleId) return uploadCardImage(file, token, roleId, onProgress);
  // 型別要宣稱：不給的話上游當成 PNG，SVG 也就照 PNG 簽進儲存。
  const intentRes = await libraryPost("uploadIntent", { byteSize: file.size, contentType: canonicalType(file) }, token);
  if (intentRes.status === 404) return uploadImageLegacy(file, token, roleId, folderIds);
  const intent = await libraryJson<{ uploadId?: string; uploadUrl?: string; contentType?: string }>(intentRes);
  if (!intent.uploadId || !intent.uploadUrl) return uploadImageLegacy(file, token, roleId, folderIds);
  try {
    await putToStorage(intent.uploadUrl, file, intent.contentType || "application/octet-stream", onProgress);
  } catch (err) {
    if (err instanceof StorageUnreachable) return uploadImageLegacy(file, token, roleId, folderIds);
    throw err;
  }
  // 檔名跟著送：上游以「圖庫前綴／檔名」存放，作者的程式碼靠它組網址，同名再傳會覆蓋同一件。
  const doneRes = await libraryPost("uploadComplete", { uploadId: intent.uploadId, fileName: file.name, roleId: roleId || undefined, folderIds }, token);
  const done = await libraryJson<{ imageUrl?: string }>(doneRes);
  if (!done.imageUrl) throw new ApiError(doneRes.status, i18n.global.t("state.uploadFailed"));
  onProgress?.(1);
  return done.imageUrl;
}

/** 連儲存都連不上（回應狀態 0）：還沒送出任何位元組，可以安全地改走舊路。 */
/** Card-owned images never fall back to personal-library storage. */
type CardUploadTicket = { uploadId: string; uploadUrl: string; contentType: string; expiresAt?: string; uploaded?: boolean; sending?: Promise<void> };
const cardUploadTickets = new WeakMap<File, Map<string, Promise<CardUploadTicket>>>();
export async function uploadCardImage(file: File, token: string, roleId: string, onProgress?: (fraction: number) => void): Promise<string> {
  // Retain the File and ticket together only in memory; never replay another
  // provider/account's ticket. Losing complete's response must not create a new upload.
  const identity = `${UPSTREAM_API}\n${roleId}\n${token}`;
  let tickets = cardUploadTickets.get(file);
  if (!tickets) cardUploadTickets.set(file, tickets = new Map());
  let pending = tickets.get(identity);
  if (!pending) {
    pending = (async () => {
      const res = await cardImagePost(roleId, "uploadIntent", { byteSize: file.size, contentType: canonicalType(file) }, token);
      const ticket = await libraryJson<CardUploadTicket>(res);
      if (!ticket.uploadId || !ticket.uploadUrl) throw new ApiError(503, i18n.global.t("state.uploadFailed"));
      return ticket;
    })();
    tickets.set(identity, pending);
  }
  let ticket: CardUploadTicket;
  try { ticket = await pending; } catch (err) { tickets.delete(identity); throw err; }
  if (!ticket.uploaded) {
    if (ticket.expiresAt && Date.parse(ticket.expiresAt) <= Date.now()) {
      tickets.delete(identity);
      return uploadCardImage(file, token, roleId, onProgress);
    }
    ticket.sending ??= putToStorage(ticket.uploadUrl, file, ticket.contentType, onProgress);
    try { await ticket.sending; ticket.uploaded = true; } finally { ticket.sending = undefined; }
  }
  const doneRes = await cardImagePost(roleId, "uploadComplete", { uploadId: ticket.uploadId }, token);
  const done = await libraryJson<{ imageUrl: string }>(doneRes);
  if (!done.imageUrl) throw new ApiError(503, i18n.global.t("state.uploadFailed"));
  tickets.delete(identity);
  onProgress?.(1);
  return done.imageUrl;
}

function cardImagePost(roleId: string, operation: "uploadIntent" | "uploadComplete" | "adopt", body: unknown, token: string): Promise<Response> {
  return fetch(`${UPSTREAM_API}/open/v1/role/${encodeURIComponent(roleId)}/images/${operation}`, {
    method: "POST", headers: { ...authHeaders(token), "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
}

export async function adoptCardImage(roleId: string, imageId: string, token: string): Promise<string> {
  const res = await cardImagePost(roleId, "adopt", { imageId }, token);
  const done = await libraryJson<{ imageUrl: string }>(res);
  if (!done.imageUrl) throw new ApiError(503, i18n.global.t("state.uploadFailed"));
  return done.imageUrl;
}

class StorageUnreachable extends Error {}

/**
 * 用 XMLHttpRequest 而不是 fetch：只有它給得出上傳進度。
 * Content-Type 送上游指定的值，不送 file.type：那個型別連同檔案大小一起簽在網址裡，
 * 送別的儲存端就拒收（真正的型別由上游在登記時從檔案內容判斷）。
 */
function putToStorage(url: string, file: File, contentType: string, onProgress?: (fraction: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable && e.total > 0) onProgress?.(e.loaded / e.total); };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new ApiError(xhr.status, i18n.global.t("state.uploadFailed")));
    };
    xhr.onerror = () => reject(new StorageUnreachable("storage unreachable"));
    xhr.onabort = () => reject(new StorageUnreachable("storage aborted"));
    xhr.send(file);
  });
}

async function uploadImageLegacy(file: File, token: string, roleId?: string, folderIds: string[] = []): Promise<string> {
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
  /** 綁在幾張卡上。只有「我的書」清單帶；還綁著卡的書刪不掉。 */
  usedByCards?: number;
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
    semanticRecall: entry.semanticRecall !== false,
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
  /** 卡片格式（mmd／tavern／fengyue）。讀回來要帶著：存檔時整份覆寫，漏讀就會被洗成空的。 */
  cardFormat: string;
  /** 首屏網頁：開新對話時畫布最上方的作者網頁，只顯示、不送模型。 */
  openingPage: string;
  cardCss?: string;
  cardCssDialect?: string;
  /** 開局呈現（greeting｜page）。舊上游不帶就是沒有，編輯頁照卡片格式判斷。 */
  openingMode?: string;
  /** 開場網頁的大小（UTF-8 位元組）。超過 512 KB 時 openingPage 是空的，只有大小與讀取網址；舊上游不帶。 */
  openingPageBytes?: number;
  /** 讀整份開場網頁的 API 路徑（相對於上游，例如 /open/v1/role/author-asset/opening?roleId=…）。 */
  openingPageUrl?: string;
  /** 舊的封存版本，大開場網頁已不保留。 */
  openingPageExpired?: boolean;
  status: string;
  version: number;
}
const asAuthorAsset = (b: Partial<AuthorAsset>): AuthorAsset => ({
  rules: Array.isArray(b.rules) ? b.rules : [],
  mountTrigger: b.mountTrigger ?? "",
  mountLayer: b.mountLayer ?? "",
  pageMode: b.pageMode ?? "",
  cardFormat: b.cardFormat ?? "",
  openingPage: b.openingPage ?? "",
  ...(typeof b.cardCss === "string" ? { cardCss: b.cardCss } : {}),
  ...(typeof b.cardCssDialect === "string" ? { cardCssDialect: b.cardCssDialect } : {}),
  ...(b.openingMode ? { openingMode: b.openingMode } : {}),
  ...(typeof b.openingPageBytes === "number" && b.openingPageBytes >= 0 ? { openingPageBytes: b.openingPageBytes } : {}),
  ...(typeof b.openingPageUrl === "string" && b.openingPageUrl ? { openingPageUrl: b.openingPageUrl } : {}),
  ...(b.openingPageExpired === true ? { openingPageExpired: true } : {}),
  status: b.status ?? "none",
  version: b.version ?? 0,
});
export async function fetchAuthorAsset(roleId: string, token: string): Promise<AuthorAsset> {
  return asAuthorAsset(await json<Partial<AuthorAsset>>(
    await fetch(`${UPSTREAM_API}/open/v1/role/author-asset?roleId=${encodeURIComponent(roleId)}`, { headers: authHeaders(token) }),
  ));
}

/**
 * 整份覆寫，帶樂觀鎖（body.version 是讀到的版本）。版本不符上游回 409。
 * openingPage 送空字串時，上游存著的頁面若超過 512 KB 視為不變；要清掉它得另帶 openingPageClear。
 */
export type AuthorAssetWrite = Omit<AuthorAsset, "status" | "openingPageBytes" | "openingPageUrl" | "openingPageExpired"> & { openingPageClear?: true };
export async function saveAuthorAsset(roleId: string, body: AuthorAssetWrite, token: string): Promise<AuthorAsset> {
  return asAuthorAsset(await json<Partial<AuthorAsset>>(
    await fetch(`${UPSTREAM_API}/open/v1/role/${encodeURIComponent(roleId)}/author-asset`, {
      method: "PUT",
      headers: writeHeaders(token),
      body: JSON.stringify(body),
    }),
  ));
}

/** 上傳或下載開場網頁時的進度：loaded／total 都是位元組，total 不知道時是 0。 */
export type TransferProgress = (loaded: number, total: number) => void;

/**
 * 用原始 HTML 上傳開場網頁（超過 512 KB 一律走這條）：本體就是那份檔案，不用 JSON 跳脫。
 * 用 XHR 而不是 fetch：要上傳進度，而且上游要求 Content-Length（串流本體會變成分塊傳送被拒）。
 * 只換開場網頁，其他作者資產欄位不動；成功回新版本。
 */
export function uploadOpeningPage(
  roleId: string,
  page: Blob,
  version: number,
  token: string,
  opts: { onProgress?: TransferProgress; signal?: AbortSignal } = {},
): Promise<AuthorAsset> {
  return new Promise((resolve, reject) => {
    if (opts.signal?.aborted) { reject(new DOMException("aborted", "AbortError")); return; }
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", `${UPSTREAM_API}/open/v1/role/${encodeURIComponent(roleId)}/opening-page?version=${encodeURIComponent(String(version))}`);
    for (const [name, value] of Object.entries(authHeaders(token))) xhr.setRequestHeader(name, value);
    xhr.setRequestHeader("Content-Type", "text/html; charset=utf-8");
    const abort = () => xhr.abort();
    opts.signal?.addEventListener("abort", abort, { once: true });
    const done = () => opts.signal?.removeEventListener("abort", abort);
    xhr.upload.onprogress = (e) => opts.onProgress?.(e.loaded, e.lengthComputable ? e.total : page.size);
    xhr.onabort = () => { done(); reject(new DOMException("aborted", "AbortError")); };
    xhr.onerror = () => { done(); reject(new ApiError(0, i18n.global.t("state.requestFailed"))); };
    xhr.onload = () => {
      done();
      const res = new Response(xhr.responseText || "{}", { status: xhr.status, headers: { "Content-Type": "application/json" } });
      json<Partial<AuthorAsset>>(res).then((body) => resolve(asAuthorAsset(body)), reject);
    };
    xhr.send(page);
  });
}

/**
 * 讀整份開場網頁（上游沒內嵌的大頁面）。邊讀邊回報進度，讀進 Blob、不轉成字串。
 * url 是作者資產回的相對路徑；total 用作者資產回的大小（回應壓縮過時 Content-Length 是壓縮後的大小）。
 */
export async function fetchOpeningPage(
  url: string,
  token: string,
  opts: { total?: number; onProgress?: TransferProgress; signal?: AbortSignal } = {},
): Promise<Blob> {
  const target = /^https?:/i.test(url) ? url : `${UPSTREAM_API}${url.startsWith("/") ? "" : "/"}${url}`;
  const res = await fetch(target, { headers: authHeaders(token), signal: opts.signal });
  if (!res.ok) await json(res);
  const total = opts.total ?? 0;
  if (!res.body) {
    const blob = await res.blob();
    opts.onProgress?.(blob.size, total || blob.size);
    return new Blob([blob], { type: "text/html" });
  }
  const reader = res.body.getReader();
  const parts: BlobPart[] = [];
  let pending: Uint8Array[] = [];
  let pendingBytes = 0;
  let loaded = 0;
  // 每 8 MB 收成一個 Blob：不讓上千個小區塊一直留在 JS 記憶體裡。
  const flush = () => { if (pending.length) { parts.push(new Blob(pending as BlobPart[])); pending = []; pendingBytes = 0; } };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    pending.push(value);
    pendingBytes += value.byteLength;
    loaded += value.byteLength;
    if (pendingBytes >= 8 * 1024 * 1024) flush();
    opts.onProgress?.(loaded, total);
  }
  flush();
  return new Blob(parts, { type: "text/html" });
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
  semanticRecall?: boolean;
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

/** 作者自己叫這個名字的那本（書名不重複：匯入同名的書就是覆蓋它）。沒有回 null。 */
export async function findWorldbookByName(token: string, name: string): Promise<WorldbookSummary | null> {
  const wanted = name.trim();
  if (!wanted) return null;
  const books = await fetchMyWorldbooks(token, wanted);
  return books.find((b) => b.name.trim() === wanted) ?? null;
}

/** 刪掉作者自己的一本書。還綁在卡上的會被拒絕（asset_in_use），要先從卡上拿掉。 */
export async function deleteWorldbook(worldbookId: string, token: string): Promise<void> {
  await json(
    await fetch(`${UPSTREAM_API}/open/v1/worldbook/${encodeURIComponent(worldbookId)}`, {
      method: "DELETE",
      headers: authHeaders(token),
    }),
  );
}

/** 把一本書從作者自己的卡上拿掉；書本身留著。已經沒綁的照樣成功。 */
export async function unbindWorldbook(worldbookId: string, roleId: string, token: string): Promise<void> {
  await json(
    await fetch(`${UPSTREAM_API}/open/v1/worldbook/${encodeURIComponent(worldbookId)}/unbind`, {
      method: "POST",
      headers: writeHeaders(token),
      body: JSON.stringify({ roleId }),
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

/** 素材的種類：表名還叫 image，但每一種檔都住那裡。code 是卡片自己的程式（JS、WASM），data 是 JSON。 */
export type LibraryKind = "image" | "video" | "audio" | "font" | "code" | "data";

export interface LibraryImage {
  id: number;
  imageUrl: string;
  /** 上傳時的檔名；網址是「圖庫前綴／檔名」，同名再傳會覆蓋。舊圖（隨機碼網址）沒有。 */
  fileName?: string;
  kind: LibraryKind;
  mimeType?: string;
  /** 上傳時的位元組數；2026-09 前的存量圖是 0。 */
  byteSize: number;
  /** pending＝審核中、pass＝通過、reject＝被駁回；舊圖是 legacy，當通過看。 */
  moderationState?: string;
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
  /** 作者的圖庫前綴（不含結尾斜線）：卡片程式碼裡用「前綴／檔名」組網址。 */
  libraryPrefix: string;
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
  const data = await libraryJson<{ imageList?: LibraryImage[]; total?: number; quota?: number; usedBytes?: number; byteQuota?: number; libraryPrefix?: string }>(res);
  return {
    items: (data.imageList ?? []).map((i) => ({ ...i, kind: i.kind || "image", byteSize: Number(i.byteSize ?? 0) })),
    total: Number(data.total ?? 0),
    quota: Number(data.quota ?? 0),
    usedBytes: Number(data.usedBytes ?? 0),
    byteQuota: Number(data.byteQuota ?? 0),
    libraryPrefix: String(data.libraryPrefix ?? ""),
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

export type CardPlatform={provider:import('./provider').ProviderId;roleId:string;playable:boolean};
export async function fetchCardPlatforms(cardId:string):Promise<{provider:import('./provider').ProviderId;roleId:string;playable:boolean}[]> {
  const viewer=await viewerAccess();
  const q=viewer.param?`?${viewer.param}`:'';
  const login=viewer.headers.Authorization ? null : loginViewer ? await loginViewer().catch(()=>null) : null;
  const body=await json<{platforms:{provider:import('./provider').ProviderId;roleId:string;playable:boolean}[]}>(await fetch(`${COMMUNITY_API}/cards/${encodeURIComponent(cardId)}/platforms${q}`,{headers:{...from(),...authHeaders(login || undefined),...viewer.headers}}));
  return body.platforms;
}



export async function updateSiteProfile(token:string, profile:{displayName:string;bio:string;tipLinks?:string[];cover?:string;avatar?:File|null;removeAvatar?:boolean}):Promise<SiteMe> {
 const body=new FormData();body.set('displayName',profile.displayName);body.set('bio',profile.bio);
 if(profile.tipLinks)body.set('tipLinks',JSON.stringify(profile.tipLinks));
 if(profile.cover!==undefined)body.set('cover',profile.cover);
 if(profile.avatar)body.set('avatar',profile.avatar);
 if(profile.removeAvatar)body.set('removeAvatar','true');
 return json<SiteMe>(await fetch(`${COMMUNITY_API}/me/profile`,{method:'PUT',headers:{...from(),...authHeaders(token)},body}));
}

/** 世界模式的成員：整包寫入（作者），卡片因此成為世界卡。 */
export async function putRoleWorld(roleId: string, world: Record<string, unknown>, token: string): Promise<unknown> {
  return json<unknown>(
    await fetch(`${UPSTREAM_API}/open/v1/role/${encodeURIComponent(roleId)}/world`, {
      method: "PUT",
      headers: writeHeaders(token),
      body: JSON.stringify(world),
    }),
  );
}

/** 拿掉世界模式的成員：卡片回到普通單卡；世界觀與世界書不動。 */
export async function deleteRoleWorld(roleId: string, token: string): Promise<unknown> {
  return json<unknown>(
    await fetch(`${UPSTREAM_API}/open/v1/role/${encodeURIComponent(roleId)}/world`, {
      method: "DELETE",
      headers: writeHeaders(token),
    }),
  );
}

/**
 * 卡片變數：整包寫入（上游正規化一次後回存好的樣子）。
 * 驗證失敗是 400 validate_reject，原因在 detail.reason（骨架太大、太深、規則路徑對不上…），
 * 各給一句人話（editor.state.reject.<reason>）；ApiError.reason 帶著它，編輯頁才知道是這一區出的錯。
 */
export async function putRoleState(roleId: string, state: StatePayload, token: string): Promise<{ state: unknown }> {
  const res = await fetch(`${UPSTREAM_API}/open/v1/role/${encodeURIComponent(roleId)}/state`, {
    method: "PUT",
    headers: writeHeaders(token),
    body: JSON.stringify(state),
  });
  if (!res.ok) {
    const body = (await res.clone().json().catch(() => ({}))) as { error?: string; detail?: { reason?: unknown } };
    const reason = typeof body.detail?.reason === "string" ? body.detail.reason : "";
    if (body.error === "validate_reject" && reason && i18n.global.te(`editor.state.reject.${reason}`)) {
      throw new ApiError(res.status, i18n.global.t(`editor.state.reject.${reason}`, stateLimitParams()), "validate_reject", undefined, reason);
    }
  }
  return json<{ state: unknown }>(res);
}

/** 拿掉卡片變數：之後的對話不再帶數值，既有對話裡的紀錄不動。 */
export async function deleteRoleState(roleId: string, token: string): Promise<{ state: null }> {
  return json<{ state: null }>(
    await fetch(`${UPSTREAM_API}/open/v1/role/${encodeURIComponent(roleId)}/state`, {
      method: "DELETE",
      headers: writeHeaders(token),
    }),
  );
}


/** Owner-only reference to the currently published immutable content. */
export interface ApprovedDraft { operationId:string; approvedRoleId:string; approvalRevision:string; policyRevision:string }
export async function fetchApprovedDraft(roleId:string,token:string):Promise<ApprovedDraft>{
 return json<ApprovedDraft>(await fetch(`${UPSTREAM_API}/open/v1/role/${encodeURIComponent(roleId)}/approved`,{headers:authHeaders(token)}));
}
export async function saveApprovedDraft(roleId:string,version:ApprovedDraft,token:string):Promise<ApprovedDraft>{
 return json<ApprovedDraft>(await fetch(`${UPSTREAM_API}/open/v1/role/${encodeURIComponent(roleId)}/approved`,{method:'POST',headers:{...authHeaders(token),'Content-Type':'application/json'},body:JSON.stringify(version)}));
}
