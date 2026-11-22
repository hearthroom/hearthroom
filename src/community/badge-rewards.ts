/**
 * 徽章積分：成員在自己的徽章頁按「領取」，每枚有效徽章領一次（數額見 shared/badge-rarity 的 badgeReward）。
 * 錢從活動點數池出，用卡片獎勵同一個服務憑證（campaign.payout）；鍵固定是 badge-<claim id>，重試只入帳一次。
 * 領取先落一筆 pending，當下試付一次；沒付成的由排程重試。付款前徽章被撤銷就作廢，不追已付的。
 */
import { HttpError, type Env } from '../types';
import { upstream } from '../upstream';
import { cardRewardTransport } from '../card-reward-service';
import { bumpOp } from '../ops-metrics';
import { ACTIVE_AWARD } from './badges';
import { badgeReward, CONVERSATION_REWARD_FROZEN_KEYS, parseConversationRewardFreeze } from '../../shared/badge-rarity';

export type ClaimState = 'pending' | 'paid' | 'void' | 'rejected';
export type ClaimSummary = { status: ClaimState; amount: number };
type Claim = { id: string; member_id: string; badge: string; amount: number; account_no: number; status: ClaimState; attempted_at: number | null };

export async function claimStates(env: Env, member: string): Promise<Record<string, ClaimState>> {
  const rows = (await env.DB.prepare('SELECT badge,status FROM badge_reward_claims WHERE member_id=?').bind(member).all<{ badge: string; status: ClaimState }>()).results;
  return Object.fromEntries(rows.map(r => [r.badge, r.status]));
}

export async function claimSummaries(env: Env, member: string): Promise<Record<string, ClaimSummary>> {
  const rows = (await env.DB.prepare('SELECT badge,status,amount FROM badge_reward_claims WHERE member_id=?').bind(member).all<{ badge: string; status: ClaimState; amount: number }>()).results;
  return Object.fromEntries(rows.map(r => [r.badge, { status: r.status, amount: r.amount }]));
}

/** 收款用的供應商公開編號：跟徽章統計同一條規則（連結過的帳號歸擁有者，取最近綁的那個）。 */
async function payoutAccount(env: Env, member: string): Promise<number | null> {
  const row = await env.DB.prepare(`SELECT CAST(i.external_id AS INTEGER) AS n FROM member_identities i LEFT JOIN member_connections c ON c.provider=i.provider AND c.external_id=i.external_id
   WHERE i.provider='harbor' AND COALESCE(c.owner_member_id,i.member_id)=? ORDER BY i.linked_at DESC,i.external_id LIMIT 1`).bind(member).first<{ n: number }>();
  return row?.n && row.n > 0 ? row.n : null;
}

/**
 * 一次領多枚：只查一次帳號、一次寫入全部領取紀錄。發點不讓使用者等：有 ctx 時放到回應之後在背景付（waitUntil），
 * 沒付成的照舊由排程重試。2026-11-20 起「全部領取」只發一個請求，不再一枚一個請求、一枚失敗整串中斷。
 */
export async function claimBadgeRewards(env: Env, member: string, wanted: { key: string; amount: number }[], now = Date.now(), ctx?: Pick<ExecutionContext, 'waitUntil'>): Promise<Record<string, ClaimState>> {
  if (wanted.length > 100 || wanted.some(w => !/^[a-z0-9_]{1,60}$/.test(w.key))) throw new HttpError(400, 'community_input');
  const blocked = await env.DB.prepare("SELECT 1 FROM members m WHERE m.id=? AND (m.account_class<>'normal' OR EXISTS(SELECT 1 FROM legacy_account_fence f WHERE f.member_id=m.id))").bind(member).first();
  if (blocked) { await bumpOp(env.DB, 'badge_reward', 'claim', 'denied'); throw new HttpError(403, 'badge_reward_unavailable'); }
  const states = await claimStates(env, member);
  const fresh = wanted.filter(w => !states[w.key] && w.amount > 0);
  if (!fresh.length) {
    if (wanted.some(w => !states[w.key])) { await bumpOp(env.DB, 'badge_reward', 'claim', 'denied'); throw new HttpError(409, 'badge_reward_unavailable'); }
    return states;
  }
  const account = await payoutAccount(env, member);
  if (!account) { await bumpOp(env.DB, 'badge_reward', 'claim', 'denied'); throw new HttpError(409, 'badge_reward_unlinked'); }
  await env.DB.batch(fresh.map(w => env.DB.prepare('INSERT OR IGNORE INTO badge_reward_claims(id,member_id,badge,amount,account_no,claimed_at) VALUES(?,?,?,?,?,?)')
    .bind(crypto.randomUUID().replaceAll('-', ''), member, w.key, w.amount, account, now)));
  await bumpOp(env.DB, 'badge_reward', 'claim', 'success', fresh.length);
  const payout = payMember(env, member, now).catch(async () => { await bumpOp(env.DB, 'badge_reward', 'payout', 'error'); });
  if (ctx) { ctx.waitUntil(payout); for (const w of fresh) states[w.key] = 'pending'; return states; }
  await payout;
  return claimStates(env, member);
}

