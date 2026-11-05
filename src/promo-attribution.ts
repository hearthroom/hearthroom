import links from '../config/promo-links.json';

const CAMPAIGN = /^[a-z0-9][a-z0-9-]{0,63}$/;
// Register campaigns in the existing operational link table, including direct links.
// A finite allowlist keeps arbitrary query strings and personal data out of AE.
const campaigns = new Set(Object.values(links).flatMap(target => {
  try {
    const values = new URL(target, 'https://sukisuki.ai').searchParams.getAll('utm_campaign');
    return values.length === 1 && CAMPAIGN.test(values[0]!) ? values : [];
  } catch { return []; }
}));

export function promoCampaign(url: URL): string {
  const values = url.searchParams.getAll('utm_campaign');
  const value = values[0] ?? '';
  return values.length === 1 && CAMPAIGN.test(value) && campaigns.has(value) ? value : '';
}
