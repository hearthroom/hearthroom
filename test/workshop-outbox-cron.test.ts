import { env, createExecutionContext, createScheduledController, waitOnExecutionContext } from 'cloudflare:test';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { makeMember, recordD1, resetDb, restoreUpstream } from './helpers';
import worker from '../src/index';
import { rankTransport, RANK_RETRY_CRON } from '../src/rank-maintenance';
import { badgeStatsTransport } from '../src/badge-stats';
import { cardRewardTransport } from '../src/card-reward-service';
import { drainProviderWorkshopOutbox, WORKSHOP_OUTBOX_MINUTE_BATCH } from '../src/workshop';
import { restoreWorkshopUpstream, workshopUpstream, type WorkshopOutboxEvent } from '../src/workshop-gateway';

// Synthetic fixtures only. The rank fixture mirrors test/rank-maintenance.test.ts so the
// minute cron's own work is observable next to the outbox drain.
const at = Date.parse('2026-10-17T00:00:00+08:00');
const realRank = { ...rankTransport }, rewardToken = cardRewardTransport.token, statsRead = badgeStatsTransport.read;
let payments = 0, refreshes = 0;
let pulls: { afterSeq: number; limit: number }[] = [];
let acked: number[] = [];
let outbox: WorkshopOutboxEvent[] = [];

beforeEach(async () => {
  await resetDb(); await makeMember(11);
  cardRewardTransport.token = async () => 'service-only';
  await env.DB.prepare("INSERT INTO cards(id,source_role_id,author_num_id,names,summaries,registered_at,last_synced_at,status,provider,approved_hosted_role_id) VALUES(100001,'rank-source',11,'{}','{}',?,1,'approved','harbor','rank-hosted')").bind(at + 1000).run();
  await env.DB.prepare("INSERT INTO review_submissions(id,card_id,provider,source_role_id,kind,status,submitted_at,decided_at) VALUES('rank-first',100001,'harbor','rank-source','first','approved',?,?)").bind(at, at + 1000).run();
  payments = 0; refreshes = 0; pulls = []; acked = [];
  rankTransport.heats = async (_e, windows) => windows.map((w) => ({ ...w, heat: 100, complete: true }));
  rankTransport.pay = async (_e, _t, input) => { payments++; return input; };
  badgeStatsTransport.read = async () => { refreshes++; return [{ accountNo: 11, effectiveInvites: 3, netTopupUsdMicros: 5000000, consumedCredits: 30000, complete: true }]; };
  // Provider outbox fake: honours afterSeq/limit like the real endpoint.
  outbox = Array.from({ length: 120 }, (_, i) => ({ seq: 9 + i, kind: 'policy_changed', eventKey: `cron-policy-${9 + i}`, workId: 'work:100001', sourceRoleId: 'rank-source', payload: { policyVersion: 2, revision: 2 + i, allowNew: i % 2 === 0 } }));
  workshopUpstream.pullOutbox = async (_e, afterSeq, limit = 100) => {
    pulls.push({ afterSeq, limit });
    return { events: outbox.filter((e) => e.seq! > afterSeq).slice(0, limit) };
  };
  workshopUpstream.ackOutbox = async (_e, seq) => { acked.push(seq); return { ok: true }; };
});
afterEach(() => {
  vi.restoreAllMocks(); Object.assign(rankTransport, realRank); cardRewardTransport.token = rewardToken; badgeStatsTransport.read = statsRead;
  restoreWorkshopUpstream(); restoreUpstream();
});

async function run(cron: string, scheduledTime: number) {
  const ctx = createExecutionContext();
  await worker.scheduled(createScheduledController({ cron, scheduledTime }), env, ctx);
  await waitOnExecutionContext(ctx);
}
const cursor = async () => (await env.DB.prepare("SELECT last_seq FROM workshop_outbox_cursor WHERE provider='harbor'").first<{ last_seq: number }>())?.last_seq ?? 0;

it('drains the workshop outbox on every phase of the minute cron in bounded batches', async () => {
  for (let phase = 0; phase < 3; phase++) await run(RANK_RETRY_CRON, at + 3 * 86400000 + phase * 60000);
  expect(pulls).toHaveLength(3);
  expect(pulls.every((p) => p.limit === WORKSHOP_OUTBOX_MINUTE_BATCH)).toBe(true);
  expect(pulls.map((p) => p.afterSeq)).toEqual([0, 8 + WORKSHOP_OUTBOX_MINUTE_BATCH, 8 + 2 * WORKSHOP_OUTBOX_MINUTE_BATCH]);
  expect(await cursor()).toBe(Math.min(128, 8 + 3 * WORKSHOP_OUTBOX_MINUTE_BATCH));
  expect(acked.at(-1)).toBe(await cursor());
  // The minute cron's own rank and badge work still ran in full.
  expect(payments).toBe(2); expect(refreshes).toBe(1);
});

it('keeps rank and badge work running when the outbox drain fails', async () => {
  workshopUpstream.pullOutbox = async () => { throw new Error('outbox down'); };
  for (let phase = 0; phase < 3; phase++) await run(RANK_RETRY_CRON, at + 3 * 86400000 + phase * 60000);
  expect(payments).toBe(2); expect(refreshes).toBe(1);
  expect(await cursor()).toBe(0);
});

it('keeps draining the outbox when rank and badge work fail', async () => {
  rankTransport.heats = async () => { throw new Error('heat down'); };
  rankTransport.pay = async () => { throw new Error('pay down'); };
  badgeStatsTransport.read = async () => { throw new Error('stats down'); };
  for (let phase = 0; phase < 3; phase++) await run(RANK_RETRY_CRON, at + 3 * 86400000 + phase * 60000);
  expect(pulls).toHaveLength(3);
  expect(await cursor()).toBe(Math.min(128, 8 + 3 * WORKSHOP_OUTBOX_MINUTE_BATCH));
});

it('no longer drains on the hourly maintenance cron, so one minute never runs two drains', async () => {
  await run('17 * * * *', at + 3 * 86400000);
  expect(pulls).toHaveLength(0);
});

it('never moves the cursor backwards when an older drain finishes late', async () => {
  // This drain reads cursor 8; while it is pulling, an overlapping drain advances the cursor to 100.
  await env.DB.prepare("INSERT INTO workshop_outbox_cursor(provider,last_seq,updated_at) VALUES('harbor',8,0)").run();
  workshopUpstream.pullOutbox = async () => {
    await env.DB.prepare("UPDATE workshop_outbox_cursor SET last_seq=100 WHERE provider='harbor'").run();
    return { events: outbox.slice(0, 10) };
  };
  await drainProviderWorkshopOutbox(env, 'harbor', 10);
  expect(await cursor()).toBe(100);
  expect(acked).toEqual([]);
});

it('keeps one full minute batch within the D1 query budget even when no event resolves to a card', async () => {
  // Worst case: every event misses the card lookups (cards without a community row).
  outbox = outbox.map((e) => ({ ...e, workId: crypto.randomUUID(), sourceRoleId: crypto.randomUUID() }));
  const recorded = recordD1(env.DB);
  const result = await drainProviderWorkshopOutbox({ ...env, DB: recorded.db }, 'harbor', WORKSHOP_OUTBOX_MINUTE_BATCH);
  expect(result.drained).toBe(WORKSHOP_OUTBOX_MINUTE_BATCH);
  // Workers allow 1000 D1 queries per invocation; the minute cron shares it with rank work.
  expect(recorded.queries.length).toBeLessThanOrEqual(400);
});
