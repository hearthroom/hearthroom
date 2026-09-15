/**
 * PWA：可安裝，加上一張「裝到主畫面」的提示卡。
 *
 * 不做資源快取。service worker（public/sw.js）只攔導覽請求給離線頁，其餘原樣放行；
 * 部署後舊分頁的處理交給 chunk-reload，兩者不重疊。
 *
 * 提示卡什麼時候出現：
 * - 不在已安裝的視窗裡（display-mode: standalone）；
 * - 按過「以後再說」的先歇一天再問；再按就越歇越久（1、3、7、14、30 天），不是一次就推滿三十天。
 *   第一次來的人多半不裝，但之後用熟了可能想裝；問太少會讓想裝的人找不到入口（owner 2026-09-15）。
 * - 首屏畫完幾秒後就問（owner 2026-09-15：原本要第二天再問，結果三個平台都看不到提示）。
 * - Chromium 系：等瀏覽器發 beforeinstallprompt 才有得裝，按下去走原生的安裝框。
 * - iOS Safari：沒有事件也沒有 API，只能提示「分享 → 加入主畫面」。
 *
 * 提示卡之外，頁尾另有一條「安裝 App」的常駐入口（installAvailable）：關掉提示卡的人之後
 * 想裝，不必等三十天。
 *
 * beforeinstallprompt 在頁面載入很早就發，比 Vue 掛上去還早；監聽器放在模組頂層，
 * main.ts 在任何 await 之前就 import 這個檔。
 *
 * 安裝的對象有兩種：站台本身，或卡片頁上的那張卡（lib/card-manifest.ts 換了 manifest 之後）。
 * 提示卡只替站台自動跳；卡片的安裝入口在卡片頁自己的按鈕上。換了對象就丟掉手上的安裝事件——
 * 它屬於前一份 manifest，瀏覽器會為新的那份再發一次。
 */
import { reactive } from "vue";

const DISMISS_KEY = "hearthroom.pwa.dismissedAt";
const DISMISS_COUNT_KEY = "hearthroom.pwa.dismissCount";
const DAYS_KEY = "hearthroom.pwa.days";
const DAY_MS = 24 * 60 * 60 * 1000;
/** 第 n 次按「以後再說」之後要歇幾天；超過表長就一直用最後一個。 */
const DISMISS_BACKOFF_DAYS = [1, 3, 7, 14, 30];
export function dismissWaitMs(count: number): number {
  const i = Math.min(Math.max(1, Math.floor(count)), DISMISS_BACKOFF_DAYS.length) - 1;
  return DISMISS_BACKOFF_DAYS[i] * DAY_MS;
}
const MIN_DAYS = 1;
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

/** 純判斷：現在該不該把提示卡拿出來。dismissCount 是按過幾次「以後再說」，決定要歇多久。 */
export function shouldOffer(opts: { standalone: boolean; dismissedAt: number | null; dismissCount?: number; visitDays: number; now?: number }): boolean {
  const now = opts.now ?? Date.now();
  if (opts.standalone) return false;
  if (opts.dismissedAt && now - opts.dismissedAt < dismissWaitMs(opts.dismissCount ?? 1)) return false;
  return opts.visitDays >= MIN_DAYS;
}

export function readDismissedAt(store: Storage | null): number | null {
  const v = Number(store?.getItem(DISMISS_KEY));
  return Number.isFinite(v) && v > 0 ? v : null;
}

export function readDismissCount(store: Storage | null): number {
  const v = Number(store?.getItem(DISMISS_COUNT_KEY));
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

export const installPrompt = reactive({
  /** 提示卡要不要畫出來。 */
  visible: false,
  /** "native"＝有原生安裝框可以按；"ios"＝只能給步驟。 */
  kind: "native" as "native" | "ios",
  /** 安裝入口要不要顯示：有原生安裝框、或是 iOS Safari，且不在已安裝的視窗裡。指的是目前的 target。 */
  available: false,
  /** 現在安裝下去的是站台，還是卡片頁上的那張卡。 */
  target: "site" as "site" | "card",
  /** target 是卡的時候，卡的名字與頭像（提示卡的標題與圖示用）。 */
  name: "",
  icon: "",
});

let deferred: BeforeInstallPromptEvent | null = null;
let visitDays = 0;

function refreshAvailable(): void {
  installPrompt.available = !isStandalone() && (!!deferred || isIosSafari());
}

function consider(): void {
  refreshAvailable();
  if (installPrompt.visible) return;
  // 卡片頁：不自動跳「裝 Hearthroom」——裝下去的會是那張卡。入口在頁上的按鈕。
  if (installPrompt.target !== "site") return;
  const store = safeStorage();
  const ok = shouldOffer({ standalone: isStandalone(), dismissedAt: readDismissedAt(store), dismissCount: readDismissCount(store), visitDays });
  if (!ok) return;
  if (deferred) { installPrompt.kind = "native"; installPrompt.visible = true; return; }
  if (isIosSafari()) { installPrompt.kind = "ios"; installPrompt.visible = true; }
}

/** manifest 換了（進出卡片頁）：手上的安裝事件作廢，等瀏覽器為新的 manifest 再發一次。 */
export function setInstallTarget(target: "site" | "card", name = "", icon = ""): void {
  if (installPrompt.target === target && installPrompt.name === name && installPrompt.icon === icon) return;
  deferred = null;
  installPrompt.target = target;
  installPrompt.name = name;
  installPrompt.icon = icon;
  installPrompt.visible = false;
  refreshAvailable();
}

/** 頁尾「安裝 App」與卡片頁「加到主畫面」：有原生安裝框就直接開；iOS 把步驟卡拿出來（不管有沒有按過以後再說）。 */
export function openInstall(): void {
  if (deferred) { void acceptInstall(); return; }
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
    installPrompt.available = false;
    try { safeStorage()?.removeItem(DISMISS_KEY); safeStorage()?.removeItem(DISMISS_COUNT_KEY); } catch { /* 無妨 */ }
  });
}

/** 頁面掛上之後叫一次：記今天來過，然後看要不要提示。 */
export function startInstallPrompt(): void {
  visitDays = recordVisit(safeStorage());
  refreshAvailable();
  // 等首屏畫完再出現，別跟內容搶第一眼
  setTimeout(consider, 3000);
}

export async function acceptInstall(): Promise<void> {
  const ev = deferred;
  if (!ev) { installPrompt.visible = false; return; }
  deferred = null;
  installPrompt.visible = false;
  installPrompt.available = false;
  try {
    await ev.prompt();
    const { outcome } = await ev.userChoice;
    // 卡片的安裝框被關掉不算「以後再說」：那是站台提示卡的計數
    if (outcome === "dismissed" && installPrompt.target === "site") dismissInstall();
  } catch { if (installPrompt.target === "site") dismissInstall(); }
}

export function dismissInstall(): void {
  installPrompt.visible = false;
  try {
    const store = safeStorage();
    store?.setItem(DISMISS_KEY, String(Date.now()));
    store?.setItem(DISMISS_COUNT_KEY, String(readDismissCount(store) + 1));
  } catch { /* 存不了就下次再問 */ }
}

/** 只在正式建置、且在主站網域上註冊：子網域（沙箱殼）跑的是同一個 Worker，不該讓站台的 SW 掛到那裡。 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  if (/^c[0-9a-f-]+\./i.test(location.hostname)) return;
  window.addEventListener("load", () => { navigator.serviceWorker.register("/sw.js").catch(() => { /* 註冊失敗不影響站台 */ }); });
}
