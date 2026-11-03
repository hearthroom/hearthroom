import { afterEach, expect, it, vi } from 'vitest';
import { createApp, nextTick, type App } from 'vue';
import CardScore from '../src/components/CardScore.vue';
import type { CardScore as Score } from '../src/lib/api';
import { i18n, applyLocale } from '../src/lib/i18n';

let app: App | undefined;
afterEach(() => { app?.unmount(); document.body.innerHTML = ''; });
async function mount(eligibility: Score['eligibility'], mine: number | null = null) {
  await applyLocale('zh-Hant');
  const rate = vi.fn(), write = vi.fn();
  const root = document.createElement('div'); document.body.append(root);
  app = createApp(CardScore, { score: { average: mine, count: mine ? 1 : 0, histogram: [0, 0, 0, 0, 0], mine, eligibility }, own: false, onRate: rate, onWrite: write }).use(i18n);
  app.mount(root); await nextTick();
  return { root, rate, write };
}
const progress = { eligible: false, turns: 2, credits: '500', requiredTurns: 6, paidTurns: 3, requiredCredits: '500' };

it('keeps progress visible and responds to a blocked star immediately without submitting a rating', async () => {
  const { root, rate, write } = await mount(progress);
  expect(root.querySelector('.score__progress')?.textContent).toContain('2／6');
  root.querySelector<HTMLButtonElement>('[data-star="1"]')!.click(); await nextTick();
  expect(rate).not.toHaveBeenCalled();
  expect(document.querySelector('[role="status"]')?.textContent).toBe(root.querySelector('.score__progress')?.textContent);
  root.querySelector<HTMLButtonElement>('.score__write')!.click();
  expect(write).toHaveBeenCalledOnce();
});

it('allows qualifying ratings and withdrawing a legacy rating without requiring progress', async () => {
  const { root, rate } = await mount(progress, 4);
  root.querySelector<HTMLButtonElement>('[data-star="4"]')!.click();
  expect(rate).toHaveBeenCalledWith(null);
});

it('never presents unavailable qualification as zero turns', async () => {
  const { root, rate } = await mount({ unavailable: true });
  root.querySelector<HTMLButtonElement>('[data-star="2"]')!.click(); await nextTick();
  expect(rate).not.toHaveBeenCalled();
  expect(document.querySelector('[role="status"]')?.textContent).toContain('暫時無法確認');
  expect(root.textContent).not.toContain('0／6');
});

it('lets the page handle guest login and eligible submissions', async () => {
  const { root, rate } = await mount({ ...progress, eligible: true, turns: 6 });
  root.querySelector<HTMLButtonElement>('[data-star="5"]')!.click();
  expect(rate).toHaveBeenCalledWith(5);
  expect(root.querySelector('.score__progress')).toBeNull();
});

it('keeps a rejected touch rating visually unselected and reserves hover preview for a mouse', async () => {
  const { root, rate } = await mount(progress);
  const star = root.querySelector<HTMLButtonElement>('[data-star="2"]')!;
  const pointer = (kind: string) => { const e = new Event('pointerenter'); Object.defineProperty(e, 'pointerType', { value: kind }); star.dispatchEvent(e); };
  pointer('touch');
  // Browsers also emit compatibility mouseenter after a tap.
  star.dispatchEvent(new MouseEvent('mouseenter'));
  star.click(); await nextTick();
  expect(rate).not.toHaveBeenCalled();
  expect(root.querySelectorAll('.score__star.is-on')).toHaveLength(0);
  pointer('mouse'); await nextTick();
  expect(root.querySelectorAll('.score__star.is-on')).toHaveLength(2);
  pointer('touch'); await nextTick();
  expect(root.querySelectorAll('.score__star.is-on')).toHaveLength(0);
});
