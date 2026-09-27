import { shallowRef } from "vue";

/**
 * 卡片標題照玩家的介面字形顯示：簡體介面看繁體卡轉簡體，正體介面看簡體卡轉繁體。
 *
 * 規則跟對話頁同一套（moonstage/display-script）：看得出是來源字形才轉、單字多義不動，
 * 所以同一個標題在榜單、卡片頁、對話頁寫法一致。字典約 470 KB（gzip），只有中文介面、
 * 標題有漢字時才載入，而且跟對話頁共用同一個檔——先逛榜單再開對話不會下載第二次。
 * 載入前先顯示原標題；頁面載完、瀏覽器空閒時才下載，好了自動換成轉換後的寫法。
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
 * 等頁面載完、瀏覽器空下來才下載字典：它有 486 KB，首屏的封面圖（最大內容繪製）
 * 還在下載時一起抓，行動網路上會跟封面搶頻寬（2026-09-27 實測：字典在 982 ms 開抓，
 * 封面 1,356 ms 才畫完）。標題晚一點換寫法沒關係，首屏慢了玩家看得到。
 */
function whenPageSettled(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  return new Promise((resolve) => {
    const idle = () => {
      if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(() => resolve(), { timeout: 2000 });
      else setTimeout(resolve, 200);
    };
    if (document.readyState === "complete") idle();
    else window.addEventListener("load", idle, { once: true });
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
