import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { apiBaseOf, oauthBaseOf } from '../src/lib/provider';
import { oauthResource, useProviderUpstream } from '../src/lib/config';

// Deployment variables select the artifact's rollout. Individual test cases set
// their own policy so both direct rollback and phase-two CI runs remain testable.
beforeEach(() => {
  vi.stubEnv('VITE_HARBOR_API_TRANSPORT', 'proxy');
  vi.stubEnv('VITE_HARBOR_PROXY_HOSTS', 'sukisuki.chat,sukisuki.pro');
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); useProviderUpstream(); });

it('keeps a failed profile request on the proxy without a direct retry', async () => {
  vi.stubGlobal('location', { origin: 'https://sukisuki.chat' });
  useProviderUpstream();
  const fetcher = vi.fn().mockRejectedValue(new TypeError('synthetic network error'));
  vi.stubGlobal('fetch', fetcher);
  const { fetchMe } = await import('../src/lib/api');
  await expect(fetchMe('synthetic')).rejects.toThrow('synthetic network error');
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0][0]).toBe('https://sukisuki.chat/hh-api/open/v1/me');
});

it('renews and revokes through the proxy while keeping the canonical OAuth resource', async () => {
  vi.stubGlobal('location', { origin: 'https://sukisuki.chat' });
  useProviderUpstream();
  const { resetManagedAuthForTest } = await import('../src/lib/managed-auth');
  resetManagedAuthForTest(false);
  localStorage.clear();
  localStorage.setItem('hearthroom.provider', 'harbor');
  localStorage.setItem('hearthroom.oauth.refresh.harbor', 'synthetic-refresh');
  localStorage.setItem('hearthroom.oauth.grant_client.harbor', 'synthetic-client');
  const calls: string[] = [];
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    calls.push(String(url));
    if (String(url).endsWith('/oauth/token')) {
      expect(new URLSearchParams(String(init?.body)).get('resource')).toBe('https://api.harperharbor.com/open/v1');
      return Response.json({ access_token: 'synthetic-access', refresh_token: 'synthetic-rotated', expires_in: 3600 });
    }
    return new Response(null, { status: 200 });
  });
  const { refresh, revokeSession } = await import('../src/lib/oauth');
  expect((await refresh('harbor'))?.accessToken).toBe('synthetic-access');
  await revokeSession('harbor');
  expect(calls).toEqual(['https://sukisuki.chat/hh-api/oauth/token', 'https://sukisuki.chat/hh-api/oauth/revoke']);
});

it.each(['sukisuki.chat', 'sukisuki.pro', 'play.sukisuki.chat', 'play.sukisuki.pro'])('uses absolute same-origin transport on %s while OAuth stays canonical', host => {
  vi.stubGlobal('location', { origin: `https://${host}` });
  expect(apiBaseOf()).toBe(`https://${host}/hh-api`);
  expect(useProviderUpstream()).toBe(`https://${host}/hh-api`);
  expect(oauthBaseOf()).toBe('https://api.harperharbor.com');
  expect(oauthResource()).toBe('https://api.harperharbor.com/open/v1');
});

it.each(['sukisuki.ai', 'hearthroom.club', 'localhost', 'evil.example', 'c123.sukisuki.chat'])('keeps unselected sites direct: %s', host => {
  vi.stubGlobal('location', { origin: `https://${host}` });
  expect(apiBaseOf()).toBe('https://api.harperharbor.com');
});

it('supports an explicit global direct switch and a second rollout phase', () => {
  vi.stubGlobal('location', { origin: 'https://sukisuki.chat' });
  vi.stubEnv('VITE_HARBOR_API_TRANSPORT', 'direct');
  expect(apiBaseOf()).toBe('https://api.harperharbor.com');
  vi.stubEnv('VITE_HARBOR_API_TRANSPORT', 'proxy');
  vi.stubEnv('VITE_HARBOR_PROXY_HOSTS', 'sukisuki.ai,hearthroom.club,sukisuki.chat,sukisuki.pro');
  vi.stubGlobal('location', { origin: 'https://play.hearthroom.club' });
  expect(apiBaseOf()).toBe('https://play.hearthroom.club/hh-api');
});

it('retains an explicit self-hosted upstream without routing it through the official proxy', async () => {
  vi.stubGlobal('location', { origin: 'https://sukisuki.chat' });
  vi.stubEnv('VITE_HARBOR_API_BASE', 'http://127.0.0.1:8888');
  vi.resetModules();
  const provider = await import('../src/lib/provider');
  expect(provider.apiBaseOf()).toBe('http://127.0.0.1:8888');
});
