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
import { CARD_NUMBER, getCard } from './cards';
import { cardLink } from './card-link';
import { bearerOf } from './community-admin';
import { requireMember } from './members';
import { bumpOp } from './ops-metrics';
import type { ProviderId } from './providers';
import { HttpError, type Env } from './types';
import { applyWorkshopEvents, memberOwnsExternal, cardPlayRoleId } from './workshop';
import { workshopUpstream } from './workshop-gateway';
import { applyWorkshopPublication } from './workshop-publication';
type Ctx = Pick<Context<{
    Bindings: Env;
}>, 'env' | 'req' | 'executionCtx'>;
const ROLE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Fenced write of one v2 policy into the public projection. The key is Provider's
 * canonical work id; a lower revision never replaces a newer one.
 */
export async function upsertWorkshopPolicyProjection(db: D1Database, provider: ProviderId, workId: string, cardId: number, allowNew: boolean, revision: number, now = Date.now()): Promise<number> {
    const res = await db.prepare(`INSERT INTO workshop_policies(provider,work_id,card_id,allow_new,revision,consent_version,updated_at)
            VALUES(?,?,?,?,?,2,?) ON CONFLICT(provider,work_id) DO UPDATE SET
            card_id=excluded.card_id,allow_new=excluded.allow_new,revision=excluded.revision,
            consent_version=2,updated_at=excluded.updated_at
            WHERE excluded.revision>workshop_policies.revision OR
              (excluded.revision=workshop_policies.revision AND workshop_policies.consent_version<>2)`)
        .bind(provider, workId, cardId, allowNew ? 1 : 0, revision, now).run();
    return res.meta.changes;
}

/** A submission waits at most this long for Provider's current workshop state. */
const BACKFILL_TIMEOUT_MS = 3_000;

/**
 * Called on every hosting submission (the only way a card becomes publicly listed),
 * including a retried submission that returns early; the fences make reruns safe.
 * While the card had no community row (or was not listed), the outbox events for the
 * author's switch and DLC publications had nothing to project onto and were acknowledged
 * as deferred. One read of Provider's current state replaces replaying them:
 * - the policy, under the same revision fence as the events;
 * - every item that carries a publication receipt (still published, not revoked), through
 *   applyWorkshopPublication with its version / publicationRevision / ownerGeneration
 *   fences. Items without a receipt are not written.
 * Never fails the submission: on error or timeout the projection stays as it was until
 * the next event.
 */
export async function projectCurrentWorkshopState(env: Env, provider: ProviderId, cardId: string, roleId: string, token?: string | null): Promise<void> {
    try {
        const state = await workshopUpstream.state(env, { sourceRoleId: roleId }, token ?? null, provider, BACKFILL_TIMEOUT_MS);
        let changed = await projectPolicyFromState(env.DB, provider, Number(cardId), state);
        let failed = false;
        for (const item of state.items ?? []) {
            const receipt = item.publication;
            if (!receipt || typeof receipt !== 'object')
                continue;
            try {
                await applyWorkshopPublication(env, provider, receipt, { submittedBase: true });
                changed = true;
            }
            catch (error) {
                // One unusable receipt does not stop the policy or the other items.
                if (!(error instanceof HttpError && error.status < 500))
                    throw error;
                console.warn('workshop_publication_backfill_skipped', { code: error.message });
                failed = true;
            }
        }
        await bumpOp(env.DB, 'workshop', 'policy_backfill', failed ? 'error' : changed ? 'success' : 'noop');
    }
    catch (error) {
        console.error('workshop_policy_backfill_failed', { code: error instanceof HttpError ? error.message : 'unexpected' });
        await bumpOp(env.DB, 'workshop', 'policy_backfill', 'error');
    }
}

/**
 * An open policy is upserted under Provider's work id. A closed one only updates a row
 * with that same key: a default "closed" read under a newly bound work id must not delete
 * a tab that is open under the earlier key. Returns whether a row changed.
 */
