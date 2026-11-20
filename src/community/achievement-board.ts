import type { Env } from '../types';
import { snapshot } from '../snapshot-cache';
import { badgeAp } from '../../shared/badge-rarity';
import { AUTHOR_CATEGORIES, UNRANKED_CATEGORIES, levelOf, type AchievementBoard, type AchievementBoardKind } from '../../shared/achievements';

type Row = { member_id: string; badge: string; category: string; n: number };
type Member = { id: string; handle: string; display_name: string | null; avatar_url: string | null };
export interface RankedMember { memberId: string; ap: number }

const TAIPEI = 8 * 3600000;
/** 'YYYY-MM' 的起訖（台北時間） */
export function monthRange(period: string): { start: number; end: number } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  if (!m) return null;
  const year = Number(m[1]), month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return { start: Date.UTC(year, month - 1, 1) - TAIPEI, end: Date.UTC(year, month, 1) - TAIPEI };
}
export const currentMonth = (now = Date.now()) => new Date(now + TAIPEI).toISOString().slice(0, 7);

/**
 * 依榜別與週期算每位成員的成就點並排好（同分照公開 ID）。榜單榮譽每拿一次算一次，從 rank_awards 讀；
 * 其他徽章讀有效的獲獎紀錄。整張榜 30 分鐘快取一份。
 */
export async function rankedMembers(env: Env, board: AchievementBoardKind, period: string): Promise<{ order: RankedMember[]; members: Record<string, Member> }> {
  const bucket = Math.floor(Date.now() / 1800000);
  return (await snapshot(env, ['achievement-board-v1', board, period, bucket], 1800, async () => {
    const now = Date.now();
    const range = period === 'all' ? null : monthRange(period);
    const window = range ? ' AND a.created_at>=? AND a.created_at<?' : '';
    const rankWindow = range ? ' AND r.awarded_at>=? AND r.awarded_at<?' : '';
    const memberFilter = `m.account_class='normal' AND NOT EXISTS(SELECT 1 FROM legacy_account_fence f WHERE f.member_id=m.id)` +
      (board === 'all' ? ` AND EXISTS(SELECT 1 FROM community_preferences p WHERE p.member_id=m.id AND p.public_badges=1)
       AND NOT EXISTS(SELECT 1 FROM leaderboard_privacy l WHERE l.member_id=m.id AND l.anonymous=1)` : '');
    const categories = board === 'author' ? AUTHOR_CATEGORIES : null;
    const categoryFilter = categories ? ` AND d.category IN (${categories.map(() => '?').join(',')})` : ` AND d.category NOT IN (${UNRANKED_CATEGORIES.map(() => '?').join(',')})`;
    const categoryArgs = categories ?? UNRANKED_CATEGORIES;
    const awards = env.DB.prepare(`SELECT a.member_id,a.badge,d.category,1 AS n FROM community_awards a JOIN community_badge_definitions d ON d.key=a.badge JOIN members m ON m.id=a.member_id
      WHERE a.revoked_at IS NULL AND (a.expires_at IS NULL OR a.expires_at>?) AND a.badge NOT LIKE 'rank\\_%' ESCAPE '\\' AND ${memberFilter}${categoryFilter}${window}`)
      .bind(now, ...categoryArgs, ...(range ? [range.start, range.end] : []));
    const honors = env.DB.prepare(`SELECT r.member_id,'rank_'||r.zone||'_'||r.window||'_'||r.band AS badge,'rank' AS category,COUNT(*) AS n FROM rank_awards r JOIN members m ON m.id=r.member_id
      WHERE ${memberFilter}${rankWindow} GROUP BY r.member_id,r.zone,r.window,r.band`).bind(...(range ? [range.start, range.end] : []));
    const [a, h] = await env.DB.batch<Row>([awards, honors]);
    const ap = new Map<string, number>();
    for (const r of [...a.results, ...h.results]) ap.set(r.member_id, (ap.get(r.member_id) ?? 0) + badgeAp({ key: r.badge, category: r.category }) * r.n);
    const ids = [...ap.keys()];
    const members: Record<string, Member> = {};
    for (let i = 0; i < ids.length; i += 90) {
      const chunk = ids.slice(i, i + 90);
      const rows = (await env.DB.prepare(`SELECT id,handle,display_name,avatar_url FROM members WHERE id IN (${chunk.map(() => '?').join(',')})`).bind(...chunk).all<Member>()).results;
      for (const m of rows) members[m.id] = m;
    }
    const order = ids.filter(id => members[id]?.handle).map(id => ({ memberId: id, ap: ap.get(id)! }))
      .sort((x, y) => y.ap - x.ap || members[x.memberId].handle.localeCompare(members[y.memberId].handle));
    return { order, members };
  })).value;
}

export async function achievementBoard(env: Env, board: AchievementBoardKind, period: string, limit = 50): Promise<AchievementBoard> {
  const { order, members } = await rankedMembers(env, board, period);
  return {
    board, period,
    items: order.slice(0, limit).map((r, i) => {
      const m = members[r.memberId];
      return { rank: i + 1, ap: r.ap, level: levelOf(r.ap), author: { handle: m.handle, name: m.display_name ?? m.handle, avatar: m.avatar_url ?? '' } };
    }),
  };
}

/** 作者成就總榜上的名次（沒上榜回 null）。 */
export async function authorRankOf(env: Env, member: string): Promise<number | null> {
  const { order } = await rankedMembers(env, 'author', 'all');
  const i = order.findIndex(r => r.memberId === member);
  return i < 0 ? null : i + 1;
}
