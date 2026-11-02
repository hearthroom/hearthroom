import worker from '../src/index';
import { SELF, env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { upsertCard } from '../src/cards';
import { boardCache } from '../src/board-cache';
import { ADULT_CONSENT_VERSION } from '../shared/adult-consent';
import { bearer, identities, makeMember, resetDb, restoreUpstream, role, rolesOnMainSite, testHandle } from './helpers';

const VIEWER = 40004, AUTHOR = 10001;
let adultId: string, generalId: string;
const request = (path: string, token = 'viewer-token') => SELF.fetch(`https://c.test${path}`, { headers: bearer(token) });
const setting = (body: Record<string, unknown>, token = 'viewer-token') => SELF.fetch('https://c.test/v1/me/settings', {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...bearer(token) }, body: JSON.stringify(body),
});
async function region(value: string, token = 'viewer-token') {
  const res = await setting({ countryRegion: value }, token);
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ countryRegion: value });
}
const items = async (path: string) => {
  const res = await request(path);
  expect(res.status).toBe(200);
  return ((await res.json()) as { items: { id: string }[] }).items.map(c => String(c.id));
};
async function unavailable(path: string, token = 'viewer-token') {
  const res = await request(path, token);
  expect(res.status).toBe(403);
  const body = await res.json();
  expect(body).toMatchObject({ error: 'region_unavailable' });
  expect(JSON.stringify(body)).not.toContain('Region Adult');
}

beforeEach(async () => {
  await resetDb();
  boardCache.namespace = `region-public-${crypto.randomUUID()}`;
  identities({ 'viewer-token': VIEWER, 'author-token': AUTHOR });
  rolesOnMainSite(
    { roleId: 'region-general', authorNumId: AUTHOR, name: 'Region General', nameEn: 'Region General' },
    { roleId: 'region-adult', authorNumId: AUTHOR, name: 'Region Adult', nameEn: 'Region Adult' },
  );
  await makeMember(AUTHOR);
  await makeMember(VIEWER);
  generalId = (await upsertCard(env.DB, role({ roleId: 'region-general', authorNumId: AUTHOR, name: 'Region General', nameEn: 'Region General' }), Date.now(), { provider: 'harbor' })).id;
  adultId = (await upsertCard(env.DB, role({ roleId: 'region-adult', authorNumId: AUTHOR, name: 'Region Adult', nameEn: 'Region Adult' }), Date.now(), { provider: 'harbor' })).id;
  await env.DB.prepare("UPDATE cards SET rating=CASE WHEN id=? THEN 'R' ELSE 'G' END,approved_hosted_role_id=source_role_id").bind(adultId).run();
  for (const token of ['viewer-token', 'author-token']) {
    expect((await setting({ showNsfw: true, birthdate: '1990-01-01', consentVersion: ADULT_CONSENT_VERSION }, token)).status).toBe(200);
  }
});
afterEach(restoreUpstream);

it('switching to CN filters warm board and search caches; switching back restores R cards', async () => {
  const paths = ['/v1/cards?zone=zh&sort=day&nsfw=1', '/v1/cards?zone=zh&q=Region&nsfw=1'];
  for (const path of paths) expect(await items(path)).toContain(adultId);
  await region('CN');
  for (const path of paths) expect(await items(path)).toEqual([generalId]);
  await region('TW');
  for (const path of paths) expect(await items(path)).toContain(adultId);
});

it('CN filters author cards and author statistics, then restores them outside CN', async () => {
  const cards = `/v1/cards?author=${testHandle(AUTHOR)}&nsfw=1`;
  expect(await items(cards)).toHaveLength(2);
  await region('CN');
  expect(await items(cards)).toEqual([generalId]);
  const res = await request(`/v1/authors/${testHandle(AUTHOR)}?nsfw=1`);
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ cardCount: 1 });
  await region('JP');
  expect(await items(cards)).toHaveLength(2);
});

