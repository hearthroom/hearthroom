import { searchForm } from "./search-text";
import { HttpError } from "./types";

/** 原作名稱的長度上限：作品名很少超過二十幾個字，六十夠放副標題。 */
export const FANDOM_MAX = 60;

/**
 * 作者送審或審核人修改時給的原作名稱：去頭尾空白、連續空白併成一個；太長、含網址、含換行的不收。
 * 不是字串（沒給）回 undefined，呼叫端當「不改」；空字串回 ""，當「沒有原作」。
 */
export function normalizeFandom(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  if (/[\r\n]/.test(raw) || /:\/\//.test(raw)) throw new HttpError(400, "fandom_invalid");
  const text = raw.replace(/\s+/g, " ").trim();
  if ([...text].length > FANDOM_MAX) throw new HttpError(400, "fandom_invalid");
  return text;
}

/** 原作的篩選鍵：跟搜尋同一個正規化，繁簡、大小寫、標點不同的寫法是同一個原作。 */
export const fandomKey = (fandom: string): string => searchForm(fandom);
