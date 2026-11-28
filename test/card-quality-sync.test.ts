import { env } from 'cloudflare:workers';
import { opsMetrics } from '../src/ops-metrics';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { syncCardQualityPlay } from '../src/card-quality-play-sync';

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM cards WHERE id BETWEEN 100001 AND 100101').run();
  await env.DB.prepare("UPDATE card_quality_play_sync SET cursor=0,lease='',lease_until=0 WHERE singleton=1").run();
});

describe('card quality play cron', () => {
  it('rejects incomplete source responses, retains the snapshot and releases its lease', async () => {
    await env.DB.prepare(`INSERT INTO cards (id, provider, source_role_id, author_num_id, author_name, status, registered_at, last_synced_at)
      VALUES (100001, 'harbor', '07c5473a-bffc-47e7-a80e-1d87aa423d65', 11, 'Fixture', 'approved', 1, 1)`).run();
    const read = vi.fn().mockResolvedValueOnce({}).mockResolvedValueOnce({
      '07c5473a-bffc-47e7-a80e-1d87aa423d65': { players: 20, reached: 12, medianTurns: 5 },
    });
    const deps = { read, now: () => 1_000 };
    await expect(syncCardQualityPlay(env, deps)).rejects.toThrow();
    expect(await env.DB.prepare('SELECT cursor, lease_until FROM card_quality_play_sync WHERE singleton=1').first()).toEqual({ cursor: 0, lease_until: 0 });
    await expect(syncCardQualityPlay(env, deps)).resolves.toBe('ok');
    expect(await env.DB.prepare('SELECT players, reached, median_turns FROM card_quality_play WHERE card_id=100001').first()).toEqual({ players: 20, reached: 12, median_turns: 5 });
    expect(await opsMetrics(env.DB)).toContain('hearthroom_card_quality_play_sync_total{operation="run",outcome="error"} 1');
    expect(await opsMetrics(env.DB)).toContain('hearthroom_card_quality_play_sync_total{operation="run",outcome="ok"} 1');
  });
});

it('keeps an in-flight page exclusive and rejects an obsolete hosted binding', async () => {
  const role = '3be5c7c3-8645-4278-b408-71036b51fda1';
  const replacement = '81dacf53-987c-4006-b631-dc512f7a0c05';
  await env.DB.prepare(`INSERT INTO cards (id, provider, source_role_id, author_num_id, author_name, status, registered_at, last_synced_at)
    VALUES (100001, 'harbor', ?, 11, 'Fixture', 'approved', 1, 1)`).bind(role).run();
  let markEntered!: () => void;
  const entered = new Promise<void>(resolve => { markEntered = resolve; });
  let finishRead!: (snapshot: Record<string, { players: number; reached: number; medianTurns: number }>) => void;
  const response = new Promise<Parameters<typeof finishRead>[0]>(resolve => { finishRead = resolve; });
  const read = vi.fn(() => { markEntered(); return response; });
  const now = () => 1_000;
  const first = syncCardQualityPlay(env, { read, now });
  await entered;
  try {
    await expect(syncCardQualityPlay(env, { read, now })).resolves.toBe('busy');
    await env.DB.prepare('UPDATE cards SET approved_hosted_role_id=? WHERE id=100001').bind(replacement).run();
  } finally {
    finishRead({ [role]: { players: 20, reached: 19, medianTurns: 6 } });
    await first;
  }
  expect(read).toHaveBeenCalledOnce();
  expect(await env.DB.prepare('SELECT card_id FROM card_quality_play WHERE card_id=100001').first()).toBeNull();
  await syncCardQualityPlay(env, { now, read: async () => ({ [replacement]: { players: 0, reached: 0, medianTurns: null } }) });
  expect(await env.DB.prepare('SELECT players, reached, median_turns FROM card_quality_play WHERE card_id=100001').first()).toEqual({ players: 0, reached: 0, median_turns: 0 });
});

it('allows a later page to refresh when an earlier page cannot be read', async () => {
  await env.DB.prepare(`WITH RECURSIVE ids(id) AS (
      SELECT 100001 UNION ALL SELECT id+1 FROM ids WHERE id<100101
    )
    INSERT INTO cards (id, provider, source_role_id, author_num_id, author_name, status, registered_at, last_synced_at)
    SELECT id,'harbor',printf('00000000-0000-4000-8000-%012d',id),11,'Fixture','approved',1,1 FROM ids`).run();
  const finalRole = '00000000-0000-4000-8000-000000100101';
  const read = vi.fn().mockRejectedValueOnce(new Error('unavailable page')).mockResolvedValueOnce({
    [finalRole]: { players: 20, reached: 10, medianTurns: 4.5 },
  });
  const deps = { read, now: () => 1_000 };
  await expect(syncCardQualityPlay(env, deps)).rejects.toThrow('unavailable page');
  expect(await env.DB.prepare('SELECT cursor FROM card_quality_play_sync WHERE singleton=1').first()).toEqual({ cursor: 100100 });
  await expect(syncCardQualityPlay(env, deps)).resolves.toBe('ok');
  expect(read).toHaveBeenLastCalledWith([finalRole]);
  expect(await env.DB.prepare('SELECT reached,median_turns FROM card_quality_play WHERE card_id=100101').first())
    .toEqual({ reached: 10, median_turns: 4.5 });
  expect(await env.DB.prepare('SELECT cursor FROM card_quality_play_sync WHERE singleton=1').first()).toEqual({ cursor: 0 });
});
