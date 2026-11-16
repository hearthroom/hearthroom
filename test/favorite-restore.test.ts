import { SELF, env } from 'cloudflare:test';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { bearer, resetDb, identities, restoreUpstream } from './helpers';
const request = (path: string, method = 'DELETE', body?: unknown, token = 'fan') => SELF.fetch(`https://c.test/v1/me/favorites${path}`, {
  method, headers: { ...bearer(token), 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
let memberId = '';
beforeEach(async () => {
  await resetDb(); identities({ fan: 20001, other: 20002 });
  await SELF.fetch('https://c.test/v1/me', { headers: bearer('fan') });
  memberId = (await env.DB.prepare("SELECT member_id FROM member_identities WHERE external_id='20001'").first<{ member_id: string }>())!.member_id;
  await env.DB.prepare("INSERT INTO cards(id,provider,source_role_id,author_num_id,registered_at,last_synced_at,status,rating) VALUES(100001,'harbor','favorite-role',10001,1,1,'needs_review','G'),(100002,'harbor','other-favorite',10001,1,1,'needs_review','G')").run();
  await env.DB.prepare('INSERT INTO member_favorites(member_id,card_id,created_at) VALUES(?,100001,1000),(?,100002,2000)').bind(memberId, memberId).run();
});
afterEach(() => { vi.restoreAllMocks(); restoreUpstream(); });
const remove = async (id = '100001') => { const r = await request('/' + id); expect(r.status).toBe(200); return await r.json() as any; };
const favorites = async () => (await env.DB.prepare('SELECT card_id,created_at FROM member_favorites WHERE member_id=? ORDER BY created_at DESC').bind(memberId).all()).results;

it('restores an actually removed unavailable favorite in its original position without fetching author data', async () => {
  const before = await favorites();
  const removed = await remove(); expect(removed.active).toBe(false); expect(removed.restoreToken).toEqual(expect.any(String));
  expect(await favorites()).toHaveLength(1);
  const r = await request('/restore', 'POST', { tokens: [removed.restoreToken] }); expect(r.status).toBe(200);
  expect(await r.json()).toEqual({ restoredIds: ['100001'] }); expect(await favorites()).toEqual(before);
  expect((await request('/restore', 'POST', { tokens: [removed.restoreToken] })).status).toBe(200);
  expect(await favorites()).toEqual(before);
});

it('does not issue a restoration capability for another member or a nonexistent favorite', async () => {
  expect((await request('/100001', 'DELETE', undefined, 'other')).status).toBe(200);
  const other = await (await request('/100001', 'DELETE', undefined, 'other')).json() as any;
  expect(other.restoreToken).toBeUndefined();
  await remove(); const absent = await remove(); expect(absent.restoreToken).toBeUndefined();
});

it('binds tokens to the member, refuses tampering and validates the entire batch before writing', async () => {
  const first = await remove(), second = await remove('100002');
  expect((await request('/restore', 'POST', { tokens: [first.restoreToken] }, 'other')).status).toBe(403);
  const forged = first.restoreToken.slice(0, -8) + 'aaaaaaaa';
  expect((await request('/restore', 'POST', { tokens: [second.restoreToken, forged] })).status).toBe(400);
  expect(await favorites()).toEqual([]);
  expect((await request('/restore', 'POST', { tokens: Array(25).fill(first.restoreToken) })).status).toBe(400);
  expect((await request('/restore', 'POST', { tokens: [] })).status).toBe(400);
  expect((await request('/restore', 'POST', { tokens: [first.restoreToken] }, '')).status).toBe(401);
});

it('keeps a newer favorite position and skips cards that no longer exist', async () => {
  const first = await remove(), second = await remove('100002');
  await env.DB.prepare('INSERT INTO member_favorites(member_id,card_id,created_at) VALUES(?,100001,3000)').bind(memberId).run();
  await env.DB.prepare('DELETE FROM cards WHERE id=100002').run();
  const restored = await request('/restore', 'POST', { tokens: [first.restoreToken, second.restoreToken] });
  expect(restored.status).toBe(200); expect(await restored.json()).toEqual({ restoredIds: ['100001'] });
  expect(await favorites()).toEqual([{ card_id: 100001, created_at: 3000 }]);
});

it('counts restoration success and denial with fixed labels', async () => {
  const removed = await remove();
  await request('/restore', 'POST', { tokens: [removed.restoreToken] });
  await request('/restore', 'POST', { tokens: [removed.restoreToken] }, 'other');
  const metrics = await (await SELF.fetch('https://c.test/metrics')).text();
  expect(metrics).toContain('hearthroom_library_requests_total{operation="favorites_restore",outcome="success"} 1');
  expect(metrics).toContain('hearthroom_library_requests_total{operation="favorites_restore",outcome="denied"} 1');
});

it('refuses expired restoration without adding the bookmark', async () => {
  const removed = await remove();
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 16 * 60 * 1000);
  expect((await request('/restore', 'POST', { tokens: [removed.restoreToken] })).status).toBe(409);
  expect(await favorites()).toHaveLength(1);
});

it('rolls back the complete restore batch on storage failure and emits an error counter', async () => {
  const first = await remove(), second = await remove('100002');
  await env.DB.exec("CREATE TRIGGER synthetic_favorite_restore_failure BEFORE INSERT ON member_favorites WHEN NEW.card_id=100002 BEGIN SELECT RAISE(ABORT,'synthetic_failure'); END;");
  try {
    expect((await request('/restore', 'POST', { tokens: [first.restoreToken, second.restoreToken] })).status).toBe(500);
    expect(await favorites()).toEqual([]);
    const metrics = await (await SELF.fetch('https://c.test/metrics')).text();
    expect(metrics).toContain('hearthroom_library_requests_total{operation="favorites_restore",outcome="error"} 1');
  } finally { await env.DB.exec('DROP TRIGGER synthetic_favorite_restore_failure'); }
});
