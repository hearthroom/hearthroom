import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../src/lib/community', async original => ({ ...await original<object>(), communityRequest: mock.request }));
import { disablePush, enablePush, pushConfig, pushState, pushSupported } from '../src/lib/push';

// 推播訂閱：狀態以瀏覽器為準，開關兩邊（瀏覽器、站台）都要動到。
const CONFIG = { enabled: true, publicKey: '' };
const PUB = 'BPtnWqq9-GEcvvu8iLFiek-R2e0irBqzECbuvs8OeAYhRAk832IDbJh2f10ssltIXg5-Bb26zvc4R6JwK_Si0ro';
let subscription: { endpoint: string; toJSON: () => unknown; unsubscribe: () => Promise<boolean> } | null;
let permission: NotificationPermission;
const subscribe = vi.fn(async (opts: { applicationServerKey: BufferSource }) => {
  expect((opts.applicationServerKey as Uint8Array).length).toBe(65);
  subscription = { endpoint: 'https://push.example/e1', toJSON: () => ({ endpoint: 'https://push.example/e1', keys: { p256dh: 'p', auth: 'a' } }), unsubscribe: async () => { subscription = null; return true; } };
  return subscription;
});
beforeEach(() => {
  vi.clearAllMocks(); subscription = null; permission = 'default';
  vi.stubGlobal('Notification', { get permission() { return permission; }, requestPermission: async () => { permission = 'granted'; return permission; } });
  vi.stubGlobal('PushManager', function PushManager() {});
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { getRegistration: async () => ({ pushManager: { getSubscription: async () => subscription, subscribe } }) } });
  mock.request.mockImplementation(async (path: string, _token?: string, method = 'GET') => {
    if (path === '/push/config') return { enabled: true, publicKey: PUB };
    if (path.startsWith('/me/push/subscription?endpoint=')) return { subscribed: !!subscription };
    if (method === 'PUT' || method === 'DELETE') return { ok: true };
    return {};
  });
});
afterEach(() => { vi.unstubAllGlobals(); delete (navigator as { serviceWorker?: unknown }).serviceWorker; });

it('asks the browser, subscribes with the site key and registers the subscription with the member language', async () => {
  expect(pushSupported()).toBe(true);
  expect(await pushState('t')).toBe('off');
  expect(await pushConfig()).toEqual({ enabled: true, publicKey: PUB });
  expect(await enablePush(async () => 't', 'ja', { enabled: true, publicKey: PUB })).toBe('on');
  expect(subscribe).toHaveBeenCalledTimes(1);
  expect(mock.request).toHaveBeenCalledWith('/me/push/subscription', 't', 'PUT', { endpoint: 'https://push.example/e1', keys: { p256dh: 'p', auth: 'a' }, locale: 'ja' });
  expect(await pushState('t')).toBe('on');
});
it('reports a browser block, a missing server key, and unsupported browsers without touching the server', async () => {
  permission = 'denied';
  expect(await pushState('t')).toBe('blocked');
  permission = 'default';
  vi.stubGlobal('Notification', { get permission() { return permission; }, requestPermission: async () => 'denied' as NotificationPermission });
  expect(await enablePush(async () => 't', 'en', { enabled: true, publicKey: PUB })).toBe('blocked');
  expect(subscribe).not.toHaveBeenCalled();
  // A prompt that was never shown or was closed leaves the decision open: not blocked, just not yet allowed.
  vi.stubGlobal('Notification', { get permission() { return permission; }, requestPermission: async () => 'default' as NotificationPermission });
  expect(await enablePush(async () => 't', 'en', { enabled: true, publicKey: PUB })).toBe('dismissed');
  expect(subscribe).not.toHaveBeenCalled();
  expect(await enablePush(async () => 't', 'en', { enabled: false, publicKey: null })).toBe('unsupported');
  vi.unstubAllGlobals();
  expect(pushSupported()).toBe(false);
  expect(await pushState('t')).toBe('unsupported');
});
it('turning off unsubscribes the browser first and then tells the server which endpoint went away', async () => {
  await enablePush(async () => 't', 'en', { enabled: true, publicKey: PUB });
  expect(await disablePush('t')).toBe('off');
  expect(subscription).toBeNull();
  expect(mock.request).toHaveBeenLastCalledWith('/me/push/subscription', 't', 'DELETE', { endpoint: 'https://push.example/e1' });
  expect(await pushState('t')).toBe('off');
});
