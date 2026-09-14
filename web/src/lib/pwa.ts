/**
 * PWA：可安裝，加上一張「裝到主畫面」的提示卡。
 *
 * 不做資源快取。service worker（public/sw.js）只攔導覽請求給離線頁，其餘原樣放行；
 * 部署後舊分頁的處理交給 chunk-reload，兩者不重疊。
 *
 * 提示卡什麼時候出現：
 * - 不在已安裝的視窗裡（display-mode: standalone）；
 * - 使用者按過「以後再說」的話，三十天內不再問；
 * - 不是第一次來：至少兩個不同日期造訪過。第一次打開就被問裝不裝，多半直接關掉，
 *   之後三十天都問不到；等人回來第二次再問，答應的比例高得多。
 * - Chromium 系：等瀏覽器發 beforeinstallprompt 才有得裝，按下去走原生的安裝框。
 * - iOS Safari：沒有事件也沒有 API，只能提示「分享 → 加入主畫面」。
 *
 * beforeinstallprompt 在頁面載入很早就發，比 Vue 掛上去還早；監聽器放在模組頂層，
 * main.ts 在任何 await 之前就 import 這個檔。
 */
import { reactive } from "vue";

const DISMISS_KEY = "hearthroom.pwa.dismissedAt";
const DAYS_KEY = "hearthroom.pwa.days";
const DISMISS_FOR_MS = 30 * 24 * 60 * 60 * 1000;
const MIN_DAYS = 2;
const KEEP_DAYS = 8;

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;

const safeStorage = (): Storage | null => { try { return localStorage; } catch { return null; } };

/** 記下今天來過；回傳最近幾天內有幾個不同日期。存不了（隱私模式）就當第一天。 */
export function recordVisit(store: Storage | null, now = Date.now()): number {
  if (!store) return 1;
  const today = new Date(now).toISOString().slice(0, 10);
  let days: string[] = [];
  try { days = JSON.parse(store.getItem(DAYS_KEY) || "[]"); } catch { days = []; }
  if (!Array.isArray(days)) days = [];
  if (!days.includes(today)) days.push(today);
  days = days.filter((d) => typeof d === "string").slice(-KEEP_DAYS);
  try { store.setItem(DAYS_KEY, JSON.stringify(days)); } catch { /* 存不了就下次再算 */ }
  return days.length;
}

export function isStandalone(): boolean {
  try {
    if (matchMedia("(display-mode: standalone)").matches) return true;
  } catch { /* 沒有 matchMedia 的環境 */ }
  return (navigator as { standalone?: boolean }).standalone === true;
}

export function isIosSafari(ua = navigator.userAgent): boolean {
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && typeof navigator !== "undefined" && navigator.maxTouchPoints > 1);
  if (!ios) return false;
  // Safari 以外的 iOS 瀏覽器（Chrome／Firefox／Edge 的 iOS 版）也能加到主畫面，但入口不在同一個位置；只對 Safari 給步驟。
  return !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
}

/** 純判斷：現在該不該把提示卡拿出來。 */
export function shouldOffer(opts: { standalone: boolean; dismissedAt: number | null; visitDays: number; now?: number }): boolean {
  const now = opts.now ?? Date.now();
  if (opts.standalone) return false;
  if (opts.dismissedAt && now - opts.dismissedAt < DISMISS_FOR_MS) return false;
  return opts.visitDays >= MIN_DAYS;
}

export function readDismissedAt(store: Storage | null): number | null {
  const v = Number(store?.getItem(DISMISS_KEY));
  return Number.isFinite(v) && v > 0 ? v : null;
}

export const installPrompt = reactive({
  /** 提示卡要不要畫出來。 */
  visible: false,
  /** "native"＝有原生安裝框可以按；"ios"＝只能給步驟。 */
  kind: "native" as "native" | "ios",
});

let deferred: BeforeInstallPromptEvent | null = null;
let visitDays = 0;

function consider(): void {
  if (installPrompt.visible) return;
  const store = safeStorage();
  const ok = shouldOffer({ standalone: isStandalone(), dismissedAt: readDismissedAt(store), visitDays });
  if (!ok) return;
  if (deferred) { installPrompt.kind = "native"; installPrompt.visible = true; return; }
  if (isIosSafari()) { installPrompt.kind = "ios"; installPrompt.visible = true; }
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    consider();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    installPrompt.visible = false;
    try { safeStorage()?.removeItem(DISMISS_KEY); } catch { /* 無妨 */ }
  });
}

/** 頁面掛上之後叫一次：記今天來過，然後看要不要提示。 */
export function startInstallPrompt(): void {
  visitDays = recordVisit(safeStorage());
  // 等首屏畫完再出現，別跟內容搶第一眼
  setTimeout(consider, 4000);
}

export async function acceptInstall(): Promise<void> {
  const ev = deferred;
  if (!ev) { installPrompt.visible = false; return; }
  deferred = null;
  installPrompt.visible = false;
  try {
    await ev.prompt();
    const { outcome } = await ev.userChoice;
    if (outcome === "dismissed") dismissInstall();
  } catch { dismissInstall(); }
}

export function dismissInstall(): void {
  installPrompt.visible = false;
  try { safeStorage()?.setItem(DISMISS_KEY, String(Date.now())); } catch { /* 存不了就下次再問 */ }
}

/** 只在正式建置、且在主站網域上註冊：子網域（沙箱殼）跑的是同一個 Worker，不該讓站台的 SW 掛到那裡。 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  if (/^c[0-9a-f-]+\./i.test(location.hostname)) return;
  window.addEventListener("load", () => { navigator.serviceWorker.register("/sw.js").catch(() => { /* 註冊失敗不影響站台 */ }); });
}