it('CN blocks direct detail, source/share aliases and platform links with region_unavailable', async () => {
  await env.DB.prepare("INSERT INTO works VALUES ('region-work',?,'harbor','region-adult',1)").bind(`member-${AUTHOR}`).run();
  await region('CN');
  for (const id of [adultId, 'region-adult', 'region-work']) {
    await unavailable(`/v1/cards/${id}`);
    await unavailable(`/v1/cards/${id}/platforms`);
  }
  expect((await request(`/v1/cards/${generalId}`)).status).toBe(200);
  await region('US');
  expect((await request(`/v1/cards/${adultId}`)).status).toBe(200);
});

it('CN denies legacy owner fallback for R cards rather than exposing unlisted previews', async () => {
  await env.DB.prepare("UPDATE cards SET status='rejected' WHERE id=?").bind(adultId).run();
  await region('CN', 'author-token');
  await unavailable(`/v1/cards/${adultId}`, 'author-token');
  await region('HK', 'author-token');
  expect((await request(`/v1/cards/${adultId}`, 'author-token')).status).toBe(200);
});

it('a previously issued adult shortcut key cannot bypass current CN region', async () => {
  const detail = await request(`/v1/cards/${adultId}`);
  expect(detail.status).toBe(200);
  const key = (await detail.json() as { shortcutKey: string }).shortcutKey;
  expect(key).toBeTruthy();
  const manifest = `/v1/cards/${adultId}/manifest.webmanifest?k=${encodeURIComponent(key)}`;
  expect((await request(manifest)).status).toBe(200);
  await region('CN');
  await unavailable(manifest);
  await region('MO');
  expect((await request(manifest)).status).toBe(200);
});

it('CN recommendations never return R cards, while general recommendations remain available', async () => {
  await region('CN');
  const res = await request('/v1/suggest?q=Region&zone=zh&nsfw=1');
  expect(res.status).toBe(200);
  const body = await res.json() as { cards: { num: number }[] };
  expect(body.cards.map(c => String(c.num))).toEqual([generalId]);
  await unavailable(`/v1/cards/${adultId}?view=0`);
});

it('CN tag counts omit R and consent cannot enable R content while restricted', async () => {
  await region('CN');
  const enable = await setting({ showNsfw: true });
  if (enable.status === 200) expect(await enable.json()).toMatchObject({ showNsfw: false });
  else expect(enable.status).toBe(403);
  await unavailable(`/v1/cards/${adultId}`);
  const res = await request('/v1/tags/counts?zone=zh&nsfw=1');
  expect(res.status).toBe(200);
  expect((await res.json() as { ratings: { R: number } }).ratings.R).toBe(0);
  await region('OTHER');
  expect((await request(`/v1/cards/${adultId}`)).status).toBe(200);
});

it('cookie-only reads recheck the persisted region instead of an earlier adult session',async()=>{
 const raw='region-session';
 const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw)));
 const hashed=btoa(String.fromCharCode(...digest)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
 await env.DB.prepare('INSERT INTO account_sessions VALUES (?,?,?,?,?,?,?)').bind(hashed,`member-${VIEWER}`,'harbor',String(VIEWER),'https://c.test',Date.now(),Date.now()+86400000).run();
 async function read(path:string){
  const ctx=createExecutionContext();
  const response=await worker.fetch(new Request(`https://c.test${path}`,{headers:{Cookie:`__Host-hr-session=${raw}`}}),{...env,AUTH_ENABLED:'true',AUTH_ALLOWED_ORIGINS:'https://c.test'},ctx);
  await waitOnExecutionContext(ctx);return response;
 }
 expect((await read(`/v1/cards/${adultId}`)).status).toBe(200);
 await region('CN');
 expect(await (await read(`/v1/cards/${adultId}`)).json()).toMatchObject({error:'region_unavailable'});
 expect((await (await read('/v1/cards?zone=zh')).json() as any).items.map((r:any)=>String(r.id))).toEqual([generalId]);
 await region('OTHER');
 expect((await read(`/v1/cards/${adultId}`)).status).toBe(200);
});
it('invalid credentials still receive the existing adult gate without card content',async()=>{
 const res=await request(`/v1/cards/${adultId}`,'invalid');
 expect(res.status).toBe(403);expect(await res.json()).toMatchObject({error:'adult_content'});
});
