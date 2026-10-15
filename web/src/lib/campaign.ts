/**
 * 分享獎勵活動：運營設定的管理呼叫（/v1/moderation/campaigns、/v1/moderation/campaign-pool）與時區換算。
 * 形狀照 src/campaign-routes.ts。業務數字（檔位金額、門檻、保留天數）全部來自服務端，這裡不放預設值。
 */
import { ApiError, describeApiError } from "./api";
import type { Localized } from "./blog";
import { COMMUNITY_API } from "./config";
import { i18n } from "./i18n";
import { currentProvider } from "./provider";
import { currentSurface } from "./track";

export const TIERS = ["light", "original", "guide", "video"] as const;
export type Tier = (typeof TIERS)[number];
export type CampaignStatus = "draft" | "active" | "ended";
export type CampaignPhase = "draft" | "upcoming" | "open" | "ended";

export interface Campaign {
  id: string; slug: string; title: Localized; intro: Localized; bannerKey: string | null; bannerUrl: string | null;
  startsAt: number | null; endsAt: number | null; timezone: string | null; submitDeadline: number | null; payoutDeadline: number | null;
  tiers: Partial<Record<Tier, number>>; extraPlacementAmount: number | null; flagBurstThreshold: number | null; evidenceRetentionDays: number;
  status: CampaignStatus; version: number; createdAt: number; updatedAt: number;
}
/** 整份覆寫：沒給的欄位服務端視為清空（保留天數沒給是服務端的預設）。 */
export interface CampaignInput {
  slug: string; title: Localized; intro: Localized; bannerKey: string | null;
  startsAt: number | null; endsAt: number | null; timezone: string | null; submitDeadline: number | null; payoutDeadline: number | null;
  tiers: Partial<Record<Tier, number>>; extraPlacementAmount: number | null; flagBurstThreshold: number | null; evidenceRetentionDays?: number;
}
/** Provider 的點數池設定，只能看；configured 為 false 時其餘欄位不存在。 */
export type CampaignPool =
  | { configured: false }
  | { configured: true; enabled: boolean; usageScope: "all" | "agent_only" | null; validityDays: number | null; maxPayout: number | null; balance: number; paidTotal: number; updatedAt: string | null };

/** 活動在這個語言的名字；沒有就退回正體，再退回任何一個。 */
export const localized = (l: Localized, locale: string) => l[locale] || l["zh-Hant"] || Object.values(l).find(Boolean) || "";

// ---- 時區 ---------------------------------------------------------------------

/** 設定頁的時區選單；預選台北，只是預填。 */
export const TIMEZONES = ["Asia/Taipei", "Asia/Shanghai", "Asia/Hong_Kong", "Asia/Tokyo", "Asia/Seoul", "UTC", "America/Los_Angeles", "America/New_York", "Europe/London"] as const;
export const DEFAULT_TIMEZONE = "Asia/Taipei";

/** 某個時刻在 tz 的牆上時間，拆成數字。 */
function wall(ms: number, tz: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(ms);
  const n = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  return { y: n("year"), mo: n("month"), d: n("day"), h: n("hour"), mi: n("minute"), s: n("second") };
}
const offsetAt = (ms: number, tz: string) => {
  const w = wall(ms, tz);
  return Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s) - Math.floor(ms / 1000) * 1000;
};

/** datetime-local 的值（YYYY-MM-DDTHH:mm）當成 tz 的牆上時間，換成 epoch 毫秒；格式不對回 null。 */
export function zonedToEpoch(local: string, tz: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) return null;
  const guess = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!);
  const first = guess - offsetAt(guess, tz);
  // 夏令時間切換附近，猜的那一刻跟結果的位移可能不同：用結果的位移再算一次
  return guess - offsetAt(first, tz);
}

/** epoch 毫秒在 tz 的牆上時間，給 datetime-local 用。 */
export function epochToZoned(ms: number, tz: string): string {
  const w = wall(ms, tz);
  const p = (v: number) => String(v).padStart(2, "0");
  return `${w.y}-${p(w.mo)}-${p(w.d)}T${p(w.h)}:${p(w.mi)}`;
}

/** 時區在這個語言的名稱（日本標準時間、Japan Standard Time）。 */
export function zoneName(tz: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { timeZone: tz, timeZoneName: "long" }).formatToParts(Date.now()).find((p) => p.type === "timeZoneName")?.value ?? tz;
  } catch {
    return tz;
  }
}