async function projectPolicyFromState(db: D1Database, provider: ProviderId, cardId: number, state: { workId?: string; allowNew?: boolean; revision?: number; policyRevision?: number }): Promise<boolean> {
    const revision = Number(state.policyRevision ?? state.revision);
    if (typeof state.workId !== 'string' || !state.workId || typeof state.allowNew !== 'boolean' || !Number.isSafeInteger(revision) || revision < 1)
        throw new HttpError(502, 'invalid_policy');
    if (state.allowNew)
        return (await upsertWorkshopPolicyProjection(db, provider, state.workId, cardId, true, revision)) > 0;
    const res = await db.prepare(`UPDATE workshop_policies SET card_id=?,allow_new=0,revision=?,consent_version=2,updated_at=?
      WHERE provider=? AND work_id=? AND (revision<? OR (revision=? AND consent_version<>2))`)
        .bind(cardId, revision, Date.now(), provider, state.workId, revision, revision).run();
    return res.meta.changes > 0;
}

/**
 * Which Provider role an id without a community row names. Only the site's own card
 * number table or a well-formed role id is accepted; ownership is decided by Provider
 * with the caller's bearer, never here.
 */
async function ownerOnlyRoleId(env: Env, id: string, provider: ProviderId): Promise<string | null> {
    if (!CARD_NUMBER.test(id) && !ROLE_ID.test(id))
        return null;
    const link = await cardLink(env, id, provider).catch((error) => {
        if (error instanceof HttpError && error.status === 404)
            return null;
        throw error;
    });
    if (link?.row)
        return null;
    if (link?.source)
        return link.source.provider === provider ? link.source.roleId : null;
    return ROLE_ID.test(id) ? id : null;
}

async function saveUpstreamPolicy(c: Ctx, token: string, provider: ProviderId, roleId: string, allowNew: boolean, expectedRevision: number) {
    let policy: Record<string, unknown>;
    try {
        policy = await workshopUpstream.policySave(c.env, token, { roleId, allowNew, expectedRevision }, provider);
    }
    catch (error) {
        if (!(error instanceof HttpError && error.status === 409))
            throw error;
        const current = await workshopUpstream.policyGet(c.env, token, roleId, provider);
        if (current.allowNew !== allowNew || Number(current.revision) <= expectedRevision)
            throw error;
        policy = current;
    }
    if (typeof policy.workId !== 'string' || !policy.workId || typeof policy.allowNew !== 'boolean' || !Number.isSafeInteger(policy.revision) || Number(policy.revision) < 1)
        throw new HttpError(502, 'invalid_policy');
    return policy as Record<string, unknown> & { workId: string; allowNew: boolean; revision: number };
}

export async function saveWorkshopPolicy(c: Ctx, cardId: string, body: unknown) {
    const member = await requireMember(c);
    const token = bearerOf(c);
    if (!token)
        throw new HttpError(401, 'missing bearer token');
    const card = await getCard(c.env.DB, cardId);
    // No community row (a private or not-yet-listed card): Provider is the only
    // authority for this author's switch, and there is no public projection to update.
    const roleOnly = card ? null : await ownerOnlyRoleId(c.env, cardId, member.provider);
    if (!card && !roleOnly)
        throw new HttpError(404, 'not_found');
    if (card && !await memberOwnsExternal(c.env.DB, member, card.provider, card.author_num_id))
        throw new HttpError(403, 'not_the_author');
    const input = body as {
        allowNew?: unknown;
        expectedRevision?: unknown;
    } | null;
    if (!input || typeof input.allowNew !== 'boolean' || !Number.isSafeInteger(input.expectedRevision) || Number(input.expectedRevision) < 1)
        throw new HttpError(400, 'invalid_request');
    if (!card)
        return await saveUpstreamPolicy(c, token, member.provider, roleOnly!, input.allowNew, Number(input.expectedRevision));
    const policy = await saveUpstreamPolicy(c, token, member.provider, cardPlayRoleId(card), input.allowNew, Number(input.expectedRevision));
    await applyWorkshopEvents(c.env, [{ kind: 'policy_changed', eventKey: `policy:v2:${member.provider}:${policy.workId}:${policy.revision}`, provider: member.provider, workId: policy.workId, sourceRoleId: card.source_role_id, payload: { policyVersion: 2, allowNew: policy.allowNew, revision: policy.revision } }]);
    return policy;
}
