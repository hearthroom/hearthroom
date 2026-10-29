import { env, SELF } from 'cloudflare:test';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { upsertCard } from '../src/cards';
import { makeMember, resetDb, restoreUpstream, role, rolesOnProviders, testHandle } from './helpers';
import { upstream } from '../src/upstream';
import {spendGateway} from '../src/spend-leaderboard';

beforeEach(async () => {
  await resetDb();
  rolesOnProviders({ harbor: [{ roleId: 'draft', authorNumId: 22 }], lunatalk: [] });
});
afterEach(()=>{vi.restoreAllMocks();restoreUpstream()});
const read = (path: string) => SELF.fetch(`https://c.test${path}`);

it('uses the connected community owner profile for a never-submitted preview without leaking private fields', async () => {
  await makeMember(22);
  const owner = await makeMember(33);
  await env.DB.prepare('UPDATE members SET display_name=?,avatar_url=?,is_official=1 WHERE id=?')
    .bind('Community owner', 'https://example.com/community.png', owner).run();
  await env.DB.prepare("INSERT INTO member_connections VALUES ('harbor','22',?,1)").bind(owner).run();
  const fetchRole = upstream.fetchRole;
  upstream.fetchRole = async (...args) => ({ ...await fetchRole(...args), authorAvatar: '' });
  const res = await read('/v1/cards/draft');
  expect(res.status).toBe(200);
  const card = await res.json() as any;
  expect(card.author).toEqual({ handle: testHandle(33), official: true, accountNumId: 22,
    name: 'Community owner', avatar: 'https://example.com/community.png' });
  expect(JSON.stringify(card)).not.toContain(owner);
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM cards').first()).toEqual({ n: 0 });
});

it.each([
  { name: 'Community author', avatar: 'https://example.com/community.png', expectedName: 'Community author', expectedAvatar: 'https://example.com/community.png' },
  { name: null, avatar: 'https://example.com/not-initialized.png', expectedName: '月光', expectedAvatar: 'https://assets.harperharbor.com/author.png' },
  { name: 'Community author', avatar: '', expectedName: 'Community author', expectedAvatar: '' },
])('matches registered profile fallback for $name / $avatar', async ({name, avatar, expectedName, expectedAvatar}) => {
  const member = await makeMember(22);
  await env.DB.prepare('UPDATE members SET display_name=?,avatar_url=? WHERE id=?').bind(name, avatar, member).run();
  const res = await read('/v1/cards/draft');
  expect(res.status).toBe(200);
  expect((await res.json() as any).author).toEqual({handle:testHandle(22),official:false,accountNumId:22,name:expectedName,avatar:expectedAvatar});
});

it('does not borrow an unrelated author profile with the same external ID on another provider', async () => {
  const unrelated = await makeMember(33);
  await env.DB.prepare('UPDATE members SET display_name=?,avatar_url=?,is_official=1 WHERE id=?')
    .bind('Other author','https://example.com/other.png',unrelated).run();
  await env.DB.prepare("INSERT INTO member_connections VALUES ('lunatalk','22',?,1)").bind(unrelated).run();
  const res = await read('/v1/cards/draft');
  expect(res.status).toBe(200);
  expect((await res.json() as any).author).toEqual({handle:null,official:false,accountNumId:22,name:'月光',avatar:'https://assets.harperharbor.com/author.png'});
});

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
  expect((await (await read('/v1/cards/work/platforms')).json() as any).platforms).toHaveLength(1);
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
  await upsertCard(env.DB, role({ roleId: 'draft' }), Date.now(), { provider: 'harbor', status: 'pending' });
  await env.DB.prepare("UPDATE cards SET rating='R' WHERE source_role_id='draft'").run();
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

it.each(['pending','rejected','needs_review','unshared'] as const)('keeps the %s legacy card link and its ranking under the same access rule',async status=>{
 await upsertCard(env.DB,role({roleId:'draft',authorNumId:22}),Date.now(),{provider:'harbor',status});
 const gateway=vi.spyOn(spendGateway,'read').mockResolvedValue({list:[],self:null,total:0});
 expect((await read('/v1/cards/draft')).status).toBe(200);
 expect((await read('/v1/cards/draft/leaderboard')).status).toBe(200);expect(gateway).toHaveBeenCalled();
 await env.DB.prepare("UPDATE cards SET rating='R' WHERE source_role_id='draft'").run();
 expect((await read('/v1/cards/draft/leaderboard')).status).toBe(403);
 await env.DB.prepare("UPDATE cards SET rating='G',public_blocked=1 WHERE source_role_id='draft'").run();
 expect((await read('/v1/cards/draft/leaderboard')).status).toBe(404);
});
