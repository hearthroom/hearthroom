import { afterEach, expect, it, vi } from 'vitest';
import { createApp, nextTick, type App } from 'vue';
import { createPinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { i18n } from '../src/lib/i18n';
vi.mock('../src/lib/oauth', () => ({ restorePersisted: () => null, refresh: async () => null, persist: () => {}, revokeSession: async () => {}, beginLogin: async () => {} }));
vi.mock('../src/lib/connections', () => ({ accountToken: async () => null, connectedBalance: async () => null }));
vi.mock('../src/lib/track', () => ({ track: () => {}, currentSurface: () => 'card', setSurface: () => {} }));
vi.mock('moonstage/stage', () => ({}));
vi.mock('moonstage/stage.css', () => ({}));
import CardPage from '../src/pages/CardPage.vue';

const card = { id: '900001', num: 900001, roleId: 'luna-hosted', provider: 'lunatalk', zone: 'zh', name: 'Fixture', summary: 'Fixture', tags: [], author: { handle: null, accountNumId: 7, name: 'Author', avatar: '' }, talkNum: 0, followNum: 0, registeredAt: 1, syncedAt: 1, nsfw: false };
const raw = '<zzt>Welcome</zzt>';
const asset = { rules: [{ id: 'title', find: '/<zzt>(.*?)<\\/zzt>/g', replace: '<div class="guest-decoration">$1</div>', enabled: true }], cardFormat: 'mmd' };
let app: App | undefined;
let root: HTMLElement;
afterEach(() => { app?.unmount(); root?.remove(); vi.unstubAllGlobals(); });
async function mount(options: { replicaStatus?: number; replicaWelcome?: string; sourceAsset?: unknown; platformsStatus?: number } = {}) {
  const requests: { url: URL; auth: string | null }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(String(input), 'https://community.test');
    requests.push({ url, auth: new Headers(init?.headers).get('Authorization') });
    let body: unknown = { error: 'not_found' }, status = 404;
    if (url.pathname === '/v1/cards/900001') { body = card; status = 200; }
    if (url.pathname.endsWith('/platforms')) { status = options.platformsStatus ?? 200; body = { platforms: [{ provider: 'lunatalk', roleId: 'luna-hosted', playable: true }, { provider: 'harbor', roleId: 'harbor-hosted', playable: true }] }; }
    if (url.pathname === '/open/v1/role/detail') { body = { roleWelcome: url.hostname.includes('harperharbor') ? options.replicaWelcome ?? raw : raw }; status = 200; }
    if (url.pathname.endsWith('/author-asset/serve')) {
      if (url.hostname.includes('harperharbor')) { status = options.replicaStatus ?? 200; body = asset; }
      else { status = options.sourceAsset ? 200 : 403; body = options.sourceAsset ?? {}; }
    }
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  }));
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/cards/:id', component: CardPage }, { path: '/:pathMatch(.*)*', component: { template: '<div />' } }] });
  await router.push('/cards/900001'); await router.isReady();
  root = document.createElement('div'); document.body.append(root);
  app = createApp({ template: '<RouterView />' }).use(createPinia()).use(router).use(i18n); app.mount(root);
  for (let i = 0; i < 30; i++) await new Promise(resolve => setTimeout(resolve, 0));
  await nextTick();
  return requests;
}
it('decorates a guest opening using the same card public replica when its source denies anonymous assets', async () => {
  const requests = await mount();
  expect(root.querySelector('iframe.hc-frame')?.getAttribute('srcdoc')).toContain('<div class="guest-decoration">Welcome</div>');
  const assets = requests.filter(r => r.url.pathname.endsWith('/author-asset/serve'));
  expect(assets.map(r => r.url.searchParams.get('roleId'))).toEqual(['luna-hosted', 'harbor-hosted']);
  expect(assets.every(r => r.auth === null)).toBe(true);
  expect(requests.filter(r => r.url.pathname.endsWith('/platforms'))).toHaveLength(1);
});
it.each([{ replicaStatus: 403 }, { platformsStatus: 403 }, { replicaWelcome: 'A different revision' }])('retains plain text if public replica access or matching content is unavailable: %j', async options => {
  await mount(options);
  expect(root.querySelector('iframe.hc-frame')).toBeNull();
  expect(root.textContent).toContain('Welcome');
});
it('respects an accessible source with intentionally empty rules', async () => {
  const requests = await mount({ sourceAsset: { rules: [] } });
  expect(root.querySelector('iframe.hc-frame')).toBeNull();
  expect(requests.filter(r => r.url.pathname.endsWith('/author-asset/serve'))).toHaveLength(1);
});