/** 活動期間，用活動自己的時區顯示，後面帶時區名稱。 */
export function formatPeriod(c: { startsAt: number | null; endsAt: number | null; timezone: string | null }, locale: string): string {
  const tz = c.timezone || DEFAULT_TIMEZONE;
  const f = new Intl.DateTimeFormat(locale, { timeZone: tz, dateStyle: "medium", timeStyle: "short" });
  const range = c.startsAt !== null && c.endsAt !== null ? f.formatRange(c.startsAt, c.endsAt) : [c.startsAt, c.endsAt].filter((v): v is number => v !== null).map((v) => f.format(v)).join(" – ");
  return range ? `${range} (${zoneName(tz, locale)})` : "";
}

// ---- 管理呼叫 -------------------------------------------------------------------

/** 400 campaign_invalid 帶的欄位（startsAt、tiers.video…），讓表單把那一格標出來。 */
export class CampaignError extends ApiError {
  constructor(status: number, message: string, code: string, readonly field = "") { super(status, message, code); }
}

const FIELD_LABEL: Record<string, string> = {
  slug: "campaign.field.slug", title: "campaign.field.title", intro: "campaign.field.intro", bannerKey: "campaign.field.banner",
  startsAt: "campaign.field.startsAt", endsAt: "campaign.field.endsAt", timezone: "campaign.field.timezone",
  submitDeadline: "campaign.field.submitDeadline", payoutDeadline: "campaign.field.payoutDeadline", tiers: "campaign.field.tiers",
  extraPlacementAmount: "campaign.field.extra", flagBurstThreshold: "campaign.field.burst", evidenceRetentionDays: "campaign.field.retention",
};
/** 申請、審核、發放的 share_invalid 欄位。evidenceIds 與 evidence（沒連結也沒截圖）都講成同一格。 */
const SHARE_FIELDS = ["content", "title", "cardId", "platform", "location", "publishedAt", "url", "note", "requestedTier", "evidence", "tier", "reason"] as const;
const SHARE_FIELD_LABEL: Record<string, string> = { ...Object.fromEntries(SHARE_FIELDS.map((f) => [f, `campaign.share.field.${f}`])), evidenceIds: "campaign.share.field.evidence" };
/** 欄位在畫面上的名字；tiers.<檔> 用那一檔的名字。scope 是 share 時用申請表的欄位名（title 是內容標題，不是活動名稱）。 */
export function fieldLabel(field: string, scope: "campaign" | "share" = "campaign"): string {
  const t = i18n.global.t;
  if (scope === "share") return SHARE_FIELD_LABEL[field] ? t(SHARE_FIELD_LABEL[field]!) : "";
  if (field.startsWith("tiers.")) return t(`campaign.tier.${field.slice("tiers.".length)}`);
  return FIELD_LABEL[field] ? t(FIELD_LABEL[field]!) : "";
}
/** 設定頁的碼沿用原本的文案。 */
const SETTINGS_MESSAGE: Record<string, string> = {
  campaign_version_conflict: "campaign.error.conflict", campaign_slug_taken: "campaign.error.slugTaken", campaign_ended: "campaign.error.ended",
  campaign_not_active: "campaign.error.notActive", campaign_image_invalid: "campaign.error.upload", campaign_image_unavailable: "campaign.error.upload",
  campaign_pool_unavailable: "campaign.error.pool",
};
/** 申請、截圖、審核、發放的碼：每個都有 campaign.error.<碼>。頁面要講得更細的另外處理，這裡是通用的一句。 */
const CAMPAIGN_CODES = new Set([
  "campaign_not_found", "campaign_not_open", "share_content_not_found", "evidence_not_attachable", "campaign_rate_limited", "campaign_operation_repeated",
  "share_placement_not_found", "share_not_editable", "campaign_submit_closed", "evidence_invalid", "evidence_rate_limited", "evidence_unavailable", "evidence_purged",
  "evidence_not_found", "share_self_review", "share_version_conflict", "share_already_decided", "agent_not_allowed", "community_admin_required", "share_self_payout",
  "share_payout_not_found", "campaign_not_payable", "campaign_payout_closed", "share_nothing_due", "share_payout_in_progress", "share_payout_not_retryable",
  "share_payout_not_cancellable", "share_payout_not_pending", "share_payout_stale",
]);

