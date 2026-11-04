import { afterEach, expect, it, vi } from 'vitest';
import links from '../../config/promo-links.json';
import { gaCampaign } from '../src/lib/ga4-payload';
import { refFromQuery, rememberShareRef, pendingShareRef } from '../src/lib/share-ref';
import { createGa4 } from '../src/lib/ga4';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('every configured landing sends the original campaign and saves the referral', () => {
  for (const path of Object.values(links)) {
    const url = new URL(path, 'https://sukisuki.ai');
    expect(gaCampaign(url.href)).toEqual({
      campaign_source: url.searchParams.get('utm_source'),
      campaign_medium: url.searchParams.get('utm_medium'),
      campaign_name: url.searchParams.get('utm_campaign'),
    });
    rememberShareRef(refFromQuery(url.searchParams.get('ref'))!);
    expect(pendingShareRef()?.code).toBe('94A9H94Z');
  }
});

it('initializes actual GA4 commands from the landing snapshot after referral cleanup', () => {
  const landingUrl = 'https://sukisuki.ai' + links['bh-slime'];
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
    campaign_source: 'bahamut', campaign_medium: 'forum', campaign_name: 'bh-slime-20261106',
    page_location: 'https://sukisuki.ai/cards/_',
  });
  expect(JSON.stringify(ga.commands())).not.toContain('94A9H94Z');
});
