import { expect, it } from 'vitest';
import links from '../../config/promo-links.json';
import { gaCampaign } from '../src/lib/ga4-payload';
import { refFromQuery, rememberShareRef, pendingShareRef } from '../src/lib/share-ref';

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
