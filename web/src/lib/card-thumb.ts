import { PRIMARY_HOST, isCardAppHost, siteRootOf } from "../../../shared/site-hosts";
import { cardThumbUrl } from "../../../shared/card-thumb";

/**
 * 卡片清單用的縮圖：同一張圖縮到卡片的大小，會動的照樣會動。網址規則在 shared/card-thumb.ts
 * （Worker 在首頁 HTML 裡 preload 第一張也用同一個）。只在我們自己的網域上用；本機開發照用原圖。
 * 轉不了（動畫超過轉換上限之類）就退回原圖，見 CardTile。
 */
function onOurSite(): boolean {
  if (typeof location === "undefined") return false;
  const host = location.hostname;
  return !!siteRootOf(host) || isCardAppHost(host);
}

export function cardThumb(url: string, width?: number): string {
  if (!onOurSite()) return url;
  return cardThumbUrl(PRIMARY_HOST, url, width) ?? url;
}
