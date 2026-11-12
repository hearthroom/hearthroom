import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp, nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { applyLocale, i18n } from '../src/lib/i18n';
import { useSession } from '../src/lib/session';
import { setProvider } from '../src/lib/provider';
import PlayPage from '../src/pages/PlayPage.vue';
const failure=vi.hoisted(()=>({status:404}));
const mocks = vi.hoisted(() => ({ stage: vi.fn(), preload: vi.fn(async () => {}), authorize: vi.fn(async () => true), owned: vi.fn() }));
vi.mock('../src/lib/stage-host', () => ({ ensureStage: mocks.stage, preloadStage: mocks.preload, remergeStageMessages: vi.fn(), stageToasts: { list: [] } }));
vi.mock('../src/lib/connections', () => ({ accountToken: vi.fn(), connectAccount: vi.fn() }));
vi.mock('../src/lib/play-authorization', () => ({ ensurePlayAuthorization: mocks.authorize }));
vi.mock('../src/lib/library', async () => {
  const { ApiError } = await import('../src/lib/api');
  return {
    libraryRequest: async () => { throw new ApiError(failure.status, 'unavailable', 'not_found'); return { cardNumber: 100300, provider: 'harbor', roleId: 'harbor-role' }; },
    recordConversation: vi.fn(), clearLibraryCache: vi.fn(),
  };
});
vi.mock('../src/lib/distribution', () => ({ copies: async () => [{ provider: 'harbor', roleId: 'source-role', status: 'source' }] }));
vi.mock('../src/lib/owned-history', () => ({ fetchOwnedHistory: mocks.owned }));
vi.mock('../src/lib/api', async original => {
  const real = await original<typeof import('../src/lib/api')>();
  return { ...real,
    fetchCard: async () => {
      return { id: '100300', num: 100300, status: 'approved', roleId: 'harbor-role', provider: 'harbor' };
    },
    fetchCardPlatforms: async () => {  return [{ provider: 'harbor', roleId: 'harbor-role', playable: true }]; },
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
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:locale(zh-Hans|en|ja|ko)?/play/:roleId', component: PlayPage }, { path: '/:pathMatch(.*)*', component: { template: '<div />' } }] });
  await router.push(path);
  root = document.createElement('div'); document.body.append(root);
  app = createApp(PlayPage).use(pinia).use(i18n).use(router); app.mount(root);
  await settle();
}
beforeEach(() => {
  setProvider('harbor'); failure.status=404;
  mocks.stage.mockReset(); mocks.stage.mockResolvedValue({ template: '<div>Fixture player</div>' });
  mocks.owned.mockReset(); mocks.owned.mockImplementation(async (_p: string, id: string) => ({ conversationId: id, roleId: 'harbor-role', canGenerate: true, title: 'Owned history' }));
});
afterEach(() => { app?.unmount(); root?.remove(); document.body.innerHTML = ''; app = undefined; });


it.each(['zh-Hant','zh-Hans','en','ja','ko'])('missing resume offers an honest reopen action in %s',async locale=>{
 await applyLocale(locale);
 const prefix=locale==='zh-Hant'?'':`/${locale}`;
 await mount(`${prefix}/play/100300?resume=missing&provider=harbor`);
 expect(root!.querySelector('.play__error')?.textContent).toBe(i18n.global.t('play.conversationMissing'));
 const link=root!.querySelector<HTMLAnchorElement>('.play__state a')!;
 expect(link.textContent).toBe(i18n.global.t('play.reopenCard'));
 const url=new URL(link.href);expect(url.pathname).toBe(`${prefix}/play/100300`);expect(url.searchParams.has('resume')).toBe(false);expect(url.searchParams.get('provider')).toBe('harbor');
 expect(mocks.stage).not.toHaveBeenCalled();
 link.click();
 await vi.waitFor(()=>expect(root!.textContent).toContain('Fixture player'));
});
it('keeps a transient resume failure generic',async()=>{
 failure.status=503;await mount('/play/100300?resume=missing');
 expect(root!.querySelector('.play__error')?.textContent).toBe(i18n.global.t('play.loadFailed'));
 expect(root!.textContent).not.toContain(i18n.global.t('play.reopenCard'));
 expect(mocks.stage).not.toHaveBeenCalled();
});
