/**
 * 卡片清單用的縮圖：同一張圖縮到卡片的大小，會動的照樣會動。
 *
 * 作者的封面常是整張動圖（實測首頁第一張是 6.4 MB 的 GIF，480×832，顯示成 179×238），
 * 每個新訪客都要整份下載，每次開頁瀏覽器還要解一次全尺寸的動畫。
 * 縮圖由 Cloudflare 的圖片轉換做（hearthroom.club 這個網域要開 Images → Transformations，
 * 來源只允許 assets.harperharbor.com），轉好的結果在邊緣快取，之後都是小檔。
 * 轉不了（沒開、動畫太大超過轉換上限）就退回原圖，見 CardTile。
 */
const SOURCE_HOSTS = new Set(["assets.harperharbor.com"]);

function transformsHere(): boolean {
  if (typeof location === "undefined") return false;
  return location.hostname === "hearthroom.club";
}

export function cardThumb(url: string, width = 480): string {
  if (!transformsHere()) return url;
  try {
    if (!SOURCE_HOSTS.has(new URL(url).host)) return url;
  } catch {
    return url;
  }
  return `/cdn-cgi/image/width=${width},fit=scale-down,format=auto,anim=true,quality=80/${url}`;
}
