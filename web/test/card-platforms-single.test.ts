// 只有一個遊玩平台就不必讓人選：直接給「開始遊玩」，少一步就少一次流失。多個平台才顯示選擇。
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp, nextTick, type App } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { i18n } from '../src/lib/i18n';
import CardPlatforms from '../src/components/CardPlatforms.vue';
import { useSession } from '../src/lib/session';
const mocks = vi.hoisted(() => ({ platforms: vi.fn() }));
vi.mock('../src/lib/api', async original => ({ ...await original<typeof import('../src/lib/api')>(), fetchCardPlatforms: mocks.platforms }));
const connections = vi.hoisted(() => ({ accountToken: vi.fn(), connectedBalance: vi.fn(async () => null), connectAccount: vi.fn() }));
vi.mock('../src/lib/connections', () => connections);
let app: App; let root: HTMLElement;
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); await nextTick(); };
beforeEach(() => vi.clearAllMocks());
afterEach(() => { app?.unmount(); root?.remove(); });
async function mount(before?: () => void) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:p(.*)*', component: { template: '<div />' } }] });
  await router.push('/cards/1');
  const pinia = createPinia(); setActivePinia(pinia);
  before?.();
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
  expect(root.textContent).not.toContain(i18n.global.t('linked.playHint'));
});

it('still asks which platform when several sources exist', async () => {
  mocks.platforms.mockResolvedValue([{ provider: 'harbor', roleId: 'r1', playable: true }, { provider: 'other', roleId: 'r2', playable: true }]);
  await mount();
  expect(root.querySelector('fieldset')).not.toBeNull();
  expect(playButton()).toBeUndefined();
});

// 餘額只在選平台的清單裡出現：開卡時不該為了一個看不到的數字依序問「我是誰」和錢包
it('does not look up balances when there is no platform list to show them in', async () => {
  mocks.platforms.mockResolvedValue([{ provider: 'harbor', roleId: 'r1', playable: true }]);
  await mount(signedIn);
  expect(connections.connectedBalance).not.toHaveBeenCalled();
});

it('shows the signed-in Harbor balance from the session instead of asking again', async () => {
  mocks.platforms.mockResolvedValue([{ provider: 'harbor', roleId: 'r1', playable: true }, { provider: 'other', roleId: 'r2', playable: true }]);
  await mount(signedIn);
  expect(root.textContent).toContain(i18n.global.t('linked.balance', { amount: 420 }));
  expect(connections.connectedBalance).not.toHaveBeenCalledWith('harbor', expect.anything());
});

function signedIn() {
  const session = useSession();
  session.me = { accountNumId: 7, nickName: '', avatar: '' };
  session.profile = { identities: [{ provider: 'harbor', externalId: 7 }] } as never;
  session.wallet = { score: 420, tempScore: 0, plans: [] };
}
