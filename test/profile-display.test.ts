/**
 * 主頁的顯示設定：封面（站內場景圖），以及粉絲／關注數。
 * 封面只收目錄裡的場景。他人看到的關注／粉絲可見度見 follow-visibility.test.ts。
 */
import { SELF, env } from 'cloudflare:test';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { bearer, myRolesOnUpstream, resetDb, restoreUpstream } from './helpers';
import { upstream } from '../src/upstream';

beforeEach(async () => {
  await resetDb();
  myRolesOnUpstream({ valid: [] });
  vi.spyOn(upstream, 'fetchMe').mockImplementation(async () => ({ accountNumId: 22, nickName: 'Harper name', avatar: '' }));
});
afterEach(() => { vi.restoreAllMocks(); restoreUpstream(); });

const me = async () => (await (await SELF.fetch('https://c.test/v1/me', { headers: bearer('valid') })).json()) as any;
const saveProfile = (body: Record<string, unknown>) =>
  SELF.fetch('https://c.test/v1/me/profile', { method: 'PUT', headers: { ...bearer('valid'), 'Content-Type': 'application/json' }, body: JSON.stringify({ displayName: 'Name', bio: '', ...body }) });

it('starts with no cover and zero follow counts', async () => {
  const profile = await me();
  expect(profile.cover).toBe('');
  expect(profile.followers).toBe(0);
  expect(profile.following).toBe(0);
});

it('stores a catalog cover, clears it, and rejects anything outside the catalog', async () => {
  expect((await saveProfile({ cover: 'bookstore-night' })).status).toBe(200);
  expect((await me()).cover).toBe('bookstore-night');
  for (const cover of ['https://evil.example/x.png', '../secret', 'unknown-scene', 42]) {
    const r = await saveProfile({ cover });
    expect(r.status).toBe(400);
    expect(((await r.json()) as any).error).toBe('cover_invalid');
  }
  expect((await me()).cover).toBe('bookstore-night');
  // 不帶 cover 的舊客戶端不會把封面洗掉
  expect((await saveProfile({})).status).toBe(200);
  expect((await me()).cover).toBe('bookstore-night');
  expect((await saveProfile({ cover: '' })).status).toBe(200);
  expect((await me()).cover).toBe('');
});

it('shows the chosen cover on the public author page', async () => {
  const profile = await me();
  await saveProfile({ cover: 'sakura' });
  const author = (await (await SELF.fetch('https://c.test/v1/authors/' + profile.handle)).json()) as any;
  expect(author.cover).toBe('sakura');
  // 作者頁有快照快取：換封面要讓快照失效，訪客才看得到新的
  await saveProfile({ cover: 'snow-day' });
  const again = (await (await SELF.fetch('https://c.test/v1/authors/' + profile.handle)).json()) as any;
  expect(again.cover).toBe('snow-day');
});

it('counts followers and followed authors', async () => {
  const profile = await me();
  const self = (await env.DB.prepare('SELECT id FROM members WHERE handle=?').bind(profile.handle).first<{ id: string }>())!.id;
  for (const [id, handle] of [['fan-a', 'fanaaaaa'], ['fan-b', 'fanbbbbb'], ['writer', 'wrtrrrrr']]) {
    await env.DB.prepare("INSERT INTO members (id, handle, created_at) VALUES (?, ?, 1)").bind(id, handle).run();
  }
  await env.DB.prepare('INSERT INTO member_follows VALUES (?,?,1)').bind('fan-a', self).run();
  await env.DB.prepare('INSERT INTO member_follows VALUES (?,?,1)').bind('fan-b', self).run();
  await env.DB.prepare('INSERT INTO member_follows VALUES (?,?,1)').bind(self, 'writer').run();
  const counted = await me();
  expect(counted.followers).toBe(2);
  expect(counted.following).toBe(1);
});
