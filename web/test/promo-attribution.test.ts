import { afterEach, expect, it, vi } from 'vitest';
import links from '../../config/promo-links.json';
import { gaCampaign } from '../src/lib/ga4-payload';
import { refFromQuery, rememberShareRef, pendingShareRef } from '../src/lib/share-ref';
import { createGa4 } from '../src/lib/ga4';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const MALIANG_CODES = [
  'bh-maple-85994', 'bh-hut-maple', 'vc-maple', 'bh-maple-gal',
  'bh-sanguo-6331', 'bh-hut-sanguo', 'vc-sanguo', 'bh-sanguo-indie',
  'bh-hut-fanren', 'vc-fanren', 'bh-fanren-indie', 'dcard-fanren',
];

it('every configured landing sends the original campaign and saves the referral', () => {
  for (const [code, path] of Object.entries(links)) {
    const url = new URL(path, 'https://sukisuki.ai');
    expect(gaCampaign(url.href)).toEqual({
      campaign_source: url.searchParams.get('utm_source'),
      campaign_medium: url.searchParams.get('utm_medium'),
      campaign_name: url.searchParams.get('utm_campaign'),
    });
    rememberShareRef(refFromQuery(url.searchParams.get('ref'))!);
    const expectedRef = ['bh-fate-tm', 'bh-fate-fgo'].includes(code) ? 'UVTEJ3N6'
      : ['bh-trpg-dnd', 'bh-dnd-2206', 'bh-dnd-bg3', 'bh-dnd-indie', 'bh-dnd-trpg-actions-20261113', 'bh-dnd-ai-start-20261118'].includes(code) ? 'H2DG5Q6Y'
      : MALIANG_CODES.includes(code) ? '6M9ZV5FS' : '94A9H94Z';
    expect(pendingShareRef()?.code).toBe(expectedRef);
  }
});

it.each([
  ['bh-slime', '94A9H94Z', 'bh-slime-20261106', 'bahamut', 'forum', '/cards/_'],
  ['bh-fate-tm', 'UVTEJ3N6', 'bh-fate-tm-20261105', 'bahamut', 'forum', '/cards/_'],
  ['vc-howto-doujin', '94A9H94Z', 'vc-howto-doujin-20261106', 'vocus', 'blog', '/guide'],
  ['vc-intro', '94A9H94Z', 'vc-intro-20261106', 'vocus', 'blog', '/'],
])('initializes sanitized GA4 commands for %s after referral cleanup', (code, ref, campaign, source, medium, page) => {
  const landingUrl = 'https://sukisuki.ai' + links[code as keyof typeof links];
  const cleaned = new URL(landingUrl);
  cleaned.searchParams.delete('ref');
  vi.stubGlobal('location', cleaned);
  vi.stubGlobal('navigator', { userAgent: 'Test', globalPrivacyControl: false });
  const append = document.head.appendChild.bind(document.head);
  vi.spyOn(document.head, 'appendChild').mockImplementation(node => {
    if (node instanceof HTMLScriptElement) node.type = 'text/plain';
    return append(node);
  });
  const ga = createGa4();
  ga.start(true, { landingUrl });
  expect(ga.commands().find(c => c[0] === 'config')?.[2]).toMatchObject({
    campaign_source: source, campaign_medium: medium, campaign_name: campaign,
    page_location: 'https://sukisuki.ai' + page,
  });
  expect(JSON.stringify(ga.commands())).not.toContain(ref);
});
