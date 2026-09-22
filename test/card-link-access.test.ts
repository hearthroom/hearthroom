import { env, SELF } from 'cloudflare:test';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { upsertCard } from '../src/cards';
import { resetDb, restoreUpstream, role, rolesOnProviders } from './helpers';

beforeEach(async () => {
  await resetDb();
  rolesOnProviders({ harbor: [{ roleId: 'draft', authorNumId: 22 }], lunatalk: [] });
});
afterEach(restoreUpstream);
const read = (path: string) => SELF.fetch(`https://c.test${path}`);

it('lets a visitor open a never-submitted draft without selecting a provider', async () => {
  const res = await read('/v1/cards/draft');
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ roleId: 'draft', provider: 'harbor', status: 'unlisted' });
  expect(res.headers.get('Cache-Control')).toContain('no-store');
  const platforms = await read('/v1/cards/draft/platforms');
  expect(platforms.status).toBe(200);
  expect(await platforms.json()).toEqual({ platforms: [{ provider: 'harbor', roleId: 'draft', playable: true }] });
  expect((await (await read('/v1/cards')).json() as any).items).toEqual([]);
});

it.each(['pending', 'rejected', 'needs_review', 'unshared'])('keeps %s cards playable by link, outside the board', async status => {
  await upsertCard(env.DB, role({ roleId: 'draft', authorNumId: 22 }), Date.now(), { provider: 'harbor', status });
  expect((await read('/v1/cards/draft')).status).toBe(200);
  const res = await read('/v1/cards/draft/platforms');
  expect(res.status).toBe(200);
  expect((await res.json() as any).platforms).toEqual([{ provider: 'harbor', roleId: 'draft', playable: true }]);
  expect((await (await read('/v1/cards')).json() as any).items).toEqual([]);
});

it('resolves a neutral work link and its available copies', async () => {
  rolesOnProviders({ harbor: [{ roleId: 'draft' }], lunatalk: [{ roleId: 'copy' }] });
  await env.DB.prepare("INSERT INTO works VALUES ('work','member','harbor','draft',1)").run();
  await env.DB.prepare("INSERT INTO work_copies(work_id,provider,external_id,role_id,status,updated_at) VALUES ('work','lunatalk',11,'copy','synced',1)").run();
  const card = await read('/v1/cards/work');
  expect(card.status).toBe(200);
  expect(await card.json()).toMatchObject({ id: '100001', roleId: 'draft', provider: 'harbor' });
  expect((await (await read('/v1/cards/work/platforms')).json() as any).platforms).toHaveLength(2);
});

it('serves a successful non-indexed HTML shell for a link-only draft', async () => {
  const res = await read('/cards/draft');
  expect(res.status).toBe(200);
  expect(await res.text()).toContain('noindex');
  expect(res.headers.get('Cache-Control')).toContain('no-store');
});

it('never uses cached review metadata to expose a host-inaccessible draft', async () => {
  await upsertCard(env.DB, role({ roleId: 'inaccessible' }), Date.now(), { provider: 'harbor', status: 'rejected' });
  expect((await read('/v1/cards/inaccessible')).status).toBe(404);
  expect((await read('/v1/cards/inaccessible/platforms')).status).toBe(404);
});

it('preserves adult gating and site blocks through work and copy aliases', async () => {
  await upsertCard(env.DB, role({ roleId: 'draft' }), Date.now(), { provider: 'harbor', status: 'pending', nsfw: true });
  await env.DB.prepare("INSERT INTO works VALUES ('work','member','harbor','draft',1)").run();
  await env.DB.prepare("INSERT INTO work_copies(work_id,provider,external_id,role_id,status,updated_at) VALUES ('work','lunatalk',11,'copy','synced',1)").run();
  for (const id of ['draft', 'work', 'copy']) {
    expect((await read(`/v1/cards/${id}`)).status).toBe(403);
    expect((await read(`/v1/cards/${id}/platforms`)).status).toBe(403);
  }
  await env.DB.prepare('UPDATE cards SET public_blocked=1').run();
  for (const id of ['draft', 'work', 'copy']) {
    expect((await read(`/v1/cards/${id}`)).status).toBe(404);
    expect((await read(`/v1/cards/${id}/platforms`)).status).toBe(404);
  }
});

it('keeps a global card identity authoritative over a colliding work alias', async () => {
  await upsertCard(env.DB, role({roleId:'draft'}),Date.now(),{provider:'harbor',status:'pending'});
  const row=await env.DB.prepare('SELECT id FROM cards').first<{id:string}>();
  await env.DB.prepare("INSERT INTO works VALUES (?,'member','lunatalk','other',1)").bind(row!.id).run();
  const res=await read(`/v1/cards/${row!.id}`);
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({id:String(row!.id),provider:'harbor',roleId:'draft'});
});
