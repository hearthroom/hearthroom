import { ADULT_CONSENT_VERSION } from '../shared/adult-consent';
import { env, SELF } from 'cloudflare:test';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { resetMaintenanceMemo } from '../src/maintenance';
import { getCard, upsertCard } from '../src/cards';
import { identitiesFor, makeMember, resetDb, restoreUpstream, role, rolesOnProviders } from './helpers';

beforeEach(async () => {
  await resetDb();
  rolesOnProviders({ harbor: [{ roleId: 'quality-source', authorNumId: 11 }] });
  await upsertCard(env.DB, role({ roleId: 'quality-source', authorNumId: 11 }), Date.now(), { status: 'approved' });
});
afterEach(() => { restoreUpstream(); vi.useRealTimers(); });

const list = () => SELF.fetch('https://c.test/v1/cards?sort=new');
const card = (path = '') => SELF.fetch('https://c.test/v1/cards/quality-source' + path);

it('projects unavailable statistics separately from a measured zero', async () => {
  const response = await card('/quality');
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ length: null, deepPlay: null, rating: null, comments: 0 });
  const board = await list();
  expect(await board.json()).toMatchObject({ items: [{
    sourceRoleId: 'quality-source', qualitySignal: { lengthCharacters: null, deepPlay: null,
      detail: { length: null, deepPlay: null, rating: null, comments: 0 } },
  }] });
});

it('follows the card adult and moderation gates on detail and list', async () => {
  await env.DB.prepare("UPDATE cards SET rating='R' WHERE source_role_id='quality-source'").run();
  expect((await card('/quality')).status).toBe(403);
  expect(await (await list()).json()).toMatchObject({ items: [] });
  await env.DB.prepare("UPDATE cards SET public_blocked=1 WHERE source_role_id='quality-source'").run();
  expect((await card('/quality')).status).toBe(404);
});

it('never serializes small cohorts and reads only the approved version’s rounded values', async () => {
  const row = (await getCard(env.DB, 'quality-source'))!;
  await env.DB.batch([
    env.DB.prepare("INSERT INTO hosting_versions(version_id,work_id,member_id,operation_id,source_role_id,provider,card_id,created_at) VALUES('approved','work','author','approved','quality-source','harbor',?,1),('draft','work-draft','author','draft','quality-source','harbor',?,2)").bind(row.id, row.id),
    env.DB.prepare("UPDATE cards SET approved_version_id='approved' WHERE id=?").bind(row.id),
    env.DB.prepare("INSERT INTO card_quality_lengths(version_id,total_chars,setting_chars,worldbook_entries,worldbook_chars,opening_count,opening_chars,opening_page,display_rules,panel) VALUES('approved',14000,10000,2,3000,1,1000,1,2,0),('draft',99000,99000,0,0,0,0,0,0,0)"),
    env.DB.prepare('INSERT INTO card_quality_play(card_id,players,reached,median_turns,verified_at) VALUES(?,19,7,3,?)').bind(row.id, Date.now()),
  ]);
  const length = { total: 14000, setting: 10000, worldbook: { entries: 2, characters: 3000 },
    openings: { count: 1, characters: 1000 }, presentation: { openingPage: true, displayRules: 2, panel: false } };
  const signal = { lengthCharacters: 14000, deepPlay: null };
  expect(await (await card('/quality')).json()).toEqual({ length, deepPlay: null, rating: null, comments: 0 });
  expect(await (await card('?view=0')).json()).toMatchObject({ qualitySignal: signal });
  expect(await (await list()).json()).toMatchObject({ items: [{ qualitySignal: signal }] });
  await env.DB.prepare('UPDATE card_quality_play SET players=200,reached=165 WHERE card_id=?').bind(row.id).run();
  const deepPlay = { rate: 82 };
  const board = await (await list()).json<{ items: { qualitySignal: unknown }[] }>();
  expect(board.items[0].qualitySignal).toEqual({ lengthCharacters: 14000, deepPlay,
    detail: { length, deepPlay: { ...deepPlay, medianTurns: 3 }, rating: null, comments: 0 } });
  const cardDetail = await (await card('?view=0')).json<{ qualitySignal: unknown }>();
  expect(cardDetail.qualitySignal).toEqual({ lengthCharacters: 14000, deepPlay });
  expect(await (await card('/quality')).json()).toEqual({ length, deepPlay: { ...deepPlay, medianTurns: 3 }, rating: null, comments: 0 });
  await env.DB.prepare('UPDATE card_quality_play SET players=19,reached=7 WHERE card_id=?').bind(row.id).run();
  expect(await (await card('/quality')).json()).toMatchObject({ deepPlay: null });
  await env.DB.prepare('UPDATE card_quality_play SET players=20,verified_at=? WHERE card_id=?')
    .bind(Date.now() - 7 * 60 * 60 * 1000, row.id).run();
  expect(await (await list()).json()).toMatchObject({ items: [{ qualitySignal: signal }] });
  expect(await (await card('/quality')).json()).toMatchObject({ deepPlay: null });
});

