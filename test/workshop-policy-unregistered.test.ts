import { SELF, env } from 'cloudflare:test';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { approveFixtureResponse } from './hosted-fixture';
import { bearer, identities, makeMember, ratingBody, resetDb, restoreUpstream, rolesOnMainSite } from './helpers';
import { applyWorkshopEvents } from '../src/workshop';
import { restoreWorkshopUpstream, workshopUpstream } from '../src/workshop-gateway';
import { HttpError } from '../src/types';

// Synthetic identities only: 74101 owns both cards, 74102 is another member.
const PRIVATE_ROLE = '6f1b6a52-6c1e-4f43-9f43-1b7c1a000001';
const LATER_ROLE = '6f1b6a52-6c1e-4f43-9f43-1b7c1a000002';
const up = workshopUpstream as any;
let privateNum: number;

beforeEach(async () => {
  await resetDb(); identities({ owner: 74101, other: 74102 }); await makeMember(74101); await makeMember(74102);
  await env.DB.prepare("INSERT INTO card_numbers(provider,source_role_id) VALUES('harbor',?)").bind(PRIVATE_ROLE).run();
  privateNum = (await env.DB.prepare('SELECT num FROM card_numbers WHERE source_role_id=?').bind(PRIVATE_ROLE).first<{ num: number }>())!.num;
});
afterEach(() => { restoreWorkshopUpstream(); restoreUpstream(); });

