import { ADULT_CONSENT_VERSION } from '../shared/adult-consent';
import { env, SELF } from 'cloudflare:test';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { resetMaintenanceMemo } from '../src/maintenance';
import { getCard, upsertCard } from '../src/cards';
import { identitiesFor, makeMember, resetDb, restoreUpstream, role, rolesOnProviders } from './helpers';

beforeEach(async () => {
  await resetDb();
  rolesOnProviders({ harbor: [{ roleId: 'quality-source', authorNumId: 11 }] });
  await upsertCard(env.DB, role({ roleId: 'quality-source', authorNumId: 11 }), Date.now(), { status: 'approved' });
});
afterEach(restoreUpstream);

const list = () => SELF.fetch('https://c.test/v1/cards?sort=new');
const card = (path = '') => SELF.fetch('https://c.test/v1/cards/quality-source' + path);

it('projects unavailable statistics separately from a measured zero', async () => {
  const response = await card('/quality');
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ length: null, deepPlay: null, rating: null, comments: 0 });
  const board = await list();
  expect(await board.json()).toMatchObject({ items: [{
    sourceRoleId: 'quality-source', qualitySignal: { lengthCharacters: null, deepPlay: null },
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
    env.DB.prepare('INSERT INTO card_quality_play(card_id,players,reached,median_turns) VALUES(?,19,7,3)').bind(row.id),
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
  expect(board.items[0].qualitySignal).toEqual({ lengthCharacters: 14000, deepPlay });
  const cardDetail = await (await card('?view=0')).json<{ qualitySignal: unknown }>();
  expect(cardDetail.qualitySignal).toEqual({ lengthCharacters: 14000, deepPlay });
  expect(await (await card('/quality')).json()).toEqual({ length, deepPlay: { ...deepPlay, medianTurns: 3 }, rating: null, comments: 0 });
  await env.DB.prepare('UPDATE card_quality_play SET players=19,reached=7 WHERE card_id=?').bind(row.id).run();
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