it('advertises the UI capability only after the rollout is enabled', async () => {
  const providers = async () => (await SELF.fetch('https://c.test/v1/providers')).json();
  expect(await providers()).not.toMatchObject({ capabilities: { cardQuality: true } });
  await env.DB.prepare("INSERT INTO community_settings(key,value,updated_at) VALUES('card_quality_ui','true',1)").run();
  resetMaintenanceMemo();
  try {
    expect(await providers()).toMatchObject({ capabilities: { cardQuality: true } });
  } finally {
    await env.DB.prepare("DELETE FROM community_settings WHERE key='card_quality_ui'").run();
    resetMaintenanceMemo();
  }
});

it('publishes ratings at five votes and denies R18 data to an unauthorized viewer', async () => {
  const row = (await getCard(env.DB, 'quality-source'))!;
  identitiesFor({ harbor: { 'adult-viewer': 2042 } });
  const viewer = await makeMember(2042);
  await env.DB.prepare('UPDATE members SET show_nsfw=1,age_verified_at=1,adult_consent_version=? WHERE id=?').bind(ADULT_CONSENT_VERSION, viewer).run();
  await env.DB.prepare("UPDATE cards SET rating='R' WHERE id=?").bind(row.id).run();
  const read = () => SELF.fetch('https://c.test/v1/cards/quality-source/quality?nsfw=1', {
    headers: { Authorization: 'Bearer adult-viewer' },
  });
  expect((await card('/quality')).status).toBe(403);
  for (const account of [51, 52, 53, 54, 55]) {
    const member = await makeMember(account);
    await env.DB.prepare('INSERT INTO card_scores(card_id,member_id,score,created_at,updated_at) VALUES(?,?,4,1,1)').bind(row.id, member).run();
    if (account === 54 || account === 55) {
      const response = await read();
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ rating: account === 54 ? null : { average: 4, count: 5 } });
    }
  }
  await env.DB.prepare('DELETE FROM card_scores WHERE card_id=? AND member_id=?').bind(row.id, 'member-55').run();
  expect(await (await read()).json()).toMatchObject({ rating: null });
});

it('does not expose statistics through numbers assigned by a retired provider', async () => {
  const retired = await upsertCard(env.DB, role({ roleId: 'retired-quality-card' }), Date.now(), {
    provider: 'lunatalk', status: 'approved',
  });
  const url = 'https://c.test/v1/cards/' + retired.id;
  expect((await SELF.fetch(url)).status).toBe(404);
  expect((await SELF.fetch(url + '/quality')).status).toBe(404);
});

