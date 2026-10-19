/**
 * 「我的」主頁改版（owner 2026-10-19）：版面換了，原本這頁的功能入口一個都不能少。
 * 這支測試列出每一個入口；拿掉任何一個都會紅。另外鎖住：主頁不再每 15 秒輪詢社區狀態（閃動來源之一），
 * 主頁數據預設不顯示，打開才出現。
 */
import { afterEach, expect, it, vi } from 'vitest';
import { createApp, nextTick, type App } from 'vue';
import { createPinia } from 'pinia';
import { createMemoryHistory, createRouter, RouterView } from 'vue-router';
import { i18n } from '../src/lib/i18n';

const fixture = vi.hoisted(() => ({
  community: vi.fn(),
  session: {
    me: { accountNumId: 7 }, ready: true, displayName: 'Author', avatarUrl: '', wallet: { score: 48238, tempScore: 0, plans: [] },
    profile: { handle: 'author01', memberSince: 0, bio: '', cover: '', showStats: false, followers: 3, following: 2, tipLinks: [], identities: [{ provider: 'harbor', externalId: 7, linkedAt: 0 }] },
    accessToken: async () => 'tok', logout: vi.fn(),
  } as any,
}));
vi.mock('../src/lib/session', () => ({ useSession: () => fixture.session }));
vi.mock('../src/lib/review', () => ({ useReviewer: () => ({ reviewer: true, blogWriter: false, pending: 3 }) }));
vi.mock('../src/lib/notifications', () => ({ useNotifications: () => ({ unread: 13 }) }));
vi.mock('../src/lib/track', () => ({ track: () => {}, currentSurface: () => 'me', setSurface: () => {} }));
vi.mock('../src/lib/community', async (o) => ({ ...(await o<object>()), communityRequest: fixture.community }));
vi.mock('../src/lib/api', async (o) => ({ ...(await o<object>()), fetchAuthor: async () => ({ cardCount: 5, talkTotal: 3700 }), fetchBoard: async () => ({ items: [], total: 0, hasNext: false, limit: 23, offset: 0, sort: 'new' }) }));
vi.mock('../src/lib/campaign', async (o) => ({ ...(await o<object>()), fetchPublicCampaigns: async () => ({ items: [] }) }));
vi.mock('../src/lib/connections', () => ({ accountToken: async () => null, connectAccount: vi.fn() }));
import MePage from '../src/pages/MePage.vue';
import { compact } from '../src/lib/format';

let app: App | null = null, el: HTMLDivElement | null = null;
const settle = async () => { for (let i = 0; i < 6; i++) { await nextTick(); await new Promise((r) => setTimeout(r, 0)); } };
async function mount() {
  fixture.community.mockReset();
  fixture.community.mockImplementation(async (path: string) => (path.endsWith('/badges')
    ? { items: [], featured: [], public: false }
    : { enabled: true, invite: null, link: { name: 'x', state: 'synced' }, xp: 0, level: 0, badges: [], xpEnabled: true, preferences: {} }));
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/me', component: MePage }, { path: '/:p(.*)*', component: { template: '<div/>' } }] });
  await router.push('/me'); await router.isReady();
  el = document.createElement('div'); document.body.append(el);
  app = createApp(RouterView).use(createPinia()).use(router).use(i18n);
  app.mount(el); await settle();
  return el;
}
afterEach(() => { app?.unmount(); el?.remove(); app = null; el = null; vi.restoreAllMocks(); fixture.session.profile.showStats = false; });
const hrefs = (root: Element) => [...root.querySelectorAll('a')].map((a) => a.getAttribute('href') ?? '');

it('keeps every entry the old profile page had', async () => {
  const root = await mount();
  const links = hrefs(root);
  for (const path of ['/authors/author01', '/settings', '/wallet', '/me/referral', '/campaigns', '/me/notifications', '/me/community', '/me/badges', '/mine', '/review', '/resources']) {
    expect(links.some((h) => h === path || h.startsWith(path + '?')), path).toBe(true);
  }
  const labels = [...root.querySelectorAll('button')].map((b) => b.textContent?.trim() ?? '');
  expect(labels).toContain(i18n.global.t('nav.logout'));
  expect(labels).toContain(i18n.global.t('profile.editProfile'));
  expect(root.querySelector(`button[aria-label="${i18n.global.t('me.copy')}"]`)).not.toBeNull();
  expect(root.textContent).toContain('48,238');
  expect(root.textContent).toContain('13');
});

it('does not poll the community status (the profile no longer redraws every 15 seconds)', async () => {
  const interval = vi.spyOn(globalThis, 'setInterval');
  await mount();
  expect(interval.mock.calls.some(([, ms]) => ms === 15000)).toBe(false);
  expect(fixture.community.mock.calls.filter(([path]) => path === '/me/community')).toHaveLength(1);
});

it('hides profile stats until the owner turns them on', async () => {
  let root = await mount();
  expect(root.querySelector('.hero__stats')).toBeNull();
  app!.unmount(); el!.remove();
  fixture.session.profile.showStats = true;
  root = await mount();
  const stats = root.querySelector('.hero__stats')!;
  expect(stats.textContent).toContain(compact(3700));
  expect(stats.textContent).toContain(i18n.global.t('profile.stat.followers'));
});
