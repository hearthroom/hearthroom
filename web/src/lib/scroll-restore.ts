/**
 * 返回鍵回到列表時，等列表長回原來的高度再捲回去。
 *
 * 搜尋、收藏、作者頁、我的卡片這些列表離開後就卸載了，回來時重新讀一次。瀏覽器給的舊位置
 * 如果馬上套用，結果還沒到、頁面只有一個畫面高，位置就被截在頂端附近：玩家從卡片頁按返回，
 * 看到的是「列表又從頭開始」（2026-11-21 玩家回報；實測搜尋頁 1143 → 187）。
 *
 * 做法：頁面夠高就立刻捲；不夠就每 50 ms 看一次，長夠了再捲。最多等 10 秒，到了照樣捲到
 * 能到的最遠處（結果真的變少了也不能一直等）。上限原本 3 秒：上線讀回時正式站手機搜尋一次 1.5 秒、
 * 一次超過 3 秒回來，超過那次被截在 1608（原位 3330）；連線慢的地區應該更常超過（推測，未量），所以放寬到 10 秒。
 * 等的期間使用者自己動了（滾輪、觸控、按鍵、點擊），或已經換到別頁，就不捲，免得把人拉走。
 *
 * 首頁榜單不走這裡：它自己記住看過的那一串，回來時照卡片對齊（board-memory.ts）。
 */
export type SavedScroll = { left: number; top: number };

const POLL_MS = 50;
export const RESTORE_WAIT_MS = 10_000;
const USER_MOVES = ["wheel", "touchstart", "keydown", "pointerdown"] as const;

export function whenScrollable(saved: SavedScroll, waitMs = RESTORE_WAIT_MS): Promise<SavedScroll | false> {
  const fits = () => document.documentElement.scrollHeight - window.innerHeight >= saved.top;
  if (fits()) return Promise.resolve(saved);
  const href = location.href;
  return new Promise((resolve) => {
    let done = false;
    const finish = (value: SavedScroll | false) => {
      if (done) return;
      done = true;
      clearInterval(poll);
      clearTimeout(limit);
      for (const type of USER_MOVES) window.removeEventListener(type, stop, true);
      resolve(value !== false && location.href !== href ? false : value);
    };
    const stop = () => finish(false);
    const poll = setInterval(() => { if (location.href !== href) finish(false); else if (fits()) finish(saved); }, POLL_MS);
    const limit = setTimeout(() => finish(saved), waitMs);
    for (const type of USER_MOVES) window.addEventListener(type, stop, { capture: true, passive: true });
  });
}