it('carries the same preview data on the list as the card data endpoint, cached for the page', async () => {
  vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 3_600_000 }); // 前面用例留下的同一頁快取已過期
  const row = (await getCard(env.DB, 'quality-source'))!;
  await env.DB.batch([
    env.DB.prepare("INSERT INTO hosting_versions(version_id,work_id,member_id,operation_id,source_role_id,provider,card_id,created_at) VALUES('approved','work','author','approved','quality-source','harbor',?,1)").bind(row.id),
    env.DB.prepare("UPDATE cards SET approved_version_id='approved' WHERE id=?").bind(row.id),
    env.DB.prepare("INSERT INTO card_quality_lengths(version_id,total_chars,setting_chars,worldbook_entries,worldbook_chars,opening_count,opening_chars,opening_page,display_rules,panel) VALUES('approved',23000,3000,18,19000,3,1000,1,2,1)"),
    env.DB.prepare('INSERT INTO card_quality_play(card_id,players,reached,median_turns,verified_at) VALUES(?,200,164,6.5,?)').bind(row.id, Date.now()),
  ]);
  const fans: string[] = [];
  for (const account of [61, 62, 63, 64, 65]) fans.push(await makeMember(account));
  await env.DB.batch(fans.map((member, i) => env.DB.prepare('INSERT INTO card_scores(card_id,member_id,score,created_at,updated_at) VALUES(?,?,?,1,1)').bind(row.id, member, i < 3 ? 5 : 4)));
  await env.DB.batch([
    env.DB.prepare("INSERT INTO comments(id,card_id,member_id,content,created_at) VALUES('q-1',?,?,'a',1),('q-2',?,?,'b',2)").bind(row.id, fans[0], row.id, fans[1]),
    env.DB.prepare("INSERT INTO comments(id,card_id,member_id,content,created_at,root_id,parent_id) VALUES('q-3',?,?,'reply',3,'q-1','q-1')").bind(row.id, fans[2]),
  ]);
  const detail = async () => (await card('/quality')).json();
  const listed = async () => (await (await list()).json<{ items: { qualitySignal: { detail?: unknown } }[] }>()).items[0].qualitySignal.detail;
  const first = await detail();
  expect(first).toEqual({
    length: { total: 23000, setting: 3000, worldbook: { entries: 18, characters: 19000 }, openings: { count: 3, characters: 1000 }, presentation: { openingPage: true, displayRules: 2, panel: true } },
    deepPlay: { rate: 82, medianTurns: 6.5 }, rating: { average: 4.6, count: 5 }, comments: 2,
  });
  expect(await listed()).toEqual(first);
  // 整頁快取 5 分鐘：新留言先不反映在列表，卡片數據端點照舊即時
  await env.DB.prepare("INSERT INTO comments(id,card_id,member_id,content,created_at) VALUES('q-4',?,?,'c',4)").bind(row.id, fans[3]).run();
  expect(await listed()).toMatchObject({ comments: 2 });
  expect(await detail()).toMatchObject({ comments: 3 });
});

it('carries the same preview data on a member’s favorites', async () => {
  vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 7_200_000 }); // 前面用例留下的同一張卡快取已過期
  const row = (await getCard(env.DB, 'quality-source'))!;
  identitiesFor({ harbor: { 'favorite-viewer': 2043 } });
  const viewer = await makeMember(2043);
  await env.DB.prepare('INSERT INTO member_favorites(member_id,card_id,created_at) VALUES(?,?,1)').bind(viewer, row.id).run();
  await env.DB.prepare("INSERT INTO comments(id,card_id,member_id,content,created_at) VALUES('f-1',?,?,'a',1)").bind(row.id, viewer).run();
  const response = await SELF.fetch('https://c.test/v1/me/favorites', { headers: { Authorization: 'Bearer favorite-viewer' } });
  expect(response.status).toBe(200);
  const body = await response.json<{ items: { qualitySignal?: { detail?: unknown } }[] }>();
  expect(body.items[0].qualitySignal?.detail).toEqual(await (await card('/quality')).json());
  expect(body.items[0].qualitySignal?.detail).toMatchObject({ comments: 1 });
});
