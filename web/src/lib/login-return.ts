/**
 * 登入頁的「登入後回哪裡」現在走網址參數（/login?returnTo=…），所以要擋開放轉址：
 * 只收站內的絕對路徑（以單一個 / 開頭），其餘一律回首頁。
 */
export function safeReturnTo(raw: unknown, fallback = "/"): string {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s.startsWith("/") || s.startsWith("//") || s.startsWith("/\\")) return fallback;
  if (/[\r\n]/.test(s)) return fallback;
  return s;
}

/** 組登入頁路由（不含語言前綴，呼叫端再套 lp）。 */
export function loginPath(returnTo: string): string {
  const to = safeReturnTo(returnTo);
  return to === "/" ? "/login" : `/login?returnTo=${encodeURIComponent(to)}`;
}
