import { afterEach, expect, it, vi } from 'vitest';
import { fetchAuthors, setNsfwViewer } from '../src/lib/api';

afterEach(() => { setNsfwViewer(null); vi.unstubAllGlobals(); });

it('author search sends the same adult intent and credential as card search', async () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({items:[]})));
  vi.stubGlobal('fetch', fetchMock);
  setNsfwViewer(async () => 'fixture-token');
  await fetchAuthors({q:'Fixture',zone:'all'});
  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(new URL(url, 'https://c.test').searchParams.get('nsfw')).toBe('1');
  expect(new Headers(init.headers).get('Authorization')).toBe('Bearer fixture-token');
});

it('general author search does not request adult access', async () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({items:[]})));
  vi.stubGlobal('fetch', fetchMock);
  await fetchAuthors({q:'Fixture'});
  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(new URL(url, 'https://c.test').searchParams.has('nsfw')).toBe(false);
  expect(new Headers(init.headers).has('Authorization')).toBe(false);
});
