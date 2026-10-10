/**
 * 遊客進對話頁（owner 2026-10-10）：不登入也掛得起舞台，只看開場；按下送出才在原地彈登入框。
 *   - 遊客：不問供應商授權、不拿 token，舞台以遊客模式掛起來（沒有 player，token 永遠是 null）。
 *   - 舞台說「要登入」（遊客按了送出）：彈登入框，不換頁；取消就收起來，人還在這張卡。
 *   - 續玩紀錄、審核、作者試玩不是公開的路：照舊要登入，不給遊客模式。
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp, nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { i18n } from '../src/lib/i18n';
import { useSession } from '../src/lib/session';
import { setProvider } from '../src/lib/provider';
import PlayPage from '../src/pages/PlayPage.vue';
const mocks = vi.hoisted(() => ({ stage: vi.fn(), preload: vi.fn(async () => {}), token: vi.fn(), authorize: vi.fn(), connect: vi.fn() }));
vi.mock('../src/lib/stage-host', () => ({ ensureStage: mocks.stage, preloadStage: mocks.preload, remergeStageMessages: vi.fn(), stageToasts: { list: [] } }));
vi.mock('../src/lib/connections', () => ({ accountToken: mocks.token, connectAccount: mocks.connect }));
vi.mock('../src/lib/play-authorization', () => ({ ensurePlayAuthorization: mocks.authorize }));
vi.mock('../src/lib/provider-switch', () => ({ availableProviders: async () => [{ id: 'harbor', name: 'HarperHarbor' }], chooseProvider: vi.fn() }));
vi.mock('../src/lib/api', async original => ({ ...await original<typeof import('../src/lib/api')>(),
  fetchCard: async () => ({ id: '100021', num: 100021, status: 'approved' }),
  fetchCardPlatforms: async () => [{ provider: 'harbor', roleId: 'harbor-role', playable: true }] }));

let app: ReturnType<typeof createApp> | undefined; let root: HTMLElement | undefined;
const settle = async () => { for (let i = 0; i < 60; i++) await Promise.resolve(); await nextTick(); };
async function mount(path: string) {
  const pinia = createPinia(); setActivePinia(pinia);
  const session = useSession();
  session.ready = true; session.me = null;
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/play/:roleId', component: PlayPage }] });
  await router.push(path);
  root = document.createElement('div'); document.body.append(root);
  app = createApp(PlayPage).use(pinia).use(i18n).use(router); app.mount(root);
  await settle();
  return session;
}
beforeEach(() => { setProvider('harbor'); Object.values(mocks).forEach(m => m.mockReset()); mocks.preload.mockResolvedValue(undefined); mocks.stage.mockResolvedValue({ template: '<div>Fixture player</div>' }); });
afterEach(() => { app?.unmount(); root?.remove(); document.body.innerHTML = ''; app = undefined; });

it('遊客：不問授權、不拿 token，以遊客模式掛舞台', async () => {
  await mount('/play/100021');
  expect(mocks.authorize).not.toHaveBeenCalled();
  expect(mocks.connect).not.toHaveBeenCalled();
  expect(mocks.stage).toHaveBeenCalledTimes(1);
  const options = mocks.stage.mock.calls[0]![0];
  expect(options.guest).toBe(true);
  expect(options.player).toBeNull();
  expect(await options.accessToken()).toBeNull();
  expect(options.currentRoleId()).toBe('harbor-role');
  expect(root!.textContent).toContain('Fixture player');
});

it('遊客按了送出：在原地彈登入框，取消就收起來', async () => {
  await mount('/play/100021');
  const options = mocks.stage.mock.calls[0]![0];
  expect(document.querySelector('[aria-labelledby="guest-signin-title"]')).toBeNull();
  options.onSignInRequired();
  await settle();
  const sheet = document.querySelector('[aria-labelledby="guest-signin-title"]');
  expect(sheet?.textContent).toContain(i18n.global.t('login.headline'));
  expect(sheet?.textContent).toContain(i18n.global.t('login.continueWith', { provider: 'HarperHarbor' }));
  [...sheet!.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.includes(i18n.global.t('dialog.cancel')))!.click();
  await settle();
  expect(document.querySelector('[aria-labelledby="guest-signin-title"]')).toBeNull();
});

it.each(['/play/100021?resume=c1', '/play/100021?mode=source', '/play/100021?review=r1'])('不是公開的路（%s）：不給遊客模式，請他先登入', async (path) => {
  mocks.token.mockResolvedValue(null);
  await mount(path);
  expect(mocks.stage).not.toHaveBeenCalled();
});
