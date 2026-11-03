import { SELF, env } from 'cloudflare:test';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { bearer, identities, makeMember, resetDb, restoreUpstream } from './helpers';
import { opsMetrics } from '../src/ops-metrics';

let turns = 0, credits = '0', unavailable = false;
let requests: { body: unknown; token: string | null }[] = [];
const settings = env as unknown as { HOSTING_SERVICE_KEY?: string };
const savedKey = settings.HOSTING_SERVICE_KEY;
beforeEach(async () => {
  await resetDb(); identities({ player: 20001, author: 10001 });
  await makeMember(20001); await makeMember(10001);
  turns = 0; credits = '0'; unavailable = false; requests = [];
  settings.HOSTING_SERVICE_KEY = 'score-fixture';
  await env.DB.prepare("INSERT INTO cards(id,provider,source_role_id,author_num_id,registered_at,last_synced_at,status,rating,approved_hosted_role_id) VALUES(100001,'harbor','source',10001,0,0,'approved','G','hosted')").run();
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const req = new Request(input, init);
    if (!req.url.endsWith('/open/v1/hosting/score-eligibility')) throw new Error('Unexpected fixture request');
    requests.push({ body: await req.json(), token: req.headers.get('Authorization') });
    return new Response(JSON.stringify(unavailable ? { error: 'unavailable' } : {
      eligible: turns >= 6 || turns >= 3 && BigInt(credits) >= 500n,
      turns, credits, requiredTurns: 6, paidTurns: 3, requiredCredits: '500',
    }), { status: unavailable ? 503 : 200, headers: { 'Content-Type': 'application/json' } });
  });
});
afterEach(() => { vi.restoreAllMocks(); restoreUpstream(); settings.HOSTING_SERVICE_KEY = savedKey; });
const read = (token?: string) => SELF.fetch('https://c.test/v1/cards/100001/score', { headers: token ? bearer(token) : {} });
const put = () => SELF.fetch('https://c.test/v1/cards/100001/score', { method: 'PUT', headers: { ...bearer('player'), 'Content-Type': 'application/json' }, body: JSON.stringify({ score: 1, turns: 100, credits: '999999' }) });

it('denies an unplayed direct API rating, returns verified progress and writes no score or reward', async () => {
  const res = await put();
  expect(res.status).toBe(403);
  expect(await res.json()).toMatchObject({ error: 'score_play_required', eligibility: { turns: 0, eligible: false } });
  expect((await env.DB.prepare('SELECT * FROM card_scores').all()).results).toHaveLength(0);
  expect((await env.DB.prepare("SELECT * FROM reward_event_outbox WHERE type='rating_set'").all()).results).toHaveLength(0);
  expect(requests).toEqual([{ body: { roleId: 'hosted' }, token: 'Bearer player' }]);
  expect(await opsMetrics(env.DB)).toContain('hearthroom_score_admissions_total{operation="set",outcome="denied"} 1');
});

it.each([[2, '999999', 403], [3, '499', 403], [3, '500', 204], [5, '0', 403], [6, '0', 204], [3, '9007199254740993', 204]] as const)('enforces the exact turn and net credit boundary %s/%s', async (n, spent, status) => {
  turns = n; credits = spent;
  expect((await put()).status).toBe(status);
});

it('returns private viewer progress and refreshes qualification for every write', async () => {
  turns = 6;
  const res = await read('player');
  expect(res.headers.get('Cache-Control')).toBe('private, no-store');
  expect(await res.json()).toMatchObject({ eligibility: { eligible: true, turns: 6 } });
  turns = 2;
  expect((await put()).status).toBe(403);
  const guest = await (await read()).json() as any;
  expect(guest.eligibility).toBeUndefined();
  expect(requests).toHaveLength(2);
});

it('fails closed when the provider is unavailable but keeps public scores readable', async () => {
  unavailable = true;
  expect((await put()).status).toBe(503);
  expect(await (await read('player')).json()).toMatchObject({ count: 0, eligibility: { unavailable: true } });
  expect(await (await read()).json()).toMatchObject({ count: 0 });
  expect(await opsMetrics(env.DB)).toContain('hearthroom_score_admissions_total{operation="set",outcome="unavailable"} 1');
});

it('preserves legacy scores, permits withdrawal, and leaves comments open without play progress', async () => {
  const member = await makeMember(20001);
  await env.DB.prepare('INSERT INTO card_scores VALUES(100001,?,4,0,0)').bind(member).run();
  expect(await (await read('player')).json()).toMatchObject({ mine: 4, count: 1 });
  expect((await put()).status).toBe(403);
  expect((await SELF.fetch('https://c.test/v1/cards/100001/score', { method: 'DELETE', headers: bearer('player') })).status).toBe(204);
  expect((await SELF.fetch('https://c.test/v1/cards/100001/comments', { method: 'POST', headers: { ...bearer('player'), 'Content-Type': 'application/json' }, body: JSON.stringify({ content: 'A comment without play progress' }) })).status).toBe(201);
});
