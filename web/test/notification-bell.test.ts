import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp, nextTick, type App } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter, RouterView, type Router } from 'vue-router';
import { i18n, applyLocale } from '../src/lib/i18n';
const mock = vi.hoisted(() => ({ request: vi.fn(), me: { accountNumId: 1 } as { accountNumId: number } | null }));
vi.mock('../src/lib/community', async original => ({ ...await original<object>(), communityRequest: mock.request }));
vi.mock('../src/lib/session', () => ({ useSession: () => ({ get me() { return mock.me; }, accessToken: async () => 'fixture' }) }));
import NotificationBell from '../src/components/NotificationBell.vue';
import { noticeText, useNotifications } from '../src/lib/notifications';
import type { CommunityNotice } from '../src/lib/community';

// 頁首鈴鐺：未讀數來自摘要輪詢，打開才載清單；每一則都說得出誰、哪張卡，點了就標已讀並跳過去。
const notice = (over: Partial<CommunityNotice> = {}): CommunityNotice => ({ id: 'n1', kind: 'comment_reply', path: '/cards/12', created_at: 1700000000000, read_at: null, actor: { handle: 'abcdefgh', name: '小雨' }, card: { id: 12, name: '雨夜書店' }, extra: { comment: 'c1' }, ...over });
let app: App, el: HTMLDivElement, router: Router, items: CommunityNotice[];
const settle = async () => { await nextTick(); await new Promise(r => setTimeout(r, 0)); };
beforeEach(async () => {
  vi.clearAllMocks(); mock.me = { accountNumId: 1 }; await applyLocale('zh-Hant');
  items = [notice(), notice({ id: 'n2', kind: 'followed_work', path: '/cards/13', read_at: 5, actor: { handle: 'author01', name: '月光' }, card: { id: 13, name: '第二張' }, extra: null })];
  mock.request.mockImplementation(async (path: string, _token: string, method = 'GET') => {
    if (path.includes('/summary')) return { unread: items.filter(n => !n.read_at).length };
    if (path.endsWith('/read-all')) { for (const n of items) n.read_at = n.read_at ?? 1; return { ok: true }; }
    if (path.endsWith('/read')) return { ok: true };
    if (method === 'GET') return { items: structuredClone(items) };
    return {};
  });
  const pinia = createPinia(); setActivePinia(pinia);
  router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: { template: '<div />' } }] });
  await router.push('/');
  el = document.createElement('div'); document.body.append(el);
  app = createApp({ components: { NotificationBell, RouterView }, template: '<NotificationBell /><RouterView />' }).use(router).use(i18n).use(pinia); app.mount(el); await settle();
});
afterEach(() => { app?.unmount(); el.remove(); });

it('shows the unread count from the summary poll and tells the server the interface language', async () => {
  await useNotifications().refresh('zh-Hant'); await settle();
  expect(el.querySelector('.bell__count')!.textContent).toBe('1');
  expect(mock.request.mock.calls[0][0]).toBe('/me/community/notifications/summary?lang=zh-Hant');
  expect(el.querySelector('button')!.getAttribute('aria-label')).toBe(i18n.global.t('community.unreadCount', { count: 1 }));
});
it('opens a list that names who did what on which card, marks a picked notice read and leaves through its link', async () => {
  await useNotifications().refresh('zh-Hant');
  el.querySelector<HTMLButtonElement>('.bell__btn')!.click(); await settle();
  const links = [...el.querySelectorAll<HTMLAnchorElement>('.bell__item')];
  expect(links.map(a => a.textContent!.trim())).toEqual([expect.stringContaining('小雨 回覆了你在「雨夜書店」的留言'), expect.stringContaining('月光 發佈或更新了「第二張」')]);
  expect(links[0].classList.contains('bell__item--unread')).toBe(true);
  expect(links[1].classList.contains('bell__item--unread')).toBe(false);
  expect(el.querySelector<HTMLAnchorElement>('.bell__all')!.getAttribute('href')).toBe('/me/notifications');
  links[0].click(); await settle();
  expect(router.currentRoute.value.path).toBe('/cards/12');
  expect(mock.request).toHaveBeenCalledWith('/me/community/notifications/read', 'fixture', 'POST', { id: 'n1' });
  expect(el.querySelector('.bell__panel')).toBeNull();
  expect(el.querySelector('.bell__count')).toBeNull();
});
it('clears everything with one action and explains an empty list', async () => {
  await useNotifications().refresh('zh-Hant');
  el.querySelector<HTMLButtonElement>('.bell__btn')!.click(); await settle();
  [...el.querySelectorAll('button')].find(b => b.textContent!.trim() === i18n.global.t('notifications.readAll'))!.click(); await settle();
  expect(mock.request).toHaveBeenCalledWith('/me/community/notifications/read-all', 'fixture', 'POST');
  expect(el.querySelector('.bell__count')).toBeNull();
  expect(el.querySelectorAll('.bell__item--unread')).toHaveLength(0);
  items = []; useNotifications().items = []; await settle();
  expect(el.textContent).toContain(i18n.global.t('notifications.empty'));
});
it('writes each notice in the reader language and falls back to the plain label without detail', async () => {
  await applyLocale('en');
  expect(noticeText(notice())).toBe('小雨 replied to your comment on “雨夜書店”');
  expect(noticeText(notice({ kind: 'review_result', actor: null, extra: { status: 'rejected' } }))).toBe('“雨夜書店” did not pass review this time');
  expect(noticeText(notice({ kind: 'review_result', actor: null, extra: { status: 'approved' } }))).toBe('“雨夜書店” passed review');
  expect(noticeText(notice({ kind: 'comment_like', extra: { count: 3 } }))).toBe('小雨 and 2 others liked your comment on “雨夜書店”');
  expect(noticeText(notice({ kind: 'comment_like', extra: { count: 1 } }))).toBe('小雨 liked your comment on “雨夜書店”');
  expect(noticeText(notice({ actor: null, card: null }))).toBe(i18n.global.t('community.notices.comment_reply'));
  expect(noticeText({ id: 'x', kind: 'registration_pack', path: '/mine', created_at: 1, read_at: null })).toBe(i18n.global.t('community.notices.registration_pack'));
  await applyLocale('ja');
  expect(noticeText(notice({ kind: 'followed_work' }))).toBe('小雨 さんが『雨夜書店』を公開・更新しました');
});
