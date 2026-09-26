import type { CardPage } from "./types";

/**
 * 榜單各分頁（日榜、週榜、類型…）剛看過的結果，只放在這個分頁的記憶體裡。
 *
 * 切回看過的分頁時先畫這一份，背景照常重讀一次再換上：伺服器那一趟要 0.25–0.9 s，
 * 切來切去每次都等是首頁最常見的等待（2026-09-26 實測）。
 * 鍵裡包含看的人與他的內容設定，換人、換開關、換隱藏類型就是另一份，不會拿錯。
 */
const pages = new Map<string, CardPage>();
const LIMIT = 24;

export function recallBoard(key: string): CardPage | null {
  return pages.get(key) ?? null;
}

export function rememberBoard(key: string, page: CardPage): void {
  pages.delete(key);
  pages.set(key, page);
  if (pages.size > LIMIT) pages.delete(pages.keys().next().value!);
}

export function forgetBoards(): void {
  pages.clear();
}
