import type { Context } from 'hono';
import { isRating } from '../shared/content-rating';
import { bearerOf } from './community-admin';
import { requireMember } from './members';
import { bumpOp } from './ops-metrics';
import type { ProviderId } from './providers';
import { HttpError, type Env } from './types';
import { ensureOperationUuid, workshopUpstream, type WorkshopPublicationReceipt } from './workshop-gateway';
import { findMemberIdByExternal, memberOwnsExternal, normalizeDbOwnerState, resolveCardForWork } from './workshop';
type Ctx = Pick<Context<{
    Bindings: Env;
}>, "env" | "req" | "executionCtx">;
const record = (v: unknown): v is Record<string, unknown> => Boolean(v && typeof v === 'object' && !Array.isArray(v));
const text = (v: unknown) => typeof v === 'string' && v.trim() !== '';
// Validate transport structure and ownership only, never Lorebook instructions.
function publicationShape(p: WorkshopPublicationReceipt) {
    if (!p || !Number.isSafeInteger(p.publicationRevision) || p.publicationRevision < 1 || !Number.isSafeInteger(p.ownerGeneration) || p.ownerGeneration < 0 || p.status !== 'published' || p.policyVersion !== 2 || !Number.isSafeInteger(p.version) || p.version < 1 || !Number.isSafeInteger(p.draftRevision) || p.draftRevision < 1 || !p.workshopId || !p.releaseId || !p.workId || !p.sourceRoleId || !p.contentHash || !Number.isSafeInteger(p.authorPublicNo) || p.authorPublicNo < 1 || !Number.isSafeInteger(p.cardOwnerPublicNo) || p.cardOwnerPublicNo < 1 || !Number.isFinite(p.publishedAt) || !record(p.sealed) || !text(p.sealed.name) || !isRating(p.sealed.rating))
        throw new HttpError(502, 'invalid_publication');
    const expected = p.authorPublicNo === p.cardOwnerPublicNo ? 'dlc' : 'lorebook';
    if (p.kind !== expected)
        throw new HttpError(502, 'invalid_publication');
    const wb = Array.isArray(p.sealed.worldbook) ? p.sealed.worldbook : [];
    let resident = 0, lore = 0;
    for (const e of wb) {
        if (!record(e))
            throw new HttpError(502, 'invalid_publication');
        const enabled = (e.isEnabled ?? e.enabled ?? false) === true;
        if (enabled && text(e.content)) {
            lore++;
            if ((e.isConstant ?? (e.mode === 'constant')) === true)
                resident += [...String(e.content)].length;
        }
    }
    if (resident !== p.residentChars || resident > 1500)
        throw new HttpError(502, 'invalid_publication');
    const rules = record(p.sealed.rules) ? p.sealed.rules : {};
    const list = Array.isArray(rules.rules) ? rules.rules : [];
    const opening = record(p.sealed.opening) ? p.sealed.opening : {};
    if (expected === 'lorebook' && (list.length > 0 || rules.lowered === true || ['statusbar', 'mountTrigger', 'format', 'cardFormat', 'customCss', 'htmlTemplate'].some(k => text(rules[k])) || (Array.isArray(rules.trialMessages) && rules.trialMessages.some(text)) || (text(opening.mode) && opening.mode !== 'greeting') || text(opening.welcome) || text(opening.openingPage) || ['alternates', 'prologue'].some(k => Array.isArray(opening[k]) && (opening[k] as unknown[]).some(text))))
        throw new HttpError(502, 'invalid_publication');
    let ruleCount = list.filter(r => record(r) && r.enabled === true && text(r.find)).length;
    if (!ruleCount && (text(rules.statusbar) || text(rules.mountTrigger)))
        ruleCount = 1;
    const openingCount = opening.mode === 'page' ? (text(opening.openingPage) ? 1 : 0) : (text(opening.welcome) ? 1 : 0) + (Array.isArray(opening.alternates) ? opening.alternates.filter(text).length : 0);
    const kinds: string[] = [];
    if (lore)
        kinds.push('lore');
    if (ruleCount)
        kinds.push('display');
    if (openingCount)
        kinds.push('opening');
    return { resident, lore, ruleCount, openingCount, kinds };
}
export async function applyWorkshopPublication(env: Env, provider: ProviderId, p: WorkshopPublicationReceipt) {
    const content = publicationShape(p);
    const resolved = await resolveCardForWork(env.DB, provider, p.workId, p.sourceRoleId);
    if (!resolved || resolved.card.status !== 'approved' || resolved.card.public_blocked || resolved.card.author_num_id !== p.cardOwnerPublicNo)
        throw new HttpError(502, 'invalid_publication');
    const current = await env.DB.prepare('SELECT provider,work_id,author_num_id,version_no,approved_release_id FROM workshops WHERE id=?').bind(p.workshopId).first<{
        provider: string;
        work_id: string;
        author_num_id: number;
        version_no: number;
        approved_release_id: string | null;
    }>();
    if (current && (current.provider !== provider || current.work_id !== p.workId || current.author_num_id !== p.authorPublicNo || (current.version_no === p.version && current.approved_release_id && current.approved_release_id !== p.releaseId)))
        throw new HttpError(502, 'invalid_publication');
    const memberId = await findMemberIdByExternal(env.DB, provider, p.authorPublicNo);
    const now = Date.now();
    await env.DB.batch([
        env.DB.prepare(`INSERT INTO workshops(id,card_id,provider,work_id,source_role_id,author_num_id,author_member_id,name,summary,readme,cover_url,kinds,rating,version_no,approved_release_id,content_hash,resident_chars,lore_count,rule_count,opening_count,moderation_state,owner_state,owner_action_generation,first_published_at,published_at,created_at,updated_at,publication_revision)
   VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'approved',?,?,?,?,?,?,?)
   ON CONFLICT(id) DO UPDATE SET name=excluded.name,summary=excluded.summary,readme=excluded.readme,cover_url=excluded.cover_url,kinds=excluded.kinds,rating=excluded.rating,version_no=excluded.version_no,approved_release_id=excluded.approved_release_id,content_hash=excluded.content_hash,resident_chars=excluded.resident_chars,lore_count=excluded.lore_count,rule_count=excluded.rule_count,opening_count=excluded.opening_count,publication_revision=excluded.publication_revision,moderation_state='approved',published_at=excluded.published_at,updated_at=excluded.updated_at,
   first_published_at=COALESCE(workshops.first_published_at,excluded.first_published_at),author_member_id=COALESCE(workshops.author_member_id,excluded.author_member_id),
   owner_state=IIF(excluded.owner_action_generation>workshops.owner_action_generation,excluded.owner_state,workshops.owner_state),owner_action_generation=MAX(workshops.owner_action_generation,excluded.owner_action_generation)
   WHERE excluded.publication_revision>=workshops.publication_revision AND excluded.version_no>=workshops.version_no AND workshops.moderation_state NOT IN('revoked','deleted')`)
            .bind(p.workshopId, Number(resolved.card.id), provider, p.workId, p.sourceRoleId, p.authorPublicNo, memberId, p.sealed.name, p.sealed.summary ?? '', p.sealed.readme ?? '', p.sealed.coverUrl ?? '', JSON.stringify(content.kinds), p.sealed.rating, p.version, p.releaseId, p.contentHash, content.resident, content.lore, content.ruleCount, content.openingCount, normalizeDbOwnerState(p.ownerState), p.ownerGeneration, p.publishedAt, p.publishedAt, now, now, p.publicationRevision),
        env.DB.prepare(`INSERT INTO workshop_versions(workshop_id,version_no,release_id,submission_id,update_note,rating,published_at,created_at) VALUES(?,?,?,NULL,?,?,?,?) ON CONFLICT(workshop_id,release_id) DO NOTHING`).bind(p.workshopId, p.version, p.releaseId, p.sealed.updateNote ?? '', p.sealed.rating, p.publishedAt, now),
    ]);
}
export async function publishWorkshop(c: Ctx, workshopId: string, body: unknown) {
    const member = await requireMember(c);
    const token = bearerOf(c);
    if (!token)
        throw new HttpError(401, 'missing bearer token');
    if (!record(body) || !Number.isSafeInteger(body.expectedRevision) || Number(body.expectedRevision) < 1 || typeof body.operationId !== 'string' || !body.operationId.trim() || body.operationId.length > 100)
        throw new HttpError(400, 'invalid_request');
    try {
        const operationId = await ensureOperationUuid(body.operationId);
        const draft = await workshopUpstream.draftMetadata(c.env, token, workshopId, member.provider);
        if (draft.workshopId !== workshopId || !draft.card?.cardId || !draft.card?.roleId)
            throw new HttpError(502, 'invalid_publication');
        const base = await resolveCardForWork(c.env.DB, member.provider, draft.card.cardId, draft.card.roleId);
        if (!base || base.card.status !== 'approved' || base.card.public_blocked)
            throw new HttpError(404, 'not_found');
        const receipt = await workshopUpstream.publish(c.env, token, { workshopId, operationId, expectedRevision: Number(body.expectedRevision) }, member.provider);
        if (receipt.workshopId !== workshopId || !await memberOwnsExternal(c.env.DB, member, member.provider, receipt.authorPublicNo))
            throw new HttpError(403, 'not_the_author');
        await applyWorkshopPublication(c.env, member.provider, receipt);
        await bumpOp(c.env.DB, 'workshop', 'publish', 'success');
        return { workshopId: receipt.workshopId, releaseId: receipt.releaseId, status: 'published', kind: receipt.kind, version: receipt.version };
    }
    catch (err) {
        await bumpOp(c.env.DB, 'workshop', 'publish', err instanceof HttpError && err.status < 500 ? 'denied' : 'error');
        throw err;
    }
}
export interface WorkshopUnpublishReceipt {
    workshopId: string;
    workId: string;
    sourceRoleId: string;
    kind: 'dlc' | 'lorebook';
    status: 'draft';
    version: number;
    draftRevision: number;
    publicationRevision: number;
    authorPublicNo: number;
    cardOwnerPublicNo: number;
    policyVersion: 2;
}
export async function applyWorkshopUnpublication(env: Env, provider: ProviderId, p: WorkshopUnpublishReceipt) {
    if (!p || p.status !== 'draft' || p.policyVersion !== 2 || !Number.isSafeInteger(p.publicationRevision) || p.publicationRevision < 1 || !Number.isSafeInteger(p.version) || p.version < 1 || !Number.isSafeInteger(p.draftRevision) || p.draftRevision < 1 || !Number.isSafeInteger(p.authorPublicNo) || p.authorPublicNo < 1 || !Number.isSafeInteger(p.cardOwnerPublicNo) || p.cardOwnerPublicNo < 1 || p.kind !== (p.authorPublicNo === p.cardOwnerPublicNo ? 'dlc' : 'lorebook'))
        throw new HttpError(502, 'invalid_publication');
    const resolved = await resolveCardForWork(env.DB, provider, p.workId, p.sourceRoleId);
    if (!resolved || resolved.card.author_num_id !== p.cardOwnerPublicNo)
        throw new HttpError(502, 'invalid_publication');
    const current = await env.DB.prepare('SELECT provider,work_id,author_num_id FROM workshops WHERE id=?').bind(p.workshopId).first<{
        provider: string;
        work_id: string;
        author_num_id: number;
    }>();
    if (current && (current.provider !== provider || current.work_id !== p.workId || current.author_num_id !== p.authorPublicNo))
        throw new HttpError(502, 'invalid_publication');
    const now = Date.now();
    const member = await findMemberIdByExternal(env.DB, provider, p.authorPublicNo);
    await env.DB.prepare(`INSERT INTO workshops(id,card_id,provider,work_id,source_role_id,author_num_id,author_member_id,version_no,publication_revision,moderation_state,created_at,updated_at)
 VALUES(?,?,?,?,?,?,?,?,?,'draft',?,?) ON CONFLICT(id) DO UPDATE SET approved_release_id=NULL,published_at=NULL,moderation_state='draft',version_no=MAX(workshops.version_no,excluded.version_no),publication_revision=excluded.publication_revision,updated_at=excluded.updated_at
 WHERE excluded.publication_revision>workshops.publication_revision AND workshops.moderation_state NOT IN('revoked','deleted')`).bind(p.workshopId, Number(resolved.card.id), provider, p.workId, p.sourceRoleId, p.authorPublicNo, member, p.version, p.publicationRevision, now, now).run();
}
export async function workshopCreatorAction(c: Ctx, workshopId: string, body: unknown, action: 'unpublish' | 'discard-changes') {
    const member = await requireMember(c);
    const token = bearerOf(c);
    if (!token)
        throw new HttpError(401, 'missing bearer token');
    if (!record(body) || !Number.isSafeInteger(body.expectedRevision) || Number(body.expectedRevision) < 1 || typeof body.operationId !== 'string' || !body.operationId.trim() || body.operationId.length > 100)
        throw new HttpError(400, 'invalid_request');
    const operationId = await ensureOperationUuid(body.operationId);
    const receipt = await workshopUpstream.creatorAction(c.env, token, { workshopId, operationId, expectedRevision: Number(body.expectedRevision) }, action, member.provider);
    if (receipt.workshopId !== workshopId)
        throw new HttpError(502, 'invalid_publication');
    if (action === 'unpublish') {
        const p = receipt as unknown as WorkshopUnpublishReceipt;
        if (!await memberOwnsExternal(c.env.DB, member, member.provider, p.authorPublicNo))
            throw new HttpError(403, 'not_the_author');
        await applyWorkshopUnpublication(c.env, member.provider, p);
    }
    await bumpOp(c.env.DB, 'workshop', action === 'unpublish' ? 'unpublish' : 'discard', 'success');
    return receipt;
}
