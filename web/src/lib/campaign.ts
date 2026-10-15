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
/** 欄位在畫面上的名字；tiers.<檔> 用那一檔的名字。 */
export function fieldLabel(field: string): string {
  const t = i18n.global.t;
  if (field.startsWith("tiers.")) return t(`campaign.tier.${field.slice("tiers.".length)}`);
  return FIELD_LABEL[field] ? t(FIELD_LABEL[field]!) : "";
}
const CODE_MESSAGE: Record<string, string> = {
  campaign_version_conflict: "campaign.error.conflict", campaign_slug_taken: "campaign.error.slugTaken", campaign_ended: "campaign.error.ended",
  campaign_not_active: "campaign.error.notActive", campaign_image_invalid: "campaign.error.upload", campaign_image_unavailable: "campaign.error.upload",
  campaign_pool_unavailable: "campaign.error.pool", community_admin_required: "moderation.settings.readOnly",
};

async function request<T>(token: string, path: string, method = "GET", body?: unknown): Promise<T> {
  const json = body !== undefined && !(body instanceof FormData);
  const res = await fetch(`${COMMUNITY_API}/moderation${path}`, {
    method,
    headers: { "X-From": currentSurface(), "X-Provider": currentProvider(), Authorization: `Bearer ${token}`, ...(json ? { "Content-Type": "application/json" } : {}) },
    body: json ? JSON.stringify(body) : (body as FormData | undefined),
  });
  if (!res.ok) {
    const b = (await res.json().catch(() => ({}))) as { error?: string; field?: string };
    const code = b.error ?? "";
    const field = b.field ?? "";
    const t = i18n.global.t;
    const label = fieldLabel(field);
    const message = code === "campaign_invalid"
      ? label ? t("campaign.error.invalid", { field: label }) : t("campaign.error.invalidAny")
      : CODE_MESSAGE[code] ? t(CODE_MESSAGE[code]!) : describeApiError(res.status, code);
    throw new CampaignError(res.status, message, code, field);
  }
  return (await res.json()) as T;
}

export const fetchCampaigns = (token: string) => request<{ items: Campaign[]; canEdit: boolean }>(token, "/campaigns");
/** 沒有 id 是新活動；有 id 要帶上次讀到的版本號，別人先存過會回 campaign_version_conflict。 */
export const saveCampaign = (token: string, input: CampaignInput, operationId: string, id?: string, expectedVersion?: number) =>
  id ? request<Campaign>(token, `/campaigns/${encodeURIComponent(id)}`, "PUT", { ...input, expectedVersion, operationId })
    : request<Campaign>(token, "/campaigns", "POST", { ...input, operationId });
export const setCampaignStatus = (token: string, id: string, status: "active" | "ended", operationId: string) =>
  request<Campaign>(token, `/campaigns/${encodeURIComponent(id)}/status`, "POST", { status, operationId });
export function uploadCampaignBanner(token: string, file: File) {
  const form = new FormData();
  form.append("file", file);
  return request<{ key: string; url: string }>(token, "/campaigns/banner", "POST", form);
}
export const fetchCampaignPool = (token: string) => request<CampaignPool>(token, "/campaign-pool");