function messageOf(status: number, code: string, field: string): string {
  const t = i18n.global.t;
  if (code === "campaign_invalid") {
    const label = fieldLabel(field);
    return label ? t("campaign.error.invalid", { field: label }) : t("campaign.error.invalidAny");
  }
  if (code === "share_invalid") {
    if (field === "account") return t("campaign.error.share_invalidAccount");
    const label = fieldLabel(field, "share");
    return label ? t("campaign.error.share_invalidField", { field: label }) : t("campaign.error.share_invalid");
  }
  if (SETTINGS_MESSAGE[code]) return t(SETTINGS_MESSAGE[code]!);
  if (CAMPAIGN_CODES.has(code)) return t(`campaign.error.${code}`);
  return describeApiError(status, code);
}

/**
 * 錯誤給人看的一句話。收 API 錯誤、伺服器回的碼字串（批次發放每一筆的 error、核准後的 payoutError），
 * 或一般的 Error（例如登入過期時頁面自己丟的）。
 */
export function campaignErrorText(e: unknown): string {
  if (typeof e === "string") return messageOf(0, e, "");
  if (e instanceof ApiError) return messageOf(e.status, e.code, e instanceof CampaignError ? e.field : "");
  if (e instanceof Error && e.message) return e.message;
  return i18n.global.t("state.requestFailed");
}

const headers = (token: string) => ({ "X-From": currentSurface(), "X-Provider": currentProvider(), Authorization: `Bearer ${token}` });

async function fail(res: Response): Promise<never> {
  const b = (await res.json().catch(() => ({}))) as { error?: string; field?: string };
  const code = b.error || (res.status === 410 ? "evidence_purged" : "");
  const field = b.field ?? "";
  throw new CampaignError(res.status, messageOf(res.status, code, field), code, field);
}

/** path 接在 /v1 後面。有本體就是 JSON，FormData 讓瀏覽器自己設 multipart 的 Content-Type。 */
async function request<T>(token: string, path: string, method = "GET", body?: unknown): Promise<T> {
  const json = body !== undefined && !(body instanceof FormData);
  const res = await fetch(`${COMMUNITY_API}${path}`, {
    method,
    headers: { ...headers(token), ...(json ? { "Content-Type": "application/json" } : {}) },
    body: json ? JSON.stringify(body) : (body as FormData | undefined),
  });
  if (!res.ok) return fail(res);
  return (await res.json()) as T;
}
const enc = encodeURIComponent;
/** 只帶有值的查詢參數。 */
const query = (q: Record<string, string | number | undefined>) => {
  const s = new URLSearchParams(Object.entries(q).filter((e): e is [string, string | number] => e[1] !== undefined && e[1] !== "").map(([k, v]) => [k, String(v)])).toString();
  return s ? `?${s}` : "";
};

/** 公開活動頁讀到的：草稿與不存在都是 404 campaign_not_found。門檻、保留天數、點數池不在這裡。 */
export interface PublicCampaign {
  slug: string; title: Localized; phase: "upcoming" | "open" | "ended"; startsAt: number | null; endsAt: number | null; timezone: string | null; bannerUrl: string | null;
  intro: Localized; submitDeadline: number | null; payoutDeadline: number | null; tiers: Partial<Record<Tier, number>>; extraPlacementAmount: number | null;
}
/** 不帶令牌：訪客也看得到活動頁。 */
export async function fetchCampaign(slug: string): Promise<PublicCampaign> {
  const res = await fetch(`${COMMUNITY_API}/campaigns/${enc(slug)}`, { headers: { "X-From": currentSurface() } });
  if (!res.ok) return fail(res);
  return (await res.json()) as PublicCampaign;
}

export const fetchCampaigns = (token: string) => request<{ items: Campaign[]; canEdit: boolean }>(token, "/moderation/campaigns");
/** 沒有 id 是新活動；有 id 要帶上次讀到的版本號，別人先存過會回 campaign_version_conflict。 */
export const saveCampaign = (token: string, input: CampaignInput, operationId: string, id?: string, expectedVersion?: number) =>
  id ? request<Campaign>(token, `/moderation/campaigns/${enc(id)}`, "PUT", { ...input, expectedVersion, operationId })
    : request<Campaign>(token, "/moderation/campaigns", "POST", { ...input, operationId });
export const setCampaignStatus = (token: string, id: string, status: "active" | "ended", operationId: string) =>
  request<Campaign>(token, `/moderation/campaigns/${enc(id)}/status`, "POST", { status, operationId });
export function uploadCampaignBanner(token: string, file: File) {
  const form = new FormData();
  form.append("file", file);
  return request<{ key: string; url: string }>(token, "/moderation/campaigns/banner", "POST", form);
}
export const fetchCampaignPool = (token: string) => request<CampaignPool>(token, "/moderation/campaign-pool");

