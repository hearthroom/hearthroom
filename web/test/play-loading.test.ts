/**
 * 對話頁的載入畫面：從進頁第一幀蓋到舞台真的畫出東西為止，不再是一片黑。
 *   - 卡片頁交過來的卡名與封面（lib/play-intro）第一幀就畫；沒有就等卡片解析好再補上。
 *   - 舞台掛上去了還不收：舞台喊「畫好了」（stage-ready）才收。
 *   - 舞台一直沒喊（卡住、舊版舞台）：時限到了照樣收，不把人永遠擋在外面。
 *   - 載入失敗：收掉，露出錯誤與返回鈕。
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp, nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { i18n } from '../src/lib/i18n';
import { useSession } from '../src/lib/session';
import { setProvider } from '../src/lib/provider';
import { savePlayIntro } from '../src/lib/play-intro';
import { markStageContentReady } from '../src/lib/stage-ready';
import PlayPage from '../src/pages/PlayPage.vue';
const mocks = vi.hoisted(() => ({ stage: vi.fn(), card: vi.fn() }));
vi.mock('../src/lib/stage-host', () => ({ ensureStage: mocks.stage, preloadStage: async () => {}, remergeStageMessages: vi.fn(), stageToasts: { list: [] } }));
vi.mock('../src/lib/connections', () => ({ accountToken: vi.fn(), connectAccount: vi.fn() }));
vi.mock('../src/lib/play-authorization', () => ({ ensurePlayAuthorization: vi.fn() }));
vi.mock('../src/lib/api', async original => ({ ...await original<typeof import('../src/lib/api')>(),
  fetchCard: mocks.card, fetchCardPlatforms: async () => [{ provider: 'harbor', roleId: 'harbor-role', playable: true }] }));

let app: ReturnType<typeof createApp> | undefined; let root: HTMLElement | undefined;
const settle = async () => { for (let i = 0; i < 60; i++) await Promise.resolve(); await nextTick(); };
const cover = () => root!.querySelector<HTMLElement>('.play-cover');
// 收的時候有 250ms 淡出；jsdom 不會跑完 CSS 過渡，正在淡出就算收了
const covered = () => !!cover() && !cover()!.classList.contains('play-cover-leave-active');
async function mount(path: string) {
  const pinia = createPinia(); setActivePinia(pinia);
  const session = useSession();
  session.ready = true; session.me = null;
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/play/:roleId', component: PlayPage }] });
  await router.push(path);
  root = document.createElement('div'); document.body.append(root);
  app = createApp(PlayPage).use(pinia).use(i18n).use(router); app.mount(root);
}
beforeEach(() => {
  setProvider('harbor'); sessionStorage.clear(); vi.useRealTimers();
  mocks.stage.mockReset().mockResolvedValue({ template: '<div>Fixture player</div>' });
  mocks.card.mockReset().mockResolvedValue({ id: '100194', num: 100194, status: 'approved', name: '露娜', avatarUrl: 'https://img.test/art.webp', landscapeUrl: 'https://img.test/wide.webp' });
});
afterEach(() => { app?.unmount(); root?.remove(); document.body.innerHTML = ''; app = undefined; vi.useRealTimers(); });

it('第一幀就畫卡片頁交過來的卡名與封面', async () => {
  savePlayIntro(['100194'], { name: '約會大作戰', art: 'https://img.test/a.webp', backdrop: 'https://img.test/b.webp' });
  await mount('/play/100194');
  await nextTick();
  expect(covered()).toBe(true);
  expect(cover()!.textContent).toContain('約會大作戰');
  expect(cover()!.querySelector('img')?.getAttribute('src')).toBe('https://img.test/a.webp');
  expect(cover()!.getAttribute('role')).toBe('status');
});

it('沒有交接（直接開網址）：卡片解析好之後補上卡名與封面', async () => {
  await mount('/play/100194');
  await settle();
  expect(cover()!.textContent).toContain('露娜');
  expect(cover()!.querySelector('img')?.getAttribute('src')).toBe('https://img.test/art.webp');
});

it('舞台掛上了還蓋著，舞台喊畫好了才收', async () => {
  await mount('/play/100194');
  await settle();
  expect(root!.textContent).toContain('Fixture player');
  expect(covered()).toBe(true);
  markStageContentReady();
  await settle();
  expect(covered()).toBe(false);
});

it('舞台一直沒喊：時限到了照樣收', async () => {
  vi.useFakeTimers();
  await mount('/play/100194');
  await settle();
  expect(covered()).toBe(true);
  await vi.advanceTimersByTimeAsync(25_000);
  await settle();
  expect(covered()).toBe(false);
});

// 時限只從舞台掛上才開始算：舞台還沒掛上就是還在載，收掉只會留下一片空白
it('舞台還沒掛上：過了時限也繼續蓋著', async () => {
  vi.useFakeTimers();
  mocks.stage.mockReturnValue(new Promise(() => {}));
  await mount('/play/100194');
  await settle();
  await vi.advanceTimersByTimeAsync(60_000);
  await settle();
  expect(covered()).toBe(true);
});

it('載入失敗：收掉，露出錯誤', async () => {
  mocks.card.mockRejectedValue(new Error('down'));
  await mount('/play/100194');
  await settle();
  expect(covered()).toBe(false);
  expect(root!.textContent).toContain(i18n.global.t('play.loadFailed'));
});
