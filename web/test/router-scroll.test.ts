/** 個人主頁切分區只改網址參數，不能把頁面拉回頂端；換頁面照舊回頂端，返回鍵照舊回原位。 */
import { expect, it } from 'vitest';
import { scrollFor } from '../src/router';

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
