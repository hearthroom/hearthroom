/**
 * 作者主頁的關注／粉絲可見度與名單（任務 2026-11-19-profile-visibility）。
 * 他人看得到什麼由作者自己的設定決定；名單裡的每一條關注要雙方都同意公開。
 * 隱藏的數字不能出現在任何回應裡，快取暖著也一樣。
 */
import { SELF, env } from 'cloudflare:test';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { bearer, makeMember, myRolesOnUpstream, resetDb, restoreUpstream, role, testHandle } from './helpers';
import { upstream } from '../src/upstream';
import { upsertCard } from '../src/cards';

let author: string;
const AUTHOR = testHandle(11);

beforeEach(async () => {
  await resetDb();
  myRolesOnUpstream({ valid: [] });
  vi.spyOn(upstream, 'fetchMe').mockImplementation(async () => ({ accountNumId: 11, nickName: 'Writer', avatar: '' }));
  author = await makeMember(11);
  await upsertCard(env.DB, role({ roleId: 'vis-card', authorNumId: 11, authorName: 'Writer' }), Date.now(), { status: 'approved' });
});
afterEach(() => { vi.restoreAllMocks(); restoreUpstream(); });

const get = (path: string, headers: Record<string, string> = {}) => SELF.fetch('https://c.test' + path, { headers });
const json = async (path: string, headers?: Record<string, string>) => (await (await get(path, headers)).json()) as any;
const settings = (body: Record<string, unknown>) =>
  SELF.fetch('https://c.test/v1/me/settings', { method: 'POST', headers: { ...bearer('valid'), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const setVis = (id: string, following: string, followers: string) =>
  env.DB.prepare('UPDATE members SET following_visibility=?, followers_visibility=? WHERE id=?').bind(following, followers, id).run();
const follow = (from: string, to: string, at = 1) => env.DB.prepare('INSERT INTO member_follows VALUES (?,?,?)').bind(from, to, at).run();

/** 粉絲 fan-1..n 關注作者、作者關注 writer-1..m；回成員 id。 */
async function graph(fans: number, followed: number) {
  const fanIds: string[] = [], followedIds: string[] = [];
  for (let i = 1; i <= fans; i++) { fanIds.push(await makeMember(500 + i)); await follow(fanIds.at(-1)!, author, i); }
  for (let i = 1; i <= followed; i++) { followedIds.push(await makeMember(800 + i)); await follow(author, followedIds.at(-1)!, i); }
  return { fanIds, followedIds };
}

it('defaults both settings to count and saves them through settings', async () => {
  const me = await json('/v1/me', bearer('valid'));
  expect(me).toMatchObject({ followingVisibility: 'count', followersVisibility: 'count' });
  expect(me).not.toHaveProperty('showStats');
  const saved = await settings({ followingVisibility: 'hidden', followersVisibility: 'list' });
  expect(saved.status).toBe(200);
  expect(await saved.json()).toMatchObject({ followingVisibility: 'hidden', followersVisibility: 'list' });
  // 只送一個不動另一個
  expect(await (await settings({ followingVisibility: 'list' })).json()).toMatchObject({ followingVisibility: 'list', followersVisibility: 'list' });
  expect(await json('/v1/me', bearer('valid'))).toMatchObject({ followingVisibility: 'list', followersVisibility: 'list' });
  for (const bad of [{ followingVisibility: 'private' }, { followersVisibility: 'hidden' }, { followingVisibility: true }]) {
    expect((await settings(bad)).status).toBe(400);
  }
});

it('shows work count and followers always, and following only when not hidden, with warm caches', async () => {
  await graph(3, 2);
  const first = await json('/v1/authors/' + AUTHOR);
  expect(first).toMatchObject({ cardCount: 1, followers: 3, following: 2, followersVisibility: 'count', followingVisibility: 'count' });
  const listed = await json('/v1/authors?zone=all&q=Writer');
  expect(listed.items[0]).toMatchObject({ handle: AUTHOR, followers: 3, following: 2 });

  await settings({ followingVisibility: 'hidden' });
  const page = await get('/v1/authors/' + AUTHOR);
  const body = await page.text();
  expect(JSON.parse(body)).toMatchObject({ followers: 3, following: null, followingVisibility: 'hidden' });
  expect(body).not.toMatch(/"following":\s*2/);
  const search = await json('/v1/authors?zone=all&q=Writer');
  expect(search.items[0]).toMatchObject({ followers: 3, following: null });

  // 新關注即時反映在人數上（不等快照過期）
  const late = await makeMember(999);
  await follow(late, author, 99);
  expect((await json('/v1/authors/' + AUTHOR)).followers).toBe(4);
});

it('refuses lists the author keeps to counts, without any number', async () => {
  await graph(2, 2);
  for (const kind of ['following', 'followers']) {
    const r = await get(`/v1/authors/${AUTHOR}/${kind}`);
    expect(r.status).toBe(403);
    const body = await r.json() as any;
    expect(body.error).toBe('list_not_public');
    expect(body).not.toHaveProperty('total');
  }
  await setVis(author, 'hidden', 'count');
  expect((await get(`/v1/authors/${AUTHOR}/following`)).status).toBe(403);
  expect((await get('/v1/authors/zzzzzzzz/followers')).status).toBe(404);
});

it('lists only relations both sides made public and reports the rest as unlisted', async () => {
  const { fanIds, followedIds } = await graph(3, 3);
  await setVis(author, 'list', 'list');
  await setVis(fanIds[0], 'list', 'count');    // 公開了自己的關注 → 列入
  await setVis(fanIds[1], 'hidden', 'list');   // 關注不公開 → 不列
  await setVis(followedIds[2], 'count', 'list'); // 公開了自己的粉絲 → 列入
  const followers = await json(`/v1/authors/${AUTHOR}/followers`);
  expect(followers).toMatchObject({ total: 3, unlisted: 2, hasNext: false, offset: 0, limit: 30 });
  expect(followers.items).toEqual([{ handle: testHandle(501), name: testHandle(501), avatar: '' }]);
  const following = await json(`/v1/authors/${AUTHOR}/following`);
  expect(following).toMatchObject({ total: 3, unlisted: 2 });
  expect(following.items.map((i: any) => i.handle)).toEqual([testHandle(803)]);
  // 只回公開身分，不回內部 id
  expect(JSON.stringify(followers) + JSON.stringify(following)).not.toMatch(/member-/);
});

it('pages thirty at a time, newest first', async () => {
  const { fanIds } = await graph(32, 0);
  await setVis(author, 'count', 'list');
  for (const id of fanIds) await setVis(id, 'list', 'count');
  const p1 = await json(`/v1/authors/${AUTHOR}/followers`);
  expect(p1.items).toHaveLength(30);
  expect(p1.items[0].handle).toBe(testHandle(532));
  expect(p1.hasNext).toBe(true);
  const p2 = await json(`/v1/authors/${AUTHOR}/followers?offset=30`);
  expect(p2.items.map((i: any) => i.handle)).toEqual([testHandle(502), testHandle(501)]);
  expect(p2).toMatchObject({ hasNext: false, total: 32, unlisted: 0 });
});

it('lets the author open their own followers whatever their setting, still honouring each fan', async () => {
  const { fanIds } = await graph(2, 0);
  await setVis(fanIds[1], 'list', 'count');
  expect((await get('/v1/me/followers')).status).toBe(401);
  const own = await json('/v1/me/followers', bearer('valid'));
  expect(own).toMatchObject({ total: 2, unlisted: 1 });
  expect(own.items.map((i: any) => i.handle)).toEqual([testHandle(502)]);
  expect((await get(`/v1/authors/${AUTHOR}/followers`)).status).toBe(403);
});

it('counts list reads by kind and outcome on /metrics', async () => {
  await get(`/v1/authors/${AUTHOR}/followers`);
  await setVis(author, 'list', 'list');
  await get(`/v1/authors/${AUTHOR}/following`);
  await get('/v1/me/followers', bearer('valid'));
  const metrics = await (await get('/metrics')).text();
  expect(metrics).toContain('hearthroom_follow_list_reads_total{kind="followers",outcome="not_public"} 1');
  expect(metrics).toContain('hearthroom_follow_list_reads_total{kind="following",outcome="success"} 1');
  expect(metrics).toContain('hearthroom_follow_list_reads_total{kind="own_followers",outcome="success"} 1');
  expect(metrics).not.toContain(author);
});

it('lets a test account open its own (empty) followers list', async () => {
  await env.DB.prepare("UPDATE members SET account_class='test', test_generation=1 WHERE id=?").bind(author).run();
  vi.spyOn(upstream, 'fetchMe').mockResolvedValue({ accountNumId: 11, accountClass: 'test', testState: 'active', testGeneration: 1 } as any);
  const own = await get('/v1/me/followers', bearer('valid'));
  expect(own.status).toBe(200);
  expect(await own.json()).toMatchObject({ total: 0, unlisted: 0, items: [] });
});
