/** 個人主頁切分區只改網址參數，不能把頁面拉回頂端；換頁面照舊回頂端，返回鍵照舊回原位。 */
import { expect, it, vi } from 'vitest';
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
it('restores the saved position on back and forward', async () => {
  const restore = withPageHeight(2000);
  try { expect(await scrollFor(at('/me'), at('/wallet'), { left: 0, top: 480 })).toEqual({ left: 0, top: 480 }); }
  finally { restore(); }
});

/** 讓 jsdom 有一個可以改的頁面高度（視窗高 800）。回傳還原函式。 */
function withPageHeight(initial: number) {
  let height = initial;
  const html = document.documentElement;
  Object.defineProperty(html, 'scrollHeight', { configurable: true, get: () => height });
  const innerHeight = window.innerHeight;
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
  const restore = () => { delete (html as any).scrollHeight; Object.defineProperty(window, 'innerHeight', { configurable: true, value: innerHeight }); };
  return Object.assign(restore, { grow: (h: number) => { height = h; } });
}

// 搜尋、收藏、作者頁這些列表回來時會重讀一次：結果到之前頁面很短，馬上捲會被截在頂端附近（2026-11-21 搜尋頁 1143 → 187）
it('waits for a re-fetched list to grow back before restoring the position', async () => {
  const page = withPageHeight(900);
  try {
    let settled: unknown = 'pending';
    const restoring = Promise.resolve(scrollFor(at('/search', { q: 'x' }), at('/cards/1'), { left: 0, top: 1143 })).then(v => { settled = v; });
    await new Promise(r => setTimeout(r, 120));
    expect(settled).toBe('pending');
    page.grow(2043);
    await restoring;
    expect(settled).toEqual({ left: 0, top: 1143 });
  } finally { page(); }
});

// 正式站讀回（2026-11-21）：手機搜尋有一次超過 3 秒才回來，被截在 1608（原位 3330）
it('keeps waiting for a slow list well past three seconds', async () => {
  const page = withPageHeight(900);
  vi.useFakeTimers();
  try {
    let settled: unknown = 'pending';
    const restoring = Promise.resolve(scrollFor(at('/search'), at('/cards/1'), { left: 0, top: 3330 })).then(v => { settled = v; });
    await vi.advanceTimersByTimeAsync(4000);
    expect(settled).toBe('pending');
    page.grow(4174);
    await vi.advanceTimersByTimeAsync(100);
    await restoring;
    expect(settled).toEqual({ left: 0, top: 3330 });
  } finally { vi.useRealTimers(); page(); }
});

it('stops waiting at ten seconds when the list never grows back', async () => {
  const page = withPageHeight(900);
  vi.useFakeTimers();
  try {
    let settled: unknown = 'pending';
    void Promise.resolve(scrollFor(at('/search'), at('/cards/1'), { left: 0, top: 3330 })).then(v => { settled = v; });
    await vi.advanceTimersByTimeAsync(9900);
    expect(settled).toBe('pending');
    await vi.advanceTimersByTimeAsync(200);
    expect(settled).toEqual({ left: 0, top: 3330 });
  } finally { vi.useRealTimers(); page(); }
});

it('gives up waiting when the reader starts scrolling or leaves the page', async () => {
  const page = withPageHeight(900);
  try {
    const scrolled = scrollFor(at('/search'), at('/cards/1'), { left: 0, top: 1143 });
    window.dispatchEvent(new Event('wheel'));
    expect(await scrolled).toBe(false);
    const left = scrollFor(at('/search'), at('/cards/1'), { left: 0, top: 1143 });
    history.pushState(null, '', '/elsewhere');
    page.grow(2043);
    expect(await left).toBe(false);
  } finally { page(); history.replaceState(null, '', '/'); }
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