// ---- 申請（本人）-----------------------------------------------------------------
// 形狀照 src/campaign-apply.ts。

export const PLATFORMS = ["qq_group", "tieba", "bahamut", "moments", "video", "forum", "other"] as const;
export type Platform = (typeof PLATFORMS)[number];
export type ReviewStatus = "submitted" | "resubmitted" | "needs_info" | "approved" | "rejected";
export type PayoutState = "none" | "awaiting" | "processing" | "queued" | "paid";

export interface PlacementView {
  id: string; platform: Platform; location: string; url: string | null; publishedAt: number; requestedTier: Tier; approvedTier: Tier | null;
  /** reviewReason 只在等補件與被拒時有值。 */
  reviewStatus: ReviewStatus; reviewReason: string | null; evidence: { id: string }[]; createdAt: number;
}
/** approvedAmount 是核准的目標金額，paidTotal 是真的入帳的；兩個分開顯示。 */
export interface ContentView {
  id: string; campaignSlug: string; title: string; cardId: number | null; shareCode: string;
  approvedTier: Tier | null; approvedAmount: number; paidTotal: number; payoutState: PayoutState; placements: PlacementView[];
}
interface PlacementFields { location: string; publishedAt: number; url?: string | null; note?: string; requestedTier: Tier; evidenceIds?: string[] }
/** 新內容給 content，替已有的內容再加一個位置給 contentId。 */
export type SubmitBody = PlacementFields & { platform: Platform; operationId: string } & ({ contentId: string; content?: never } | { content: { title: string; cardId?: number | null }; contentId?: never });
/** 補件重送：平台不能改，沒給的欄位不變；url 給 null 是拿掉連結。 */
export type ResubmitBody = Partial<PlacementFields> & { operationId: string };
export type ApplyResult = { placementId: string; content: ContentView };

export const submitPlacement = (token: string, slug: string, body: SubmitBody) => request<ApplyResult>(token, `/campaigns/${enc(slug)}/placements`, "POST", body);
export const resubmitPlacement = (token: string, id: string, body: ResubmitBody) => request<ApplyResult>(token, `/campaign/placements/${enc(id)}`, "PUT", body);
export const fetchMyContents = (token: string, slug?: string) => request<{ items: ContentView[] }>(token, `/me/campaign/contents${query({ campaign: slug })}`);

export function uploadEvidence(token: string, file: File) {
  const form = new FormData();
  form.append("file", file);
  return request<{ id: string; sha256: string; bytes: number }>(token, "/campaign/evidence", "POST", form);
}
/** 截圖只認 Authorization 標頭，<img src> 帶不了：抓下來轉成 blob 網址。用完由呼叫端 URL.revokeObjectURL。 */
export async function evidenceBlobUrl(token: string, id: string): Promise<string> {
  const res = await fetch(`${COMMUNITY_API}/campaign/evidence/${enc(id)}`, { headers: headers(token) });
  if (!res.ok) return fail(res);
  return URL.createObjectURL(await res.blob());
}

// ---- 審核（審核員，含 AI 帳號）-----------------------------------------------------
// 形狀照 src/campaign-review.ts。

export interface Flags { duplicateLocation: boolean; duplicateImage: boolean; burst: boolean }
export interface QueueItem {
  id: string; contentId: string; contentTitle: string; campaignSlug: string; applicant: { handle: string };
  platform: Platform; location: string; url: string | null; publishedAt: number; requestedTier: Tier; approvedTier: Tier | null;
  reviewStatus: ReviewStatus; version: number; createdAt: number; evidenceCount: number; flags: Flags;
}
export interface ContentDetail {
  content: { id: string; campaignSlug: string; title: string; cardId: number | null; shareCode: string; applicant: { handle: string }; createdAt: number };
  placements: {
    id: string; platform: Platform; location: string; locationKey: string; url: string | null; publishedAt: number; note: string;
    requestedTier: Tier; approvedTier: Tier | null; reviewStatus: ReviewStatus; reviewReason: string | null; reviewedKind: string | null; reviewedAt: number | null;
    countsAsPlacement: boolean; version: number; createdAt: number; evidence: { id: string; purged: boolean }[]; flags: Flags;
    /** location：同一份內容裡同位置的其他位置 id；image：別人用了同一張截圖的內容。 */
    duplicates: { location: string[]; image: { contentId: string; handle: string }[] };
  }[];
  payout: { tier: Tier | null; target: number; due: number };
  paidTotal: number;
  payouts: { id: string; amount: number; targetTotal: number; status: PayoutStatus; attempts: number; error: string | null; createdAt: number; settledAt: number | null }[];
  /** 同一人在同一活動的其他內容。 */
  history: { id: string; title: string; createdAt: number; paidTotal: number }[];
}
export type Decision = "approve" | "reject" | "needs_info";
export interface DecisionBody { decision: Decision; tier?: Tier; countsAsPlacement?: boolean; reason?: string; expectedVersion: number; operationId: string }
export interface DecisionResult {
  placement: { id: string; reviewStatus: ReviewStatus; approvedTier: Tier | null; countsAsPlacement: boolean; reviewReason: string | null; reviewedKind: string | null; reviewedAt: number | null; version: number };
  /** 真人應用管理員核准時會直接發放；payoutError 是發放沒成功的碼，核准照樣成立。 */
  payout: PayoutView | null; payoutError?: string;
}
type Page = { page: number };

