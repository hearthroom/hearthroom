/**
 * 徽章稀有度（設計檔位）與它決定的兩個數：成就點（AP）、可領的積分。
 * 依「拿到有多難」分五階：普通、稀有、史詩、傳說、全服唯一。檔位由設計者指定，不跟持有人數變動；
 * 實際持有率另外顯示。門檻在 migrations 的目錄裡，這裡照 key 對應，新目錄沒登記的落到類別預設。
 * 規則：HarperHarbor/docs product/Hearthroom_Achievements_ProductDesign_20261120_V1.0.md §5、§8。
 */
export const BADGE_RARITIES = ['common', 'rare', 'epic', 'legendary', 'unique'] as const;
export type BadgeRarity = typeof BADGE_RARITIES[number];

/** 成就點：拿到就固定，撤銷時扣回。榜單榮譽每拿一次計一次。 */
export const BADGE_AP: Record<BadgeRarity, number> = { common: 5, rare: 15, epic: 40, legendary: 100, unique: 300 };

const BY_KEY: Record<string, BadgeRarity> = {
  creator_works_10: 'rare', creator_followers_10: 'rare', creator_favorited_10: 'rare',
  creator_works_30: 'epic', creator_followers_100: 'epic', creator_favorited_100: 'epic', creator_featured: 'epic',
  invite_10: 'rare', invite_30: 'epic', invite_100: 'legendary',
  spend_2: 'rare', spend_3: 'epic', spend_4: 'legendary',
  // 開站元老約八成成員都有，2026-11-20 從稀有改普通
  opening_veteran: 'common', member_anniversary: 'rare', beta_veteran: 'epic',
  player_explorer_50: 'rare', player_favorites_50: 'rare',
  player_commenter_10: 'rare', player_liked_10: 'rare', player_commenter_100: 'epic', player_liked_100: 'epic',
  community_level_10: 'rare', community_level_20: 'epic',
  server_booster: 'epic',
};
/** 管理員發的活動、比賽徽章是限時限量的；unique 類別是全服唯一。 */
const BY_CATEGORY: Record<string, BadgeRarity> = { event: 'epic', contest: 'epic', unique: 'unique' };

const HONOR = /^rank_(?:clean|all)_(day|week|month)_(1|3|10)$/;
const WINDOWS = ['day', 'week', 'month'];
const BANDS = ['1', '3', '10'];

export function badgeRarity(badge: { key: string; category: string }): BadgeRarity {
  // 年冠全站唯一，年度十傑次之（annual_<zone>_<year>_<1|10>）
  const annual = /^annual_(?:clean|all)_\d{4}_(1|10)$/.exec(badge.key);
  if (annual) return annual[1] === '1' ? 'unique' : 'epic';
  // 榜單榮譽照期別×名次算：月榜第一最難；週榜第一、月榜前三次之；其餘都是稀有
  const honor = HONOR.exec(badge.key);
  if (honor) {
    const score = WINDOWS.indexOf(honor[1]) + (BANDS.length - 1 - BANDS.indexOf(honor[2]));
    return score >= 4 ? 'legendary' : score === 3 ? 'epic' : 'rare';
  }
  return BY_KEY[badge.key] ?? BY_CATEGORY[badge.category] ?? 'common';
}
export const badgeAp = (badge: { key: string; category: string }) => BADGE_AP[badgeRarity(badge)];

/**
 * 每枚徽章可領一次的積分（活動點數池，7,200 積分約 1 美元）。依稀有度：普通 100、稀有 500、史詩 2,000、傳說 6,000；
 * 全服唯一各自在 REWARD_BY_KEY 定。不發積分的：榜單榮譽（結算時已發獎金）、消費（疊在儲值贈送上會超過定價憲章 6% 上限）、
 * 活動與比賽（每次活動自己定）、元老（只看註冊時間，不是成就）。
 */
export const BADGE_REWARD: Record<BadgeRarity, number> = { common: 100, rare: 500, epic: 2000, legendary: 6000, unique: 30000 };
const NO_REWARD_CATEGORIES = new Set(['rank', 'spend', 'event', 'contest']);
const NO_REWARD_KEYS = new Set(['beta_veteran', 'opening_veteran']);
/** 全服唯一徽章各自的獎勵；0＝只有徽章，不發積分。 */
export const REWARD_BY_KEY: Record<string, number> = {};
export function badgeReward(badge: { key: string; category: string }): number {
  if (badge.key in REWARD_BY_KEY) return REWARD_BY_KEY[badge.key];
  if (NO_REWARD_CATEGORIES.has(badge.category) || NO_REWARD_KEYS.has(badge.key)) return 0;
  return BADGE_REWARD[badgeRarity(badge)];
}
