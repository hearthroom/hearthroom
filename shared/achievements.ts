/**
 * 成就等級與成就榜（成就設計 V2 §5.3、§6）。
 *
 * 等級：Lv.L 需要 25 × L(L−1)/2 成就點（Lv.2＝25、Lv.5＝250、Lv.10＝1,125），沒有上限。
 * 25 點約是五枚普通徽章，新手第一週就到 Lv.2；一位活躍作者（二十多枚、含幾次榜單）落在 Lv.6–8。
 *
 * 成就榜兩張：
 *   author：只算創作類與榜單榮譽（作者頁、卡片封面上本來就公開的事實），收錄所有作者；
 *   all：全部徽章，但消費類與邀請類不進任何排行（花錢買名次、刷邀請），只收錄公開了徽章、沒有選擇排行榜匿名的成員。
 * 週期：all＝總榜；YYYY-MM＝那個月（台北時間）新拿到的徽章。
 */
export const levelThreshold = (level: number) => 25 * level * (level - 1) / 2;
export function levelOf(ap: number): number {
  let level = 1;
  while (levelThreshold(level + 1) <= ap) level++;
  return level;
}
export const ACHIEVEMENT_BOARDS = ['author', 'all'] as const;
export type AchievementBoardKind = typeof ACHIEVEMENT_BOARDS[number];
/** 任何成就榜都不算的類別 */
export const UNRANKED_CATEGORIES = ['spend', 'invite'];
/** 作者成就榜只算這些類別 */
export const AUTHOR_CATEGORIES = ['creation', 'rank'];

export interface AchievementEntry {
  rank: number;
  ap: number;
  level: number;
  author: { handle: string; name: string; avatar: string };
}
export interface AchievementBoard {
  board: AchievementBoardKind;
  /** 'all' 或 'YYYY-MM' */
  period: string;
  items: AchievementEntry[];
}
