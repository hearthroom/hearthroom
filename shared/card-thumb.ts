/**
 * 卡片縮圖的網址。前端的 <img> 與 Worker 在 HTML 裡的 preload 都用這一個函式，
 * 兩邊一個字都不能差，不然瀏覽器會下載兩次（preload 了卻沒被用上）。
 *
 * 一律在主網域轉：Cloudflare 的圖片轉換按網域計費、各自快取，同一張圖只該轉一次（owner 2026-09-26）。
 * 來源走主網域自己的 /v1/art/（只轉發白名單上的封面），轉換設定的「來源」只要允許本網域。
 */
export const THUMB_SOURCES: Readonly<Record<string, string>> = {
  "assets.harperharbor.com": "harbor",
  "objects.lunatalk.ai": "lunatalk",
};

/**
 * 卡片在清單上約 170–180 px 寬，2 倍密度的螢幕要 360 px。只出這一個尺寸：每多一個尺寸就多算一次轉換。
 * 實測（6.4 MB、83 格的 GIF）：480/q80 是 2.8 MB，360/q70 是 1.16 MB，畫面上看不出差別。
 * 來源不在白名單或網址壞了回 null（照用原圖）。
 */
export function cardThumbUrl(primaryHost: string, url: string, width = 360): string | null {
  let source: URL;
  try {
    source = new URL(url);
  } catch {
    return null;
  }
  const key = THUMB_SOURCES[source.host];
  if (!key) return null;
  return `https://${primaryHost}/cdn-cgi/image/width=${width},fit=scale-down,format=auto,anim=true,quality=70/v1/art/${key}${source.pathname}${source.search}`;
}

/** 介面語言 → 首頁預設的語區與內容語言（卡片內容只有四個語言槽，繁簡共用 zh）。前端與 Worker 共用。 */
export const landingZone = (locale: string): string => (locale.startsWith("zh") ? "zh" : locale);
