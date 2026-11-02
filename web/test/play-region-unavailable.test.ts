/**
 * 國家／地區不提供的卡直接開對話頁（owner 2026-11-03）：卡片網址、分享連結、舊聊天連結。
 * 讀卡或續聊授權回 403 region_unavailable：畫「暫不提供」，舞台不掛、不去問這段對話的紀錄，
 * 不是成人內容的門，也不是「載不進來」。
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp, nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { i18n } from '../src/lib/i18n';
import { useSession } from '../src/lib/session';
import { setProvider } from '../src/lib/provider';
import PlayPage from '../src/pages/PlayPage.vue';
const blocked = vi.hoisted(() => ({ card: true, resume: true }));
const mocks = vi.hoisted(() => ({ stage: vi.fn(), preload: vi.fn(async () => {}), authorize: vi.fn(async () => true), owned: vi.fn() }));
vi.mock('../src/lib/stage-host', () => ({ ensureStage: mocks.stage, preloadStage: mocks.preload, remergeStageMessages: vi.fn(), stageToasts: { list: [] } }));
vi.mock('../src/lib/connections', () => ({ accountToken: vi.fn(), connectAccount: vi.fn() }));
vi.mock('../src/lib/play-authorization', () => ({ ensurePlayAuthorization: mocks.authorize }));
vi.mock('../src/lib/library', async () => {
  const { ApiError } = await import('../src/lib/api');
  return {
    libraryRequest: async () => { if (blocked.resume) throw new ApiError(403, 'forbidden', 'region_unavailable'); return { cardNumber: 100300, provider: 'harbor', roleId: 'harbor-role' }; },
    recordConversation: vi.fn(), clearLibraryCache: vi.fn(),
  };
});
vi.mock('../src/lib/distribution', () => ({ copies: async () => [{ provider: 'harbor', roleId: 'source-role', status: 'source' }] }));
vi.mock('../src/lib/owned-history', () => ({ fetchOwnedHistory: mocks.owned }));
vi.mock('../src/lib/api', async original => {
  const real = await original<typeof import('../src/lib/api')>();
  return { ...real,
    fetchCard: async () => {
      if (blocked.card) throw new real.ApiError(403, 'forbidden', 'region_unavailable');
      return { id: '100300', num: 100300, status: 'approved', roleId: 'harbor-role', provider: 'harbor' };
    },
    fetchCardPlatforms: async () => { if (blocked.card) throw new real.ApiError(403, 'forbidden', 'region_unavailable'); return [{ provider: 'harbor', roleId: 'harbor-role', playable: true }]; },
  };
});

let app: ReturnType<typeof createApp> | undefined; let root: HTMLElement | undefined;
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(r => setTimeout(r, 0)); await nextTick(); };
async function mount(path: string) {
  const pinia = createPinia(); setActivePinia(pinia);
  const session = useSession();
  session.ready = true;
  session.token = { accessToken: 'tok-1', refreshToken: 'r', expiresAt: Date.now() + 3600_000 } as never;
  session.me = { accountNumId: 1, nickName: '測試', avatar: '' } as never;
  session.profile = { handle: 'abcdefgh', identities: [], showNsfw: false, ageVerified: true, adultConsent: true, countryRegion: 'CN' } as never;
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/play/:roleId', component: PlayPage }, { path: '/:pathMatch(.*)*', component: { template: '<div />' } }] });
  await router.push(path);
  root = document.createElement('div'); document.body.append(root);
  app = createApp(PlayPage).use(pinia).use(i18n).use(router); app.mount(root);
  await settle();
}
beforeEach(() => {
  setProvider('harbor'); blocked.card = true; blocked.resume = true;
  mocks.stage.mockReset(); mocks.stage.mockResolvedValue({ template: '<div>Fixture player</div>' });
  mocks.owned.mockReset(); mocks.owned.mockImplementation(async (_p: string, id: string) => ({ conversationId: id, roleId: 'harbor-role', canGenerate: true, title: 'Owned history' }));
});
afterEach(() => { app?.unmount(); root?.remove(); document.body.innerHTML = ''; app = undefined; });

it.each([
  ['卡片網址', '/play/100300'],
  ['分享連結', '/play/100300?share=ctx-1&ref=abc'],
  ['舊聊天連結', '/play/100300?resume=c1'],
])('%s：畫「暫不提供」，不掛舞台、不問對話紀錄', async (_entry, path) => {
  await mount(path);
  expect(root!.textContent).toContain(i18n.global.t('region.unavailable.title'));
  expect(root!.textContent).not.toContain(i18n.global.t('card.gate.title'));
  expect(root!.textContent).not.toContain(i18n.global.t('play.loadFailed'));
  expect(mocks.stage).not.toHaveBeenCalled();
  expect(mocks.owned).not.toHaveBeenCalled();
  expect(root!.querySelector('a.btn--primary')?.getAttribute('href')).toBe('/');
});

it('被擋下的讀卡不留下沒接住的錯誤（全站會把它記成錯誤事件）', async () => {
  const unhandled = vi.fn();
  process.on('unhandledRejection', unhandled);
  try {
    await mount('/play/100300');
    await new Promise(r => setTimeout(r, 20));
    expect(root!.textContent).toContain(i18n.global.t('region.unavailable.title'));
    expect(unhandled).not.toHaveBeenCalled();
  } finally { process.off('unhandledRejection', unhandled); }
});

it('提供的卡照常掛舞台（正控）', async () => {
  blocked.card = false; blocked.resume = false;
  await mount('/play/100300?resume=c1');
  await vi.waitFor(() => expect(mocks.stage).toHaveBeenCalledTimes(1));
  await settle();
  expect(root!.textContent).toContain('Fixture player');
  expect(root!.textContent).not.toContain(i18n.global.t('region.unavailable.title'));
});
