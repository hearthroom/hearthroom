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

it('hides average, stars, and histogram from non-authors when rating count is under 5, across all five locales', async () => {
  const expected: Record<string, string> = {
    'zh-Hant': '評分樣本過少',
    'zh-Hans': '评分样本过少',
    en: 'Not enough ratings',
    ja: '評価件数不足',
    ko: '평점 표본 부족',
  };
  for (const count of [0, 1, 2, 4]) {
    app?.unmount(); document.body.innerHTML = '';
    await applyLocale('zh-Hant');
    const root = document.createElement('div'); document.body.append(root);
    app = createApp(CardScore, {
      score: { average: count ? 2.5 : null, count, histogram: [count ? 1 : 0, 0, 0, count > 1 ? count - 1 : 0, 0], mine: null },
      own: false,
    }).use(i18n);
    app.mount(root); await nextTick();
    expect(root.querySelector('.score__avg')).toBeNull();
    expect(root.querySelector('.score__stars')).toBeNull();
    expect(root.querySelector('.score__hist')).toBeNull();
    expect(root.querySelector('.score__insufficient')?.textContent).toBe('評分樣本過少');
    expect(root.querySelector('.score__mine')).not.toBeNull();
  }
  for (const [loc, copy] of Object.entries(expected)) {
    app?.unmount(); document.body.innerHTML = '';
    await applyLocale(loc as any);
    const root = document.createElement('div'); document.body.append(root);
    app = createApp(CardScore, {
      score: { average: 2.5, count: 2, histogram: [1, 0, 0, 1, 0], mine: null },
      own: false,
    }).use(i18n);
    app.mount(root); await nextTick();
    expect(root.querySelector('.score__insufficient')?.textContent).toBe(copy);
  }
});

it('shows average, stars, and histogram to non-authors once rating count reaches 5, and always shows breakdown to the author', async () => {
  await applyLocale('zh-Hant');
  const root = document.createElement('div'); document.body.append(root);
  app = createApp(CardScore, {
    score: { average: 4.2, count: 5, histogram: [0, 0, 1, 2, 2], mine: null },
    own: false,
  }).use(i18n);
  app.mount(root); await nextTick();
  expect(root.querySelector('.score__insufficient')).toBeNull();
  expect(root.querySelector('.score__avg')?.textContent).toBe('4.2');
  expect(root.querySelector('.score__stars')).not.toBeNull();
  expect(root.querySelector('.score__hist')).not.toBeNull();

  app.unmount(); document.body.innerHTML = '';
  const ownRoot = document.createElement('div'); document.body.append(ownRoot);
  app = createApp(CardScore, {
    score: { average: 2.5, count: 2, histogram: [1, 0, 0, 1, 0], mine: null },
    own: true,
  }).use(i18n);
  app.mount(ownRoot); await nextTick();
  expect(ownRoot.querySelector('.score__insufficient')).toBeNull();
  expect(ownRoot.querySelector('.score__avg')?.textContent).toBe('2.5');
  expect(ownRoot.querySelector('.score__big')?.textContent).toContain('2 則評分');
  expect(ownRoot.querySelector('.score__hist')).not.toBeNull();
  expect(ownRoot.querySelector('.score__mine')).toBeNull();
});
