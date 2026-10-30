/**
 * 一個畫面只有一個蘇綺（docs/design/hearthroom-mascot/README.md「會出現的地方」，2026-10-19）：頁面上的蘇綺插圖
 * 進到視野裡，桌寵就淡出，捲走了再回來。原本只在整頁是插圖的簽到頁用路由退場（petAway）；404、搜尋空態、
 * 我的頁的簽到卡頭像這種「一塊」插圖，看的是它在不在視野裡（任務 2026-10-30 desk-pet-mobile-overlap 第二班）。
 *
 * 不算：啾啾（chuchu-*）、站名旁的小頭像（suki-mark）、桌寵自己的圖，以及標了 data-pet-stays 的地方——
 * 首頁面板、歡迎橫幅、新手引導（owner 2026-10-13：她是寵物，這些在的時候也不躲）、安裝提示的 App 圖示。
 */
const ART = 'img[src*="/mascot/"]';
const NOT_SUKI = /\/mascot\/(?:pet\/|chuchu|suki-mark)/;
const STAYS = '.suki-pet,.suki-pet__catch,.suki-pet__tab,[data-pet-stays]';

let at = -Infinity, cached = false;
/** 每一格都會問：插圖不多，但捲動時還是每 200ms 才重量一次 */
export function sukiArtInView(): boolean {
  const now = performance.now();
  if (now - at < 200) return cached;
  at = now;
  cached = [...document.querySelectorAll<HTMLImageElement>(ART)].some((img) => {
    if (NOT_SUKI.test(img.getAttribute("src") ?? "") || img.closest(STAYS)) return false;
    const r = img.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || r.bottom <= 0 || r.top >= innerHeight || r.right <= 0 || r.left >= innerWidth) return false;
    const cs = getComputedStyle(img);
    return cs.visibility !== "hidden" && cs.opacity !== "0";
  });
  return cached;
}
