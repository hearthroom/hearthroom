import { env, SELF } from 'cloudflare:test';
import { beforeEach, afterEach, it, expect } from 'vitest';
import { resetDb, makeMember, makeReviewer, identities, bearer, restoreUpstream, testHandle } from './helpers';
import { WEEKLY_LIMIT } from '../src/quota';

/**
 * 管理端發補充包：只有 manager/owner 能發、發給誰都留下理由、重送同一個操作不會多發一包。
 * 扣包的路徑（作者登記時先免費後補充包）在 quota.test.ts。
 */
const author = testHandle(10001);
const request = (path: string, token = 'manager', body?: unknown) => SELF.fetch('https://c.test/v1/moderation' + path, {
  method: body ? 'POST' : 'GET', headers: { ...bearer(token), 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}),
});
const grant = (granted: unknown, token = 'manager', extra: Record<string, unknown> = {}) =>
  request(`/members/${author}/packs`, token, { granted, reason: 'Contest winner', operationId: crypto.randomUUID(), ...extra });

beforeEach(async () => {
  await resetDb();
  await makeMember(10001);
  await makeReviewer(2); await makeReviewer(4);
  await env.DB.prepare("UPDATE reviewers SET role='manager' WHERE member_id='member-4'").run();
  identities({ author: 10001, r1: 2, manager: 4 });
});
afterEach(restoreUpstream);

it('能審卡的人就能發（跟審卡同一個權限等級）；作者本人 403，發給不存在的人 404', async () => {
  expect((await grant(2, 'author')).status).toBe(403);
  expect((await grant(1, 'r1')).status).toBe(201);
  expect((await request('/members/nobodyhere/packs', 'manager', { granted: 1, reason: 'x', operationId: crypto.randomUUID() })).status).toBe(404);
  expect((await request(`/members/${author}`, 'r1')).status).toBe(200);
  const res = await grant(2);
  expect(res.status).toBe(201);
  const body = await res.json() as any;
  expect(body.member).toMatchObject({ handle: author, role: null });
  expect(body.quota).toMatchObject({ limit: WEEKLY_LIMIT, used: 0 });
  expect(body.packs).toHaveLength(2);
  expect(body.packs[0]).toMatchObject({ granted: 2, remaining: 2, reason: 'Contest winner', grantedBy: testHandle(4) });
  expect(body.quota.packRemaining).toBe(3);
});

it('張數要是 1–100 的整數、理由必填；manager 不能發給自己', async () => {
  for (const bad of [0, 101, 1.5, '3', null]) expect((await grant(bad)).status).toBe(400);
  expect((await grant(1, 'manager', { reason: ' ' })).status).toBe(400);
  expect((await request(`/members/${testHandle(4)}/packs`, 'manager', { granted: 1, reason: 'me', operationId: crypto.randomUUID() })).status).toBe(403);
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM registration_packs').first<{ n: number }>()).toEqual({ n: 0 });
});

it('同一個操作重送不會多發一包；同一個操作改了內容是 409', async () => {
  const body = { granted: 3, reason: 'Same operation', operationId: crypto.randomUUID() };
  const a = await request(`/members/${author}/packs`, 'manager', body);
  const b = await request(`/members/${author}/packs`, 'manager', body);
  expect(a.status).toBe(201); expect(b.status).toBe(200);
  expect((await b.json() as any).packs).toHaveLength(1);
  expect((await request(`/members/${author}/packs`, 'manager', { ...body, granted: 5 })).status).toBe(409);
});

it('發包同時通知作者（有開通知的才通知），通知帶他去「我的卡片」', async () => {
  await env.DB.prepare("INSERT INTO community_preferences(member_id,notifications) VALUES('member-10001',1)").run();
  expect((await grant(1)).status).toBe(201);
  const rows = await env.DB.prepare("SELECT kind,path FROM community_notifications WHERE member_id='member-10001'").all();
  expect(rows.results).toEqual([{ kind: 'registration_pack', path: '/mine' }]);
  const seen = await SELF.fetch('https://c.test/v1/me/community/notifications', { headers: bearer('author') }).then(r => r.json()) as any;
  expect(seen.items?.[0] ?? seen[0]).toMatchObject({ kind: 'registration_pack', path: '/mine', extra: { granted: 1 } });
  // The reason is a staff record and never reaches the author.
  expect(JSON.stringify(seen)).not.toContain('Contest winner');
});

it('成員詳情看得到每個包還剩幾次；最近發放清單跨成員、新的在前', async () => {
  const first = await grant(2).then(r => r.json()) as any;
  await env.DB.prepare("INSERT INTO card_registrations(provider,author_num_id,source_role_id,registered_at,pack_id) VALUES('harbor',10001,'x1',?,?)").bind(Date.now(), first.packs[0].id).run();
  const other = await makeMember(30003);
  await request(`/members/${testHandle(30003)}/packs`, 'manager', { granted: 5, reason: 'Second author', operationId: crypto.randomUUID() });
  const detail = await request(`/members/${author}`).then(r => r.json()) as any;
  expect(detail.packs[0]).toMatchObject({ granted: 2, remaining: 1 });
  expect(detail.quota).toMatchObject({ packRemaining: 1 });
  const recent = await request('/packs').then(r => r.json()) as any;
  expect(recent.items.map((p: any) => p.member)).toEqual([testHandle(30003), author]);
  expect(recent.hasNext).toBe(false);
  expect(other).toBe('member-30003');
});

it('發包計入管理請求指標，不帶任何成員識別', async () => {
  await grant(1);
  const metrics = await SELF.fetch('https://c.test/metrics').then(r => r.text());
  expect(metrics).toContain('hearthroom_moderation_requests_total{operation="packs",outcome="success"} 1');
  expect((await grant(1, 'author')).status).toBe(403);
  expect(await SELF.fetch('https://c.test/metrics').then(r => r.text())).toContain('hearthroom_moderation_requests_total{operation="packs",outcome="denied"} 1');
  expect(metrics).not.toContain(author);
});

it('發包通知預設就送；只有明確關掉通知的人不收', async () => {
  const { setPreferences } = await import('../src/community/service');
  const notices = () => env.DB.prepare("SELECT path FROM community_notifications WHERE member_id='member-10001' AND kind='registration_pack'").all();
  expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM community_preferences WHERE member_id='member-10001'").first<{ n: number }>()).toEqual({ n: 0 });
  expect((await grant(1)).status).toBe(201);
  expect((await notices()).results).toEqual([{ path: '/mine' }]);
  await setPreferences(env as never, 'member-10001', { notifications: false });
  expect((await grant(1)).status).toBe(201);
  expect((await notices()).results).toHaveLength(1);
});
