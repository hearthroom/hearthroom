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

const MALIANG_CODES = [
  'bh-maple-85994', 'bh-hut-maple', 'vc-maple', 'bh-maple-gal',
  'bh-sanguo-6331', 'bh-hut-sanguo', 'vc-sanguo', 'bh-sanguo-indie',
  'bh-hut-fanren', 'vc-fanren', 'bh-fanren-indie',
];

it('all configured targets are safe local landings with attribution', () => {
  for (const [code, value] of Object.entries(links)) {
    expect(promoTarget(value)).toBe(value);
    const url = new URL(value, 'https://sukisuki.ai');
    expect(url.origin).toBe('https://sukisuki.ai');
    const authorRef = ['bh-fate-tm', 'bh-fate-fgo'].includes(code) ? 'UVTEJ3N6'
      : ['bh-trpg-dnd', 'bh-dnd-2206', 'bh-dnd-bg3', 'bh-dnd-indie', 'bh-dnd-trpg-actions-20261113', 'bh-dnd-ai-start-20261118'].includes(code) ? 'H2DG5Q6Y'
      : MALIANG_CODES.includes(code) ? '6M9ZV5FS' : '94A9H94Z';
    expect(url.searchParams.get('ref')).toBe(authorRef);
    const [source, medium] = code.startsWith('vc-') ? ['vocus', 'blog']
      : code.startsWith('bh-hut-') ? ['bahamut', 'cabin'] : ['bahamut', 'forum'];
    expect(url.searchParams.get('utm_source')).toBe(source);
    expect(url.searchParams.get('utm_medium')).toBe(medium);
    expect(url.searchParams.get('utm_campaign')).toBeTruthy();
  }
});

it.each([
  ['bh-hut-dal', 'bahamut', 'cabin'],
  ['vc-dal', 'vocus', 'blog'],
])('serves the approved Date A Live blog campaign %s', async (code, source, medium) => {
  const response = await visit(`/go/${code}?ref=ATTACKER&utm_source=override&utm_medium=override&utm_campaign=override`);
  expect(response.status).toBe(302);
  expect(response.headers.get('location')).toBe(`/cards/100194?ref=94A9H94Z&utm_source=${source}&utm_medium=${medium}&utm_campaign=${code}-20261106`);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await opsMetrics(env.DB)).toContain('hearthroom_promo_redirects_total{operation="redirect",outcome="success"} 1');
});

it.each([
  ['vc-howto-doujin', '/guide'],
  ['vc-intro', '/'],
])('keeps the approved Vocus destination and attribution for %s', async (code, path) => {
  const response = await visit(`/go/${code}?ref=ATTACKER&utm_source=override&utm_medium=override&utm_campaign=override&url=https://evil.test`);
  expect(response.status).toBe(302);
  expect(response.headers.get('location')).toBe(`${path}?ref=94A9H94Z&utm_source=vocus&utm_medium=blog&utm_campaign=${code}-20261106`);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await opsMetrics(env.DB)).toContain('hearthroom_promo_redirects_total{operation="redirect",outcome="success"} 1');
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

it.each([
  ['bh-fate-tm', 'bh-fate-tm-20261105'],
  ['bh-fate-fgo', 'bh-fate-fgo-20261105'],
])('keeps the approved author referral for %s', async (code, campaign) => {
  const response = await visit(`/go/${code}?ref=94A9H94Z`);
  expect(response.status).toBe(302);
  expect(response.headers.get('location')).toBe(`/cards/100376?ref=UVTEJ3N6&utm_source=bahamut&utm_medium=forum&utm_campaign=${campaign}`);
  expect(response.headers.get('cache-control')).toBe('no-store');
});

it.each([
  ['bh-trpg-dnd', 'bh-trpg-dnd-20261105'],
  ['bh-dnd-2206', 'bh-dnd-2206-20261105'],
  ['bh-dnd-bg3', 'bh-dnd-bg3-20261106'],
])('keeps the approved D&D author referral for %s', async (code, campaign) => {
  const response = await visit(`/go/${code}?ref=94A9H94Z&utm_campaign=override`);
  expect(response.status).toBe(302);
  expect(response.headers.get('location')).toBe(`/cards/100192?ref=H2DG5Q6Y&utm_source=bahamut&utm_medium=forum&utm_campaign=${campaign}`);
  expect(response.headers.get('cache-control')).toBe('no-store');
});

// Approved marketing plan (2026-11-05): each referral is the card author's code.
it.each([
  ['bh-dnd-indie', '/cards/100192', 'H2DG5Q6Y'],
  ['bh-tiandao-mcs', '/cards/100169', '94A9H94Z'],
  ['bh-tiandao-ynxy', '/cards/100169', '94A9H94Z'],
  ['bh-tiandao-ggbh', '/cards/100169', '94A9H94Z'],
  ['bh-bofuri-novel', '/cards/100184', '94A9H94Z'],
  ['bh-mona-ai', '/cards/100271', '94A9H94Z'],
])('serves the approved November 6 author campaign %s', async (code, path, ref) => {
  const response = await visit(`/go/${code}?ref=ATTACKER&utm_campaign=override`);
  expect(response.status).toBe(302);
  expect(response.headers.get('location')).toBe(`${path}?ref=${ref}&utm_source=bahamut&utm_medium=forum&utm_campaign=${code}-20261106`);
  expect(response.headers.get('cache-control')).toBe('no-store');
});
it.each([
  ['bh-dal-indie', '20261107'],
  ['bh-dal-galgame', '20261108'],
  ['bh-dal-webgame', '20261109'],
])('serves the approved Date A Live board campaign %s', async (code, date) => {
  const response = await visit(`/go/${code}?ref=ATTACKER&utm_campaign=override&url=https://evil.test`);
  expect(response.status).toBe(302);
  expect(response.headers.get('location')).toBe(`/cards/100194?ref=94A9H94Z&utm_source=bahamut&utm_medium=forum&utm_campaign=${code}-${date}`);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await opsMetrics(env.DB)).toContain('hearthroom_promo_redirects_total{operation="redirect",outcome="success"} 1');
});

