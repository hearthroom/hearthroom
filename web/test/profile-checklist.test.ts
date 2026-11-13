import { afterEach, expect, it, vi } from 'vitest';
import { createApp, nextTick, type App } from 'vue';
import { createPinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { i18n } from '../src/lib/i18n';
const fixture = vi.hoisted(() => ({ session: { avatarUrl: '/avatar.png', profile: { handle: 'author', bio: 'Bio', tipLinks: [] as string[] } } }));
vi.mock('../src/lib/session', () => ({ useSession: () => fixture.session }));
vi.mock('../src/lib/review', () => ({ useReviewer: () => ({ reviewer: false, blogWriter: false }) }));
vi.mock('../src/lib/notifications', () => ({ useNotifications: () => ({ unread: 0 }) }));
import ProfileRail from '../src/components/profile/ProfileRail.vue';
let app: App, el: HTMLDivElement;
const edit = vi.fn();
afterEach(() => { app?.unmount(); el?.remove(); edit.mockClear(); });
async function mount({ tips = [], avatar = true, bio = true, discord = true, card = true }: { tips?: string[]; avatar?: boolean; bio?: boolean; discord?: boolean; card?: boolean } = {}) {
  fixture.session.avatarUrl = avatar ? '/avatar.png' : '';
  fixture.session.profile = { handle: 'author', bio: bio ? 'Bio' : '', tipLinks: tips };
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:p(.*)*', component: { template: '<div/>' } }] });
  await router.push('/me');
  el = document.createElement('div'); document.body.append(el);
  app = createApp(ProfileRail, { community: { enabled: true, link: discord ? { state: 'synced' } : null } as any, author: { cardCount: card ? 1 : 0 } as any, onEdit: edit }).use(createPinia()).use(router).use(i18n);
  app.mount(el); await nextTick();
}
it.each([{ tips: [] }, { tips: ['https://ko-fi.com/example'] }])('hides the completed checklist regardless of tip links (%j)', async ({ tips }) => {
  await mount({ tips });
  expect(el.querySelector('.todo')).toBeNull();
});
it.each(['avatar', 'bio', 'discord', 'card'] as const)('counts four steps and keeps %s as the next missing step', async (key) => {
  await mount({ [key]: false, tips: ['https://ko-fi.com/example'] });
  expect(el.querySelector('.todo__ring')?.textContent).toBe('3/4');
  expect(el.querySelector('.todo__text')?.textContent).toContain(i18n.global.t('profile.todo.' + key));
  if (key === 'avatar' || key === 'bio') {
    el.querySelector<HTMLButtonElement>('.todo')!.click();
    expect(edit).toHaveBeenCalledOnce();
  } else expect(el.querySelector('.todo')?.getAttribute('href')).toBe(key === 'discord' ? '/me/community' : '/mine');
});
it('does not count a tip link toward the four required steps', async () => {
  await mount({ avatar: false, bio: false, discord: false, card: false, tips: ['https://ko-fi.com/example'] });
  expect(el.querySelector('.todo__ring')?.textContent).toBe('0/4');
  expect(el.querySelector('.todo__text')?.textContent).toContain(i18n.global.t('profile.todo.avatar'));
});
