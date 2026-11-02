import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import worker from '../src/index';
import { upsertCard } from '../src/cards';
import { hostGateway } from '../src/hosting';
import { spendGateway } from '../src/spend-leaderboard';
import { upstream } from '../src/upstream';
import { ADULT_CONSENT_VERSION } from '../shared/adult-consent';
import { bearer, identities, makeMember, resetDb, restoreUpstream, role, rolesOnMainSite } from './helpers';
import { legacyPolicyFixture, restoreLegacyPolicyFixture } from './work-policy-fixture';

const VIEWER = 40004, AUTHOR = 10001;
const DECL = { polls: { choice: { options: ['a', 'b'], share: true } } };
let adultId: string, safeId: string, viewer: string;
async function api(path: string, token = 'viewer', body?: unknown) {
  const context = createExecutionContext();
  const response = await worker.fetch(new Request(`https://c.test${path}`, {
    method: body === undefined ? 'GET' : 'POST', headers: { ...bearer(token), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), { ...env, CARD_STATE_ENABLED: 'true' }, context);
  await waitOnExecutionContext(context);
  return { status: response.status, body: await response.json() as any };
}
async function region(countryRegion: string, token = 'viewer') {
  expect(await api('/v1/me/settings', token, { countryRegion })).toMatchObject({ status: 200, body: { countryRegion } });
}
const denied = (result: Awaited<ReturnType<typeof api>>) => expect(result).toMatchObject({ status: 403, body: { error: 'region_unavailable' } });

beforeEach(async () => {
  await resetDb();
  identities({ viewer: VIEWER, author: AUTHOR });
  rolesOnMainSite({ roleId: 'secondary-safe', authorNumId: AUTHOR }, { roleId: 'secondary-adult', authorNumId: AUTHOR });
  viewer = await makeMember(VIEWER); await makeMember(AUTHOR);
  safeId = (await upsertCard(env.DB, role({ roleId: 'secondary-safe', authorNumId: AUTHOR }), Date.now())).id;
  adultId = (await upsertCard(env.DB, role({ roleId: 'secondary-adult', authorNumId: AUTHOR }), Date.now())).id;
  await env.DB.prepare("UPDATE cards SET rating=CASE WHEN id=? THEN 'R' ELSE 'G' END,approved_hosted_role_id=source_role_id").bind(adultId).run();
  for (const token of ['viewer', 'author']) {
    expect((await api('/v1/me/settings', token, { showNsfw: true, birthdate: '1990-01-01', consentVersion: ADULT_CONSENT_VERSION })).status).toBe(200);
  }
  upstream.fetchSharedState = async () => DECL;
  upstream.fetchArchiveCount = async () => 1;
  vi.spyOn(spendGateway, 'read').mockResolvedValue({ list: [], self: null, total: 0, authorCredits: '42' });
});
afterEach(() => { vi.restoreAllMocks(); restoreLegacyPolicyFixture(); restoreUpstream(); });

it('CN owner cannot read a private R card spend leaderboard through owner fallback', async () => {
  legacyPolicyFixture();
  vi.spyOn(hostGateway, 'read').mockResolvedValue(role({ roleId: 'secondary-adult', authorNumId: AUTHOR }));
  await env.DB.prepare("INSERT INTO works VALUES('private-region-work',?,'harbor','secondary-adult',1)").bind(`member-${AUTHOR}`).run();
  await env.DB.prepare("INSERT INTO managed_work_access(work_id,provider,source_role_id,access,epoch,restriction) VALUES('private-region-work','harbor','secondary-adult','private',1,'none')").run();
  const adultPath = `/v1/cards/${adultId}/leaderboard`;
  expect((await api(adultPath, 'author')).status).toBe(200);
  await region('CN', 'author');
  denied(await api(adultPath, 'author'));
  expect((await api(`/v1/cards/${safeId}/leaderboard`, 'author')).status).toBe(200);
  await region('TW', 'author');
  expect((await api(adultPath, 'author')).status).toBe(200);
});

it('CN R shared-state reads and writes are denied, while safe state and stored votes survive', async () => {
  const path = `/v1/cards/${adultId}/state`;
  expect((await api(`${path}/choice/vote`, 'viewer', { option: 'a' })).status).toBe(200);
  expect((await api(`${path}?keys=choice`)).body.items.choice.mine).toBe('a');
  await region('CN');
  denied(await api(`${path}?keys=choice`));
  denied(await api(`${path}/choice/vote`, 'viewer', { option: 'b' }));
  expect((await api(`/v1/cards/${safeId}/state?keys=choice`)).status).toBe(200);
  await region('JP');
  expect((await api(`${path}?keys=choice`)).body.items.choice.mine).toBe('a');
});

it('CN cannot resolve R share context, list results or respond to an existing token', async () => {
  const mint = await api(`/v1/cards/${adultId}/share-tokens`, 'author', { context: 'choice.a', poll: 'choice' });
  expect(mint.status).toBe(200);
  const path = `/v1/cards/${adultId}/share-tokens/${mint.body.token}`;
  expect(await api(path)).toMatchObject({ status: 200, body: { context: 'choice.a' } });
  await region('CN');
  denied(await api(path));
  denied(await api(`${path}/respond`, 'viewer', { option: 'a' }));
  denied(await api(`/v1/cards/${adultId}/share-tokens`));
  expect((await api(`/v1/cards/${safeId}/state`)).status).toBe(200);
  await region('HK');
  expect(await api(path)).toMatchObject({ status: 200, body: { context: 'choice.a' } });
});

it('CN notifications omit whole R rows including old card paths and extra, without deleting them', async () => {
  await env.DB.prepare('DELETE FROM community_notifications').run();
  for (const [id, card, kind, extra] of [
    ['safe-note', safeId, 'comment_reply', { comment: 'safe-comment' }],
    ['adult-note', adultId, 'comment_reply', { comment: 'adult-secret', note: 'private R details' }],
    ['adult-new', adultId, 'followed_work', { event: 'new' }],
  ] as const) {
    await env.DB.prepare('INSERT INTO community_notifications(id,event_key,member_id,kind,card_id,path,extra,created_at) VALUES(?,?,?,?,?,?,?,?)')
      .bind(id, id, viewer, kind, Number(card), `/cards/${card}`, JSON.stringify(extra), Date.now()).run();
  }
  expect((await api('/v1/me/community/notifications')).body.items).toHaveLength(3);
  expect((await api('/v1/me/community/notifications/summary')).body).toEqual({ unread: 3 });
  await region('CN');
  const hidden = await api('/v1/me/community/notifications');
  expect(hidden.status).toBe(200);
  expect(hidden.body.items.map((n: any) => n.id)).toEqual(['safe-note']);
  expect(JSON.stringify(hidden.body)).not.toContain(`/cards/${adultId}`);
  expect(JSON.stringify(hidden.body)).not.toContain('adult-secret');
  expect((await api('/v1/me/community/notifications/summary')).body).toEqual({ unread: 1 });
  await region('OTHER');
  expect((await api('/v1/me/community/notifications')).body.items).toHaveLength(3);
  expect((await api('/v1/me/community/notifications/summary')).body).toEqual({ unread: 3 });
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM community_notifications').first()).toEqual({ n: 3 });
});