it.each([
  ['bh-maple-85994', '/cards/100218', 'bahamut', 'forum', '20261108'],
  ['bh-hut-maple', '/cards/100218', 'bahamut', 'cabin', '20261108'],
  ['vc-maple', '/cards/100218', 'vocus', 'blog', '20261108'],
  ['bh-maple-gal', '/cards/100218', 'bahamut', 'forum', '20261112'],
  ['bh-sanguo-6331', '/cards/100240', 'bahamut', 'forum', '20261108'],
  ['bh-hut-sanguo', '/cards/100240', 'bahamut', 'cabin', '20261108'],
  ['vc-sanguo', '/cards/100240', 'vocus', 'blog', '20261108'],
  ['bh-sanguo-indie', '/cards/100240', 'bahamut', 'forum', '20261111'],
  ['bh-hut-fanren', '/cards/100257', 'bahamut', 'cabin', '20261110'],
  ['vc-fanren', '/cards/100257', 'vocus', 'blog', '20261110'],
  ['bh-fanren-indie', '/cards/100257', 'bahamut', 'forum', '20261110'],
])('serves the approved three-cards campaign %s', async (code, path, source, medium, date) => {
  const response = await visit(`/go/${code}?ref=ATTACKER&utm_campaign=override&url=https://evil.test`);
  expect(response.status).toBe(302);
  expect(response.headers.get('location')).toBe(`${path}?ref=6M9ZV5FS&utm_source=${source}&utm_medium=${medium}&utm_campaign=${code}-${date}`);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await opsMetrics(env.DB)).toContain('hearthroom_promo_redirects_total{operation="redirect",outcome="success"} 1');
});

it.each([
  ['bh-dnd-trpg-actions-20261113', '/cards/100192', 'H2DG5Q6Y'],
  ['bh-slime-village-20261115', '/cards/100188', '94A9H94Z'],
  ['bh-bofuri-operator-20261116', '/cards/100184', '94A9H94Z'],
  ['bh-dnd-ai-start-20261118', '/cards/100192', 'H2DG5Q6Y'],
])('serves the approved four-day Bahamut plan code %s', async (code, path, ref) => {
  const response = await visit(`/go/${code}?ref=ATTACKER&utm_campaign=override&url=https://evil.test`);
  expect(response.status).toBe(302);
  expect(response.headers.get('location')).toBe(`${path}?ref=${ref}&utm_source=bahamut&utm_medium=forum&utm_campaign=${code}`);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await opsMetrics(env.DB)).toContain('hearthroom_promo_redirects_total{operation="redirect",outcome="success"} 1');
});
