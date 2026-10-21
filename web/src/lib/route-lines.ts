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
 * 在不在 Android App 裡：App 有自己的線路畫面與記憶，網站在 App 裡不放任何線路入口、也不靜默登入。
 * WebView 的 UA 帶 HearthroomApp；TWA 跑的是使用者的 Chrome，UA 沒有記號，只有第一次載入的
 * referrer 是 android-app://<套件名>。之後站內換頁 referrer 就不見了，所以第一次看到時記在這個分頁裡。
 */
const APP_REFERRER = "android-app://club.hearthroom.app";
const APP_KEY = "hearthroom.androidApp";
export function rememberAndroidAppLaunch(referrer: string = document.referrer): void {
  if (!referrer.startsWith(APP_REFERRER)) return;
  try { sessionStorage.setItem(APP_KEY, "1"); } catch { /* 存不了就只有這一頁認得 */ }
  launchedFromApp = true;
}
let launchedFromApp = false;
export function inAndroidApp(ua: string = navigator.userAgent): boolean {
  if (/\bHearthroomApp\/[\d.]+\b/.test(ua) || launchedFromApp) return true;
  try { return sessionStorage.getItem(APP_KEY) === "1"; } catch { return false; }
}

