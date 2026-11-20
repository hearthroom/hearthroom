/**
 * 全服唯一徽章（first_<名>）與先驅版（first_<名>_pioneer）的發放（成就設計 V2 §7.0）。
 *
 * 誰是第一個只看越線時間（觸發那件事發生的時刻），不看我們哪時候讀到：讀數據是分批輪流刷新的，
 * 所以越線之後先等一段確認期（邀請 7 天：大約是所有成員輪一圈刷新的兩倍多；儲值 30 天：退款、拒付的窗口），
 * 期間更早越線的人一定會被讀到。確認期過了、現在仍然達標的，照越線時間排：第一位拿唯一版，第 2–10 位拿先驅版。
 * 一枚發出去就佔住名次：撤銷不順延，第二名不會補上第一名（資料庫的唯一索引也守著這一點）。
 * 獲獎時間記成越線時間，徽章頁的「第幾位獲得」就照真正的先後。
 */
import type { Env } from '../types';
import { bumpOp } from '../ops-metrics';

export interface FirstBadge {
  key: string;
  /** 越線時間的欄位或子查詢，回 (member_id, at) */
  crossings: string;
  /** 越線後多久才確認 */
  hold: number;
}
const DAY = 86400000;
export const PIONEER_SLOTS = 9;

/** 讀 Harbor 統計的兩枚：付費好友 100、儲值與使用都到星輝門檻。條件也要「現在仍然成立」。 */
export const STAT_FIRST_BADGES: FirstBadge[] = [
  { key: 'first_lighthouse', hold: 7 * DAY, crossings: 'SELECT member_id,paid_invites_100_at AS at FROM badge_qualifications WHERE paid_invites_100_at IS NOT NULL AND paid_invites>=100' },
  { key: 'first_starlight', hold: 30 * DAY, crossings: 'SELECT member_id,starlight_at AS at FROM badge_qualifications WHERE starlight_at IS NOT NULL AND net_topup_usd_micros>=1000000000 AND consumed_credits>=6000000' },
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
      const r = await env.DB.prepare("INSERT OR IGNORE INTO community_awards(member_id,badge,source,created_at) VALUES(?,?,'first-v1',?)").bind(c.member_id, key, c.at).run();
      if (!r.meta.changes) { if (key === badge.key) firstTaken = true; continue; }
      holders.add(c.member_id);
      if (key === badge.key) firstTaken = true; else pioneers++;
      await env.DB.prepare('UPDATE members SET public_cache_revision=lower(hex(randomblob(16))) WHERE id=?').bind(c.member_id).run();
      await bumpOp(env.DB, 'badge_stats', 'first', 'success');
    }
  }
}
