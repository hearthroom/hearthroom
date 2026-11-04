import worker from '../src/index';
import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { upsertCard } from '../src/cards';
import { boardCache, boardKey } from '../src/board-cache';
import { ADULT_CONSENT_VERSION } from '../shared/adult-consent';
import { bearer, identities, makeMember, resetDb, restoreUpstream, role, rolesOnMainSite } from './helpers';

const VIEWER = 40004;
const fixtures = [
  { roleId: 'mixed-general', authorNumId: 10001, authorName: 'Fixture Mixed', talkNum: 10 },
  { roleId: 'mixed-adult', authorNumId: 10001, authorName: 'Fixture Mixed', talkNum: 20 },
  { roleId: 'adult-only', authorNumId: 10002, authorName: 'Fixture Adult', talkNum: 30 },
];
const path = '/v1/authors?zone=all&q=Fixture&nsfw=1';
async function read(token?: string, url = path) {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request(`https://c.test${url}`, { headers: token ? bearer(token) : {} }), env, ctx);
  await waitOnExecutionContext(ctx);
  expect(res.status).toBe(200);
  return { res, body: await res.json() as { items: { name: string; cardCount: number; talkTotal: number }[] } };
}
const general = [{ name: 'Fixture Mixed', cardCount: 1, talkTotal: 10 }];
const adult = [
  { name: 'Fixture Mixed', cardCount: 2, talkTotal: 30 },
  { name: 'Fixture Adult', cardCount: 1, talkTotal: 30 },
];
const counts = (body: Awaited<ReturnType<typeof read>>['body']) => body.items.map(({name,cardCount,talkTotal}) => ({name,cardCount,talkTotal}));

beforeEach(async () => {
  await resetDb();
  boardCache.namespace = `author-nsfw-${crypto.randomUUID()}`;
  identities({ 'viewer-token': VIEWER });
  rolesOnMainSite(...fixtures);
  await makeMember(VIEWER);
  await env.DB.prepare('UPDATE members SET show_nsfw=1,age_verified_at=1,adult_consent_version=?,country_region=? WHERE id=?')
    .bind(ADULT_CONSENT_VERSION, 'TW', `member-${VIEWER}`).run();
  for (const fixture of fixtures) {
    const card = await upsertCard(env.DB, role(fixture), Date.now(), {provider:'harbor'});
    await env.DB.prepare('UPDATE cards SET rating=?,talk_num=?,approved_hosted_role_id=source_role_id WHERE id=?')
      .bind(fixture.roleId === 'mixed-general' ? 'G' : 'R', fixture.talkNum, card.id).run();
  }
});
afterEach(restoreUpstream);

it('uses the board adult preference for mixed and adult-only author counts', async () => {
  expect(counts((await read()).body)).toEqual(general);
  expect(counts((await read('viewer-token')).body)).toEqual(adult);
  expect(counts((await read('viewer-token', path.replace('&nsfw=1',''))).body)).toEqual(general);
  await env.DB.prepare('UPDATE members SET show_nsfw=0 WHERE id=?').bind(`member-${VIEWER}`).run();
  expect(counts((await read('viewer-token')).body)).toEqual(general);
});

it('isolates general and adult edge/KV caches and rechecks CN and invalid credentials', async () => {
  const first = await read('viewer-token');
  expect(counts(first.body)).toEqual(adult);
  expect(first.res.headers.get('X-Adult-Content')).toBe('1');
  expect(first.res.headers.get('Cache-Control')).toBe('private, no-store');
  expect((await read('viewer-token')).res.headers.get('X-Cache-Layer')).toBe('edge');
  const revision = (await env.DB.prepare('SELECT revision FROM moderation_clock WHERE id=1').first<{revision:number}>())!.revision;
  await (await caches.open(boardCache.namespace)).delete((await boardKey(`https://c.test${path}`,revision,true)).edge);
  expect((await read('viewer-token')).res.headers.get('X-Cache-Layer')).toBe('kv');
  expect(counts((await read()).body)).toEqual(general);
  expect(counts((await read('invalid-token')).body)).toEqual(general);
  await env.DB.prepare('UPDATE members SET country_region=? WHERE id=?').bind('CN',`member-${VIEWER}`).run();
  const restricted = await read('viewer-token');
  expect(counts(restricted.body)).toEqual(general);
  expect(restricted.res.headers.get('X-Adult-Content')).toBe('0');
  await env.DB.prepare('UPDATE members SET country_region=? WHERE id=?').bind('HK',`member-${VIEWER}`).run();
  expect(counts((await read('viewer-token')).body)).toEqual(adult);
});
