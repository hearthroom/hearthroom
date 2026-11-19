/**
 * 主頁關注／粉絲可見度的畫面規則（任務 2026-11-19-profile-visibility）：
 * 隱藏的關注數換成遮眼圖示、名單只在允許時可點、名單彈層的各狀態、設定選了就存且失敗彈回。
 */
import { afterEach, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, type App } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import { i18n } from '../src/lib/i18n';

const api = vi.hoisted(() => ({ list: vi.fn(), own: vi.fn(), settings: vi.fn(), author: vi.fn() }));
import { reactive } from 'vue';
const session = reactive({
  profile: { handle: 'writer01', followingVisibility: 'count', followersVisibility: 'count', followers: 12, following: 4 } as Record<string, unknown>,
  accessToken: async () => 'token',
});
vi.mock('../src/lib/session', () => ({ useSession: () => session }));
vi.mock('../src/lib/api', async (original) => ({
  ...(await original<object>()),
  fetchFollowList: api.list, fetchOwnFollowers: api.own, updateSiteSettings: api.settings, fetchAuthor: api.author,
}));

import { ApiError } from '../src/lib/api';
import ProfileStats from '../src/components/profile/ProfileStats.vue';
import FollowListDialog from '../src/components/profile/FollowListDialog.vue';
import SettingsProfile from '../src/components/settings/SettingsProfile.vue';
import AuthorList from '../src/components/AuthorList.vue';

const t = i18n.global.t;
let app: App | null = null, root: HTMLElement | null = null;
afterEach(() => { app?.unmount(); root?.remove(); app = null; root = null; document.body.innerHTML = ''; vi.clearAllMocks(); });
async function mount(component: object, props: Record<string, unknown> = {}) {
  root = document.createElement('div'); document.body.append(root);
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:p(.*)*', component: { render: () => null } }] });
  app = createApp({ render: () => h(component, props) }).use(i18n).use(router);
  app.mount(root);
  await router.isReady();
  for (let i = 0; i < 4; i++) { await nextTick(); await Promise.resolve(); }
  return document.body;
}
const page = (over: Record<string, unknown> = {}) => ({ total: 3, unlisted: 0, items: [], hasNext: false, offset: 0, limit: 30, ...over });
const person = (n: number) => ({ handle: `fan${n}aaaa`, name: `Fan ${n}`, avatar: '' });

it('replaces a hidden following count with the eye icon and only opens lists that are allowed', async () => {
  const open = vi.fn();
  const body = await mount(ProfileStats, { works: 5, chats: 1200, followers: 30, following: null, followersOpen: true, followingOpen: true, onOpen: open });
  const hidden = body.querySelector('[role="img"]')!;
  expect(hidden.getAttribute('aria-label')).toBe(t('profile.stat.followingHidden'));
  // 隱藏的格不可點；粉絲格是唯一的按鈕
  const buttons = body.querySelectorAll('button');
  expect(buttons).toHaveLength(1);
  buttons[0].click();
  expect(open).toHaveBeenCalledWith('followers', buttons[0]);
  expect([...body.querySelectorAll('[role="listitem"]')].map((c) => c.textContent)).toEqual([
    expect.stringContaining(t('profile.stat.works')), expect.stringContaining(t('profile.stat.following')),
    expect.stringContaining(t('profile.stat.followers')), expect.stringContaining(t('profile.stat.chats')),
  ]);
});

