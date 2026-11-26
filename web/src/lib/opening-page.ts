/**
 * 開場網頁的大小規則（任務 2026-11-25-opening-page-object-storage，owner 2026-11-25 定案）。
 *
 * - 上限讀公開沙盒契約的 `openingPageMaxBytes`：契約改成 100 MB 時編輯器跟著放寬，不在這裡另寫一個數字。
 *   工坊（DLC）開場另讀 `workshopOpeningPageMaxBytes`，契約還沒有這個鍵時照 512 KB。
 * - 上游只把 512 KB 以下的頁面內嵌在作者資產裡；更大的頁面只回大小與讀取網址，存檔走原始上傳端點。
 * - 超過 OPENING_PAGE_EDIT_MAX_BYTES 的頁面不放進文字框：文字框灰掉，只能上傳取代、下載、清除。
 *   門檻是在真的 Chrome 裡量出來的（桌機與手機模擬），數字與量法見任務書。
 */
import { provider as contractLimits } from "../../../stage/contract/sandbox-contract.json";

/** 上游內嵌在作者資產裡的上限；超過就只給大小與網址，存檔也要走原始上傳。 */
export const OPENING_PAGE_INLINE_BYTES = 512 * 1024;

/**
 * 文字框能編輯的最大頁面（UTF-8 位元組）。超過就換成檔案卡：內容不進文字框，只能用上傳換掉、下載、清除。
 *
 * 2026-11-26 在真的 Chrome 開編輯頁量（本機 mock、機器負載 13–21，各 3 次取中位數；
 * 打字＝按鍵到下一個畫面，開頁＝到文字框填好內容）：
 *   桌機      0 / 256K / 512K / 1M / 2M / 5M：打字 10 / 12 / 14 / 19 / 33 / 74 ms，開頁 453 / 469 / 499 / 545 / 714 / 1085 ms
 *   手機模擬（390×844、CPU 4 倍降速）：打字 26 / 40 / 57 / 88 / 201 / 414 ms，開頁 1353 / 1489 / 1802 / 2020 / 2685 / 4377 ms
 * 手機在 1 MB 到 2 MB 之間明顯變卡（打字 88 → 201 ms），所以取 1 MB；桌機到 2 MB 都還順。
 * 剩下的延遲幾乎都是瀏覽器處理大文字框本身（CPU 剖析裡 JS 只佔一小部分），不是這頁的程式。
 */
export const OPENING_PAGE_EDIT_MAX_BYTES = 1024 * 1024;

/** 超過這個大小在檔案卡下方多一行中性提醒（不擋存檔）。 */
export const OPENING_PAGE_LARGE_HINT_BYTES = 10 * 1000 * 1000;

type Limits = { openingPageMaxBytes?: number; workshopOpeningPageMaxBytes?: number };
const declared = contractLimits as Limits;
const positive = (n: unknown, fallback: number) => (typeof n === "number" && Number.isFinite(n) && n > 0 ? n : fallback);

let maxOverride: number | null = null;
let workshopOverride: number | null = null;

/** 一般卡開場網頁的上限（位元組）。 */
export function openingPageMaxBytes(): number {
  return maxOverride ?? positive(declared.openingPageMaxBytes, OPENING_PAGE_INLINE_BYTES);
}

/** 工坊開場網頁的上限：仍存在 JSON 裡，契約沒寫就照 512 KB。 */
export function workshopOpeningPageMaxBytes(): number {
  return workshopOverride ?? positive(declared.workshopOpeningPageMaxBytes, OPENING_PAGE_INLINE_BYTES);
}

/** 測試用：模擬契約改成別的上限；傳 null 回到契約值。 */
export function setOpeningPageLimitsForTest(limits: { max?: number | null; workshop?: number | null }): void {
  if ("max" in limits) maxOverride = limits.max ?? null;
  if ("workshop" in limits) workshopOverride = limits.workshop ?? null;
}

/**
 * UTF-8 位元組數，不配置記憶體：大頁面每按一鍵都要量，TextEncoder 每次都會複製一份。
 * 落單的代理字元照 TextEncoder 的做法算成 U+FFFD（3 位元組）。
 */
export function utf8Length(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) { n += 4; i++; } else n += 3;
    } else n += 3;
  }
  return n;
}

/**
 * 給人看的大小：1 MB 以下用 KB，以上用 MB，都是十進位（1 MB＝1,000,000 位元組），
 * 跟上游的上限「100000000 位元組（100 MB）」同一把尺。無條件進位到一位小數，超過上限幾個位元組的檔案
 * 不會被印成剛好等於上限。整數不帶小數（512 KB、100 MB）。
 */
export function formatPageSize(bytes: number, locale: string): string {
  const mb = bytes >= 1000 * 1000;
  const value = Math.ceil((bytes / (mb ? 1000 * 1000 : 1000)) * 10) / 10;
  return `${value.toLocaleString(locale, { maximumFractionDigits: 1 })} ${mb ? "MB" : "KB"}`;
}

/** 上限印成 MB 的數字（字串裡自帶「MB」，十進位）：10 MB 以上取整，以下留一位小數，524288 印成 0.5。 */
export function pageLimitMB(bytes: number, locale: string): string {
  const mb = bytes / 1000 / 1000;
  return (bytes >= 10 * 1000 * 1000 ? Math.round(mb) : Math.round(mb * 10) / 10).toLocaleString(locale, { maximumFractionDigits: 1 });
}

/** 只收網頁檔：副檔名 .html／.htm，或瀏覽器認得的 text/html。 */
export function isHtmlFile(file: { name: string; type?: string }): boolean {
  return /\.html?$/i.test(file.name) || file.type === "text/html";
}

/** 作者按了取消（上傳或讀取中止）：不是錯誤，畫面不顯示失敗。 */
export const isAbortError = (err: unknown): boolean =>
  typeof err === "object" && err !== null && (err as { name?: unknown }).name === "AbortError";

/** 下載時固定的檔名（不沿用作者原本的檔名）。 */
export const OPENING_PAGE_FILENAME = "opening.html";
