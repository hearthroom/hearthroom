import { shallowRef } from "vue";

/**
 * 卡片標題照玩家的介面字形顯示：簡體介面看繁體卡轉簡體，正體介面看簡體卡轉繁體。
 *
 * 規則跟對話頁同一套（moonstage/display-script）：看得出是來源字形才轉、單字多義不動，
 * 所以同一個標題在榜單、卡片頁、對話頁寫法一致。字典約 470 KB（gzip），只有中文介面、
 * 標題有漢字時才載入，而且跟對話頁共用同一個檔——先逛榜單再開對話不會下載第二次。
 * 載入前先顯示原標題；首屏網路停了、瀏覽器空閒時才下載，好了自動換成轉換後的寫法。
 *
 * 只轉顯示的字。依標題算出的東西（佔位色）、搜尋、分享出去的標題都用原文。
 */
type ScriptApi = typeof import("moonstage/display-script");
type Direction = "s2t" | "t2s";

const api = shallowRef<ScriptApi | null>(null);
let pending: Promise<void> | null = null;
let failed = false;
const converters: Partial<Record<Direction, (text: string) => string>> = {};
const HAS_HAN = /\p{Script=Han}/u;

/**
 * 等首屏的網路都停了才下載字典：它有 486 KB，行動網路上會跟頁面自己的內容搶頻寬。
 * 只等 load 事件不夠——卡片頁的開場白在 load 之後才下載，2026-09-27 實測（4 倍 CPU
 * 降速、Fast 4G、冷快取）簡體介面的開場白比英文介面晚約 500 ms 畫出。
 * 所以 load 之後再等網路安靜一秒（最多等 6 秒），瀏覽器空閒時才開抓。
 * 標題晚一點換寫法沒關係，頁面內容慢了玩家看得到。
 */
const QUIET_MS = 1000;
const MAX_WAIT_MS = 6000;

function resourceCount(): number {
  return typeof performance?.getEntriesByType === "function" ? performance.getEntriesByType("resource").length : 0;
}

function whenNetworkQuiet(): Promise<void> {
  return new Promise((resolve) => {
    const started = Date.now();
    let seen = resourceCount();
    let quietSince = Date.now();
    const tick = () => {
      const now = resourceCount();
      if (now !== seen) { seen = now; quietSince = Date.now(); }
      if (Date.now() - quietSince >= QUIET_MS || Date.now() - started >= MAX_WAIT_MS) resolve();
      else setTimeout(tick, 250);
    };
    setTimeout(tick, 250);
  });
}

function whenPageSettled(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  return new Promise((resolve) => {
    const idle = () => {
      if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(() => resolve(), { timeout: 2000 });
      else setTimeout(resolve, 200);
    };
    const afterLoad = () => { void whenNetworkQuiet().then(idle); };
    if (document.readyState === "complete") afterLoad();
    else window.addEventListener("load", afterLoad, { once: true });
  });
}

function load(): Promise<void> {
  pending ??= whenPageSettled().then(() => import("moonstage/display-script")).then(
    (mod) => { api.value = mod; },
    () => { failed = true; },
  );
  return pending;
}

/** 測試與需要等轉換完成的地方用；沒觸發過載入時也會開始載。 */
export function displayScriptReady(): Promise<void> {
  return load();
}

export function displayName(name: string, locale: string): string {
  if (!name || !/^zh/i.test(locale) || !HAS_HAN.test(name) || failed) return name;
  const mod = api.value;
  if (!mod) {
    void load();
    return name;
  }
  const direction = mod.directionForLocale(locale);
  if (direction === "none") return name;
  const convert = (converters[direction] ??= mod.createDisplayScriptConverter(direction));
  return mod.convertPlainText(name, convert);
}
