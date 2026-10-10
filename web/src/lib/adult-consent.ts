/**
 * 成人內容開關三個入口（首頁 R18、卡片頁的門、設定頁）共用的判斷：
 * 年齡沒驗過、或沒同意目前這一版聲明，打開前都要先走聲明窗（AdultConsentDialog）；
 * 兩樣都齊了才能一鍵打開。關閉永遠一鍵。
 *
 * 遊客也能開（owner 2026-10-10：確認是成人就能看，確認不是成人就不能看，跟有沒有帳號無關）：
 * 登入的人照帳號設定；沒登入的照伺服器發的遊客憑證（guestAdult），登入時伺服器會把它帶進帳號。
 */
import { reactive } from "vue";
import { UNDERAGE_LOCK_MS } from "../../../shared/adult-consent";
import { ApiError, updateGuestAdult, updateSiteSettings, type SiteMe, type SiteSettings } from "./api";
import type { useSession } from "./session";

type Session = ReturnType<typeof useSession>;
type AdultState = Pick<SiteSettings, "showNsfw" | "ageVerified" | "adultConsent">;

export function needsAdultConsent(profile: Pick<SiteMe, "ageVerified" | "adultConsent"> | null | undefined): boolean {
  return !profile?.ageVerified || !profile.adultConsent;
}

/** 設定改完，把伺服器回的現況寫回 session.profile（清單頁看到開關變了會自己重讀）。 */
export function applyAdultSettings(profile: SiteMe | null, result: SiteSettings | AdultState): void {
  if (!profile) return;
  profile.showNsfw = result.showNsfw;
  profile.ageVerified = result.ageVerified;
  profile.adultConsent = result.adultConsent;
}

/** 遊客這台裝置的狀態。available：這個站有開託管登入（自架站沒有，遊客開關就不畫）。 */
export const guestAdult = reactive({ loaded: false, available: false, showNsfw: false, ageVerified: false, adultConsent: false });
let guestLoad: Promise<void> | null = null;
function applyGuest(result: AdultState) {
  Object.assign(guestAdult, { loaded: true, available: true, showNsfw: result.showNsfw, ageVerified: result.ageVerified, adultConsent: result.adultConsent });
}
/** 問一次遊客憑證的現況；同一頁只問一次。失敗（沒開託管登入）就當不能開。 */
export function loadGuestAdult(): Promise<void> {
  guestLoad ??= updateGuestAdult().then(applyGuest, () => { Object.assign(guestAdult, { loaded: true, available: false }); });
  return guestLoad;
}
/** 登入、登出之後遊客憑證可能已被伺服器清掉（帶進帳號了），下次要用時重問。 */
export function forgetGuestAdult(): void {
  guestLoad = null;
  Object.assign(guestAdult, { loaded: false, showNsfw: false, ageVerified: false, adultConsent: false });
}

/** 看的人現在的成人內容狀態：登入的看帳號，沒登入的看遊客憑證。還不知道就是 null。 */
export function viewerAdult(session: Session): AdultState | null {
  if (session.me) return session.profile ?? null;
  return guestAdult.loaded && guestAdult.available ? guestAdult : null;
}

/** 改開關，成員與遊客同一個入口。伺服器說未滿 18 就把這台裝置鎖上（UNDERAGE_LOCK_MS）。 */
export async function saveAdult(session: Session, input: { showNsfw: boolean; birthdate?: string; consentVersion?: number }): Promise<void> {
  try {
    if (session.me) applyAdultSettings(session.profile, await updateSiteSettings(input, (await session.accessToken()) ?? ""));
    else applyGuest(await updateGuestAdult(input));
  } catch (err) {
    if (err instanceof ApiError && err.code === "underage") lockUnderage();
    throw err;
  }
}

const LOCK_KEY = "hr-underage-until";
export function lockUnderage(now = Date.now()): void {
  try { localStorage.setItem(LOCK_KEY, String(now + UNDERAGE_LOCK_MS)); } catch { /* 無痕模式：這次不記 */ }
}
/** 這台裝置還在未成年鎖的期限內嗎。 */
export function underageLocked(now = Date.now()): boolean {
  try { return Number(localStorage.getItem(LOCK_KEY) || 0) > now; } catch { return false; }
}
