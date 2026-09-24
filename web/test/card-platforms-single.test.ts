// 只有一個遊玩平台就不必讓人選：直接給「開始遊玩」，少一步就少一次流失。多個平台才顯示選擇。
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp, nextTick, type App } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { i18n } from '../src/lib/i18n';
import CardPlatforms from '../src/components/CardPlatforms.vue';
const mocks = vi.hoisted(() => ({ platforms: vi.fn() }));
vi.mock('../src/lib/api', async original => ({ ...await original<typeof import('../src/lib/api')>(), fetchCardPlatforms: mocks.platforms }));
vi.mock('../src/lib/connections', () => ({ accountToken: vi.fn(), connectedBalance: vi.fn(async () => null), connectAccount: vi.fn() }));
let app: App; let root: HTMLElement;
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); await nextTick(); };
beforeEach(() => vi.clearAllMocks());
afterEach(() => { app?.unmount(); root?.remove(); });
async function mount() {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:p(.*)*', component: { template: '<div />' } }] });
  await router.push('/cards/1');
  const pinia = createPinia(); setActivePinia(pinia);
  root = document.createElement('div'); document.body.append(root);
  app = createApp(CardPlatforms, { cardId: 'card-1' }).use(pinia).use(i18n).use(router); app.mount(root); await settle();
}
const playButton = () => [...root.querySelectorAll('button')].find(b => b.textContent?.trim() === i18n.global.t('card.play'));

it('skips the platform choice when the card has a single playable source', async () => {
  mocks.platforms.mockResolvedValue([{ provider: 'harbor', roleId: 'r1', playable: true }]);
  await mount();
  expect(root.querySelector('fieldset')).toBeNull();
  expect(root.textContent).not.toContain(i18n.global.t('linked.playWith'));
  expect(playButton()).toBeDefined();
});

it('still asks which platform when several sources exist', async () => {
  mocks.platforms.mockResolvedValue([{ provider: 'harbor', roleId: 'r1', playable: true }, { provider: 'other', roleId: 'r2', playable: true }]);
  await mount();
  expect(root.querySelector('fieldset')).not.toBeNull();
  expect(playButton()).toBeUndefined();
});
