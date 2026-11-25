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

// 開場網頁的原始上傳（PUT /open/v1/role/{roleId}/opening-page）：上游要 Content-Length，沒有就回 411。
// 串流本體轉送時 Worker 不會帶長度，所以照客戶端宣告的長度用 FixedLengthStream 轉一手（仍是串流，不整份讀進來）。
// 上限照上游的開場網頁上限（100000000 位元組，十進位 100 MB）加一點餘裕，超過的在這裡就擋，不佔上游的頻寬。
const OPENING_PAGE_UPLOAD = /^\/open\/v1\/role\/[^/]+\/opening-page$/;
export const OPENING_PAGE_MAX_BYTES = 100_000_000;
export const OPENING_PAGE_UPLOAD_MAX_BYTES = OPENING_PAGE_MAX_BYTES + 64 * 1024;

/**
 * 有宣告長度的原始上傳本體；回 Response 時是本地就拒絕。
 * FixedLengthStream 讓送出去的請求在線上帶長度；Request 物件的標頭上看不到它，所以另外照實寫一份 Content-Length。
 */
function openingPageUploadBody(request: Request, path: string): { body: ReadableStream | string; length: number } | Response | null {
  if (request.method !== 'PUT' || !OPENING_PAGE_UPLOAD.test(path)) return null;
  const declared = request.headers.get('Content-Length') ?? '';
  if (!/^\d+$/.test(declared)) {
    return Response.json({ error: 'invalid_param' }, { status: 411, headers: { 'Cache-Control': 'no-store' } });
  }
  const length = Number(declared);
  if (length > OPENING_PAGE_UPLOAD_MAX_BYTES) {
    return Response.json({ error: 'file_too_large' }, { status: 413, headers: { 'Cache-Control': 'no-store' } });
  }
  if (length === 0 || !request.body) return { body: '', length: 0 };
  return { body: request.body.pipeThrough(new FixedLengthStream(length)), length };
}

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
  const upload = openingPageUploadBody(request, path);
  if (upload instanceof Response) return upload;
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
  if (upload) headers.set('Content-Length', String(upload.length));
  const country = request.cf?.country;
  if (typeof country === 'string' && /^[A-Z]{2}$/.test(country)) headers.set('CF-IPCountry', country);
  headers.set('X-Harbor-Client-IP', client);
  headers.set('X-Harbor-Edge-Secret', env.HARBOR_HEARTHROOM_PROXY_SECRET);
  try {
    const upstream = await fetch(new Request(target, {
      method: request.method, headers, redirect: 'manual', signal: request.signal,
      body: request.method === 'GET' || request.method === 'HEAD' ? undefined : upload ? upload.body : request.body,
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
