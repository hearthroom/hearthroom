export async function readWorkshopPolicy(db: D1Database, cardId: number): Promise<{
    enabled: boolean;
    revision: number;
}> {
    const row = await db.prepare('SELECT allow_new,consent_version,revision FROM workshop_policies WHERE card_id=? ORDER BY updated_at DESC LIMIT 1').bind(cardId).first<{
        allow_new: number;
        consent_version: number;
        revision: number;
    }>();
    return { enabled: row?.consent_version === 2 && row.allow_new === 1, revision: row?.revision ?? 0 };
}
import type { Context } from 'hono';
import { getCard } from './cards';
import { bearerOf } from './community-admin';
import { requireMember } from './members';
import { HttpError, type Env } from './types';
import { applyWorkshopEvents, memberOwnsExternal, cardPlayRoleId } from './workshop';
import { workshopUpstream } from './workshop-gateway';
type Ctx = Pick<Context<{
    Bindings: Env;
}>, 'env' | 'req' | 'executionCtx'>;
export async function saveWorkshopPolicy(c: Ctx, cardId: string, body: unknown) {
    const member = await requireMember(c);
    const token = bearerOf(c);
    if (!token)
        throw new HttpError(401, 'missing bearer token');
    const card = await getCard(c.env.DB, cardId);
    if (!card)
        throw new HttpError(404, 'not_found');
    if (!await memberOwnsExternal(c.env.DB, member, card.provider, card.author_num_id))
        throw new HttpError(403, 'not_the_author');
    const input = body as {
        allowNew?: unknown;
        expectedRevision?: unknown;
    } | null;
    if (!input || typeof input.allowNew !== 'boolean' || !Number.isSafeInteger(input.expectedRevision) || Number(input.expectedRevision) < 1)
        throw new HttpError(400, 'invalid_request');
    const roleId = cardPlayRoleId(card);
    let policy: Record<string, unknown>;
    try {
        policy = await workshopUpstream.policySave(c.env, token, { roleId, allowNew: input.allowNew, expectedRevision: Number(input.expectedRevision) }, member.provider);
    }
    catch (error) {
        if (!(error instanceof HttpError && error.status === 409))
            throw error;
        const current = await workshopUpstream.policyGet(c.env, token, roleId, member.provider);
        if (current.allowNew !== input.allowNew || Number(current.revision) <= Number(input.expectedRevision))
            throw error;
        policy = current;
    }
    if (typeof policy.workId !== 'string' || !policy.workId || typeof policy.allowNew !== 'boolean' || !Number.isSafeInteger(policy.revision) || Number(policy.revision) < 1)
        throw new HttpError(502, 'invalid_policy');
    await applyWorkshopEvents(c.env, [{ kind: 'policy_changed', eventKey: `policy:v2:${member.provider}:${policy.workId}:${policy.revision}`, provider: member.provider, workId: policy.workId, sourceRoleId: card.source_role_id, payload: { policyVersion: 2, allowNew: policy.allowNew, revision: policy.revision } }]);
    return policy;
}
