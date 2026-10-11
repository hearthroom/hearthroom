// 從對話頁按返回回到卡片頁：瀏覽器從往返快取（bfcache）原樣還原這一頁，按下「開始對話」時記下的
// 忙碌狀態也跟著回來，按鈕就一直是灰的。頁面被還原（pageshow 帶 persisted）時要把它放開。
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp, nextTick, type App } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { i18n } from '../src/lib/i18n';
import CardPlatforms from '../src/components/CardPlatforms.vue';
import { readPlayIntro } from '../src/lib/play-intro';
const mocks = vi.hoisted(() => ({ platforms: vi.fn() }));
vi.mock('../src/lib/api', async original => ({ ...await original<typeof import('../src/lib/api')>(), fetchCardPlatforms: mocks.platforms }));
vi.mock('../src/lib/connections', () => ({ accountToken: vi.fn(), connectedBalance: vi.fn(async () => null), connectAccount: vi.fn() }));
let app: App; let root: HTMLElement;
const assign = vi.fn();
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); await nextTick(); };
beforeEach(() => { vi.clearAllMocks(); sessionStorage.clear(); vi.stubGlobal('location', { assign, origin: 'https://hearthroom.test', hostname: 'hearthroom.test', host: 'hearthroom.test', protocol: 'https:', href: 'https://hearthroom.test/cards/1', pathname: '/cards/1', search: '', hash: '' }); });
afterEach(() => { app?.unmount(); root?.remove(); vi.unstubAllGlobals(); });
async function mount() {
  mocks.platforms.mockResolvedValue([{ provider: 'harbor', roleId: 'r1', playable: true }]);
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:p(.*)*', component: { template: '<div />' } }] });
  await router.push('/cards/1');
  setActivePinia(createPinia());
  root = document.createElement('div'); document.body.append(root);
  app = createApp(CardPlatforms, { cardId: 'card-1', cardNumber: 100194, intro: { name: '露娜', art: 'https://img.test/a.webp', backdrop: 'https://img.test/b.webp' } })
    .use(createPinia()).use(i18n).use(router);
  app.mount(root); await settle();
}
const playButton = () => [...root.querySelectorAll('button')].find(b => b.textContent?.trim() === i18n.global.t('card.play'))!;
function pageshow(persisted: boolean) {
  const event = new Event('pageshow');
  Object.defineProperty(event, 'persisted', { value: persisted });
  window.dispatchEvent(event);
}

it('lets the player start again after coming back from the chat page', async () => {
  await mount();
  playButton().click(); await settle();
  expect(playButton().disabled).toBe(true);
  pageshow(true); await nextTick();
  expect(playButton().disabled).toBe(false);
});

it('hands the cover and name to the chat page before leaving', async () => {
  await mount();
  playButton().click(); await settle();
  expect(readPlayIntro('100194')).toEqual({ name: '露娜', art: 'https://img.test/a.webp', backdrop: 'https://img.test/b.webp' });
  expect(readPlayIntro('card-1')?.name).toBe('露娜');
  expect(readPlayIntro('999')).toBeNull();
});
