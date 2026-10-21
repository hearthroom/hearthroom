import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { afterEach, expect, it, vi } from 'vitest';
import worker from '../src/index';
import { proxyHarborApi } from '../src/harbor-api-proxy';
import { opsMetrics } from '../src/ops-metrics';

afterEach(() => vi.restoreAllMocks());
const options = { ...env, HARBOR_EDGE_PROXY_SECRET: 'test-proxy-secret' };
const request = (path: string, init?: RequestInit) => new Request(`https://sukisuki.chat/hh-api${path}`, {
  ...init, headers: { 'CF-Connecting-IP': '203.0.113.7', ...init?.headers },
});

it('forwards method, query, bearer and body to a fixed host, replacing proxy claims', async () => {
  const mock = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    const req = input as Request;
    expect(req.url).toBe('https://api.harperharbor.com/open/v1/me?x=a%2Fb');
    expect(req.method).toBe('PATCH');
    expect(req.headers.get('Authorization')).toBe('Bearer synthetic');
    expect(req.headers.get('Content-Type')).toBe('application/json');
    expect(req.headers.get('X-Harbor-Client-IP')).toBe('203.0.113.7');
    expect(req.headers.get('X-Harbor-Edge-Secret')).toBe('test-proxy-secret');
    expect(req.headers.has('Cookie')).toBe(false);
    expect(req.headers.has('X-Forwarded-For')).toBe(false);
    expect(req.redirect).toBe('manual');
    expect(await req.text()).toBe('{"synthetic":true}');
    return new Response('ok', { status: 201, headers: { 'Set-Cookie': 'foreign=value' } });
  });
  const res = await proxyHarborApi(request('/open/v1/me?x=a%2Fb', {
    method: 'PATCH', body: '{"synthetic":true}', headers: {
      Authorization: 'Bearer synthetic', 'Content-Type': 'application/json', Cookie: 'hr_auth=private',
      'X-Harbor-Client-IP': '1.2.3.4', 'X-Harbor-Edge-Secret': 'forged', 'X-Forwarded-For': '1.2.3.4',
    },
  }), options);
  expect(mock).toHaveBeenCalledTimes(1);
  expect(res.status).toBe(201);
  expect(res.headers.has('Set-Cookie')).toBe(false);
});

it('returns the first SSE chunk before the upstream closes', async () => {
  let finish!: () => void;
  const stream = new ReadableStream<Uint8Array>({ start(c) {
    c.enqueue(new TextEncoder().encode('data: first\n\n'));
    finish = () => { c.enqueue(new TextEncoder().encode('data: last\n\n')); c.close(); };
  } });
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } }));
  const res = await proxyHarborApi(request('/open/v1/conversation/stream'), options);
  const reader = res.body!.getReader();
  expect(new TextDecoder().decode((await reader.read()).value)).toBe('data: first\n\n');
  finish();
  expect(new TextDecoder().decode((await reader.read()).value)).toBe('data: last\n\n');
  expect((await reader.read()).done).toBe(true);
});

it('starts forwarding an upload before the request body is complete', async () => {
  let finish!: () => void;
  const body = new ReadableStream<Uint8Array>({ start(c) {
    c.enqueue(new TextEncoder().encode('first'));
    finish = () => c.close();
  } });
  vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    const reader = (input as Request).body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe('first');
    finish();
    expect((await reader.read()).done).toBe(true);
    return new Response('stored');
  });
  const res = await proxyHarborApi(request('/open/v1/image/upload', { method: 'POST', body }), options);
  expect(await res.text()).toBe('stored');
});

it('keeps upgrade and failure counts bounded and visible in the actual metrics endpoint', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 401 }));
  const ctx = createExecutionContext();
  const res = await worker.fetch(request('/open/v1/conversation/ws?ticket=synthetic-private', { headers: { Upgrade: 'websocket' } }), options, ctx);
  expect(res.status).toBe(401);
  await waitOnExecutionContext(ctx);
  const metricsResponse = await worker.fetch(new Request('https://sukisuki.chat/metrics'), options, createExecutionContext());
  const text = await metricsResponse.text();
  expect(text).toContain('hearthroom_harbor_proxy_requests_total{route="conversation",status_class="4xx",websocket="true"}');
  expect(text).not.toContain('synthetic-private');
});

it('preserves a WebSocket upgrade and bidirectional messages', async () => {
  const pair = new WebSocketPair();
  pair[1].accept();
  pair[1].addEventListener('message', e => pair[1].send(`echo:${e.data}`));
  vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    expect((input as Request).headers.get('Upgrade')).toBe('websocket');
    return new Response(null, { status: 101, webSocket: pair[0] });
  });
  const res = await proxyHarborApi(request('/open/v1/conversation/ws', { headers: { Upgrade: 'websocket' } }), options);
  expect(res.status).toBe(101);
  const socket = res.webSocket!;
  socket.accept();
  const reply = new Promise(resolve => socket.addEventListener('message', e => resolve(e.data), { once: true }));
  socket.send('synthetic');
  expect(await reply).toBe('echo:synthetic');
  socket.close();
});

it('fails closed for missing trusted IP/secret, sandbox hosts and non-public API paths', async () => {
  const fetcher = vi.spyOn(globalThis, 'fetch');
  expect((await proxyHarborApi(request('/open/v1/me'), { ...options, HARBOR_EDGE_PROXY_SECRET: '' })).status).toBe(503);
  expect((await proxyHarborApi(new Request('https://sukisuki.chat/hh-api/open/v1/me'), options)).status).toBe(503);
  for (const path of ['/auth/session', '/metrics', '//evil.example/open/v1/me', '/open/v1/../admin', '/open/v1/%2f%2fevil.example']) {
    expect((await proxyHarborApi(request(path), options)).status).toBe(404);
  }
  expect((await proxyHarborApi(new Request('https://c123.sukisuki.ai/hh-api/open/v1/me'), options)).status).toBe(404);
  expect(fetcher).not.toHaveBeenCalled();
});

it('does not follow upstream redirects or retry transport failures', async () => {
  const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 307, headers: { Location: 'https://assets.harperharbor.com/file' } }));
  const res = await proxyHarborApi(request('/open/v1/media/file'), options);
  expect(res.status).toBe(307);
  expect(res.headers.get('Location')).toBe('https://assets.harperharbor.com/file');
  fetcher.mockRejectedValue(new Error('private upstream detail'));
  expect((await proxyHarborApi(request('/open/v1/me'), options)).status).toBe(502);
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it('dispatches before D1 admission and records bounded Prometheus dimensions', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok'));
  const ctx = createExecutionContext();
  const res = await worker.fetch(request('/open/v1/me'), options, ctx);
  expect(await res.text()).toBe('ok');
  await waitOnExecutionContext(ctx);
  const metrics = await opsMetrics(env.DB);
  expect(metrics).toContain('hearthroom_harbor_proxy_requests_total{route="profile",status_class="2xx",websocket="false"}');
  expect(metrics).not.toContain('203.0.113.7');
  expect(metrics).not.toContain('synthetic');
});
