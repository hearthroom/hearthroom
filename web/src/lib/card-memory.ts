import type { CommunityCard } from "./types";

/**
 * 剛看過的卡放在手邊，點進卡片頁時先畫出來。
 *
 * 榜單、搜尋、作者頁、「其他作品」列出的卡，欄位跟卡片頁左半邊要的完全一樣——名字、封面、
 * 簡介、標籤、對話數都在。既然點下去之前那些資料就在畫面上，就沒有理由再讓使用者對著
 * 骨架屏等一次往返（玩家回報 2026-09-17：點卡片頁要黑屏一兩秒；量到的等待幾乎全在那一次
 * 請求上，其中約四成只是到邊緣節點的距離）。
 *
 * 只放在記憶體、不進 localStorage：它是「這一次瀏覽的上一屏」，不是快取。重新整理就沒有，
 * 那時本來就該重新拿一份。卡片頁照樣會去問伺服器（瀏覽數要記、資料可能變了），只是那一次
 * 往返在背景發生，使用者不必等。
 */
const seen = new Map<string, CommunityCard>();

/** 記憶體上限：夠蓋住連續翻幾頁榜單，也不會在長時間瀏覽後把一整站的卡都留著。 */
const LIMIT = 300;

/** 數字卡號是主要索引；供應商角色 ID 僅供既有遊玩入口回查。 */
export function rememberCards(cards: readonly CommunityCard[]): void {
  for (const card of cards) {
    if (!card?.roleId) continue;
    seen.set(card.roleId, card);
    seen.set(card.id, card);
    if (card.num) seen.set(String(card.num), card);
  }
  // 超過上限就從最舊的開始丟（Map 的順序就是寫入順序）
  while (seen.size > LIMIT) {
    const oldest = seen.keys().next();
    if (oldest.done) break;
    seen.delete(oldest.value);
  }
}

export function rememberCard(card: CommunityCard): void {
  rememberCards([card]);
}

/** 剛才那一屏有沒有這張卡。沒有就是直接開連結或重新整理進來的，照舊畫骨架屏。 */
export function recallCard(id: string): CommunityCard | null {
  return seen.get(id) ?? null;
}
