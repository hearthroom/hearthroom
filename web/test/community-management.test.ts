import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, type App } from 'vue';
import { createPinia } from 'pinia';
import { createMemoryHistory, createRouter, RouterView, type Router } from 'vue-router';
import { i18n } from '../src/lib/i18n';
const mocks = vi.hoisted(() => ({
  summary: { reviewer: true, pending: 5, reviews: 2, cases: 3, role: 'reviewer' },
  queue: vi.fn(async () => ({ items: [] })),
  moderation: vi.fn(async (_path: string) => ({ items: [], hasNext: false })),
}));
vi.mock('../src/lib/session', () => ({ useSession: () => ({ me: { accountNumId: 7 }, accessToken: async () => 'synthetic' }) }));
vi.mock('../src/lib/api', async (original) => ({ ...await original<object>(), fetchReviewMe: async () => mocks.summary, fetchReviewQueue: mocks.queue }));
vi.mock('../src/lib/moderation', () => ({ moderationRequest: mocks.moderation }));
vi.mock('../src/pages/ReviewDetailPage.vue', () => ({ default: { template: '<h2>Review detail fixture</h2>' } }));
import { router as siteRouter } from '../src/router';
let app: App, host: HTMLElement, router: Router;
beforeEach(async () => {
  host = document.createElement('div'); document.body.append(host);
  router = createRouter({ history: createMemoryHistory(), routes: siteRouter.options.routes });
  await router.push('/review');
  app = createApp({ render: () => h(RouterView) }).use(createPinia()).use(router).use(i18n);
  app.mount(host);
  await vi.waitFor(() => expect(mocks.queue).toHaveBeenCalled());
});
afterEach(() => { app?.unmount(); host?.remove(); vi.clearAllMocks(); });
const links = () => [...host.querySelectorAll<HTMLAnchorElement>('.management-nav a')];
it('keeps card review, cases, works and history inside one management workspace with separate counts', async () => {
  expect(host.querySelectorAll('h1')).toHaveLength(1);
  expect(host.querySelector('h1')!.textContent).toBe(i18n.global.t('moderation.title'));
  expect(links().map(a => a.getAttribute('href'))).toEqual(['/review', '/review/cases', '/review/cards', '/review/history']);
  await vi.waitFor(() => expect(links()[0]!.querySelector('.review-badge')?.textContent).toBe('2'));
  expect(links()[1]!.querySelector('.review-badge')?.textContent).toBe('3');
  const shell = host.querySelector('.community-management');
  for (const [index, path] of ['/review', '/review/cases', '/review/cards', '/review/history'].entries()) {
    await router.push(path); await nextTick();
    expect(host.querySelector('.community-management')).toBe(shell);
    expect(host.querySelectorAll('h1')).toHaveLength(1);
    expect(links().filter(a => a.getAttribute('aria-current') === 'page')).toEqual([links()[index]]);
    expect(host.querySelector('a[href="/review/manage"]')).toBeNull();
  }
  await vi.waitFor(() => expect(mocks.moderation.mock.calls.map(c => c[0])).toContain('/cases?history=1&offset=0'));
  await router.push('/review/submission1'); await nextTick();
  expect(host.textContent).toContain('Review detail fixture');
  expect(host.querySelector('.community-management')).toBe(shell);
  expect(links()[0]!.getAttribute('aria-current')).toBe('page');
});
it('keeps legacy management bookmarks and all navigation in the selected language', async () => {
  await router.push('/en/review/manage?from=bookmark#pending'); await nextTick();
  expect(router.currentRoute.value.fullPath).toBe('/en/review/cases?from=bookmark#pending');
  expect(links().map(a => a.getAttribute('href'))).toEqual(['/en/review', '/en/review/cases', '/en/review/cards', '/en/review/history']);
  expect(router.currentRoute.value.meta.auth).toBe(true);
});
