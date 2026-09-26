import type { CardPage } from "./types";

/**
 * 首頁 HTML 裡預先放好的第一屏榜單（Worker 的 landingPage）。只用一次：拿了就從頁面上拿掉，
 * 之後在站內繞回首頁不會拿到舊的那份。問的條件（語區、語言、第一頁、沒篩選）對不上就不用。
 */
interface Inline {
  query: { zone: string; lang: string; sort: string; offset: number };
  page: CardPage;
}

let taken = false;

export function takeInlineBoard(query: { zone: string; lang: string; sort: string; offset: number; tag: readonly string[] }): CardPage | null {
  if (taken || typeof document === "undefined") return null;
  taken = true;
  const node = document.getElementById("board-inline");
  if (!node) return null;
  node.remove();
  try {
    const data = JSON.parse(node.textContent ?? "") as Inline;
    const q = data.query;
    if (query.tag.length || q.zone !== query.zone || q.lang !== query.lang || q.sort !== query.sort || q.offset !== query.offset) return null;
    return data.page;
  } catch {
    return null;
  }
}

/** 測試用：模擬新開一頁 */
export function resetInlineBoardForTest(): void {
  taken = false;
}