/** 單枚領取（舊網址與測試用）：同一條路，當下等發點結果。 */
export async function claimBadgeReward(env: Env, member: string, key: string, amount: number, now = Date.now()): Promise<ClaimState> {
  return (await claimBadgeRewards(env, member, [{ key, amount }], now))[key];
}

/** 付這位成員還沒付的領取：權杖拿一次，一枚一枚付（鍵固定，重複付不會重複入帳）。 */
async function payMember(env: Env, member: string, now: number): Promise<void> {
  const rows = (await env.DB.prepare("SELECT id,member_id,badge,amount,account_no,status,attempted_at FROM badge_reward_claims WHERE member_id=? AND status='pending' AND attempted_at IS NULL ORDER BY claimed_at LIMIT 100").bind(member).all<Claim>()).results;
  if (!rows.length) return;
  let token: string;
  try { token = await cardRewardTransport.token(env); } catch { await bumpOp(env.DB, 'badge_reward', 'payout', 'pending'); return; }
  for (const row of rows) await pay(env, token, row, now);
}

async function pay(env: Env, token: string, claim: Claim, now: number): Promise<ClaimState> {
  const taken = await env.DB.prepare("UPDATE badge_reward_claims SET attempts=attempts+1,attempted_at=? WHERE id=? AND status='pending' AND attempted_at IS ?").bind(now, claim.id, claim.attempted_at).run();
  if (!taken.meta.changes) return (await env.DB.prepare('SELECT status FROM badge_reward_claims WHERE id=?').bind(claim.id).first<ClaimState>('status')) ?? 'pending';
  const active = await env.DB.prepare(`SELECT created_at FROM community_awards WHERE member_id=? AND badge=? AND ${ACTIVE_AWARD}`).bind(claim.member_id, claim.badge, now).first<{ created_at: number }>();
  // 連結 Discord、伺服器加成這兩枚不落獎勵紀錄，由徽章頁即時判斷；其他徽章付款前要還有效
  if (!active && !['discord_linked', 'server_booster'].includes(claim.badge)) {
    await env.DB.prepare("UPDATE badge_reward_claims SET status='void' WHERE id=? AND status='pending'").bind(claim.id).run();
    return 'void';
  }
  // 付款前再檢一次凍結規則（防止排程重試或合併發點繞過凍結／排除名單）
  if (CONVERSATION_REWARD_FROZEN_KEYS.has(claim.badge)) {
    const freeze = parseConversationRewardFreeze(env.CONVERSATION_BADGE_REWARD_FREEZE, env.CONVERSATION_BADGE_FREEZE_EXCLUDED);
    if (badgeReward({ key: claim.badge, category: 'play' }, { freeze, memberId: claim.member_id, state: 'earned', earnedAt: active?.created_at ?? null }) <= 0) {
      await env.DB.prepare("UPDATE badge_reward_claims SET status='void' WHERE id=? AND status='pending'").bind(claim.id).run();
      return 'void';
    }
  }
  const result = await upstream.payCampaign(env, token, { key: `badge-${claim.id}`, accountNo: claim.account_no, amount: claim.amount, campaignRef: 'badges-v1', contentRef: `badge:${claim.badge}` });
  if (result.kind === 'paid') {
    await env.DB.prepare("UPDATE badge_reward_claims SET status='paid',paid_at=?,error=NULL WHERE id=? AND status='pending'").bind(now, claim.id).run();
    await bumpOp(env.DB, 'badge_reward', 'payout', 'success');
    return 'paid';
  }
  if (result.kind === 'rejected') {
    await env.DB.prepare("UPDATE badge_reward_claims SET status='rejected',error=? WHERE id=? AND status='pending'").bind(result.code, claim.id).run();
    await bumpOp(env.DB, 'badge_reward', 'payout', 'error');
    return 'rejected';
  }
  // 池子不夠或結果不明：保持 pending，排程用同一個鍵重試
  await env.DB.prepare('UPDATE badge_reward_claims SET error=? WHERE id=?').bind(result.kind, claim.id).run();
  await bumpOp(env.DB, 'badge_reward', 'payout', 'pending');
  return 'pending';
}

/** 排程：重試沒付成的領取，一分鐘起退避到一小時。 */
export async function badgeRewardMaintenance(env: Env, now = Date.now()): Promise<void> {
  const rows = (await env.DB.prepare(`SELECT id,member_id,badge,amount,account_no,status,attempted_at FROM badge_reward_claims WHERE status='pending'
   AND (attempted_at IS NULL OR attempted_at+MIN(3600000,60000*(1<<MIN(MAX(attempts-1,0),6)))<=?) ORDER BY attempted_at IS NOT NULL,attempted_at,claimed_at LIMIT 5`).bind(now).all<Claim>()).results;
  if (!rows.length) return;
  let token: string;
  try { token = await cardRewardTransport.token(env); } catch { await bumpOp(env.DB, 'badge_reward', 'payout', 'pending'); return; }
  for (const row of rows) await pay(env, token, row, now);
}
