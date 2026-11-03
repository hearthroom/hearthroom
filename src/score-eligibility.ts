import { getCard } from './cards';
import type { CommentCard } from './comments';
import { hostingKey } from './hosting';
import { apiBaseOf } from './providers';
import { currentCardAccess } from './work-read';
import { HttpError, type Env } from './types';

export interface ScoreEligibility {
  eligible: boolean;
  turns: number;
  credits: string;
  requiredTurns: number;
  paidTurns: number;
  requiredCredits: string;
}

/** The provider derives the viewer from their bearer. Never send client progress or an account ID. */
export const scoreGateway = {
  async read(env: Env, roleId: string, token: string): Promise<ScoreEligibility> {
    const key = hostingKey(env, 'harbor');
    if (!key) throw new HttpError(503, 'score_eligibility_unavailable');
    try {
      const res = await fetch(`${apiBaseOf(env, 'harbor')}/open/v1/hosting/score-eligibility`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hosting-Key': key, Authorization: `Bearer ${token}` },
        body: JSON.stringify({ roleId }), redirect: 'manual', signal: AbortSignal.timeout(7000),
      });
      if (!res.ok) throw new Error('Qualification unavailable');
      const value = await res.json() as ScoreEligibility;
      if (!Number.isSafeInteger(value.turns) || value.turns < 0 || typeof value.credits !== 'string' || !/^(0|[1-9]\d*)$/.test(value.credits)
        || value.requiredTurns !== 6 || value.paidTurns !== 3 || value.requiredCredits !== '500'
        || value.eligible !== (value.turns >= value.requiredTurns || value.turns >= value.paidTurns && BigInt(value.credits) >= BigInt(value.requiredCredits))) {
        throw new Error('Invalid qualification');
      }
      // Explicit projection: upstream additions can never leak identities or private data.
      return { eligible: value.eligible, turns: value.turns, credits: value.credits, requiredTurns: value.requiredTurns, paidTurns: value.paidTurns, requiredCredits: value.requiredCredits };
    } catch {
      throw new HttpError(503, 'score_eligibility_unavailable');
    }
  },
};

export async function scoreEligibility(env: Env, card: CommentCard, token: string): Promise<ScoreEligibility> {
  const row = await getCard(env.DB, card.id);
  if (!row || row.provider !== 'harbor') throw new HttpError(503, 'score_eligibility_unavailable');
  const access = await currentCardAccess(env, row, 'social');
  if (!access.reachable) throw new HttpError(404, 'card not found');
  return scoreGateway.read(env, access.shareRoleId || row.approved_hosted_role_id || row.source_role_id, token);
}
