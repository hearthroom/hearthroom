/**
 * 推薦與註冊獎勵的公開規則（Harbor GET /open/v1/referral/terms，不用登入）。
 * 活動頁拿它說明「朋友來儲值你拿多少」：數字是設定值，會跟著價格憲章改，前端一律照這裡顯示、不寫死。
 * 讀不到（服務不通、舊服務還沒有這條路由）就回 null，頁面只講分享拿點數，不顯示推薦數字。
 */
import { apiBaseOf, currentProvider, type ProviderId } from "./provider";

export interface ReferralTerms {
  enabled: boolean;
  firstChatCredits?: number; firstChatDays?: number; inviterCredits?: number; inviterDays?: number; inviterStartAt?: string; inviterEndAt?: string;
  firstPercent: number; firstCap: number; inviteePercent: number;
  rebatePercent: number; rebateDays: number; bindDays: number;
  welcomeCredits: number; welcomeDays: number;
  signupWelcomeCredits: number; signupWelcomeDays: number;
}

const cache = new Map<ProviderId, Promise<ReferralTerms | null>>();

export function fetchReferralTerms(provider: ProviderId = currentProvider()): Promise<ReferralTerms | null> {
  let pending = cache.get(provider);
  if (!pending) {
    pending = fetch(`${apiBaseOf(provider)}/open/v1/referral/terms`)
      .then(async (res) => (res.ok ? normalize(await res.json()) : null))
      .catch(() => null);
    // 失敗的不記住，下次進頁再問一次
    pending.then((t) => { if (!t) cache.delete(provider); });
    cache.set(provider, pending);
  }
  return pending;
}

/** 測試用：清掉記住的結果 */
export function resetReferralTermsCache(): void { cache.clear(); }

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);
function normalize(raw: unknown): ReferralTerms | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  return {
    enabled: r.enabled === true,
    ...(typeof r.firstChatCredits === "number" ? { firstChatCredits: num(r.firstChatCredits) } : {}),
    ...(typeof r.firstChatDays === "number" ? { firstChatDays: num(r.firstChatDays) } : {}),
    ...(typeof r.inviterCredits === "number" ? { inviterCredits: num(r.inviterCredits) } : {}),
    ...(typeof r.inviterDays === "number" ? { inviterDays: num(r.inviterDays) } : {}),
    ...(typeof r.inviterStartAt === "string" ? { inviterStartAt: r.inviterStartAt } : {}),
    ...(typeof r.inviterEndAt === "string" ? { inviterEndAt: r.inviterEndAt } : {}),
    firstPercent: num(r.firstPercent), firstCap: num(r.firstCap), inviteePercent: num(r.inviteePercent),
    rebatePercent: num(r.rebatePercent), rebateDays: num(r.rebateDays), bindDays: num(r.bindDays),
    welcomeCredits: num(r.welcomeCredits), welcomeDays: num(r.welcomeDays),
    signupWelcomeCredits: num(r.signupWelcomeCredits), signupWelcomeDays: num(r.signupWelcomeDays),
  };
}

/** 推薦區要不要出現：推薦關著、或首儲與之後的分成都是 0，就只講分享拿點數。 */
export function referralShown(t: ReferralTerms | null): t is ReferralTerms {
  return !!t && t.enabled && (t.firstPercent > 0 || t.rebatePercent > 0);
}

/** 朋友透過連結註冊一共拿到的點數：新帳號禮＋推薦禮。 */
export const friendTotal = (t: ReferralTerms) => t.signupWelcomeCredits + t.welcomeCredits;

/** 兩筆邀請獎勵只在服務明示新規則與活動期間時呈現；舊服務不推算。 */
export function inviteTotal(t: { enabled: boolean; inviterCredits?: number; firstChatCredits?: number; inviterStartAt?: string; inviterEndAt?: string } | null): number {
  if (!t?.enabled || t.firstChatCredits === undefined || Date.parse(t.inviterEndAt ?? "") <= Date.now() || !Number.isFinite(Date.parse(t.inviterEndAt ?? ""))) return 0;
  if (t.inviterStartAt && Date.parse(t.inviterStartAt) > Date.now()) return 0;
  return (t.inviterCredits ?? 0) + t.firstChatCredits;
}

/**
 * 「算算看」的固定情境：一篇原創貼文貼到 3 個群，朋友第一次儲值 30,000 點、之後再儲值 10,000 點。
 * 金額照活動與推薦設定算；沒有推薦時只算分享那一列。
 */
export const CALC_FIRST_TOPUP = 30_000;
export const CALC_LATER_TOPUP = 10_000;
export interface CalcExample { base: number; extra: number; share: number; invite?: number; first: number | null; rebate: number | null; total: number }
export function calcExample(base: number, extraPerPlacement: number, terms: ReferralTerms | null): CalcExample {
  const extra = extraPerPlacement * 2;
  const share = base + extra;
  if (!referralShown(terms)) return { base, extra, share, first: null, rebate: null, total: share };
  const firstRaw = Math.floor((CALC_FIRST_TOPUP * terms.firstPercent) / 100);
  const first = terms.firstCap > 0 ? Math.min(firstRaw, terms.firstCap) : firstRaw;
  const rebate = Math.floor((CALC_LATER_TOPUP * terms.rebatePercent) / 100);
  const invite = inviteTotal(terms);
  return { base, extra, share, ...(invite > 0 ? { invite } : {}), first, rebate, total: share + first + rebate + invite };
}
