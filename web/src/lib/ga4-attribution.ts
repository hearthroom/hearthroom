const KEY = "hearthroom.ga4.signupSource";
const TTL = 30 * 86400000;
const SOURCES = ["invite", "card_share", "campaign_share"];
const optedOut = () => (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true;
/** Mirrors referral last-click lifetime but never stores the referral/share code. */
export function captureGa4Source(href: string, now = Date.now()) {
  if (optedOut()) return;
  const url = new URL(href);
  const share = url.searchParams.get("s") ?? "";
  const ref = url.searchParams.get("ref") ?? "";
  const via = /^[A-Z0-9]{8}$/i.test(share) ? "campaign_share"
    : /^[A-Z0-9]{4,32}$/i.test(ref) ? /\/cards\/[^/]+/.test(url.pathname) ? "card_share" : "invite" : null;
  if (via) try { localStorage.setItem(KEY, JSON.stringify({ via, at: now })); } catch { /* Optional attribution. */ }
}
export function ga4SignupVia(now = Date.now()): string {
  if (optedOut()) { try { localStorage.removeItem(KEY); } catch {} return "none"; }
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "null") as { via?: string; at?: number } | null;
    if (saved && SOURCES.includes(saved.via ?? "") && typeof saved.at === "number" && now >= saved.at && now - saved.at < TTL) return saved.via!;
    localStorage.removeItem(KEY);
  } catch { /* Broken storage cannot affect login. */ }
  return "none";
}
