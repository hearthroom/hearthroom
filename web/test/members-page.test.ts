import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, type App } from 'vue';
import { createPinia } from 'pinia';
import { createMemoryHistory, createRouter, RouterView, type Router } from 'vue-router';
import { i18n } from '../src/lib/i18n';
/**
 * 成員分頁：找人、看額度與補充包、發包（帶理由與操作 ID）、發完畫面跟著更新。
 * 徽章管理的表單也住在這裡（從個人徽章頁搬過來）。
 */
const detail = (packs: any[] = []) => ({
  member: { handle: 'moonlight', displayName: '月光', avatarUrl: '', memberSince: 1, providers: ['harbor'], role: null },
  quota: { limit: 3, used: 1, weekStart: 0, weekEnd: 1, packRemaining: packs.reduce((n, p) => n + p.remaining, 0) },
  packs, badges: [{ key: 'first_work', icon: 'award', titles: { en: 'First approved work' }, earnedAt: 1, expiresAt: null }], badgeAudit: [],
});
const mocks = vi.hoisted(() => ({
  summary: { reviewer: true, pending: 0, reviews: 0, cases: 0, role: 'manager' },
  moderation: vi.fn(),
  community: vi.fn(async () => ({ definitions: [{ key: 'event_x', icon: 'star', category: 'event', titles: { en: 'Event X' }, descriptions: { en: 'x' } }], audit: [] })),
}));
vi.mock('../src/lib/session', () => ({ useSession: () => ({ me: { accountNumId: 7 }, profile: { handle: 'admin' }, accessToken: async () => 'synthetic' }) }));
vi.mock('../src/lib/api', async (original) => ({ ...await original<object>(), fetchReviewMe: async () => mocks.summary }));
vi.mock('../src/lib/moderation', () => ({ moderationRequest: mocks.moderation }));
vi.mock('../src/lib/community', () => ({ communityRequest: mocks.community, communityRequestId: async () => 'request-id-0123456789', forgetCommunityRequest: async () => {} }));
import { router as siteRouter } from '../src/router';
let app: App, host: HTMLElement, router: Router;
const packs: any[] = [];
beforeEach(async () => {
  packs.length = 0;
  mocks.moderation.mockReset().mockImplementation(async (path: string, _token: string, body?: any) => {
    if (path.startsWith('/packs')) return { items: packs, hasNext: false };
    if (path.endsWith('/packs') && body) { packs.unshift({ id: 'p' + packs.length, member: 'moonlight', granted: body.granted, remaining: body.granted, reason: body.reason, grantedBy: 'admin', at: 2 }); return detail(packs); }
    if (path.startsWith('/members/moonlight')) return detail(packs);
    throw Object.assign(new Error(i18n.global.t('moderation.error.community_member_missing')), { code: 'community_member_missing' });
  });
  host = document.createElement('div'); document.body.append(host);
  router = createRouter({ history: createMemoryHistory(), routes: siteRouter.options.routes });
  await router.push('/review/members');
  app = createApp({ render: () => h(RouterView) }).use(createPinia()).use(router).use(i18n); app.mount(host);
  await vi.waitFor(() => expect(mocks.moderation).toHaveBeenCalledWith('/packs?offset=0', 'synthetic'));
});
afterEach(() => { app?.unmount(); host?.remove(); vi.clearAllMocks(); });
const input = () => host.querySelector<HTMLInputElement>('.work-search input')!;
it('looks a member up by handle, shows quota and packs, and grants a pack with a reason', async () => {
  expect(host.textContent).toContain(i18n.global.t('moderation.members.select'));
  input().value = '@moonlight'; input().dispatchEvent(new Event('input')); await nextTick();
  host.querySelector<HTMLFormElement>('.work-search')!.requestSubmit();
  await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/review/members/moonlight'));
  await vi.waitFor(() => expect(host.querySelector('[data-member-quota]')?.textContent).toContain('1/3'));
  expect(host.querySelector('[data-member-packs]')!.textContent).toBe(i18n.global.t('moderation.members.packsLeft', { n: 0 }));
  expect(host.textContent).toContain('First approved work');
  const amount = host.querySelector<HTMLInputElement>('#pack-granted')!; amount.value = '5'; amount.dispatchEvent(new Event('input'));
  const reason = host.querySelector<HTMLTextAreaElement>('#pack-reason')!; reason.value = 'Contest winner'; reason.dispatchEvent(new Event('input')); await nextTick();
  host.querySelector<HTMLFormElement>('[data-grant-pack]')!.requestSubmit();
  await vi.waitFor(() => expect(mocks.moderation).toHaveBeenCalledWith('/members/moonlight/packs', 'synthetic', expect.objectContaining({ granted: 5, reason: 'Contest winner', operationId: expect.stringMatching(/^[0-9a-f-]{36}$/) })));
  await vi.waitFor(() => expect(host.querySelector('[data-member-packs]')!.textContent).toBe(i18n.global.t('moderation.members.packsLeft', { n: 5 })));
  expect(host.querySelector('[role=status]')!.textContent).toContain(i18n.global.t('moderation.members.grantSaved'));
  expect(host.querySelector<HTMLTextAreaElement>('#pack-reason')!.value).toBe('');
  expect(host.querySelectorAll('[data-pack]')).toHaveLength(1);
  expect(host.querySelector('[data-badge-award] input')).not.toBeNull();
});
it('tells the manager when no member has that handle and keeps the search', async () => {
  await router.push('/review/members/nobody'); await nextTick();
  await vi.waitFor(() => expect(host.querySelector('[role=alert]')?.textContent).toContain(i18n.global.t('moderation.error.community_member_missing')));
  expect(host.querySelector('[data-grant-pack]')).toBeNull();
});
it('opens a member from the recent grants list', async () => {
  packs.push({ id: 'p9', member: 'moonlight', granted: 2, remaining: 1, reason: 'Earlier', grantedBy: 'admin', at: 1 });
  await router.push('/review/members?x=1'); await nextTick();
  await vi.waitFor(() => expect(host.querySelector('[data-pack="p9"]')).not.toBeNull());
  host.querySelector<HTMLButtonElement>('[data-pack="p9"]')!.click();
  await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/review/members/moonlight'));
  await vi.waitFor(() => expect(host.querySelector('[data-member-packs]')!.textContent).toBe(i18n.global.t('moderation.members.packsLeft', { n: 1 })));
});
