import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { i18n } from '../src/lib/i18n';
import { useSession } from '../src/lib/session';
import PlayPage from '../src/pages/PlayPage.vue';

const fixture = vi.hoisted(() => ({ playHost: false }));
vi.mock('../src/lib/site', async original => ({ ...await original<typeof import('../src/lib/site')>(),
  isPlayHost: () => fixture.playHost, communityHost: () => 'sukisuki.ai' }));
vi.mock('../src/lib/stage-host', () => ({ ensureStage: vi.fn(), preloadStage: async () => {}, remergeStageMessages: vi.fn(), stageToasts: { list: [] } }));
vi.mock('../src/lib/api', async original => ({ ...await original<typeof import('../src/lib/api')>(),
  fetchCard: async () => { throw Object.assign(new Error('card unavailable'), { status: 503 }); },
  fetchCardPlatforms: async () => [],
}));

let app: ReturnType<typeof createApp> | undefined;
let root: HTMLElement;
beforeEach(() => { sessionStorage.clear(); });
afterEach(() => { app?.unmount(); app = undefined; root?.remove(); });

it.each(['zh-Hant', 'zh-Hans', 'en', 'ja', 'ko'].flatMap(locale => [false, true].map(playHost => ({ locale, playHost }))))(
  'card 503: Back to card preserves $locale, playHost=$playHost', async ({ locale, playHost }) => {
    fixture.playHost = playHost;
    const pinia = createPinia(); setActivePinia(pinia);
    const session = useSession(); session.ready = true; session.me = null;
    i18n.global.locale.value = locale as any;
    const prefix = locale === 'zh-Hant' ? '' : `/${locale}`;
    const router = createRouter({ history: createMemoryHistory(), routes: [
      { path: '/:locale(zh-Hans|en|ja|ko)?/play/:roleId', component: PlayPage },
      { path: '/:roleId/', component: PlayPage },
      { path: '/:locale(zh-Hans|en|ja|ko)?/cards/:id', component: { template: '<div>Card</div>' } },
    ] });
    await router.push(playHost ? `/100001/?lang=${locale}` : `${prefix}/play/100001`);
    root = document.createElement('div'); document.body.append(root);
    app = createApp({ template: '<RouterView />' }).use(pinia).use(i18n).use(router); app.mount(root);
    await vi.waitFor(() => expect(root.querySelector('.play__error')).not.toBeNull());
    const link = root.querySelector<HTMLAnchorElement>('.play__state a')!;
    expect(link.textContent).toBe(i18n.global.t('play.backToCard'));
    const target = `${prefix}/cards/100001`;
    expect(link.getAttribute('href')).toBe(playHost ? `https://sukisuki.ai${target}` : target);
    if (!playHost) {
      link.click();
      await vi.waitFor(() => expect(router.currentRoute.value.path).toBe(target));
    }
  },
);
