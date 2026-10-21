import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp, nextTick, type App } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { resetManagedAuthForTest } from '../src/lib/managed-auth';
import { useSession } from '../src/lib/session';
import { accountToken, connectedBalance } from '../src/lib/connections';
import { AuthUnavailable } from '../src/lib/oauth';
import { i18n } from '../src/lib/i18n';
import LibraryPage from '../src/pages/LibraryPage.vue';
import MyCardsPage from '../src/pages/MyCardsPage.vue';
let app: App | undefined;
let root: HTMLElement;
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  resetManagedAuthForTest(false);
  setActivePinia(createPinia());
  localStorage.setItem('hearthroom.provider', 'harbor');
  localStorage.setItem('hearthroom.oauth.refresh.harbor', 'synthetic-refresh');
  localStorage.setItem('hearthroom.oauth.grant_client.harbor', 'synthetic-client');
  vi.stubEnv('VITE_HARBOR_API_BASE', `${location.origin}/hh-api`);
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('/oauth/token')) throw new TypeError('synthetic disconnected /hh-api/oauth/token');
    return Response.json({ items: [], identities: [] });
  }));
  root = document.body.appendChild(document.createElement('div'));
});
afterEach(() => { app?.unmount(); app = undefined; root.remove(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
it('settles both token entrypoints with a recognizable error and preserves credentials', async () => {
  await expect(useSession().accessToken()).rejects.toBeInstanceOf(AuthUnavailable);
  await expect(accountToken('harbor', 22)).rejects.toBeInstanceOf(AuthUnavailable);
  // Drain cleanup promises: Vitest also fails on unhandled rejections.
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(localStorage.getItem('hearthroom.oauth.refresh.harbor')).toBe('synthetic-refresh');
});
it('treats disconnected refresh as unavailable optional balance', async () => {
  await expect(connectedBalance('harbor', 22)).resolves.toBeNull();
});
it.each(['library', 'mine'])('%s settles loading and offers a retry when refresh disconnects', async page => {
  const session = useSession();
  session.ready = true;
  session.me = { accountNumId: 22, nickName: 'fixture', avatar: '' };
  session.profile = { identities: [{ provider: 'harbor', externalId: 22 }] } as never;
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:p(.*)*', component: { template: '<div />' } }] });
  await router.push(`/${page}`);
  app = createApp(page === 'library' ? LibraryPage : MyCardsPage).use(session.$pinia).use(router).use(i18n);
  const errors: unknown[] = [];
  app.config.errorHandler = error => { errors.push(error); };
  app.mount(root);
  await nextTick();
  await vi.waitFor(() => expect(root.textContent).toContain(i18n.global.t(page === 'library' ? 'library.retry' : 'linked.retry')));
  expect(root.querySelector('.ghost, .skeleton')).toBeNull();
  expect(errors).toEqual([]);
  expect(localStorage.getItem('hearthroom.oauth.refresh.harbor')).toBe('synthetic-refresh');
});

it('preserves an existing wallet when its optional post-action refresh is unavailable', async () => {
  const session = useSession();
  session.wallet = { score: 9, tempScore: 0, plans: [], expiries: [] };
  await expect(session.refreshWallet()).resolves.toBeUndefined();
  expect(session.wallet.score).toBe(9);
});
