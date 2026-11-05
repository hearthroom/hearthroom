import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { beforeEach, expect, it } from 'vitest';
import worker from '../src/index';
import { upsertCard } from '../src/cards';
import { envWithAssets, resetDb, role, rolesOnProviders } from './helpers';
import links from '../config/promo-links.json';

type Point = { indexes: string[]; blobs: string[]; doubles: number[] };
let points: Point[];
beforeEach(async () => {
  await resetDb();
  rolesOnProviders({});
  points = [];
  await upsertCard(env.DB, role({ roleId: 'promo-fixture', name: 'Fixture' }), Date.now());
});

async function visit(path: string, init?: RequestInit, files?: Record<string, string | Response>) {
  const ctx = createExecutionContext();
  const response = await worker.fetch(new Request('https://sukisuki.ai' + path, init), {
    ...envWithAssets(files),
    EVENTS: { writeDataPoint: (point: Point) => points.push(point) } as AnalyticsEngineDataset,
  }, ctx);
  await response.arrayBuffer();
  await waitOnExecutionContext(ctx);
  return response;
}

it('records each successful short code once without accepting request attribution overrides', async () => {
  const response = await visit('/go/bh-fate-fgo?utm_campaign=private-email@example.test&ref=PRIVATE', { headers: { 'User-Agent': 'Mozilla/5.0' } });
  expect(response.status).toBe(302);
  expect(response.headers.get('location')).toContain('utm_campaign=bh-fate-fgo-20261105');
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(points).toHaveLength(1);
  expect(points[0]!.blobs[0]).toBe('promo_redirect');
  expect(points[0]!.blobs[10]).toBe('bh-fate-fgo');
  expect(points[0]!.blobs[11]).toBe('success');
  expect(points[0]!.blobs[13]).toBe('get');
  expect(JSON.stringify(points)).not.toContain('PRIVATE');
  expect(JSON.stringify(points)).not.toContain('example.test');
});

it('preserves the exact configured response for every registered code with separate subjects', async () => {
  for (const [code, target] of Object.entries(links)) {
    points = [];
    const response = await visit('/go/' + code);
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(target);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(points).toHaveLength(1);
    expect(points[0]!.blobs[0]).toBe('promo_redirect');
    expect(points[0]!.blobs[10]).toBe(code);
  }
});

it('does not persist unknown codes or attribute HEAD and bots as promotional clicks', async () => {
  await visit('/go/private-user-12345');
  expect(points[0]!.blobs[0]).toBe('promo_redirect');
  expect(points[0]!.blobs[10]).toBe('');
  expect(points[0]!.blobs[11]).toBe('unknown');
  points = [];
  await visit('/go/bh-fate-fgo', { method: 'HEAD' });
  expect(points.some(point => point.blobs[0] === 'promo_redirect')).toBe(false);
  points = [];
  await visit('/go/bh-fate-fgo', { headers: { 'User-Agent': 'Twitterbot' } });
  expect(points[0]!.blobs[14]).toBe('bot');
  expect(points.some(point => point.blobs[0] === 'promo_redirect')).toBe(false);
  points = [];
  await visit('/cards/promo-fixture?utm_campaign=bh-fate-fgo-20261105', { headers: { 'User-Agent': 'Twitterbot' } });
  expect(points[0]!.blobs[15]).toBe('');
});

it('appends campaign at blob16 and separates campaigns on the same HTML page', async () => {
  for (const campaign of ['bh-fate-fgo-20261105', 'bh-fate-tm-20261105']) {
    points = [];
    const response = await visit('/cards/promo-fixture?utm_campaign=' + campaign, { headers: { Referer: 'https://forum.gamer.com.tw/' } });
    expect(response.status).toBe(200);
    expect(points).toHaveLength(1);
    expect(points[0]!.blobs).toHaveLength(16);
    expect(points[0]!.blobs[0]).toBe('page_html');
    expect(points[0]!.blobs[6]).toBe('forum.gamer.com.tw');
    expect(points[0]!.blobs[10]).toBe('promo-fixture');
    expect(points[0]!.blobs[15]).toBe(campaign);
  }
});

it.each(['email@example.test', 'unknown-but-valid-shape', 'x'.repeat(65), 'UPPER', 'bh-fate-fgo-20261105&utm_campaign=bh-fate-tm-20261105'])('drops unregistered, malformed, oversized or duplicate campaign %s', async campaign => {
  await visit('/cards/promo-fixture?utm_campaign=' + campaign);
  expect(points[0]!.blobs[15]).toBe('');
});

it('only attributes successful GET HTML; home and guide work without a card dimension', async () => {
  for (const path of ['/', '/guide']) {
    points = [];
    await visit(path + '?utm_campaign=bh-intro-20261105');
    expect(points.find(point => point.blobs[0] === 'page_html')!.blobs[15]).toBe('bh-intro-20261105');
  }
  for (const [path, init] of [
    ['/cards/promo-fixture', { method: 'HEAD' }],
    ['/v1/cards', {}],
    ['/assets/fixture.js', {}],
  ] as const) {
    points = [];
    await visit(path + '?utm_campaign=bh-intro-20261105', init, { '/assets/fixture.js': new Response('export default 1', { headers: { 'Content-Type': 'text/javascript' } }) });
    expect(points.every(point => point.blobs[15] === '')).toBe(true);
  }
});

it('does not accept a campaign field from the anonymous beacon body', async () => {
  await visit('/v1/e', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify([{ event: 'cta', campaign: 'private-person@example.test' }]) });
  expect(points).toHaveLength(1);
  expect(points[0]!.blobs[15]).toBe('');
  expect(JSON.stringify(points)).not.toContain('example.test');
});

it('keeps redirect responses when analytics is disabled, missing, or its background write throws', async () => {
  for (const extra of [{ ANALYTICS_ENABLED: 'false' }, { EVENTS: undefined }]) {
    const ctx = createExecutionContext();
    const response = await worker.fetch(new Request('https://sukisuki.ai/go/bh-fate-fgo'), {
      ...envWithAssets(), EVENTS: { writeDataPoint: (point: Point) => points.push(point) } as AnalyticsEngineDataset,
      ...extra,
    }, ctx);
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(302);
    expect(points).toHaveLength(0);
  }
  let attempts = 0;
  const failures: unknown[] = [];
  const ctx = createExecutionContext();
  const response = await worker.fetch(new Request('https://sukisuki.ai/go/bh-fate-fgo'), {
    ...envWithAssets(), EVENTS: { writeDataPoint: () => { attempts++; throw new Error('synthetic AE failure'); } } as AnalyticsEngineDataset,
  }, { ...ctx, waitUntil: promise => ctx.waitUntil(promise.catch(error => { failures.push(error); })) });
  expect(response.status).toBe(302);
  await waitOnExecutionContext(ctx);
  expect(attempts).toBe(1);
  expect(failures).toHaveLength(1);
});
