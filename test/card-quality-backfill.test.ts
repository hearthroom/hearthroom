import { env } from 'cloudflare:test';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { backfillCardQualityLengths } from '../src/card-quality-backfill';
import { getCard, upsertCard } from '../src/cards';
import { opsMetrics } from '../src/ops-metrics';
import { resetDb, role } from './helpers';

beforeEach(async () => {
  await resetDb();
  await env.DB.prepare("UPDATE card_quality_length_scan SET cursor_time=9007199254740991,cursor_id=0,lease='',run_after=0").run();
});
afterEach(() => vi.unstubAllGlobals());

async function listed(source: string, timestamp: number, sealed = true) {
  await upsertCard(env.DB, role({ roleId: source, authorNumId: 11 }), timestamp, { status: 'approved' });
  const card = (await getCard(env.DB, source))!;
  if (!sealed) return;
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO hosting_versions(version_id,work_id,member_id,operation_id,source_role_id,provider,hosted_revision_id,card_id,state,created_at)
      VALUES(?,?, 'author',?,?,'harbor',?,?,'approved',?)`).bind(source, source, source, source, `sealed-${source}`, card.id, timestamp),
    env.DB.prepare('UPDATE cards SET approved_version_id=?,approved_hosted_role_id=? WHERE id=?').bind(source, `sealed-${source}`, card.id),
  ]);
}

it('backs up approved versions newest first with one active sweep, bounded failures and aggregate metrics', async () => {
  const now = Date.now();
  await listed('older', now - 20);
  await listed('legacy-without-seal', now - 10, false);
  await listed('newest', now - 5);
  const requests: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname;
    const id = path.split('/').at(-2)!;
    expect(path).toBe(`/open/v1/hosting/revisions/${id}/review`);
    expect(new Headers(init?.headers).get('X-Hosting-Key')).toBe('fixture-issuer');
    requests.push(id);
    if (id === 'sealed-older') return new Response(null, { status: 404 });
    return Response.json({ responses: {
      [`/role/detail?roleId=${id}`]: { roleDetailDesc: '秘密'.repeat(720), roleWelcome: '開'.repeat(1100) },
      [`/worldbook/bindings?roleId=${id}`]: { bindings: [{ worldbookId: 'book' }] },
      '/worldbook/detail?worldbookId=book': { name: 'Private fixture' },
      '/worldbook/entry/list?worldbookId=book': { entries: [
        { name: 'a', content: '地'.repeat(800), matchOptions: { groupId: 'same-entry' } },
        { name: 'b', content: '海'.repeat(1200), matchOptions: { groupId: 'same-entry' } },
      ] },
      [`/role/author-asset?roleId=${id}`]: { openingPageBytes: 640000 },
    } });
  }));
  const local = { ...env, HOSTING_SERVICE_KEY: 'fixture-issuer' };
  await Promise.all([backfillCardQualityLengths(local, now), backfillCardQualityLengths(local, now)]);
  expect(requests).toEqual(['sealed-newest', 'sealed-older']);
  expect((await env.DB.prepare('SELECT * FROM card_quality_lengths').all()).results).toEqual([{
    version_id: 'newest', total_chars: 5000, setting_chars: 1000, worldbook_entries: 1, worldbook_chars: 2000,
    opening_count: 1, opening_chars: 1000, opening_page: 1, display_rules: 0, panel: 0,
  }]);
  const metrics = await opsMetrics(env.DB);
  expect(metrics).toContain('hearthroom_card_quality_length_total{operation="backfill",outcome="success"} 1');
  expect(metrics).toContain('hearthroom_card_quality_length_total{operation="backfill",outcome="error"} 1');
  expect(metrics).toMatch(/hearthroom_card_quality_length_duration_milliseconds_total\{operation="backfill",outcome="elapsed"} \d+/);
  await backfillCardQualityLengths(local, now + 3_600_000);
  expect(requests).toEqual(['sealed-newest', 'sealed-older', 'sealed-older']);
});
