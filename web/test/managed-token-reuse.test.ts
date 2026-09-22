/**
 * 託管模式下 access token 的重用。內嵌聊天每個請求都先要 token；每次都問伺服器、
 * 跨平台時再問一次 /me，開場十幾支請求就疊成十幾秒（玩家回報 2026-09-23）。
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MANAGED_TOKEN_REUSE_MS, managedAuth, managedToken, resetManagedAuthForTest } from '@/lib/managed-auth';

let issued = 0;
let meCalls = 0;
let expiresIn = 8 * 3600_000;
function serve() {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/v1/auth/config') return Response.json({ managed: true });
    if (url === '/v1/auth/token') { issued++; return Response.json({ accessToken: `grant-${issued}`, expiresAt: Date.now() + expiresIn }); }
    if (url.endsWith('/open/v1/me')) { meCalls++; return Response.json({ accountNumId: 22 }); }
    return Response.json({ ok: true });
  }));
}
beforeEach(async () => {
  vi.resetModules();
  resetManagedAuthForTest();
  issued = 0; meCalls = 0; expiresIn = 8 * 3600_000;
  serve();
  await managedAuth();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it('reuses a server-issued token for a few minutes instead of asking the server before every request', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  expect((await managedToken('harbor'))?.accessToken).toBe('grant-1');
  expect((await managedToken('harbor'))?.accessToken).toBe('grant-1');
  expect(issued).toBe(1);
  vi.setSystemTime(Date.now() + MANAGED_TOKEN_REUSE_MS);
  expect((await managedToken('harbor'))?.accessToken).toBe('grant-2');
});

it('does not reuse a token that is about to expire', async () => {
  expiresIn = 30_000;
  await managedToken('harbor');
  await managedToken('harbor');
  expect(issued).toBe(2);
});

it('checks the account behind a token once, even when the stage asks for it concurrently', async () => {
  const { accountToken } = await import('@/lib/connections');
  const tokens = await Promise.all(Array.from({ length: 6 }, () => accountToken('harbor', 22)));
  expect(new Set(tokens)).toEqual(new Set(['grant-1']));
  expect(issued).toBe(1);
  expect(meCalls).toBe(1);
  expect(await accountToken('harbor', 22)).toBe('grant-1');
  expect(meCalls).toBe(1);
});

it('after the provider rejects the reused token, fetches the current grant and reports whether it changed', async () => {
  const { recoverRejectedToken } = await import('@/lib/stage-host');
  const { accountToken } = await import('@/lib/connections');
  const token = () => accountToken('harbor', 22);
  expect(await token()).toBe('grant-1');
  // 另一台設備換綁：伺服器現在發的是另一張
  expect(await recoverRejectedToken('harbor', token)).toBe(true);
  expect(await token()).toBe('grant-2');
  expect(meCalls).toBe(2);
});

it('sends the player to sign in again when the server still has the same rejected token', async () => {
  const { recoverRejectedToken } = await import('@/lib/stage-host');
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/v1/auth/token'
    ? Response.json({ accessToken: 'same', expiresAt: Date.now() + expiresIn })
    : Response.json({ managed: true })));
  expect((await managedToken('harbor'))?.accessToken).toBe('same');
  expect(await recoverRejectedToken('harbor', async () => (await managedToken('harbor'))?.accessToken ?? null)).toBe(false);
});
