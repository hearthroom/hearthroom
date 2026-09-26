import { PRIMARY_HOST, isCardAppHost, siteRootOf } from "../../../shared/site-hosts";

/**
 * 卡片清單用的縮圖：同一張圖縮到卡片的大小，會動的照樣會動。
 *
 * 作者的封面常是整張動圖（實測首頁第一張是 6.4 MB 的 GIF，480×832，顯示成 179×238），
 * 每個新訪客都要整份下載，每次開頁瀏覽器還要解一次全尺寸的動畫。
 *
 * 縮圖一律在主網域轉（Cloudflare 的圖片轉換按網域計費、各自快取）：不管訪客從哪個網域進來，
 * 同一張圖只轉一次、所有網域共用那份快取，之後加網域也不會多付（owner 2026-09-26）。
 * 來源走主網域自己的 /v1/art/（只轉發白名單上的封面），轉換設定的「來源」只要允許本網域。
 * 轉不了（動畫超過轉換上限之類）就退回原圖，見 CardTile。
 */
const SOURCES: Record<string, string> = {
  "assets.harperharbor.com": "harbor",
  "objects.lunatalk.ai": "lunatalk",
};

function onOurSite(): boolean {
  if (typeof location === "undefined") return false;
  const host = location.hostname;
  return !!siteRootOf(host) || isCardAppHost(host);
}

export function cardThumb(url: string, width = 480): string {
  if (!onOurSite()) return url;
  let source: URL;
  try {
    source = new URL(url);
  } catch {
    return url;
  }
  const key = SOURCES[source.host];
  if (!key) return url;
  return `https://${PRIMARY_HOST}/cdn-cgi/image/width=${width},fit=scale-down,format=auto,anim=true,quality=80/v1/art/${key}${source.pathname}${source.search}`;
}
