// 主頁數據列：縮寫的數字可以點開看確切值（任務 2026-11-26-profile-stat-numbers ui.md §4–5）。
import { afterEach, expect, it } from 'vitest';
import { createApp, h, nextTick, type App } from 'vue';
import { i18n } from '../src/lib/i18n';
import ProfileStats from '../src/components/profile/ProfileStats.vue';

let app: App | undefined; let root: HTMLElement;
afterEach(() => { app?.unmount(); root?.remove(); i18n.global.locale.value = 'zh-Hant'; });
async function mount(props: Record<string, unknown>) {
  i18n.global.locale.value = 'zh-Hant';
  root = document.createElement('div'); document.body.append(root);
  app = createApp({ render: () => h(ProfileStats, { works: 12, chats: 19_999, followers: 54_321, following: 7, ...props }) }).use(i18n);
  app.mount(root); await nextTick();
}
const exactButtons = () => [...root.querySelectorAll<HTMLButtonElement>('button.pstats__num')];
const bubble = () => root.querySelector<HTMLElement>('.pstats__exact');

it('他人看：一萬以上縮寫成可點的數字，未滿一萬是一般文字', async () => {
  await mount({});
  expect(exactButtons().map(b => b.textContent?.trim())).toEqual(['5.4萬', '1.9萬']);
  const chats = exactButtons()[1];
  expect(chats.title).toBe('19,999');
  expect(chats.getAttribute('aria-label')).toContain('19,999');
  expect(root.textContent).toContain('12');
});

it('點一下出現確切數字，再點一下、Esc、點外面都會關', async () => {
  await mount({});
  const chats = exactButtons()[1];
  chats.click(); await nextTick();
  expect(bubble()?.textContent?.trim()).toBe('19,999');
  expect(chats.getAttribute('aria-expanded')).toBe('true');
  chats.click(); await nextTick();
  expect(bubble()).toBeNull();
  chats.click(); await nextTick();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await nextTick();
  expect(bubble()).toBeNull();
  expect(document.activeElement).toBe(chats);
  chats.click(); await nextTick();
  document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); await nextTick();
  expect(bubble()).toBeNull();
});

it('氣泡不放在有圓角裁切的格子裡', async () => {
  await mount({});
  exactButtons()[0].click(); await nextTick();
  expect(bubble()?.closest('.pstats__grid')).toBeNull();
  expect(bubble()?.closest('.pstats')).not.toBeNull();
});

it('本人看自己：99,999 以內寫全數、不必點', async () => {
  await mount({ own: true });
  expect(exactButtons()).toHaveLength(0);
  expect(root.textContent).toContain('54,321');
  expect(root.textContent).toContain('19,999');
});

it('可開名單的格子整格是按鈕：不再套數字按鈕，滑過帶確切值', async () => {
  await mount({ followersOpen: true });
  const open = root.querySelector<HTMLButtonElement>('.pstats__stat--open')!;
  expect(open.querySelector('button')).toBeNull();
  expect(open.title).toBe('54,321');
  expect(open.textContent).toContain('5.4萬');
});
