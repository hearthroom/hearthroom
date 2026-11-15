import type { Context } from 'hono';
import { getCard } from './cards';
import { bearerOf } from './community-admin';
import { requireMember } from './members';
import { bumpOp } from './ops-metrics';
import type { ProviderId } from './providers';
import { HttpError, type Env } from './types';
import { memberOwnsExternal } from './workshop';
import { workshopUpstream } from './workshop-gateway';
import { applyWorkshopOwnerProjection } from './workshop-owner-projection';

type Ctx = Pick<Context<{ Bindings: Env }>, 'env' | 'req' | 'executionCtx'>;

// Provider owns authorization and the audit record; D1 must catch up before the
// caller refreshes the public card. Generation fencing also covers late outbox delivery.
export async function workshopOwnerAction(c: Ctx, workshopId: string, body: unknown) {
  const member = await requireMember(c);
  const token = bearerOf(c);
  if (!token) throw new HttpError(401, 'missing bearer token');
  try {
    const input = body && typeof body === 'object' ? body as Record<string, unknown> : {};
    const action = input.action;
    if ((action !== 'hide' && action !== 'restore') ||
        (input.expectedGeneration !== undefined && (!Number.isSafeInteger(input.expectedGeneration) || Number(input.expectedGeneration) < 0))) {
      throw new HttpError(400, 'invalid_request');
    }
    const row = await c.env.DB.prepare('SELECT provider,card_id,author_num_id FROM workshops WHERE id=?')
      .bind(workshopId).first<{ provider: ProviderId; card_id: number; author_num_id: number }>();
    if (!row) throw new HttpError(404, 'not_found');
    const card = await getCard(c.env.DB, String(row.card_id));
    if (!card) throw new HttpError(404, 'not_found');
    if (row.provider !== member.provider || row.author_num_id === card.author_num_id ||
        !await memberOwnsExternal(c.env.DB, member, row.provider, card.author_num_id)) {
      throw new HttpError(403, 'not_the_author');
    }
    const receipt = await workshopUpstream.ownerAction(c.env, token, { workshopId, action,
      ...(input.expectedGeneration !== undefined ? { expectedGeneration: Number(input.expectedGeneration) } : {}) }, row.provider);
    if (!Number.isSafeInteger(receipt.generation) || receipt.generation < 1 ||
        receipt.ownerState !== (action === 'hide' ? 'hidden' : 'visible')) {
      throw new HttpError(502, 'invalid_owner_action');
    }
    await applyWorkshopOwnerProjection(c.env.DB,row.provider,workshopId,action,receipt.generation);
    await bumpOp(c.env.DB, 'workshop', 'owner_action', 'success');
    return receipt;
  } catch (error) {
    await bumpOp(c.env.DB, 'workshop', 'owner_action', error instanceof HttpError && error.status === 409 ? 'conflict' : error instanceof HttpError && error.status < 500 ? 'denied' : 'error');
    throw error;
  }
}
