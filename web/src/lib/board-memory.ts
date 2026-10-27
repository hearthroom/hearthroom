import type { CardPage } from "./types";
import type { BoardStreamSnapshot } from "./board-stream";

export interface RememberedStream {
  stream: BoardStreamSnapshot;
  scroll?: { top: number; anchor?: string; delta?: number };
}
const streams = new Map<string, RememberedStream>();
let restoredScroll: RememberedStream["scroll"] | null = null;
export function prepareBoardScroll(scroll: RememberedStream["scroll"] | null) { restoredScroll = scroll; }
export function boardScrollPosition(saved: { left: number; top: number }): { left: number; top: number } {
  if (!restoredScroll) return { left: 0, top: 0 };
  // Capture-phase link decoration may canonicalize the clicked href before the
  // leave snapshot; rebuilt card links still use relative attributes.
  const expected = restoredScroll.anchor ? new URL(restoredScroll.anchor, document.baseURI).href : undefined;
  const anchor = [...document.querySelectorAll<HTMLAnchorElement>('[data-board-list] .card__link')].find(el => el.href === expected);
  return anchor && restoredScroll.delta !== undefined ? { left: 0, top: Math.max(0, window.scrollY + anchor.getBoundingClientRect().top - restoredScroll.delta) } : saved;
}
export function recallStream(key: string): RememberedStream | null { return streams.get(key) ?? null; }
export function rememberStream(key: string, value: RememberedStream): void {
  streams.delete(key);
  streams.set(key, value);
  if (streams.size > 6) streams.delete(streams.keys().next().value!);
}

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
  streams.clear();
  restoredScroll = null;
}
