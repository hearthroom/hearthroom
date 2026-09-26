/**
 * Official serving domains. Keep routing, sandboxes and card apps in one family.
 * The first one is the primary: search-engine canonical, default card-app host, and the one zone
 * that converts card thumbnails for every domain (owner 2026-09-26: primary moves to sukisuki.ai;
 * the others keep serving, no cross-domain redirect, so nobody is signed out).
 */
export const SITE_HOSTS = ['sukisuki.ai', 'hearthroom.club', 'sukisuki.chat'] as const;
export const PRIMARY_HOST = SITE_HOSTS[0];
export function siteRootOf(hostname: string): string | undefined {
  return SITE_HOSTS.find(root => [root, `www.${root}`, `play.${root}`].includes(hostname.toLowerCase()));
}
export const isCardAppHost = (hostname: string): boolean =>
  SITE_HOSTS.some(root => hostname.toLowerCase() === `play.${root}`);
export const SANDBOX_HOST_RE = new RegExp(
  `^c([a-z0-9-]+)\\.(${SITE_HOSTS.map(host => host.replaceAll('.', '\\.')).join('|')})$`, 'i',
);
export const SANDBOX_PARENT_ORIGINS = SITE_HOSTS.flatMap(root =>
  [root, `www.${root}`, `play.${root}`].map(host => `https://${host}`),
);
