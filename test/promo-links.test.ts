import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { beforeEach, expect, it } from 'vitest';
import worker from '../src/index';
import { envWithAssets, resetDb } from './helpers';
import { opsMetrics } from '../src/ops-metrics';
import { promoTarget } from '../src/promo-links';
import links from '../config/promo-links.json';

beforeEach(resetDb);

async function visit(path: string, method = 'GET') {
  const ctx = createExecutionContext();
  const response = await worker.fetch(new Request(`https://sukisuki.ai${path}`, { method }), envWithAssets(), ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

it('redirects the published code with its exact original referral and campaign', async () => {
  const response = await visit('/go/bh-slime?ref=ATTACKER&utm_campaign=override&url=https://evil.test');
  expect(response.status).toBe(302);
  expect(response.headers.get('location')).toBe('/cards/100188?ref=94A9H94Z&utm_source=bahamut&utm_medium=forum&utm_campaign=bh-slime-20261106');
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await opsMetrics(env.DB)).toContain('hearthroom_promo_redirects_total{operation="redirect",outcome="success"} 1');
});

it.each(['missing', 'constructor', '__proto__', 'https%3A%2F%2Fevil.test'])('unknown code %s safely returns home', async code => {
  const response = await visit(`/go/${code}`);
  expect(response.status).toBe(302);
  expect(response.headers.get('location')).toBe('/');
  expect(await opsMetrics(env.DB)).toContain('hearthroom_promo_redirects_total{operation="redirect",outcome="unknown"} 1');
});

it.each(['/go', '/go/', '/go/missing/extra'])('malformed short path %s also returns home', async path => {
  const response = await visit(path);
  expect(response.status).toBe(302);
  expect(response.headers.get('location')).toBe('/');
  expect(response.headers.get('cache-control')).toBe('no-store');
});

it('HEAD uses the same temporary redirect', async () => {
  const response = await visit('/go/bh-slime', 'HEAD');
  expect(response.status).toBe(302);
  expect(response.headers.get('location')).toContain('/cards/100188?ref=94A9H94Z&');
});

it('a trailing slash uses the same short code', async () => {
  expect((await visit('/go/bh-slime/')).headers.get('location')).toBe(links['bh-slime']);
});

it('invalid configured targets fall back home and emit a bounded failure', async () => {
  const original = links['bh-slime'];
  try {
    links['bh-slime'] = '//evil.test/';
    const response = await visit('/go/bh-slime');
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/');
    expect(await opsMetrics(env.DB)).toContain('hearthroom_promo_redirects_total{operation="redirect",outcome="invalid"} 1');
  } finally { links['bh-slime'] = original; }
});

it.each(['plan', 'topup'])('preserves the existing /go/%s application page', async code => {
  const response = await visit(`/go/${code}`);
  expect(response.status).toBe(200);
  expect(response.headers.get('location')).toBeNull();
});

it.each(['https://evil.test/', '//evil.test/', '/\\evil.test', '/%2f%2fevil.test', '/%5cevil.test', '/a/..//evil.test', '/go/bh-slime', '/en/go/plan', '/%67o/topup', '/cards/100188%0d%0aLocation:evil', '/bad%'])('rejects unsafe configuration %s', value => {
  expect(promoTarget(value)).toBeNull();
});

it('all configured targets are safe local landings with attribution', () => {
  for (const value of Object.values(links)) {
    expect(promoTarget(value)).toBe(value);
    const url = new URL(value, 'https://sukisuki.ai');
    expect(url.origin).toBe('https://sukisuki.ai');
    expect(url.searchParams.get('ref')).toBe('94A9H94Z');
    expect(url.searchParams.get('utm_source')).toBe('bahamut');
    expect(url.searchParams.get('utm_medium')).toBe('forum');
    expect(url.searchParams.get('utm_campaign')).toBeTruthy();
  }
});

it.each([
  ['bh-bofuri', '/cards/100184', 'bh-bofuri-20261104'],
  ['bh-bofuri-indie', '/cards/100184', 'bh-bofuri-indie-20261105'],
  ['bh-howto-doujin', '/guide', 'bh-howto-doujin-20261104'],
  ['bh-intro', '/', 'bh-intro-20261105'],
  ['bh-novelsim-fantasy', '/cards/100216', 'bh-novelsim-fantasy-20261105'],
  ['bh-cli-dev', '/developers', 'bh-cli-dev-20261106'],
  ['bh-novelsim-mini', '/cards/100216', 'bh-novelsim-mini-20261106'],
])('serves the approved additional campaign %s', async (code, path, campaign) => {
  const response = await visit(`/go/${code}`);
  expect(response.status).toBe(302);
  expect(response.headers.get('location')).toBe(`${path}?ref=94A9H94Z&utm_source=bahamut&utm_medium=forum&utm_campaign=${campaign}`);
  expect(response.headers.get('cache-control')).toBe('no-store');
});
