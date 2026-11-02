import { SELF, env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { afterEach, beforeEach, expect, it } from 'vitest';
import worker from '../src/index';
import { ADULT_CONSENT_VERSION } from '../shared/adult-consent';
import { settleRankSnapshot } from '../src/rank-awards';
import { boardCache } from '../src/board-cache';
import { bearer, identities, makeMember, resetDb, restoreUpstream, testHandle } from './helpers';

const VIEWER = 40004, AUTHOR = 10001;
const adultId = 100701, generalId = 100702;
const at = Date.parse('2026-10-17T00:00:00+08:00');
let author: string;
const request = (path: string) => SELF.fetch(`https://c.test${path}`, { headers: bearer('viewer') });
async function settings(body: Record<string, unknown>) {
  const res = await SELF.fetch('https://c.test/v1/me/settings', {
    method: 'POST', headers: { ...bearer('viewer'), 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  expect(res.status).toBe(200);
}
async function honors(id: number | string) {
  const res = await request(`/v1/cards/${id}/honors`);
  expect(res.status).toBe(200);
  return res.json<{ items: { zone: string; window: string; band: number }[] }>();
}

beforeEach(async () => {
  await resetDb();
  boardCache.namespace = `region-honors-${crypto.randomUUID()}`;
  identities({ viewer: VIEWER });
  await makeMember(VIEWER);
  author = await makeMember(AUTHOR);
  for (const [id, rating, name] of [[adultId, 'R', 'Region Adult Honor'], [generalId, 'G', 'Region General Honor']] as const) {
    await env.DB.prepare("INSERT INTO card_numbers(num,provider,source_role_id) VALUES(?,'harbor',?)").bind(id, `region-honor-${id}`).run();
    await env.DB.prepare(`INSERT INTO cards(id,source_role_id,author_num_id,names,summaries,registered_at,last_synced_at,status,provider,rating)
      VALUES(?,?,?,?,'{}',?,1,'approved','harbor',?)`)
      .bind(id, `region-honor-${id}`, AUTHOR, JSON.stringify({ zh: name, en: name }), at, rating).run();
  }
  const cards = [
    { id: adultId, heat: 100, talkNum: 1, registeredAt: at, adult: true, memberId: author, accountNo: AUTHOR },
    { id: generalId, heat: 50, talkNum: 1, registeredAt: at, adult: false, memberId: author, accountNo: AUTHOR },
  ];
  for (const zone of ['clean', 'all'] as const) {
    await settleRankSnapshot(env, { zone, window: 'day', period: '2026-10-17', now: at + 65 * 86400000, cards });
  }
  await settleRankSnapshot(env, { zone: 'all', window: 'week', period: '2026-10-12', now: at + 65 * 86400000, cards: [cards[1]] });
  await settings({ countryRegion: 'TW', showNsfw: true, birthdate: '1990-01-01', consentVersion: ADULT_CONSENT_VERSION });
});
afterEach(restoreUpstream);

it('denies CN R card honors with the region error and no-store while safe honors and a switch back preserve awards', async () => {
  const adult = await honors(adultId), general = await honors(generalId);
  expect(adult.items).toEqual([expect.objectContaining({ zone: 'all', window: 'day', band: 1 })]);
  expect(general.items).toEqual([
    expect.objectContaining({ zone: 'clean', window: 'day', band: 1 }),
    expect.objectContaining({ zone: 'all', window: 'week', band: 1 }),
  ]);
  const saved = (await env.DB.prepare('SELECT * FROM rank_awards ORDER BY id').all()).results;
  await settings({ countryRegion: 'CN' });
  for (const id of [adultId, `region-honor-${adultId}`]) {
    const denied = await request(`/v1/cards/${id}/honors`);
    expect(denied.status).toBe(403);
    expect.soft(denied.headers.get('Cache-Control')).toBe('private, no-store');
    expect.soft(await denied.json()).toEqual({ error: 'region_unavailable' });
  }
  expect(await (await SELF.fetch('https://c.test/metrics')).text()).toContain(
    'hearthroom_country_region_operations_total{operation="admission",outcome="denied"} 2',
  );
  expect(await honors(generalId)).toEqual(general);
  expect((await env.DB.prepare('SELECT * FROM rank_awards ORDER BY id').all()).results).toEqual(saved);
  await settings({ countryRegion: 'TW' });
  expect(await honors(adultId)).toEqual(adult);
  expect(await honors(generalId)).toEqual(general);
});

it('filters R card cover honors in CN and restores the same R and general card projections', async () => {
  const cards = async () => {
    const res = await request('/v1/cards?zone=zh&sort=hot&nsfw=1');
    expect(res.status).toBe(200);
    return (await res.json<{ items: { id: string; honors: { zone: string; window: string; band: number }[] }[] }>()).items;
  };
  const baseline = await cards();
  expect(baseline.map(c => Number(c.id))).toEqual(expect.arrayContaining([adultId, generalId]));
  const safe = baseline.find(c => Number(c.id) === generalId)!;
  expect(safe.honors).toEqual(expect.arrayContaining([
    { zone: 'clean', window: 'day', band: 1 }, { zone: 'all', window: 'week', band: 1 },
  ]));
  expect(baseline.find(c => Number(c.id) === adultId)!.honors).toEqual([{ zone: 'all', window: 'day', band: 1 }]);
  await settings({ countryRegion: 'CN' });
  const restricted = await cards();
  expect(restricted.map(c => Number(c.id))).toEqual([generalId]);
  expect(restricted[0].honors).toEqual(safe.honors);
  const detail = await request(`/v1/cards/${generalId}?view=0`);
  expect(detail.status).toBe(200);
  expect((await detail.json<{ honors: unknown }>()).honors).toEqual(safe.honors);
  await settings({ countryRegion: 'TW' });
  expect((await cards()).map(c => ({ id: c.id, honors: c.honors }))).toEqual(baseline.map(c => ({ id: c.id, honors: c.honors })));
});

it('keeps public author honors and name badges as permanent metadata without R card references through a region roundtrip', async () => {
  const featured = ['rank_all_day_1', 'rank_clean_day_1', 'rank_all_week_1'];
  await env.DB.prepare('INSERT INTO community_preferences(member_id,public_badges,featured_badges) VALUES(?,1,?)')
    .bind(author, JSON.stringify(featured)).run();
  const paths = [`/v1/community/members/${testHandle(AUTHOR)}/badges`, `/v1/community/members/${testHandle(AUTHOR)}`];
  const read = async () => Promise.all(paths.map(async path => {
    const ctx = createExecutionContext();
    const response = await worker.fetch(new Request(`https://c.test${path}`, { headers: bearer('viewer') }), { ...env, COMMUNITY_ENABLED: 'true' }, ctx);
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(200);
    return response.json() as Promise<any>;
  }));
  const baseline = await read();
  expect(baseline[0].items).toHaveLength(3);
  for (const key of featured) expect(baseline[0].items.find((b: { key: string }) => b.key === key)).toMatchObject({ state: 'earned', count: 1 });
  expect(baseline[1].badges).toEqual(featured);
  const saved = (await env.DB.prepare('SELECT * FROM rank_awards ORDER BY id').all()).results;
  await settings({ countryRegion: 'CN' });
  const restricted = await read();
  expect(restricted).toEqual(baseline);
  const json = JSON.stringify(restricted);
  for (const secret of ['Region Adult Honor', `region-honor-${adultId}`, '/cards/']) expect(json).not.toContain(secret);
  const referenceKeys = new Set(['cardId', 'card_id', 'roleId', 'sourceRoleId', 'cards', 'cardUrl', 'rating']);
  const checkKeys = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) { expect(referenceKeys.has(key)).toBe(false); checkKeys(child); }
  };
  checkKeys(restricted);
  expect((await env.DB.prepare('SELECT * FROM rank_awards ORDER BY id').all()).results).toEqual(saved);
  await settings({ countryRegion: 'TW' });
  expect(await read()).toEqual(baseline);
  await env.DB.prepare('UPDATE community_preferences SET public_badges=0 WHERE member_id=?').bind(author).run();
  const hidden = await read();
  expect(hidden[0]).toEqual({ items: [], featured: [] });
  expect(hidden[1].badges).toEqual([]);
});

it('keeps unreachable R honors at 404 before disclosing a region denial', async () => {
  await env.DB.prepare("UPDATE cards SET status='unshared' WHERE id=?").bind(adultId).run();
  await settings({ countryRegion: 'CN' });
  const denied = await request(`/v1/cards/${adultId}/honors`);
  expect(denied.status).toBe(404);
  expect(await denied.json()).toEqual({ error: 'card not found' });
  expect((await honors(generalId)).items).toHaveLength(2);
});
