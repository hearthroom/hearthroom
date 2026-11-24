/**
 * 全服唯一徽章（sole_<名>）與先驅版（sole_<名>_pioneer）的發放（成就設計 V2 §7.0）。
 *
 * 誰是第一個只看越線時間（觸發那件事發生的時刻），不看我們哪時候讀到：讀數據是分批輪流刷新的，
 * 所以越線之後先等一段確認期（邀請 7 天：大約是所有成員輪一圈刷新的兩倍多；儲值 30 天：退款、拒付的窗口），
 * 期間更早越線的人一定會被讀到。確認期過了、現在仍然達標的，照越線時間排：第一位拿唯一版，第 2–10 位拿先驅版。
 * 一枚發出去就佔住名次：撤銷不順延，第二名不會補上第一名（資料庫的唯一索引也守著這一點）。
 * 獲獎時間記成越線時間，徽章頁的「第幾位獲得」就照真正的先後。
 */
import type { Env } from '../types';
import { bumpOp } from '../ops-metrics';
import { OWNED_LISTED } from './badges';

export interface FirstBadge {
  key: string;
  /** 越線時間的欄位或子查詢，回 (member_id, at) */
  crossings: string;
  /** 越線後多久才確認 */
  hold: number;
}
const DAY = 86400000;
export const PIONEER_SLOTS = 9;

/**
 * 讀 Harbor 統計的幾枚：付費好友 100、儲值與使用都到星輝門檻、探索 500 個角色。條件也要「現在仍然成立」。
 * 千面旅人原本看遊玩頁回報的「開過對話」（不驗證），2026-11-22 改成 Harbor 驗證過的角色數：
 * 每個角色自己聊滿 10 輪、每天最多計入 10 個，所以最快也要 50 天。
 */
export const STAT_FIRST_BADGES: FirstBadge[] = [
  { key: 'sole_lighthouse', hold: 7 * DAY, crossings: 'SELECT member_id,paid_invites_100_at AS at FROM badge_qualifications WHERE paid_invites_100_at IS NOT NULL AND paid_invites>=100' },
  // 千面旅人仍停發（PM 2026-11-22）：資格刷新一輪要兩天多，誰先被刷到誰先拿，更早達標的人事後無法更正。
  // 等 Harbor exploredRoles 上線、全站資格完整刷新一輪後再決定是否放行；數照存，放行時取消這行註解，並把 badges.ts PROGRESS_ONLY 的 paused 改成 false。
  // { key: 'sole_wanderer', hold: DAY, crossings: 'SELECT member_id,explored_roles_500_at AS at FROM badge_qualifications WHERE explored_roles_500_at IS NOT NULL AND explored_roles>=500' },
  { key: 'sole_starlight', hold: 30 * DAY, crossings: 'SELECT member_id,starlight_at AS at FROM badge_qualifications WHERE starlight_at IS NOT NULL AND net_topup_usd_micros>=1000000000 AND consumed_credits>=6000000' },
];

export async function awardFirstBadges(env: Env, badges: FirstBadge[], now = Date.now()): Promise<void> {
  for (const badge of badges) {
    const pioneer = `${badge.key}_pioneer`;
    if (!await env.DB.prepare('SELECT 1 FROM community_badge_definitions WHERE key=?').bind(badge.key).first()) continue;
    const taken = (await env.DB.prepare('SELECT member_id,badge FROM community_awards WHERE badge IN (?,?)').bind(badge.key, pioneer).all<{ member_id: string; badge: string }>()).results;
    const holders = new Set(taken.map(r => r.member_id));
    let firstTaken = taken.some(r => r.badge === badge.key), pioneers = taken.filter(r => r.badge === pioneer).length;
    if (firstTaken && pioneers >= PIONEER_SLOTS) continue;
    const candidates = (await env.DB.prepare(`SELECT c.member_id,c.at FROM (${badge.crossings}) c JOIN members m ON m.id=c.member_id
      WHERE c.at<=? AND m.account_class='normal' AND NOT EXISTS(SELECT 1 FROM legacy_account_fence f WHERE f.member_id=m.id)
      ORDER BY c.at,c.member_id LIMIT 20`).bind(now - badge.hold).all<{ member_id: string; at: number }>()).results;
    for (const c of candidates) {
      if (holders.has(c.member_id)) continue;
      const key = !firstTaken ? badge.key : pioneers < PIONEER_SLOTS ? pioneer : null;
      if (!key) break;
      const r = await env.DB.prepare("INSERT OR IGNORE INTO community_awards(member_id,badge,source,created_at) VALUES(?,?,'sole-v1',?)").bind(c.member_id, key, c.at).run();
      if (!r.meta.changes) { if (key === badge.key) firstTaken = true; continue; }
      holders.add(c.member_id);
      if (key === badge.key) firstTaken = true; else pioneers++;
      await env.DB.prepare('UPDATE members SET public_cache_revision=lower(hex(randomblob(16))) WHERE id=?').bind(c.member_id).run();
      await bumpOp(env.DB, 'badge_stats', 'first', 'success');
    }
  }
}

