import type { Context } from 'hono';
import links from '../config/promo-links.json';
import { bumpOp } from './ops-metrics';
import { clientKind, note, type Pending } from './analytics';
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

type PromoContext = Context<{ Bindings: Env; Variables: { ev: Pending } }>;
function redirect(c: PromoContext, target: string, outcome: 'success' | 'unknown' | 'invalid', code = '') {
  c.executionCtx.waitUntil(bumpOp(c.env.DB, 'promo_redirect', 'redirect', outcome));
  if (c.req.method === 'GET' && clientKind(c.req.header('User-Agent')) !== 'bot') {
    note(c, { event: 'promo_redirect', subject: code, outcome, detail: 'get' });
  }
  c.header('Cache-Control', 'no-store');
  return c.redirect(target, 302);
}
/** Use the parent context so its one pending AE event receives the code. */
export function promoRedirect(c: PromoContext) {
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') return redirect(c, '/', 'unknown');
  const match = /^\/go\/([^/]+)\/?$/.exec(c.req.path);
  let code = '';
  try { code = match ? decodeURIComponent(match[1]!) : ''; } catch { /* Unknown malformed code. */ }
  const known = /^[a-z0-9][a-z0-9-]{0,63}$/.test(code) && Object.hasOwn(links, code);
  const target = known ? promoTarget(links[code as keyof typeof links]) : null;
  return redirect(c, target ?? '/', known ? target ? 'success' : 'invalid' : 'unknown', known ? code : '');
}

export const isPromoPurchasePath = (path: string) => /^\/go\/(?:plan|topup)\/?$/.test(path);