/** Provider fake: only the canonical author token may read or save; others get a non-identifying 404. */
function providerPolicy() {
  const state = { allowNew: false, revision: 1 };
  const calls: { op: string; roleId: string; token: string }[] = [];
  const view = () => ({ workId: PRIVATE_ROLE, sourceRoleId: PRIVATE_ROLE, allowNew: state.allowNew, everOpened: state.allowNew || state.revision > 1, revision: state.revision, items: [], counts: { dlcPublished: 0, dlcDrafts: 0, lorebookPublished: 0, lorebookDrafts: 0, joinCount: 0 } });
  up.policyGet = async (_e: unknown, token: string, roleId: string) => {
    calls.push({ op: 'get', roleId, token });
    if (token !== 'owner' || roleId !== PRIVATE_ROLE) throw new HttpError(404, 'not_found');
    return view();
  };
  up.policySave = async (_e: unknown, token: string, input: { roleId: string; allowNew: boolean; expectedRevision: number }) => {
    calls.push({ op: 'save', roleId: input.roleId, token });
    if (token !== 'owner' || input.roleId !== PRIVATE_ROLE) throw new HttpError(404, 'not_found');
    if (input.expectedRevision !== state.revision) throw new HttpError(409, 'workshop_policy_stale');
    state.allowNew = input.allowNew; state.revision++;
    return view();
  };
  return { state, calls };
}
const save = (id: string | number, token: string, body: unknown) =>
  SELF.fetch(`https://c.test/v1/cards/${id}/workshop/policy`, { method: 'POST', headers: { ...bearer(token), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
async function publicRows() {
  const count = async (table: string) => (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())!.n;
  return { cards: await count('cards'), policies: await count('workshop_policies'), registrations: await count('card_registrations') };
}

it('saves the author switch on an own card that has no community row, without registering or projecting it', async () => {
  const p = providerPolicy();
  const opened = await save(privateNum, 'owner', { allowNew: true, expectedRevision: 1 });
  expect(opened.status).toBe(200);
  expect(await opened.json()).toMatchObject({ allowNew: true, revision: 2, workId: PRIVATE_ROLE });
  const closed = await save(privateNum, 'owner', { allowNew: false, expectedRevision: 2 });
  expect(closed.status).toBe(200);
  expect(await closed.json()).toMatchObject({ allowNew: false, revision: 3 });
  // A lost response retried with the old revision re-reads Provider and reports the stored value.
  const retried = await save(privateNum, 'owner', { allowNew: false, expectedRevision: 2 });
  expect(retried.status).toBe(200);
  expect(await retried.json()).toMatchObject({ allowNew: false, revision: 3 });
  // The editor opened by role id (no card number yet) reaches the same card.
  const byRole = await save(PRIVATE_ROLE, 'owner', { allowNew: true, expectedRevision: 3 });
  expect(byRole.status).toBe(200);
  expect(await byRole.json()).toMatchObject({ allowNew: true, revision: 4 });
  expect(p.calls.filter((c) => c.op === 'save').every((c) => c.roleId === PRIVATE_ROLE && c.token === 'owner')).toBe(true);
  expect(await publicRows()).toEqual({ cards: 0, policies: 0, registrations: 0 });
});

it('keeps another member out of a private card without revealing it', async () => {
  const p = providerPolicy();
  const foreign = await save(privateNum, 'other', { allowNew: true, expectedRevision: 1 });
  expect(foreign.status).toBe(404);
  expect(p.state).toEqual({ allowNew: false, revision: 1 });
  // A conflicting stale save from a non-author never turns into a success through the re-read.
  const stale = await save(privateNum, 'other', { allowNew: false, expectedRevision: 1 });
  expect(stale.status).toBe(404);
  // Unknown numbers and malformed ids stop at the site and never reach Provider.
  const before = p.calls.length;
  expect((await save(privateNum + 999, 'owner', { allowNew: true, expectedRevision: 1 })).status).toBe(404);
  expect((await save('not-a-card', 'owner', { allowNew: true, expectedRevision: 1 })).status).toBe(404);
  expect(p.calls.length).toBe(before);
  expect((await save(privateNum, 'owner', { allowNew: 'yes', expectedRevision: 1 })).status).toBe(400);
  expect(await publicRows()).toEqual({ cards: 0, policies: 0, registrations: 0 });
});

async function registerLater() {
  rolesOnMainSite({ roleId: LATER_ROLE, authorNumId: 74101, name: 'Synthetic later card' });
  const r = await approveFixtureResponse(await SELF.fetch('https://c.test/v1/cards', { method: 'POST', headers: { ...bearer('owner'), 'Content-Type': 'application/json' }, body: JSON.stringify({ roleId: LATER_ROLE, operationId: crypto.randomUUID(), ...ratingBody(false) }) }));
  expect(r.status).toBe(201);
  return Number((await r.json() as { id: string }).id);
}
const tab = async (cardId: number) => {
  const r = await SELF.fetch(`https://c.test/v1/cards/${cardId}/workshop`, { headers: bearer('other') });
  expect(r.status).toBe(200);
  return await r.json() as { tabVisible: boolean; allowNew: boolean };
};

it('projects the current Provider policy when the card is registered later, and older events cannot undo it', async () => {
  const reads: { sourceRoleId?: string; token?: string | null }[] = [];
  up.state = async (_e: unknown, query: { sourceRoleId?: string }, token?: string | null) => {
    reads.push({ sourceRoleId: query.sourceRoleId, token });
    return { workId: 'canonical-work-later', allowNew: true, everOpened: true, revision: 5, policyRevision: 5, items: [] };
  };
  const cardId = await registerLater();
  expect(reads).toEqual([{ sourceRoleId: LATER_ROLE, token: 'owner' }]);
  expect(await tab(cardId)).toMatchObject({ tabVisible: true, allowNew: true });
  expect(await env.DB.prepare('SELECT work_id,allow_new,revision,consent_version FROM workshop_policies WHERE card_id=?').bind(cardId).all())
    .toMatchObject({ results: [{ work_id: 'canonical-work-later', allow_new: 1, revision: 5, consent_version: 2 }] });
  // An event that predates the registration (lower revision) is ignored.
  await applyWorkshopEvents(env, [{ kind: 'policy_changed', eventKey: 'later-stale', workId: 'canonical-work-later', sourceRoleId: LATER_ROLE, payload: { policyVersion: 2, revision: 4, allowNew: false } }]);
  expect(await tab(cardId)).toMatchObject({ tabVisible: true, allowNew: true });
  // A newer closure still applies.
  await applyWorkshopEvents(env, [{ kind: 'policy_changed', eventKey: 'later-close', workId: 'canonical-work-later', sourceRoleId: LATER_ROLE, payload: { policyVersion: 2, revision: 6, allowNew: false } }]);
  expect(await tab(cardId)).toMatchObject({ tabVisible: false, allowNew: false });
});

it('still registers the card when the Provider policy read fails, and counts the failure', async () => {
  up.state = async () => { throw new HttpError(503, 'workshop_provider_unavailable'); };
  const cardId = await registerLater();
  expect(await tab(cardId)).toMatchObject({ tabVisible: false, allowNew: false });
  const metrics = await (await import('../src/ops-metrics')).opsMetrics(env.DB);
  expect(metrics).toContain('hearthroom_workshop_operations_total{operation="policy_backfill",outcome="error"} 1');
});

function dlcReceipt(workshopId: string, authorPublicNo = 74101) {
  return { workshopId, releaseId: crypto.randomUUID(), workId: PRIVATE_ROLE, sourceRoleId: PRIVATE_ROLE, kind: authorPublicNo === 74101 ? 'dlc' : 'lorebook', status: 'published', publicationRevision: 1, version: 1, draftRevision: 2, publishedAt: Date.now(), contentHash: 'synthetic', authorPublicNo, cardOwnerPublicNo: 74101, ownerState: 'visible', ownerGeneration: 0, residentChars: 0, policyVersion: 2, sealed: { name: 'Synthetic DLC', summary: '', readme: '', coverUrl: '', rating: 'G', worldbook: [], rules: { rules: [] }, opening: { mode: 'greeting' }, updateNote: '' } };
}
const publish = (workshopId: string, token: string) =>
  SELF.fetch(`https://c.test/v1/me/workshops/${workshopId}/publish`, { method: 'POST', headers: { ...bearer(token), 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedRevision: 2, operationId: crypto.randomUUID() }) });

it('lets the author publish a DLC on an own card that has no community row, without a public listing', async () => {
  providerPolicy();
  const workshopId = crypto.randomUUID();
  let writes = 0;
  up.draftMetadata = async () => ({ workshopId, card: { cardId: PRIVATE_ROLE, roleId: PRIVATE_ROLE } });
  up.publish = async (_e: unknown, token: string) => { writes++; expect(token).toBe('owner'); return dlcReceipt(workshopId); };
  const r = await publish(workshopId, 'owner');
  expect(r.status).toBe(200);
  expect(await r.json()).toMatchObject({ workshopId, status: 'published', kind: 'dlc', version: 1 });
  expect(writes).toBe(1);
  expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM workshops').first<{ n: number }>())!.n).toBe(0);
});

it('stops a non-author before Provider commits a publication on a card that has no community row', async () => {
  providerPolicy();
  const workshopId = crypto.randomUUID();
  let writes = 0;
  up.draftMetadata = async () => ({ workshopId, card: { cardId: PRIVATE_ROLE, roleId: PRIVATE_ROLE } });
  up.publish = async () => { writes++; return dlcReceipt(workshopId, 74102); };
  const r = await publish(workshopId, 'other');
  expect(r.status).toBe(404);
  expect(writes).toBe(0);
});
