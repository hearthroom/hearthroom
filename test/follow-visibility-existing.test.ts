/**
 * 上線預設（owner 2026-11-19 授權上線、PM 裁定①）：改版前他人看不到關注與粉絲，
 * 遷移當下已存在的帳號關注設成「隱藏」維持現況；粉絲數依需求不能隱藏，維持「僅數量」。
 * 之後新註冊的帳號照欄位預設（關注、粉絲都是「僅數量」）。
 */
import { applyD1Migrations, env } from 'cloudflare:test';
import { beforeEach, expect, it } from 'vitest';
import { resetDb } from './helpers';

const migration = env.TEST_MIGRATIONS.find((m) => m.name === '0135_existing_members_following_hidden.sql');
beforeEach(async () => {
  await resetDb();
  await env.DB.prepare('DELETE FROM d1_migrations WHERE name=?').bind('0135_existing_members_following_hidden.sql').run();
});
const vis = async (id: string) => await env.DB.prepare('SELECT following_visibility AS following, followers_visibility AS followers FROM members WHERE id=?').bind(id).first();

it('hides following for members that existed at migration time and leaves followers as a count', async () => {
  expect(migration).toBeDefined();
  await env.DB.prepare("INSERT INTO members (id, handle, created_at, show_stats) VALUES ('old-on','oldonaaa',1,1),('old-off','oldoffaa',1,0)").run();
  await applyD1Migrations(env.DB, [migration!]);
  expect(await vis('old-on')).toEqual({ following: 'hidden', followers: 'count' });
  expect(await vis('old-off')).toEqual({ following: 'hidden', followers: 'count' });
  await env.DB.prepare("INSERT INTO members (id, handle, created_at) VALUES ('new','newmembr',2)").run();
  expect(await vis('new')).toEqual({ following: 'count', followers: 'count' });
});
