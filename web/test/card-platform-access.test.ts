import { afterEach, expect, it, vi } from 'vitest';
import { fetchCardPlatforms, setNsfwViewer } from '../src/lib/api';
import { setProvider } from '../src/lib/provider';

afterEach(() => {
  setNsfwViewer(null);
  setProvider('harbor');
  vi.unstubAllGlobals();
});

it.each(['harbor', 'harbor'] as const)('uses the %s community login to discover another service without a second adult preference', async provider => {
  setProvider(provider);
  setNsfwViewer(async () => 'community-session');
  const other = provider === 'harbor' ? 'harbor' : 'harbor';
  const platforms = [{ provider: other, roleId: 'play-copy', playable: true }];
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    return headers.get('X-Provider') === provider && headers.get('Authorization') === 'Bearer community-session'
      ? Response.json({ platforms })
      : Response.json({ error: 'nsfw_gated' }, { status: 403 });
  });
  vi.stubGlobal('fetch', fetchMock);
  expect(await fetchCardPlatforms('community-card')).toEqual(platforms);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0][0]).toContain('/cards/community-card/platforms?nsfw=1');
});

it('does not claim community adult access when the community setting is off', async () => {
  setProvider('harbor');
  setNsfwViewer(async () => null);
  const fetchMock = vi.fn(async () => Response.json({ error: 'nsfw_gated' }, { status: 403 }));
  vi.stubGlobal('fetch', fetchMock);
  await expect(fetchCardPlatforms('community-card')).rejects.toMatchObject({ status: 403 });
  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).not.toContain('nsfw=1');
  expect(new Headers(init.headers).has('Authorization')).toBe(false);
});
