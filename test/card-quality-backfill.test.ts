import { env } from 'cloudflare:test';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { backfillCardQualityLengths } from '../src/card-quality-backfill';
import { getCard, upsertCard } from '../src/cards';
import { opsMetrics } from '../src/ops-metrics';
import { makeMember, resetDb, role } from './helpers';

beforeEach(async () => {
  await resetDb();
  await env.DB.prepare("UPDATE card_quality_length_scan SET cursor_time=9007199254740991,cursor_id=0,lease='',run_after=0,priority_board=0,priority_ids='[]'").run();
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
  await env.DB.prepare("UPDATE card_quality_length_scan SET priority_board=16").run();
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

it('warms the weekly and monthly first screens before advancing the general sweep', async () => {
  const day = 86_400_000;
  const now = Date.now();
  for (let i = 0; i < 30; i++) await listed(`weekly-${i}`, now - day);
  await listed('visibility-stale', now - day);
  await listed('monthly', now - 20 * day);
  await listed('newest-off-screen', now - 10);
  const member = await makeMember(11);
  await env.DB.batch([
    env.DB.prepare("UPDATE cards SET heat=100 WHERE source_role_id LIKE 'weekly-%'"),
    env.DB.prepare("UPDATE cards SET heat=200 WHERE source_role_id='monthly'"),
    env.DB.prepare("UPDATE cards SET heat=300 WHERE source_role_id='visibility-stale'"),
    env.DB.prepare("INSERT INTO works VALUES(?,?,'harbor','visibility-stale',1)").bind('stale-work', member),
    env.DB.prepare(`INSERT INTO managed_work_access(work_id,provider,source_role_id,access,epoch,restriction,approved_role_id)
      VALUES('stale-work','harbor','visibility-stale','public',1,'none','sealed-visibility-stale')`),
  ]);
  const requested: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname;
    if (path.endsWith('/work-access/batch')) {
      const { items } = JSON.parse(String(init?.body)) as { items: { targetRoleId: string }[] };
      return Response.json({ items: items.map(item => ({
        ...item, managed: true, access: 'private', restriction: 'none', epoch: 2,
        approvedRoleId: item.targetRoleId, shareRoleId: '', targetReadable: false, listed: false,
      })) });
    }
    const id = path.split('/').at(-2)!;
    requested.push(id);
    if (requested.length === 1) return new Response(null, { status: 503 });
    return Response.json({ responses: {
      [`/role/detail?roleId=${id}`]: { roleDetailDesc: '正文'.repeat(700) },
      [`/worldbook/bindings?roleId=${id}`]: { bindings: [] },
      [`/role/author-asset?roleId=${id}`]: {},
    } });
  }));
  const local = { ...env, HOSTING_SERVICE_KEY: 'fixture-issuer' };
  await backfillCardQualityLengths(local, now);
  expect(requested).toHaveLength(10);
  expect(requested.every(id => id.startsWith('sealed-weekly-'))).toBe(true);
  await backfillCardQualityLengths(local, now + 60_000);
  expect(requested).toHaveLength(20);
  await backfillCardQualityLengths(local, now + 120_000);
  expect(new Set(requested).size).toBe(30);
  await backfillCardQualityLengths(local, now + 180_000);
  expect(requested.at(-1)).toBe(requested[0]);
  await backfillCardQualityLengths(local, now + 240_000);
  expect(requested.at(-1)).toBe('sealed-monthly');
  expect(requested).not.toContain('sealed-visibility-stale');
  expect(requested).not.toContain('sealed-newest-off-screen');
  expect((await env.DB.prepare('SELECT COUNT(*) AS total FROM card_quality_lengths').first())?.total).toBe(31);
  expect(await env.DB.prepare('SELECT cursor_id,priority_board FROM card_quality_length_scan').first())
    .toEqual({ cursor_id: 0, priority_board: 2 });
});
it('limits one scheduled minute to ten sealed reads across concurrent invocations', async () => {
  const now = Date.now();
  await env.DB.prepare("UPDATE card_quality_length_scan SET priority_board=16").run();
  for (let i = 0; i < 25; i++) await listed(`cap-${i}`, now - i);
  const fetchRevision = vi.fn(async () => new Response(null, { status: 404 }));
  vi.stubGlobal('fetch', fetchRevision);
  const local = { ...env, HOSTING_SERVICE_KEY: 'fixture-issuer' };
  await Promise.all([backfillCardQualityLengths(local, now), backfillCardQualityLengths(local, now)]);
  expect(fetchRevision).toHaveBeenCalledTimes(10);
  await backfillCardQualityLengths(local, now + 60_000);
  expect(fetchRevision).toHaveBeenCalledTimes(20);
});

it('warms a recently approved version from before rollout even when the general cursor is older', async () => {
  const now = Date.now();
  await listed('approved-from-old-submission', now - 2_000);
  await env.DB.prepare('UPDATE card_quality_length_scan SET priority_board=8,cursor_time=?,cursor_id=0')
    .bind(now - 86_400_000).run();
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const id = new URL(url).pathname.split('/').at(-2)!;
    return Response.json({ responses: {
      [`/role/detail?roleId=${id}`]: { roleDetailDesc: '正文'.repeat(700) },
      [`/worldbook/bindings?roleId=${id}`]: { bindings: [] },
      [`/role/author-asset?roleId=${id}`]: {},
    } });
  }));
  await backfillCardQualityLengths({ ...env, HOSTING_SERVICE_KEY: 'fixture-issuer' }, now);
  expect(await env.DB.prepare("SELECT total_chars FROM card_quality_lengths WHERE version_id='approved-from-old-submission'").first())
    .toEqual({ total_chars: 1_000 });
});
