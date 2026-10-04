import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp, nextTick, type App } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter, RouterView, type Router } from 'vue-router';
import { i18n, applyLocale } from '../src/lib/i18n';
const mock = vi.hoisted(() => ({ request: vi.fn(), push: { state: 'off' as string, enable: vi.fn(async () => 'on'), disable: vi.fn(async () => 'off') } }));
vi.mock('../src/lib/community', async original => ({ ...await original<object>(), communityRequest: mock.request }));
vi.mock('../src/lib/session', () => ({ useSession: () => ({ me: { accountNumId: 1 }, accessToken: async () => 'fixture' }) }));
vi.mock('../src/lib/push', () => ({ pushSupported: () => true, pushConfig: async () => ({ enabled: true, publicKey: 'k' }), pushState: async () => mock.push.state, enablePush: mock.push.enable, disablePush: mock.push.disable }));
import NotificationsPage from '../src/pages/NotificationsPage.vue';

// 通知頁：清單、全部標為已讀、站內／按讚／推播開關，以及一句 Discord 引導（綁定或開私訊）。
let app: App, el: HTMLDivElement, router: Router;
let view: { link: { name: string; state: string } | null; preferences: Record<string, number> };
let items: { id: string; kind: string; path: string; created_at: number; read_at: number | null; actor?: unknown; card?: unknown; extra?: unknown }[];
const settle = async () => { await nextTick(); await new Promise(r => setTimeout(r, 0)); };
beforeEach(async () => {
  vi.clearAllMocks(); await applyLocale('zh-Hant'); mock.push.state = 'off';
  view = { link: null, preferences: { public_badges: 0, public_level: 0, notifications: 1, like_notifications: 1, discord_dm: 0, case_access: 0 } };
  items = [{ id: 'n1', kind: 'comment_reply', path: '/cards/12', created_at: 1700000000000, read_at: null, actor: { handle: 'abcdefgh', name: '小雨' }, card: { id: 12, name: '雨夜書店' }, extra: {} }];
  mock.request.mockImplementation(async (path: string, _token?: string, method = 'GET', body?: Record<string, unknown>) => {
    if (path.startsWith('/me/community/notifications?')) return { items: structuredClone(items) };
    if (path.endsWith('/read-all')) { for (const n of items) n.read_at = n.read_at ?? 1; return { ok: true }; }
    if (path === '/me/community/preferences') { for (const [k, v] of Object.entries(body ?? {})) view.preferences[{ notifications: 'notifications', likeNotifications: 'like_notifications' }[k] ?? k] = v ? 1 : 0; return { enabled: true, invite: null, xp: 0, level: 0, badges: [], xpEnabled: true, ...view }; }
    if (path === '/me/community') return { enabled: true, invite: null, xp: 0, level: 0, badges: [], xpEnabled: true, ...view };
    return { ok: true };
  });
  const pinia = createPinia(); setActivePinia(pinia);
  router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/me/notifications', component: NotificationsPage }, { path: '/:pathMatch(.*)*', component: { template: '<div />' } }] });
  await router.push('/me/notifications');
  el = document.createElement('div'); document.body.append(el);
  app = createApp(RouterView).use(router).use(i18n).use(pinia); app.mount(el); await settle(); await settle();
});
afterEach(() => { app?.unmount(); el.remove(); });

it('lists every notice with who and which card, offers mark-all-read, and points unlinked members at Discord linking', async () => {
  expect(el.querySelector('h1')!.textContent).toBe(i18n.global.t('nav.notifications'));
  const item = el.querySelector<HTMLAnchorElement>('.notices__item')!;
  expect(item.textContent).toContain('小雨 回覆了你在「雨夜書店」的留言');
  expect(item.getAttribute('href')).toBe('/cards/12');
  expect(item.classList.contains('notices__item--unread')).toBe(true);
  const readAll = [...el.querySelectorAll('button')].find(b => b.textContent!.trim() === i18n.global.t('notifications.readAll'))!;
  readAll.click(); await settle();
  expect(mock.request).toHaveBeenCalledWith('/me/community/notifications/read-all', 'fixture', 'POST');
  expect(el.querySelector('.notices__item--unread')).toBeNull();
  expect(el.textContent).toContain(i18n.global.t('notifications.discordUnlinked'));
  expect(el.querySelector<HTMLAnchorElement>('.notices__discord a')!.getAttribute('href')).toBe('/me/community');
  expect(el.querySelector('.notices__discord a')!.textContent).toContain(i18n.global.t('notifications.discordGoLink'));
});
it('flips the site, like and browser switches from this page', async () => {
  const toggles = () => [...el.querySelectorAll<HTMLButtonElement>('.notices__toggle')];
  expect(toggles().map(b => b.getAttribute('aria-pressed'))).toEqual(['true', 'true', 'false']);
  toggles()[1].click(); await settle();
  expect(mock.request).toHaveBeenCalledWith('/me/community/preferences', 'fixture', 'PATCH', { likeNotifications: false });
  expect(toggles()[1].getAttribute('aria-pressed')).toBe('false');
  toggles()[2].click(); await settle();
  expect(mock.push.enable).toHaveBeenCalledWith(expect.any(Function), 'zh-Hant', { enabled: true, publicKey: 'k' });
  expect(toggles()[2].getAttribute('aria-pressed')).toBe('true');
});
it('tells linked members whether Discord reminders are on and sends them to the Discord settings', async () => {
  view.link = { name: 'Linked', state: 'synced' }; view.preferences.discord_dm = 1;
  await router.push('/'); await router.push('/me/notifications'); await settle(); await settle();
  expect(el.textContent).toContain(i18n.global.t('notifications.discordOn'));
  expect(el.querySelector('.notices__discord a')!.textContent).toContain(i18n.global.t('notifications.discordGoSettings'));
  view.preferences.discord_dm = 0;
  await router.push('/'); await router.push('/me/notifications'); await settle(); await settle();
  expect(el.textContent).toContain(i18n.global.t('notifications.discordOff'));
});
