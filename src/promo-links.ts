import { Hono } from 'hono';
import links from '../config/promo-links.json';
import { bumpOp } from './ops-metrics';
import type { Env } from './types';

const ORIGIN = 'https://sukisuki.ai';

/** Configuration is path-only; request query parameters never choose the target. */
export function promoTarget(value: unknown): string | null {
  if (typeof value !== 'string' || !value.startsWith('/')) return null;
  try {
    const decoded = decodeURIComponent(value);
    if (/^[\/]{2}|[\\\s\u0000-\u001f\u007f]/.test(decoded)) return null;
    const url = new URL(value, ORIGIN);
    if (url.origin !== ORIGIN || url.pathname.startsWith('//')) return null;
    const path = decodeURIComponent(url.pathname);
    // Short-link chains (including the existing purchase handoffs) are not landing pages.
    if (/^\/(?:zh-Hant\/|zh-Hans\/|en\/|ja\/|ko\/)?go(?:\/|$)/.test(path)) return null;
    return url.pathname + url.search + url.hash;
  } catch { return null; }
}

export const promoLinkRoutes = new Hono<{ Bindings: Env }>({ strict: false });
promoLinkRoutes.get('/go/:code', c => {
  const code = c.req.param('code');
  const known = /^[a-z0-9][a-z0-9-]{0,63}$/.test(code) && Object.hasOwn(links, code);
  const target = known ? promoTarget(links[code as keyof typeof links]) : null;
  c.executionCtx.waitUntil(bumpOp(c.env.DB, 'promo_redirect', 'redirect', known ? target ? 'success' : 'invalid' : 'unknown'));
  c.header('Cache-Control', 'no-store');
  return c.redirect(target ?? '/', 302);
});

export const isPromoPurchasePath = (path: string) => /^\/go\/(?:plan|topup)\/?$/.test(path);
