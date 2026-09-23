import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

/** deleteDatabase 的替身：記下刪了哪個庫、非同步成功。 */
function fakeIdb(order: string[] = []) {
  const deleted: string[] = [];
  const factory = {
    deleteDatabase: vi.fn((name: string) => {
      const req: Record<string, any> = {};
      setTimeout(() => { deleted.push(name); order.push('delete'); req.onsuccess?.(); }, 0);
      return req;
    }),
  };
  return { factory, deleted };
}

beforeEach(async () => {
  vi.resetModules();
  localStorage.clear();
  setActivePinia(createPinia());
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('account scope is a stable one-way hash of provider and account, never the id itself', async () => {
  const { stageStorageScope } = await import('../src/lib/stage-storage');
  const a = await stageStorageScope('harbor', { accountNumId: 123456 });
  expect(a).toMatch(/^[0-9a-f]{64}$/);
  expect(a).not.toContain('123456');
  expect(await stageStorageScope('harbor', { accountNumId: 123456 })).toBe(a);
  expect(await stageStorageScope('lunatalk', { accountNumId: 123456 })).not.toBe(a);
  expect(await stageStorageScope('harbor', { accountNumId: 123457 })).not.toBe(a);
  expect(await stageStorageScope('harbor', null)).toBeNull();
});

it('signing out deletes the player rule cache and runs the embedded player cleanup', async () => {
  const { factory, deleted } = fakeIdb();
  vi.stubGlobal('indexedDB', factory);
  const { clearStageStorage, onStageSignOut } = await import('../src/lib/stage-storage');
  const hook = vi.fn();
  onStageSignOut(hook);
  await clearStageStorage();
  expect(deleted).toEqual(['hearthroom-author-rules']);
  expect(hook).toHaveBeenCalledOnce();
});

it('cleanup never throws when storage is unavailable', async () => {
  vi.stubGlobal('indexedDB', { deleteDatabase() { throw new DOMException('denied', 'SecurityError'); } });
  const { clearStageStorage, onStageSignOut } = await import('../src/lib/stage-storage');
  onStageSignOut(() => { throw new Error('boom'); });
  await expect(clearStageStorage()).resolves.toBeUndefined();
});

it('managed logout clears the cache before reloading', async () => {
  const order: string[] = [];
  const { factory, deleted } = fakeIdb(order);
  vi.stubGlobal('indexedDB', factory);
  vi.stubGlobal('location', { reload: vi.fn(() => order.push('reload')) });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/config') ? Response.json({ managed: true }) : Response.json({ ok: true })));
  const { useSession } = await import('../src/lib/session');
  await useSession().logout();
  expect(deleted).toEqual(['hearthroom-author-rules']);
  expect(order).toEqual(['delete', 'reload']);
});

it('self-hosted logout (no reload) still clears the cache', async () => {
  const { factory, deleted } = fakeIdb();
  vi.stubGlobal('indexedDB', factory);
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/config') ? Response.json({ managed: false }) : Response.json({ ok: true })));
  const { useSession } = await import('../src/lib/session');
  await useSession().logout();
  expect(deleted).toEqual(['hearthroom-author-rules']);
});

it('another tab signing out clears this tab cache before the reload', async () => {
  const order: string[] = [];
  const { factory } = fakeIdb(order);
  vi.stubGlobal('indexedDB', factory);
  const reload = vi.fn(() => order.push('reload'));
  vi.stubGlobal('location', { reload });
  vi.stubGlobal('fetch', async () => Response.json({ managed: true }));
  const { managedAuth } = await import('../src/lib/managed-auth');
  await managedAuth();
  window.dispatchEvent(new StorageEvent('storage', { key: 'hearthroom.auth.change', newValue: JSON.stringify({ action: 'logout', nonce: 'x' }) }));
  // 前面的測試 resetModules 過，舊的 managed-auth 實例也還掛著 storage 監聽；只看先後。
  await vi.waitFor(() => expect(reload).toHaveBeenCalled());
  expect(order.indexOf('delete')).toBeGreaterThanOrEqual(0);
  expect(order.indexOf('delete')).toBeLessThan(order.indexOf('reload'));
});

it('installs the player with the hashed account scope and registers its sign-out cleanup', async () => {
  const install = vi.fn(async () => {});
  const clear = vi.fn(async () => {});
  const stage = {
    browserHost: () => ({ events: { on: vi.fn() } }),
    installMoonStage: install,
    clearAuthorRuleStorage: clear,
    MoonStage: {},
  };
  vi.doMock('../src/lib/stage-preload', () => ({ preloadStage: async () => stage }));
  vi.stubGlobal('indexedDB', fakeIdb().factory);
  const { ensureStage } = await import('../src/lib/stage-host');
  const { stageStorageScope, clearStageStorage } = await import('../src/lib/stage-storage');
  const player = { accountNumId: 22, nickName: 'n', avatar: '' };
  await ensureStage({
    app: {} as any, router: {} as any, session: { accessToken: async () => 't', me: player } as any,
    provider: 'harbor', player, currentPath: () => '/play/x', lp: (p: string) => p,
  });
  const options = (install.mock.calls[0] as unknown as [unknown, { auth: { storageScope?: string | null } }])[1];
  expect(options.auth.storageScope).toBe(await stageStorageScope('harbor', player));
  await clearStageStorage();
  expect(clear).toHaveBeenCalledOnce();
});

it('a signed-out player gets no scope (nothing is persisted)', async () => {
  const install = vi.fn(async () => {});
  const stage = { browserHost: () => ({ events: { on: vi.fn() } }), installMoonStage: install, clearAuthorRuleStorage: vi.fn(), MoonStage: {} };
  vi.doMock('../src/lib/stage-preload', () => ({ preloadStage: async () => stage }));
  const { ensureStage } = await import('../src/lib/stage-host');
  await ensureStage({
    app: {} as any, router: {} as any, session: { accessToken: async () => null, me: null } as any,
    provider: 'harbor', player: null, currentPath: () => '/play/x', lp: (p: string) => p,
  });
  const options = (install.mock.calls[0] as unknown as [unknown, { auth: { storageScope?: string | null } }])[1];
  expect(options.auth.storageScope ?? null).toBeNull();
});