export const fetchQueue = (token: string, q: { status?: ReviewStatus; campaign?: string } & Page) =>
  request<{ total: number; items: QueueItem[] }>(token, `/moderation/campaign/placements${query({ status: q.status, campaign: q.campaign, page: q.page })}`);
export const fetchContentDetail = (token: string, id: string) => request<ContentDetail>(token, `/moderation/campaign/contents/${enc(id)}`);
/** 撞版本回 409 share_version_conflict（CampaignError），重新載入再決定，不自動覆蓋。 */
export const decide = (token: string, placementId: string, body: DecisionBody) =>
  request<DecisionResult>(token, `/moderation/campaign/placements/${enc(placementId)}/decision`, "POST", body);

// ---- 發放（真人＋應用管理員）---------------------------------------------------------
// 形狀照 src/campaign-payout.ts。

export type PayoutStatus = "pending" | "paid" | "blocked_insufficient" | "failed" | "cancelled";
export interface PayoutView {
  id: string; contentId: string; amount: number; targetTotal: number; status: PayoutStatus; error: string | null; attempts: number;
  providerEntryId: string | null; checkedAbsentAt: number | null; createdAt: number; updatedAt: number; settledAt: number | null;
}
export type PayoutListItem = PayoutView & { contentTitle: string; campaignSlug: string; applicant: { handle: string } };
export interface PayableItem { contentId: string; contentTitle: string; campaignSlug: string; applicant: { handle: string }; target: number; paidTotal: number; due: number }
export type BatchItem = { contentId: string; payout: PayoutView } | { contentId: string; error: string };
export type CheckResult = "paid" | "absent" | "unknown";

export const fetchPayouts = (token: string, q: { status?: PayoutStatus; campaign?: string } & Page) =>
  request<{ total: number; items: PayoutListItem[] }>(token, `/moderation/campaign/payouts${query({ status: q.status, campaign: q.campaign, page: q.page })}`);
export const fetchPayable = (token: string, q: { campaign?: string } & Page) =>
  request<{ total: number; items: PayableItem[] }>(token, `/moderation/campaign/payable${query({ campaign: q.campaign, page: q.page })}`);
export const requestPayout = (token: string, contentId: string, operationId: string) =>
  request<PayoutView>(token, `/moderation/campaign/contents/${enc(contentId)}/payout`, "POST", { operationId });
/** 一次 1–20 筆；一筆被拒不影響其他筆，每筆的 error 用 campaignErrorText 翻。 */
export const batchPayout = (token: string, contentIds: string[], operationId: string) =>
  request<{ items: BatchItem[] }>(token, "/moderation/campaign/payouts/batch", "POST", { contentIds, operationId });
export const retryPayout = (token: string, id: string, operationId: string) =>
  request<PayoutView>(token, `/moderation/campaign/payouts/${enc(id)}/retry`, "POST", { operationId });
export const cancelPayout = (token: string, id: string, reason: string, operationId: string) =>
  request<PayoutView>(token, `/moderation/campaign/payouts/${enc(id)}/cancel`, "POST", { reason, operationId });
export const checkPayout = (token: string, id: string) =>
  request<{ result: CheckResult; payout: PayoutView }>(token, `/moderation/campaign/payouts/${enc(id)}/check`, "POST", {});
export const reconcilePayouts = (token: string) =>
  request<{ items: { result: CheckResult; payout: PayoutView }[] }>(token, "/moderation/campaign/payouts/reconcile", "POST", {});
