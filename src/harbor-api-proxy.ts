import { siteRootOf } from '../shared/site-hosts';
import type { Env } from './types';

export const HARBOR_PROXY_PREFIX = '/hh-api';
const HARBOR_ORIGIN = 'https://api.harperharbor.com';
export const PROXY_ROUTES = ['conversation', 'media', 'profile', 'wallet', 'oauth', 'other'] as const;
export type ProxyRoute = typeof PROXY_ROUTES[number];

export function proxyRoute(path: string): ProxyRoute {
  if (path === '/oauth/token' || path === '/oauth/revoke') return 'oauth';
  if (path.startsWith('/open/v1/conversation/')) return 'conversation';
  if (/^\/open\/v1\/(media|image|uploads?)(\/|$)/.test(path)) return 'media';
  if (/^\/open\/v1\/(?:me\/)?(wallet|credits)(\/|$)/.test(path)) return 'wallet';
  if (/^\/open\/v1\/me(\/|$)/.test(path)) return 'profile';
  return 'other';
}

/** Bearer-only public transport. Never expose Harbor's cookie-authenticated Console routes. */
export async function proxyHarborApi(request: Request, env: Env): Promise<Response> {
  const incoming = new URL(request.url);
  const path = incoming.pathname.slice(HARBOR_PROXY_PREFIX.length);
  if (!siteRootOf(incoming.hostname) || !incoming.pathname.startsWith(`${HARBOR_PROXY_PREFIX}/`)
    || /%2f|%5c|\\/i.test(path)
    || !(path.startsWith('/open/v1/') || path === '/oauth/token' || path === '/oauth/revoke')) {
    return Response.json({ error: 'not_found' }, { status: 404 });
  }
  const client = request.headers.get('CF-Connecting-IP');
  if (!env.HARBOR_EDGE_PROXY_SECRET || !client) {
    return Response.json({ error: 'temporarily_unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
  const target = new URL(HARBOR_ORIGIN);
  target.pathname = path;
  target.search = incoming.search;
  const headers = new Headers(request.headers);
  // Site cookies belong to Hearthroom; the upstream uses the forwarded bearer.
  // Discard caller-supplied provenance before attaching the authenticated claim.
  for (const name of ['Host', 'Cookie', 'X-Real-IP', 'X-Forwarded-For', 'Forwarded', 'X-Harbor-Client-IP', 'X-Harbor-Edge-Secret']) headers.delete(name);
  headers.set('X-Harbor-Client-IP', client);
  headers.set('X-Harbor-Edge-Secret', env.HARBOR_EDGE_PROXY_SECRET);
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
