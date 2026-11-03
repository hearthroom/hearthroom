/** 個人主頁切分區只改網址參數，不能把頁面拉回頂端；換頁面照舊回頂端，返回鍵照舊回原位。 */
import { expect, it } from 'vitest';
import { prepareBoardScroll } from '../src/lib/board-memory';
import { scrollFor } from '../src/router';

it('bounds author workspaces and parks the pet only on working surfaces', async () => {
  const { router } = await import('../src/router');
  for (const prefix of ['', '/en', '/ja', '/ko', '/zh-Hans']) {
    for (const path of ['/create', '/cards/100001/edit']) {
      expect(router.resolve(prefix + path).meta.workspace, prefix + path).toBe(true);
      expect(router.resolve(prefix + path).meta.petAway, prefix + path).toBe(true);
    }
    expect(router.resolve(prefix + '/review/local-review').meta.petAway).toBe(true);
    expect(router.resolve(prefix + '/review').meta.petAway).not.toBe(true);
  }
});

const at = (path: string, query: Record<string, string> = {}, meta: Record<string, unknown> = {}) => ({ path, query, meta }) as any;

it('keeps the position when only the query changes on a page that asks for it', () => {
  expect(scrollFor(at('/me', { tab: 'saved' }, { keepScrollOnQuery: true }), at('/me', {}, { keepScrollOnQuery: true }), null)).toBe(false);
});
it('still scrolls to the top on a new page or on pages that did not ask', () => {
  expect(scrollFor(at('/wallet'), at('/me', {}, { keepScrollOnQuery: true }), null)).toEqual({ top: 0 });
  expect(scrollFor(at('/authors/a', { offset: '24' }), at('/authors/a'), null)).toEqual({ top: 0 });
});
it('restores the saved position on back and forward', () => {
  expect(scrollFor(at('/me'), at('/wallet'), { left: 0, top: 480 })).toEqual({ left: 0, top: 480 });
});

it('waits for the restored board DOM and corrects to the card anchor', async () => {
  prepareBoardScroll({ top: 480, anchor: '/cards/1', delta: 80 });
  const anchor = document.createElement('a'); anchor.href = '/cards/1'; anchor.className = 'card__link';
  const list = document.createElement('div'); list.dataset.boardList = ''; list.append(anchor); document.body.append(list);
  anchor.getBoundingClientRect = () => ({ top: 900 }) as DOMRect;
  expect(await scrollFor(at('/', {}, { board: true }), at('/cards/1'), { left: 0, top: 480 })).toEqual({ left: 0, top: 820 });
  list.remove(); prepareBoardScroll(null);
});

it('restores the clicked card after capture-phase decoration makes its href absolute', async () => {
  const leaving = document.createElement('a'); leaving.href = '/cards/1';
  const { decorateGa4Checkout } = await import('../src/lib/ga4');
  const click = new MouseEvent('click'); Object.defineProperty(click, 'target', { value: leaving });
  decorateGa4Checkout(click);
  expect(leaving.getAttribute('href')).toBe(leaving.href);
  prepareBoardScroll({ top: 480, anchor: leaving.getAttribute('href')!, delta: 80 });
  const returned = document.createElement('a'); returned.href = '/cards/1'; returned.className = 'card__link';
  const list = document.createElement('div'); list.dataset.boardList = ''; list.append(returned); document.body.append(list);
  returned.getBoundingClientRect = () => ({ top: 900 }) as DOMRect;
  try { expect(await scrollFor(at('/', {}, { board: true }), at('/cards/1'), { left: 0, top: 480 })).toEqual({ left: 0, top: 820 }); }
  finally { list.remove(); prepareBoardScroll(null); }
});

it('keeps the board where it is when only the chosen types change (phone type panel, desktop type row)', async () => {
  const { router } = await import('../src/router');
  for (const prefix of ['', '/en']) {
    const home = prefix || '/';
    expect(scrollFor(router.resolve({ path: home, query: { tag: 'romance' } }), router.resolve(home), null), prefix).toBe(false);
    expect(scrollFor(router.resolve({ path: home, query: { tag: ['romance', 'fantasy'], sort: 'week' } }), router.resolve({ path: home, query: { tag: 'romance', sort: 'week', offset: '24' } }), null), prefix).toBe(false);
    expect(scrollFor(router.resolve(home), router.resolve({ path: home, query: { tag: 'romance' } }), null), prefix).toBe(false);
    // 換排序、換分級、只換頁、從別頁帶著類型進首頁，仍照舊回頂端
    expect(scrollFor(router.resolve({ path: home, query: { sort: 'week' } }), router.resolve(home), null), prefix).toEqual({ top: 0 });
    expect(scrollFor(router.resolve({ path: home, query: { tag: 'romance', rating: 'pg' } }), router.resolve({ path: home, query: { tag: 'romance' } }), null), prefix).toEqual({ top: 0 });
    expect(scrollFor(router.resolve({ path: home, query: { tag: 'romance', offset: '24' } }), router.resolve({ path: home, query: { tag: 'romance' } }), null), prefix).toEqual({ top: 0 });
    expect(scrollFor(router.resolve({ path: home, query: { tag: 'romance' } }), router.resolve(`${prefix}/cards/1`), null), prefix).toEqual({ top: 0 });
  }
});