it('explains unlisted members above the list and the all-unlisted state apart from empty', async () => {
  api.list.mockResolvedValueOnce(page({ total: 3420, unlisted: 3418, items: [person(1), person(2)], hasNext: true }));
  let body = await mount(FollowListDialog, { kind: 'followers', handle: 'writer01', total: 3420 });
  expect(api.list).toHaveBeenCalledWith('writer01', 'followers', 0);
  const note = body.querySelector('.fl__unlisted')!;
  expect(note.textContent).toContain('3,418');
  expect(note.nextElementSibling?.classList.contains('fl__body')).toBe(true);
  expect(body.querySelectorAll('.fl__row')).toHaveLength(2);
  expect(body.textContent).not.toContain('writer01-internal');
  app!.unmount(); app = null; document.body.innerHTML = '';

  api.list.mockResolvedValueOnce(page({ total: 3420, unlisted: 3420 }));
  body = await mount(FollowListDialog, { kind: 'following', handle: 'writer01', total: 3420 });
  expect(body.textContent).toContain(t('profile.list.allHidden.title', { n: '3,420' }, 3420));
  expect(body.textContent).not.toContain(t('profile.list.emptyFollowing.title'));
  app!.unmount(); app = null; document.body.innerHTML = '';

  api.list.mockResolvedValueOnce(page({ total: 0 }));
  body = await mount(FollowListDialog, { kind: 'following', handle: 'writer01', total: 0 });
  expect(body.textContent).toContain(t('profile.list.emptyFollowing.title'));
});

it('tells the viewer when the author closes the list while it is open', async () => {
  api.list.mockRejectedValueOnce(new ApiError(403, 'list_not_public', 'list_not_public'));
  const notPublic = vi.fn();
  const body = await mount(FollowListDialog, { kind: 'followers', handle: 'writer01', total: 9, onNotPublic: notPublic });
  expect(body.textContent).toContain(t('profile.list.closed'));
  expect(notPublic).toHaveBeenCalledOnce();
});

it('reads the owner\'s own followers through the signed-in endpoint', async () => {
  api.own.mockResolvedValueOnce(page({ total: 1, items: [person(1)] }));
  await mount(FollowListDialog, { kind: 'followers', total: 1 });
  expect(api.own).toHaveBeenCalledWith('token', 0);
  expect(api.list).not.toHaveBeenCalled();
});

it('saves a choice right away and puts it back when saving fails', async () => {
  api.author.mockResolvedValue({ cardCount: 2, talkTotal: 10 });
  api.settings.mockResolvedValueOnce({ followingVisibility: 'hidden', followersVisibility: 'count' });
  const body = await mount(SettingsProfile);
  body.querySelector<HTMLInputElement>('input[name="profile-vis-following"][value="hidden"]')!.click();
  for (let i = 0; i < 4; i++) { await nextTick(); await Promise.resolve(); }
  expect(api.settings).toHaveBeenCalledWith({ followingVisibility: 'hidden' }, 'token');
  expect(session.profile.followingVisibility).toBe('hidden');
  expect(body.querySelector('[role="status"]')!.textContent).toContain(t('settings.profile.saved'));
  // 預覽跟著設定：關注變成遮眼圖示
  expect(body.querySelector('.profile-vis__preview [role="img"]')).not.toBeNull();

  api.settings.mockRejectedValueOnce(new Error('offline'));
  body.querySelector<HTMLInputElement>('input[name="profile-vis-followers"][value="list"]')!.click();
  for (let i = 0; i < 4; i++) { await nextTick(); await Promise.resolve(); }
  expect(session.profile.followersVisibility).toBe('count');
  expect(body.querySelector<HTMLInputElement>('input[name="profile-vis-followers"][value="count"]')!.checked).toBe(true);
  expect(body.querySelector('[role="alert"]')!.textContent).toContain(t('settings.profile.saveFailed'));
});

it('shows works, following and followers in author search results, hiding a private following count', async () => {
  const author = (handle: string, following: number | null) => ({ handle, accountNumId: 1, name: handle, avatar: '', cardCount: 3, talkTotal: 40, followers: 7, following, joinedAt: 0 });
  const body = await mount(AuthorList, { authors: [author('opensome', 5), author('privates', null)] });
  const rows = body.querySelectorAll('.al__row');
  expect(rows[0].textContent).toContain('5');
  expect(rows[1].querySelector('[role="img"]')!.getAttribute('aria-label')).toBe(t('profile.stat.followingHidden'));
  expect(rows[1].textContent).toContain('7');
});
