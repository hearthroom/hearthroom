/**
 * 把一張卡加到主畫面。
 *
 * 站台本身是一個可安裝的 PWA（public/manifest.webmanifest）。這裡另外替每張在榜的卡發一份
 * manifest：id 與 start_url 都是那張卡的對話頁，圖示是卡的頭像。前端在卡片頁把 <link rel="manifest">
 * 換成這一份，瀏覽器就把「安裝」當成安裝這張卡——桌面／主畫面上多一個以角色為名的圖示，
 * 點下去直接進對話，不經過首頁（owner 2026-09-15）。
 *
 * scope 維持「/」而不是收窄到 /play/<id>：語言前綴（/zh-Hans/play/…）與從對話頁回榜單都還在同一個
 * 範圍內，不會被瀏覽器當成「離開 App」而加上一條網址列。同一站上多個 manifest 靠 id 區分。
 *
 * 圖示：安裝條件要求 PNG／WebP／SVG、至少 192px，而頭像有 jpg 與 gif。/v1/cards/:id/icon-<size>.png 先試
 * Images 綁定轉成正方形 PNG；轉不了（帳號沒開 Images）就照原樣回 PNG，其他格式包成一層 SVG——
 * 瀏覽器照 SVG 收，內容仍是原圖。網址一定要以 .png 結尾：manifest 的 icons 沒寫 type 時，Chrome 在下載前
 * 先看副檔名決定「這個圖示能不能用」，/icon?size=192 這種會直接被跳過（本機實測 no-acceptable-icon）。
 * touch-icon.png 給 iOS 的 apple-touch-icon：不包 SVG（iOS 不吃），轉不了 PNG 就給原圖。
 *
 * 成人內容：manifest 與圖示都是瀏覽器自己抓的，帶不了登入狀態，所以對 nsfw 的卡一律 404——
 * 名字與頭像正是 /v1/cards/:id 對沒開成人內容的人擋下來的東西。
 */
import type { CardRow } from "./cards";
import { type Localized, pickLocale } from "./types";

/** 圖片代抓放行的主機：頭像與素材所在。匯出 PNG 卡與主畫面圖示共用。 */
export const IMAGE_HOSTS = new Set(["objects.lunatalk.ai", "cdn.lunatalk.ai"]);

/** 帶語言前綴的路徑（與 web/src/router.ts 的 PREFIXED 一致；zh-Hant 是不帶前綴的來源語言）。 */
const PREFIXED_LOCALES = ["zh-Hans", "en", "ja", "ko"];
export const localePrefix = (lang: string): string => (PREFIXED_LOCALES.includes(lang) ? `/${lang}` : "");

/** manifest 圖示只做這兩個尺寸；iOS 的 touch icon 固定 180。別的值收斂到最近的一個。 */
export const ICON_SIZES = [192, 512] as const;
export const TOUCH_ICON_SIZE = 180;
export type IconSize = (typeof ICON_SIZES)[number];
export function iconSize(raw: string | undefined): IconSize {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 192;
  return ICON_SIZES.reduce((best, s) => (Math.abs(s - n) < Math.abs(best - n) ? s : best), 192 as IconSize);
}
/** 圖示網址：/v1/cards/<id>/icon-192.png、icon-512.png、touch-icon.png。 */
export const iconPath = (cardId: string, size: IconSize | "touch"): string =>
  `/v1/cards/${encodeURIComponent(cardId)}/${size === "touch" ? "touch-icon" : `icon-${size}`}.png`;

export function allowedImageUrl(raw: string | null | undefined): URL | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && IMAGE_HOSTS.has(u.hostname) ? u : null;
  } catch {
    return null;
  }
}

export function cardManifest(row: CardRow, lang: string) {
  const name = pickLocale(JSON.parse(row.names) as Localized, lang) || row.source_role_id;
  const icon = (size: IconSize) => ({ src: iconPath(row.id, size), sizes: `${size}x${size}`, purpose: "any" });
  return {
    id: `/play/${row.source_role_id}`,
    name,
    short_name: name,
    start_url: `${localePrefix(lang)}/play/${row.source_role_id}`,
    scope: "/",
    display: "standalone",
    background_color: "#f5f5f7",
    theme_color: "#f5f5f7",
    icons: [icon(192), icon(512)],
  };
}

const b64 = (bytes: ArrayBuffer): string => {
  let s = "";
  const view = new Uint8Array(bytes);
  for (let i = 0; i < view.length; i += 0x8000) s += String.fromCharCode(...view.subarray(i, i + 0x8000));
  return btoa(s);
};

/** 非 PNG 的頭像包成 SVG：瀏覽器收 SVG 當圖示，畫出來還是原圖，置中裁成正方形。 */
export function svgWrap(bytes: ArrayBuffer, type: string, size: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    `<image width="${size}" height="${size}" preserveAspectRatio="xMidYMid slice" xlink:href="data:${type};base64,${b64(bytes)}"/></svg>`;
}

/** 包 SVG 的上限：base64 會再脹三分之一，超過這個就不值得，退回站台圖示。 */
export const SVG_WRAP_LIMIT = 2 * 1024 * 1024;