const OWNER = 'COALESCE(ac.owner_member_id,ai.member_id)';
/** 第 n 筆（從 1 數）的時間：越線那一刻 */
const nth = (table: string, where: string, n: number) => `(SELECT x.created_at FROM ${table} x WHERE ${where} ORDER BY x.created_at,x.rowid LIMIT 1 OFFSET ${n - 1})`;
/**
 * 讀本站資料就算得出越線時間的幾枚（成就設計 V2 §7.4）。收藏、關注、按讚可以收回，所以都要「現在仍然達標」，
 * 再等一天確認；榜單榮譽結算了就不變，不必等。
 */
export const LOCAL_FIRST_BADGES: FirstBadge[] = [
  { key: 'sole_treasured', hold: DAY, crossings: `SELECT o.member_id,${nth('member_favorites', 'x.card_id=o.id', 1000)} AS at FROM (SELECT c.id,${OWNER} AS member_id FROM ${OWNED_LISTED}) o
    WHERE (SELECT COUNT(*) FROM member_favorites f WHERE f.card_id=o.id)>=1000` },
  { key: 'sole_beloved', hold: DAY, crossings: `SELECT a.author_id AS member_id,${nth('member_follows', 'x.author_id=a.author_id', 500)} AS at FROM (SELECT author_id FROM member_follows GROUP BY author_id HAVING COUNT(*)>=500) a` },
  { key: 'sole_eloquent', hold: DAY, crossings: `SELECT c.member_id,${nth('comment_likes', 'x.comment_id=c.id', 100)} AS at FROM comments c
    WHERE c.deleted_at IS NULL AND c.status='visible' AND (SELECT COUNT(*) FROM comment_likes l WHERE l.comment_id=c.id)>=100` },
  { key: 'sole_founder', hold: DAY, crossings: `WITH owned AS (SELECT c.id,c.registered_at,${OWNER} AS member_id FROM ${OWNED_LISTED}),
    listed AS (SELECT member_id,registered_at,ROW_NUMBER() OVER (PARTITION BY member_id ORDER BY registered_at,id) AS n FROM owned),
    honored AS (SELECT o.member_id,MIN(r.awarded_at) AS first_at FROM owned o JOIN rank_awards r ON r.card_id=o.id GROUP BY o.id),
    ranked AS (SELECT member_id,first_at,ROW_NUMBER() OVER (PARTITION BY member_id ORDER BY first_at) AS n FROM honored)
    SELECT l.member_id,MAX(l.registered_at,h.first_at) AS at FROM listed l JOIN ranked h ON h.member_id=l.member_id AND h.n=5 WHERE l.n=30` },
  { key: 'sole_triple_crown', hold: 0, crossings: `WITH wins AS (SELECT member_id,period,MIN(awarded_at) AS at FROM rank_awards WHERE window='week' AND band=1 AND member_id IS NOT NULL GROUP BY member_id,period),
    runs AS (SELECT member_id,period,at,LAG(period,1) OVER w AS p1,LAG(period,2) OVER w AS p2 FROM wins WINDOW w AS (PARTITION BY member_id ORDER BY period))
    SELECT member_id,MIN(at) AS at FROM runs WHERE p1=date(period,'-7 days') AND p2=date(period,'-14 days') GROUP BY member_id` },
  { key: 'sole_double_crown', hold: 0, crossings: `SELECT member_id,MIN(at) AS at FROM (SELECT member_id,period,MAX(awarded_at) AS at FROM rank_awards WHERE window='month' AND band=1 AND member_id IS NOT NULL
    GROUP BY member_id,period HAVING COUNT(DISTINCT zone)=2) GROUP BY member_id` },
  { key: 'sole_grand_slam', hold: 0, crossings: `SELECT member_id,MAX(first_at) AS at FROM (SELECT member_id,MIN(awarded_at) AS first_at FROM rank_awards WHERE member_id IS NOT NULL GROUP BY member_id,zone,window,band)
    GROUP BY member_id HAVING COUNT(*)=18` },
];
