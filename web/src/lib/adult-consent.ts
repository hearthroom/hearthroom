/**
 * 成人內容開關三個入口（首頁 R18、卡片頁的門、設定頁）共用的判斷：
 * 年齡沒驗過、或沒同意目前這一版聲明，打開前都要先走聲明窗（AdultConsentDialog）；
 * 兩樣都齊了才能一鍵打開。關閉永遠一鍵。
 */
import type { SiteMe, SiteSettings } from "./api";

export function needsAdultConsent(profile: Pick<SiteMe, "ageVerified" | "adultConsent"> | null | undefined): boolean {
  return !profile?.ageVerified || !profile.adultConsent;
}

/** 設定改完，把伺服器回的現況寫回 session.profile（清單頁看到開關變了會自己重讀）。 */
export function applyAdultSettings(profile: SiteMe | null, result: SiteSettings): void {
  if (!profile) return;
  profile.showNsfw = result.showNsfw;
  profile.ageVerified = result.ageVerified;
  profile.adultConsent = result.adultConsent;
}
