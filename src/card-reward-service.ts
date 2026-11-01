import { auditStmt } from './audit';
import { DUE, requestReward, retryReward, type Payer, type RewardView } from './card-reward';
import { bumpOp } from './ops-metrics';
import type { Env } from './types';

// A separate confidential client has only campaign.payout. Never reuse a player's
// bearer or silently grant payment authority to the rewards.report client.
export const cardRewardTransport = {
  async token(env: Env): Promise<string> {
    if (!env.HARBOR_CARD_REWARDS_CLIENT_ID || !env.HARBOR_CARD_REWARDS_CLIENT_SECRET) throw new Error('service_unconfigured');
    const response = await fetch(`${env.PROVIDER_API_BASE_HARBOR}/oauth/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: AbortSignal.timeout(5000),
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: env.HARBOR_CARD_REWARDS_CLIENT_ID,
        client_secret: env.HARBOR_CARD_REWARDS_CLIENT_SECRET, scope: 'campaign.payout' }),
    });
    if (!response.ok) throw new Error('service_unavailable');
    const body = await response.json() as { access_token?: unknown };
    if (typeof body.access_token !== 'string' || !body.access_token) throw new Error('service_unavailable');
    return body.access_token;
  },
};

type Path = 'stamp' | 'recovery' | 'maintenance';
type Result = { reward: RewardView | null; rewardError?: string };
const RETRY_BASE = 60_000;
const priorReward = (db: D1Database, cardId: number) => db.prepare(`SELECT id,status,attempts,updated_at FROM card_rewards
  WHERE card_id=? AND status<>'cancelled' ORDER BY status='paid' DESC,created_at DESC,id LIMIT 1`)
  .bind(cardId).first<{ id: string; status: string; attempts: number; updated_at: number }>();
const readReward = async (db: D1Database, id: string) => db.prepare(`SELECT id,card_id AS cardId,amount,status,error,attempts,
  provider_entry_id AS providerEntryId,checked_absent_at AS checkedAbsentAt,created_at AS createdAt,updated_at AS updatedAt,settled_at AS settledAt
  FROM card_rewards WHERE id=?`).bind(id).first<RewardView>();

// The HTTP stamp response reads the attempt performed by the domain operation.
// It must not start a second token exchange/payment after a failed first attempt.
export async function serviceRewardState(env: Env, cardId: number): Promise<Result> {
  try {
    const prior = await priorReward(env.DB, cardId);
    if (prior) return { reward: await readReward(env.DB, prior.id) };
    const last = await env.DB.prepare(`SELECT json_extract(after_json,'$.outcome') AS outcome FROM audit_log
      WHERE subject_kind='card_reward' AND subject_id=? AND action='automatic' ORDER BY created_at DESC,rowid DESC LIMIT 1`)
      .bind(String(cardId)).first<{outcome:string}>();
    return last?.outcome === 'unavailable' ? {reward:null,rewardError:'card_reward_service_unavailable'} : {reward:null};
  } catch { return {reward:null,rewardError:'card_reward_service_unavailable'}; }
}

export async function serviceRewardOnApproval(env: Env, cardId: number, path: Path, now = Date.now()): Promise<Result> {
  const db = env.DB, op = crypto.randomUUID();
  const audit = (outcome: string) => auditStmt(db, { subjectKind: 'card_reward', subjectId: String(cardId), actorMemberId: null,
    actorKind: 'system', action: 'automatic', after: { path, outcome }, operationId: `${op}:${outcome}`, now }).run();
  try {
    const prior = await priorReward(db, cardId);
    if (prior?.status === 'paid') return { reward: await readReward(db, prior.id) };
    if (!prior && !await db.prepare(DUE).bind(now, cardId).first()) return { reward: null };
    // Persist the start before any network request: a killed invocation remains
    // distinguishable from an ineligible card or a finished payment attempt.
    if (prior && now - prior.updated_at < Math.min(3_600_000, RETRY_BASE * 2 ** Math.min(prior.attempts - 1, 6))) {
      return { reward: await readReward(db, prior.id) };
    }
    await audit('started');
    const payer: Payer = { env, bearer: await cardRewardTransport.token(env), provider: 'harbor',
      memberId: 'service:card-rewards', service: true, now: () => now };
    const reward = prior ? await retryReward(payer, prior.id, op) : await requestReward(payer, cardId, op);
    await audit(reward.status);
    await bumpOp(db, 'card_reward_auto', path === 'maintenance' ? 'retry' : 'approval', reward.status === 'paid' ? 'paid' : 'pending');
    return { reward };
  } catch {
    // No identity or upstream error body belongs in logs/metrics. The durable
    // start/outcome pair and reward row retain the diagnostic boundary.
    await audit('unavailable').catch(() => {});
    await bumpOp(db, 'card_reward_auto', path === 'maintenance' ? 'retry' : 'approval', 'unavailable');
    return { reward: null, rewardError: 'card_reward_service_unavailable' };
  }
}

// Include in-flight/failed grants as well as cards that never got a grant row.
// Reuse the persisted grant key even after a terminal rejection; never generate
// a fresh payment key on every scheduled retry.
export const REWARD_BACKLOG = `SELECT card_id,MIN(since) AS since FROM (
 SELECT card_id,listed_at AS since FROM (${DUE})
 UNION ALL SELECT card_id,created_at AS since FROM card_rewards WHERE status IN ('pending','blocked_insufficient','failed')
 AND NOT EXISTS(SELECT 1 FROM card_rewards paid WHERE paid.work_key=card_rewards.work_key AND paid.status='paid')
) GROUP BY card_id`;

export async function cardRewardMaintenance(env: Env, now = Date.now(), limit = 10) {
  const rows = await env.DB.prepare(`SELECT card_id FROM (${REWARD_BACKLOG}) backlog ORDER BY
    COALESCE((SELECT MAX(a.created_at) FROM audit_log a WHERE a.subject_kind='card_reward'
      AND a.subject_id=CAST(backlog.card_id AS TEXT) AND a.action='automatic'),0),since,card_id LIMIT ?3`)
    .bind(now, null, Math.min(10, Math.max(1, limit))).all<{ card_id: number }>();
  for (const row of rows.results) await serviceRewardOnApproval(env, row.card_id, 'maintenance', now);
}

export async function cardRewardBacklog(db: D1Database, now = Date.now()) {
  return (await db.prepare(`SELECT count(*) AS total,COALESCE(SUM(since<=?3),0) AS overdue FROM (${REWARD_BACKLOG})`)
    .bind(now, null, now - 3_600_000).first<{ total: number; overdue: number }>())!;
}
