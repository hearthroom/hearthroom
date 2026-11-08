/**
 * 徽章稀有度：只管徽章頁怎麼畫（底座、卡面、名稱顏色），不影響發放。
 * 依「拿到有多難」分四階；門檻在 migrations 的目錄裡，這裡照 key 對應，新目錄沒登記的落到類別預設。
 * 榜單榮譽照期別×名次算：月榜第一最難；週榜第一、月榜前三次之；其餘都是稀有。
 */
import { HONOR_BANDS, HONOR_WINDOWS, parseHonorKey } from './honors';

export const BADGE_RARITIES = ['common', 'rare', 'epic', 'legendary'] as const;
export type BadgeRarity = typeof BADGE_RARITIES[number];

const BY_KEY: Record<string, BadgeRarity> = {
  creator_works_10: 'rare', creator_followers_10: 'rare', creator_favorited_10: 'rare',
  creator_works_30: 'epic', creator_followers_100: 'epic', creator_favorited_100: 'epic', creator_featured: 'epic',
  invite_10: 'rare', invite_30: 'epic', invite_100: 'legendary',
  spend_2: 'rare', spend_3: 'epic', spend_4: 'legendary',
  opening_veteran: 'rare', member_anniversary: 'rare', beta_veteran: 'epic',
  player_explorer_50: 'rare', player_favorites_50: 'rare',
  player_commenter_10: 'rare', player_liked_10: 'rare', player_commenter_100: 'epic', player_liked_100: 'epic',
  community_level_10: 'rare', community_level_20: 'epic',
  server_booster: 'epic',
};
/** 管理員發的活動、比賽徽章是限時限量的 */
const BY_CATEGORY: Record<string, BadgeRarity> = { event: 'epic', contest: 'epic' };

export function badgeRarity(badge: { key: string; category: string }): BadgeRarity {
  const honor = parseHonorKey(badge.key);
  if (honor) {
    const score = HONOR_WINDOWS.indexOf(honor.window) + (HONOR_BANDS.length - 1 - HONOR_BANDS.indexOf(honor.band));
    return score >= 4 ? 'legendary' : score === 3 ? 'epic' : 'rare';
  }
  return BY_KEY[badge.key] ?? BY_CATEGORY[badge.category] ?? 'common';
}
