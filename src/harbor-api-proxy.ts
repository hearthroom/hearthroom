import { siteRootOf } from '../shared/site-hosts';
import type { Env } from './types';

export const HARBOR_PROXY_PREFIX = '/hh-api';
const HARBOR_ORIGIN = 'https://api.harperharbor.com';
export const PROXY_ROUTES = ['conversation', 'media', 'profile', 'wallet', 'oauth', 'other'] as const;
export type ProxyRoute = typeof PROXY_ROUTES[number];
const FORWARDED_HEADERS = [
  'Authorization', 'Content-Type', 'Accept', 'Accept-Language', 'User-Agent', 'Origin', 'Sec-GPC', 'language',
  'X-Device-Token', 'X-Client-Platform', 'X-API-Version', 'X-From', 'Idempotency-Key', 'Last-Event-ID',
  'Range', 'If-Match', 'If-None-Match', 'If-Modified-Since', 'If-Unmodified-Since',
  'Upgrade', 'Connection', 'Sec-WebSocket-Key', 'Sec-WebSocket-Version', 'Sec-WebSocket-Protocol', 'Sec-WebSocket-Extensions',
] as const;

export function proxyRoute(path: string): ProxyRoute {
  path=reviewTarget(path)?.path??path;
  if (path === '/oauth/token' || path === '/oauth/revoke') return 'oauth';
  if (path.startsWith('/open/v1/conversation/')) return 'conversation';
  if (/^\/open\/v1\/(media|image|uploads?)(\/|$)/.test(path)) return 'media';
  if (/^\/open\/v1\/(?:me\/)?(wallet|credits)(\/|$)/.test(path)) return 'wallet';
  if (/^\/open\/v1\/me(\/|$)/.test(path)) return 'profile';
  return 'other';
}

function reviewTarget(path:string):{path:string;reviewId:string}|null {
 const match=path.match(/^\/reviews\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(\/open\/v1\/.*)$/i);
 return match?{reviewId:match[1],path:match[2]}:null;
}

export function allowedHarborProxyRequest(request: Request): boolean {
  const incoming = new URL(request.url);
  const path = incoming.pathname.slice(HARBOR_PROXY_PREFIX.length);
  return !!siteRootOf(incoming.hostname) && incoming.pathname.startsWith(`${HARBOR_PROXY_PREFIX}/`)
    && !/%2f|%5c|\\/i.test(path)
    && (path.startsWith('/open/v1/') || !!reviewTarget(path) || path === '/oauth/token' || path === '/oauth/revoke');
}

/** Bearer-only public transport. Never expose Harbor's cookie-authenticated Console routes. */
export async function proxyHarborApi(request: Request, env: Env): Promise<Response> {
  const incoming = new URL(request.url);
  const path = incoming.pathname.slice(HARBOR_PROXY_PREFIX.length);
  if (!allowedHarborProxyRequest(request)) {
    return Response.json({ error: 'not_found' }, { status: 404 });
  }
  const client = request.headers.get('CF-Connecting-IP');
  if (!env.HARBOR_HEARTHROOM_PROXY_SECRET || !client) {
    return Response.json({ error: 'temporarily_unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
  const target = new URL(HARBOR_ORIGIN);
  const review=reviewTarget(path);
  target.pathname = review?.path??path;
  target.search = incoming.search;
  // Only documented browser/public-API headers cross this boundary. Site cookies,
  // internal service keys and caller-supplied provenance are never copied.
  const headers = new Headers();
  for (const name of FORWARDED_HEADERS) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  // The selector is untrusted: Provider checks the actual OAuth viewer with the issuer.
  if(review)headers.set('X-Hearthroom-Review',review.reviewId);
  const country = request.cf?.country;
  if (typeof country === 'string' && /^[A-Z]{2}$/.test(country)) headers.set('CF-IPCountry', country);
  headers.set('X-Harbor-Client-IP', client);
  headers.set('X-Harbor-Edge-Secret', env.HARBOR_HEARTHROOM_PROXY_SECRET);
  try {
    const upstream = await fetch(new Request(target, {
      method: request.method, headers, redirect: 'manual', signal: request.signal,
      body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
    }));
    const responseHeaders = new Headers(upstream.headers);
    responseHeaders.delete('Set-Cookie');
    responseHeaders.set('Cache-Control', 'private, no-store');
    // Keep the stream and upgrade object intact; neither direction is buffered.
    return new Response(upstream.body, {
      status: upstream.status, statusText: upstream.statusText, headers: responseHeaders,
      ...(upstream.status === 101 ? { webSocket: upstream.webSocket } : {}),
    });
  } catch {
    return Response.json({ error: 'temporarily_unavailable' }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
}
