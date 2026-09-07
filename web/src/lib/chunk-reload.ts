/**
 * 舊頁面撞上新部署。
 *
 * 頁面按路由拆成小塊懶載入，每次部署檔名裡的 hash 都變，而 Workers 的靜態資源只留當前這一版。
 * 部署前就開著的分頁（或快取了舊 index.html 的瀏覽器）記的是舊 hash，之後第一次點到要懶載入的
 * 頁面就拿到 404：控制台 `Failed to fetch dynamically imported module`，路由跳轉靜默失敗，
 * 使用者的感受是「按鈕沒反應」。
 *
 * 做法：認出這種失敗就整頁重載一次到目標網址，讓瀏覽器拿新的 index.html。只重載一次——
 * 十秒內再失敗就不是版本問題（真的斷網、或 CDN 出事），別讓頁面無限轉。
 */
import type { Router } from "vue-router";

const RELOAD_KEY = "hearthroom.chunk-reload-at";
const RELOAD_COOLDOWN_MS = 10_000;

/** Chrome／Firefox／Safari 對動態匯入失敗的措辭各不同，加上 Vite 預載 CSS 失敗那一句。 */
export function isChunkLoadError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : "";
  return /dynamically imported module|Importing a module script failed|Unable to preload CSS/i.test(message);
}

export function shouldReload(now: number, lastAt: number | null): boolean {
  return lastAt === null || now - lastAt >= RELOAD_COOLDOWN_MS;
}

function readLastAt(): number | null {
  try {
    const raw = sessionStorage.getItem(RELOAD_KEY);
    return raw ? Number(raw) : null;
  } catch {
    return null;
  }
}

/** 重載一次到 target；十秒內已經重載過就回 false，讓呼叫端照一般錯誤處理。 */
export function reloadOnce(target: string): boolean {
  const now = Date.now();
  if (!shouldReload(now, readLastAt())) return false;
  try {
    sessionStorage.setItem(RELOAD_KEY, String(now));
  } catch {
    /* 隱私模式寫不進去：那就每次都重載，總比按鈕沒反應好 */
  }
  window.location.assign(target);
  return true;
}

/** 接上路由與 Vite 的預載事件。路由層抓的是頁面元件本身載不到；vite:preloadError 抓的是它的 CSS／依賴。 */
export function installChunkReload(router: Router) {
  router.onError((err, to) => {
    if (isChunkLoadError(err)) reloadOnce(to.fullPath);
  });
  window.addEventListener("vite:preloadError", (event) => {
    if (reloadOnce(window.location.href)) event.preventDefault();
  });
}
