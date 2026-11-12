// The server still verifies member, nonce, receipt, expiry and single use.
// Only the initiating browser's proof is shared between same-origin tabs.
const KEY = "community.discord.attempt";
const LOCALE_KEY = "community.discord.return-locale";
const TTL = 600000;
interface DiscordAttempt { scope: string; nonce: string; returnPath: string; expires: number }
function read(): DiscordAttempt | null {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (value && typeof value.scope === "string" && typeof value.nonce === "string"
      && value.nonce.length >= 32 && value.nonce.length <= 128
      && typeof value.returnPath === "string" && Number.isFinite(value.expires)) return value;
  } catch { /* Missing or unavailable browser storage cannot supply proof. */ }
  return null;
}
export function saveDiscordAttempt(scope: string, nonce: string, returnPath: string) {
  localStorage.setItem(KEY, JSON.stringify({ scope, nonce, returnPath, expires: Date.now() + TTL }));
  // Display context must survive losing the authentication proof. It grants no
  // linking authority and is consumed at callback capture, independently of nonce.
  const locale = returnPath.match(/^\/(en|ja|ko|zh-Hans)(?:\/|$)/)?.[1] ?? "zh-Hant";
  localStorage.setItem(LOCALE_KEY, locale);
  sessionStorage.removeItem("community.discord.nonce");
  sessionStorage.removeItem("community.discord.return");
}
export function clearDiscordAttempt() {
  try { localStorage.removeItem(KEY); localStorage.removeItem(LOCALE_KEY); } catch { /* Storage may be disabled. */ }
  try {
    sessionStorage.removeItem("community.discord.nonce");
    sessionStorage.removeItem("community.discord.return");
  } catch { /* Storage failure must not block logout. */ }
}
export function takeDiscordReturnLocale(): string | null {
  try {
    const locale = localStorage.getItem(LOCALE_KEY);
    localStorage.removeItem(LOCALE_KEY);
    return locale;
  } catch { return null; }
}
export function takeDiscordAttempt(scope: string): { nonce: string | null; expired: boolean } {
  const attempt = read();
  if (attempt) {
    // A different signed-in member cannot consume the initiating member's proof.
    if (attempt.scope !== scope) return { nonce: null, expired: false };
    clearDiscordAttempt();
    return attempt.expires <= Date.now()
      ? { nonce: null, expired: true } : { nonce: attempt.nonce, expired: false };
  }
  // In-flight attempts started before this version retain server-side expiry and ownership checks.
  const nonce = sessionStorage.getItem("community.discord.nonce");
  sessionStorage.removeItem("community.discord.nonce");
  return { nonce, expired: false };
}
export function discordReturnPath(): string | null {
  const attempt = read();
  return attempt && attempt.expires > Date.now() ? attempt.returnPath : sessionStorage.getItem("community.discord.return");
}
