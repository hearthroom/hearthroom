import { env, SELF } from 'cloudflare:test';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { getCard, upsertCard } from '../src/cards';
import { identitiesFor, resetDb, restoreUpstream, role, rolesOnProviders } from './helpers';

beforeEach(async () => {
  await resetDb();
  identitiesFor({ harbor: { author:11, unrelated: 99 } });
  rolesOnProviders({
    harbor: [{ roleId: 'source', authorNumId:11 }, {roleId:'copy',authorNumId:22}],
  });
  await upsertCard(env.DB, role({ roleId: 'source', authorNumId: 11 }), Date.now(), { status: 'approved' });
});
afterEach(restoreUpstream);

const read = (id: string, provider = 'harbor', token?: string) => SELF.fetch(
  `https://c.test/v1/cards/${id}`, {
    headers: { 'X-Provider': provider, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  },
);

it('serves a published card and summary regardless of the viewer platform or login', async () => {
  for (const token of [undefined, 'unrelated']) {
    const response = await read('source', 'harbor', token);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ roleId: 'source', provider: 'harbor', summary: '民國背景推理' });
  }
  await upsertCard(env.DB, role({ roleId: 'harbor-only' }), Date.now(), { status: 'approved', provider: 'harbor' });
  expect((await read('harbor-only', 'lunatalk')).status).toBe(400);
});

it('keeps a public card number stable across a colliding retired source identifier',async()=>{
 const original=(await getCard(env.DB,'source'))!;
 await upsertCard(env.DB,role({roleId:'source',name:'Retired'}),Date.now(),{provider:'lunatalk',status:'approved'});
 const response=await read(original.id);
 expect(response.status).toBe(200);expect(await response.json()).toMatchObject({id:original.id,provider:'harbor'});
});

it.each(['pending', 'rejected', 'needs_review', 'unshared'])('serves %s card links across providers without granting author access', async status => {
  await env.DB.prepare('UPDATE cards SET status=?').bind(status).run();
  const card = (await getCard(env.DB, 'source'))!;
  for (const id of ['source', card.id, String(card.num)]) {
    expect((await read(id, 'harbor', 'unrelated')).status).toBe(200);
    expect((await read(`${id}/platforms`, 'harbor', 'unrelated')).status).toBe(200);
  }
  expect((await read('source', 'harbor', 'author')).status).toBe(200);
});

it('retains the adult gate, moderation block and genuine not-found response', async () => {
  await env.DB.prepare('UPDATE cards SET nsfw=1').run();
  expect((await read('source')).status).toBe(403);
  expect((await read('source/platforms')).status).toBe(403);
  await env.DB.prepare('UPDATE cards SET public_blocked=1').run();
  expect((await read('source')).status).toBe(404);
  expect((await read('source/platforms')).status).toBe(404);
  expect((await read('missing')).status).toBe(404);
});

it('serves the direct HTML page for a published Harbor card', async () => {
  await upsertCard(env.DB, role({ roleId: 'harbor-only', name: 'Public Harbor card' }), Date.now(), { status: 'approved', provider: 'harbor' });
  const response = await SELF.fetch('https://c.test/cards/harbor-only');
  expect(response.status).toBe(200);
  expect(await response.text()).toContain('Public Harbor card');
});
