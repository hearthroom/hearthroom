/**
 * 線路一～四與網域的對照（lib/routes.ts 的說明）。單獨一個檔、不帶任何載入時的副作用：
 * 登入狀態（session）與靜默登入只需要查表，不該因此把測速與安裝提示一起載進來。
 */
import manifest from "../../../android/routes.json";
import { SITE_HOSTS, siteRootOf } from "../../../shared/site-hosts";

export interface Line {
  /** 1–4，跟網域綁定 */
  n: number;
  host: string;
  origin: string;
}

/** 清單裡啟用的線路，照編號排。編號取 SITE_HOSTS 的位置，清單改順序也不會換號。 */
export const LINES: Line[] = SITE_HOSTS
  .map((host, i) => ({ n: i + 1, host, origin: `https://${host}` }))
  .filter((line) => manifest.routes.some((r) => r.host === line.host));

export const lineByOrigin = (origin: string): Line | undefined => LINES.find((l) => l.origin === origin);
export const lineByNumber = (n: unknown): Line | undefined => LINES.find((l) => l.n === Number(n));

/** 目前在哪條線路；www. 與 play. 算同一條。本機、預覽網域回 undefined。 */
export function currentLine(hostname: string = location.hostname): Line | undefined {
  // 本機開發：line3.localhost 當作線路三，走查與截圖用（瀏覽器把 *.localhost 解到本機）；正式建置沒有這條
  if (import.meta.env.DEV) {
    const dev = /^line([1-4])\.localhost$/.exec(hostname);
    if (dev) return LINES.find((l) => l.n === Number(dev[1]));
  }
  const root = siteRootOf(hostname);
  return root ? LINES.find((l) => l.host === root) : undefined;
}

/*
 * 在不在 Android App 裡：靜默登入與 standalone 開新分頁策略需要辨識 App；線路入口另外按 runtime 分流。
 * WebView 的 UA 帶 HearthroomApp；TWA 跑的是使用者的 Chrome，UA 沒有記號，只有第一次載入的
 * referrer 是 android-app://<套件名>。之後站內換頁 referrer 就不見了，所以第一次看到時記在這個分頁裡。
 */
const APP_REFERRER = "android-app://club.hearthroom.app";
const APP_KEY = "hearthroom.androidApp";
const APP_QUERY = "_hr_app";
export function rememberAndroidAppLaunch(referrer: string = document.referrer): void {
  // 跨網域後 referrer／sessionStorage 不會攜帶過來；此標記只選導航模式，不授予任何原生或登入權限。
  let carried: URL | undefined;
  if (location.search?.includes(APP_QUERY) && /\bAndroid\b/.test(navigator.userAgent)
    && window.matchMedia("(display-mode: standalone)").matches && LINES.some(line => line.origin === location.origin)) {
    const url = new URL(location.href);
    if (url.searchParams.get(APP_QUERY) === "twa") carried = url;
  }
  if (!referrer.startsWith(APP_REFERRER) && !carried) return;
  try { sessionStorage.setItem(APP_KEY, "1"); } catch { /* 存不了就只有這一頁認得 */ }
  launchedFromApp = true;
  if (carried) {
    carried.searchParams.delete(APP_QUERY);
    history.replaceState(history.state, "", `${carried.pathname}${carried.search}${carried.hash}`);
  }
}
let launchedFromApp = false;
export function inAndroidApp(ua: string = navigator.userAgent): boolean {
  if (inAndroidWebView(ua) || launchedFromApp) return true;
  try { return sessionStorage.getItem(APP_KEY) === "1"; } catch { return false; }
}

export function inAndroidWebView(ua: string = navigator.userAgent): boolean {
  return /\bHearthroomApp\/[\d.]+\b/.test(ua);
}

/** TWA 跨官方網域仍留在原視窗；一般瀏覽器、PWA、WebView 與外站 URL 都不加標記。 */
export function appNavigationUrl(raw: string): string {
  if (!inAndroidApp() || inAndroidWebView()) return raw;
  const url = new URL(raw);
  if (!LINES.some(line => line.origin === url.origin)) return raw;
  url.searchParams.set(APP_QUERY, "twa");
  return url.toString();
}

