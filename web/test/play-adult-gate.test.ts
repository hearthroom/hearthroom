/**
 * 成人內容的卡直接開對話頁（玩家回報 2026-10-18：R 級卡 100228 只看到「舞台載不進來」）：
 * 讀卡被 403 adult_content 擋下時畫卡片頁那道門（AdultGate），不是 play.loadFailed；
 * 在門上打開成人內容就重讀、掛舞台。遊客、登入的人、作者試玩（mode=source）三條路都一樣。
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp, nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { i18n } from '../src/lib/i18n';
import { useSession } from '../src/lib/session';
import { setProvider } from '../src/lib/provider';
import PlayPage from '../src/pages/PlayPage.vue';
const adult = vi.hoisted(() => ({ on: false, fail: false }));
const mocks = vi.hoisted(() => ({ stage: vi.fn(), preload: vi.fn(async () => {}), authorize: vi.fn(async () => true) }));
vi.mock('../src/lib/stage-host', () => ({ ensureStage: mocks.stage, preloadStage: mocks.preload, remergeStageMessages: vi.fn(), stageToasts: { list: [] } }));
vi.mock('../src/lib/connections', () => ({ accountToken: vi.fn(), connectAccount: vi.fn() }));
vi.mock('../src/lib/play-authorization', () => ({ ensurePlayAuthorization: mocks.authorize }));
vi.mock('../src/lib/library', () => ({ libraryRequest: async () => ({ cardNumber: 100228, provider: 'harbor', roleId: 'harbor-role' }), recordConversation: vi.fn(), clearLibraryCache: vi.fn() }));
vi.mock('../src/lib/distribution', () => ({ copies: async () => [{ provider: 'harbor', roleId: 'source-role', status: 'source' }] }));
vi.mock('../src/lib/api', async original => {
  const real = await original<typeof import('../src/lib/api')>();
  const state = () => ({ showNsfw: adult.on, ageVerified: true, adultConsent: true });
  return { ...real,
    fetchCard: async () => {
      if (adult.fail) throw new real.ApiError(500, 'boom');
      if (!adult.on) throw new real.ApiError(403, 'forbidden', 'adult_content');
      return { id: '100228', num: 100228, status: 'approved', roleId: 'harbor-role', provider: 'harbor' };
    },
    fetchCardPlatforms: async () => [{ provider: 'harbor', roleId: 'harbor-role', playable: true }],
    updateGuestAdult: async (input: { showNsfw?: boolean } = {}) => { if (input.showNsfw) adult.on = true; return state(); },
    updateSiteSettings: async (input: { showNsfw?: boolean }) => { if (input.showNsfw) adult.on = true; return state(); },
  };
});

let app: ReturnType<typeof createApp> | undefined; let root: HTMLElement | undefined;
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(r => setTimeout(r, 0)); await nextTick(); };
async function mount(path: string, signedIn: boolean) {
  const pinia = createPinia(); setActivePinia(pinia);
  const session = useSession();
  session.ready = true;
  if (signedIn) {
    session.token = { accessToken: 'tok-1', refreshToken: 'r', expiresAt: Date.now() + 3600_000 } as never;
    session.me = { accountNumId: 1, nickName: '測試', avatar: '' } as never;
    session.profile = { handle: 'abcdefgh', identities: [], showNsfw: false, ageVerified: true, adultConsent: true } as never;
  } else session.me = null;
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/play/:roleId', component: PlayPage }, { path: '/cards/:id', component: { template: '<div />' } }] });
  await router.push(path);
  root = document.createElement('div'); document.body.append(root);
  app = createApp(PlayPage).use(pinia).use(i18n).use(router); app.mount(root);
  await settle();
}
beforeEach(() => {
  setProvider('harbor'); adult.on = false; adult.fail = false;
  mocks.stage.mockReset(); mocks.stage.mockResolvedValue({ template: '<div>Fixture player</div>' });
});
afterEach(() => { app?.unmount(); root?.remove(); document.body.innerHTML = ''; app = undefined; });

it.each([
  ['遊客', '/play/100228', false],
  ['登入的人續玩', '/play/100228?resume=c1', true],
  ['作者試玩', '/play/100228?mode=source', true],
])('%s：成人內容的卡畫門而不是「載不進來」，在門上打開就掛舞台', async (_who, path, signedIn) => {
  await mount(path, signedIn);
  expect(root!.textContent).toContain(i18n.global.t('card.gate.title'));
  expect(root!.textContent).not.toContain(i18n.global.t('play.loadFailed'));
  expect(mocks.stage).not.toHaveBeenCalled();
  // 對話頁沒有站台頁首：門下要有路回卡片頁
  expect([...root!.querySelectorAll('a')].some(a => a.getAttribute('href') === '/cards/100228')).toBe(true);
  const enable = [...root!.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.includes(i18n.global.t('settings.content.nsfw')));
  enable!.click();
  await vi.waitFor(() => expect(mocks.stage).toHaveBeenCalledTimes(1));
  await settle();
  expect(root!.textContent).toContain('Fixture player');
  expect(root!.textContent).not.toContain(i18n.global.t('card.gate.title'));
});

it('真的讀不到卡：照舊說載不進來，不畫門', async () => {
  adult.fail = true;
  await mount('/play/100228', false);
  expect(root!.textContent).toContain(i18n.global.t('play.loadFailed'));
  expect(root!.textContent).not.toContain(i18n.global.t('card.gate.title'));
});
