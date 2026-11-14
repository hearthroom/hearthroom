/**
 * 橫向捲動的列（分頁列、chip 列）裡，讓某一格完整露出來：只要沒有完整落在列的可視範圍內（含一半被切掉）就捲，
 * 捲到它置中；已經完整看得到就不動。列本身沒有溢出時什麼都不做。
 */
export function revealInScroller(scroller: HTMLElement, item: HTMLElement): void {
  if (scroller.scrollWidth <= scroller.clientWidth) return;
  const box = scroller.getBoundingClientRect(), tab = item.getBoundingClientRect();
  if (tab.left >= box.left && tab.right <= box.right) return;
  scroller.scrollLeft += tab.left - box.left - (box.width - tab.width) / 2;
}
