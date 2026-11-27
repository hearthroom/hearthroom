import { workPolicyGateway } from "../src/work-policy";
import { HttpError } from "../src/types";
import { env, SELF } from 'cloudflare:test';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ensureCardNumber, getCard, upsertCard } from '../src/cards';
import { bearer, resetDb, restoreUpstream, role, rolesOnProviders, whoAmI } from './helpers';

beforeEach(async () => { await resetDb(); whoAmI(10001); });
afterEach(() => { restoreUpstream(); vi.restoreAllMocks(); });
const read = (id: string, headers = {}) => SELF.fetch(`https://c.test/v1/cards/${id}`, { headers });

it('uses the existing public number as the integer primary key and board identity', async () => {
  const saved = await upsertCard(env.DB, role({ roleId: 'source-role' }), 1);
  const row = await env.DB.prepare('SELECT id,typeof(id) AS kind FROM cards').first();
  expect(row).toEqual({ id: 100001, kind: 'integer' });
  expect(saved.id).toBe('100001');
  const board = await (await SELF.fetch('https://c.test/v1/cards')).json() as any;
  expect(board.items[0]).toMatchObject({ id: '100001', num: 100001 });
  expect((await getCard(env.DB, '100001'))?.source_role_id).toBe('source-role');
});

it('gives an unlisted card a stable number without publishing it or using registration quota', async () => {
  rolesOnProviders({ harbor: [{ roleId: 'private-draft', authorNumId: 10001 }] });
  const first = await (await read('private-draft', bearer())).json() as any;
  expect(first).toMatchObject({ id: '100001', num: 100001, status: 'unlisted' });
  const second = await read(first.id);
  expect(second.status).toBe(200);
  expect(await second.json()).toMatchObject({ id: first.id, num: first.num });
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM cards').first()).toEqual({ n: 0 });
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM card_registrations').first()).toEqual({ n: 0 });
  const saved = await upsertCard(env.DB, role({ roleId: 'private-draft' }), 1, { status: 'pending' });
  expect(saved.id).toBe(first.id);
});

it('never exposes host-private content by guessing its assigned number', async () => {
  await env.DB.prepare("INSERT INTO card_numbers(provider,source_role_id) VALUES ('harbor','hidden')").run();
  rolesOnProviders({ harbor: [] });
  expect((await read('100001')).status).toBe(404);
  expect((await SELF.fetch('https://c.test/v1/cards/100001/platforms')).status).toBe(404);
});

it('allocates a number on an authenticated draft save, without allowing another author to claim it', async () => {
  rolesOnProviders({ harbor: [{ roleId: 'saved-draft', authorNumId: 10001 }] });
  const save = () => SELF.fetch('https://c.test/v1/me/card-identities', { method:'POST', headers:{...bearer(),'Content-Type':'application/json'}, body:JSON.stringify({roleId:'saved-draft'}) });
  const response = await save();
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({id:'100001',num:100001,sourceRoleId:'saved-draft'});
  whoAmI(20002);
  expect((await save()).status).toBe(403);
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM card_numbers').first()).toEqual({n:1});
});

it('keeps an unlisted numbered card blocked when a durable moderation block exists', async () => {
  rolesOnProviders({ harbor:[{roleId:'blocked-draft'}] });
  const num = await ensureCardNumber(env.DB,'harbor','blocked-draft');
  await env.DB.prepare("INSERT INTO moderation_state(provider,source_role_id,public_blocked) VALUES ('harbor','blocked-draft',1)").run();
  expect((await read(String(num))).status).toBe(404);
  expect((await SELF.fetch(`https://c.test/v1/cards/${num}/platforms`)).status).toBe(404);
});

it('concurrent allocations and different provider namespaces remain stable and separate', async () => {
  const numbers = await Promise.all(Array.from({length:8},()=>ensureCardNumber(env.DB,'lunatalk','same-source')));
  expect(new Set(numbers).size).toBe(1);
  expect(await ensureCardNumber(env.DB,'harbor','same-source')).not.toBe(numbers[0]);
});

it('updates the author cover flag immediately, preserving it on an ordinary save', async () => {
  const writeGrant = vi.spyOn(workPolicyGateway,'owner').mockResolvedValue({} as Awaited<ReturnType<typeof workPolicyGateway.owner>>);
  rolesOnProviders({ harbor: [{ roleId: 'marked-draft', authorNumId: 10001 }] });
  const saved = await upsertCard(env.DB, role({ roleId: 'marked-draft', authorNumId: 10001 }), Date.now());
  const board = () => SELF.fetch('https://c.test/v1/cards?sort=new').then(r => r.json()) as Promise<{items:{coverSensitive:boolean; coverAuthorSensitive?:boolean}[]}>;
  const save = (extra: object) => SELF.fetch('https://c.test/v1/me/card-identities', {
    method:'POST', headers:{...bearer(),'Content-Type':'application/json'}, body:JSON.stringify({roleId:'marked-draft',...extra}),
  });
  expect((await board()).items[0]?.coverSensitive).toBe(false);
  writeGrant.mockRejectedValueOnce(new HttpError(403,'not_the_author'));
  expect((await save({coverSensitive:true})).status).toBe(403);
  expect((await board()).items[0]?.coverSensitive).toBe(false);
  expect(await (await save({ coverSensitive: true })).json()).toMatchObject({ coverAuthorSensitive: true, coverReviewSensitive: false });
  expect(writeGrant).toHaveBeenCalledWith(expect.anything(),'harbor','marked-draft',expect.any(String),true);
  expect((await board()).items[0]).toMatchObject({coverSensitive:true});
  expect((await board()).items[0]).not.toHaveProperty('coverAuthorSensitive');
  const owner = await SELF.fetch('https://c.test/v1/me/cards/marked-draft/cover',{headers:bearer()});
  expect(await owner.json()).toEqual({coverAuthorSensitive:true,coverReviewSensitive:false,coverSensitive:true});
  expect((await save({})).status).toBe(200);
  expect((await read(saved.id).then(r=>r.json()))).toMatchObject({coverSensitive:true});
  whoAmI(20002);
  expect((await save({ coverSensitive: false })).status).toBe(403);
  whoAmI(10001);
  expect((await save({ coverSensitive: 'false' })).status).toBe(400);
  expect((await save({ coverSensitive: false })).status).toBe(200);
  expect((await board()).items[0]?.coverSensitive).toBe(false);
});
