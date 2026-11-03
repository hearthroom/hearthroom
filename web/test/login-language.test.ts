/**
 * 新成員的國家／地區預設在登入後第一次讀個人資料（POST /v1/auth/session）時決定，要照介面語言（QA 2026-11-03：
 * 英文介面＋中文瀏覽器第一次登入得到台灣）。登入回來先落在不帶語言前綴的 /auth/callback，那一刻介面語言
 * 是照瀏覽器猜的；所以按下登入時記下介面語言，回來後的第一次 session 用它，用過就丟。
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { i18n } from '../src/lib/i18n';
import { authRequest, resetManagedAuthForTest } from '../src/lib/managed-auth';
import { beginLogin } from '../src/lib/oauth';

vi.mock('../src/lib/track', () => ({ track: () => {}, currentSurface: () => 'login', setSurface: () => {} }));
const sent: { path: string; language: string | null }[] = [];
beforeEach(() => {
  resetManagedAuthForTest(true); sessionStorage.clear(); sent.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    sent.push({ path: url, language: new Headers(init?.headers).get('language') });
    const body = url.endsWith('/v1/auth/start') ? { url: 'https://example.test/authorize' } : { provider: 'harbor', me: {}, profile: {} };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }));
  vi.spyOn(window.location, 'assign').mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); i18n.global.locale.value = 'zh-Hant' as never; });

it('登入回來的第一次 session 帶按下登入時的介面語言，不帶回呼頁照瀏覽器猜的那個；之後照目前的', async () => {
  i18n.global.locale.value = 'en' as never;
  await beginLogin('/en/cards/1');
  // 回呼頁：沒有語言前綴，介面語言照瀏覽器（中文）
  i18n.global.locale.value = 'zh-Hant' as never;
  await authRequest('session', { provider: 'harbor', token: true });
  await authRequest('session', { provider: 'harbor', token: true });
  const sessions = sent.filter((r) => r.path.endsWith('/v1/auth/session')).map((r) => r.language);
  expect(sessions).toEqual(['en', 'zh-Hant']);
});

it('沒走登入（只是重新開頁）：照目前的介面語言', async () => {
  i18n.global.locale.value = 'ja' as never;
  await authRequest('session', { provider: 'harbor' });
  expect(sent.at(-1)?.language).toBe('ja');
});
