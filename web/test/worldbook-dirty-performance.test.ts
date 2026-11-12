import { expect, it, vi } from 'vitest';
import { useWorldbookDraft } from '../src/lib/worldbook-draft';
it('editing one of 4001 entries reserializes only that entry and detects nested edits and reverting', () => {
  const book = useWorldbookDraft({ untitled: () => '', fallbackName: () => '', language: () => 'zh' });
  book.entries = Array.from({ length: 4001 }, (_, i) => ({ name: `${i}`, content: '合成'.repeat(1000), keywords: ['key'], isConstant: false }));
  book.original = JSON.parse(JSON.stringify(book.entries));
  expect(book.dirty()).toBe(false);
  const stringify = vi.spyOn(JSON, 'stringify');
  try {
    book.entries[2000] = { ...book.entries[2000], content: '修改' };
    expect(book.dirty()).toBe(true);
    expect(stringify.mock.calls.length).toBeLessThanOrEqual(1);
    book.entries[2000].content = book.original[2000].content;
    expect(book.dirty()).toBe(false);
    book.entries[4000].keywords.push('nested'); expect(book.dirty()).toBe(true);
    book.entries[4000].keywords.pop(); expect(book.dirty()).toBe(false);
    book.entries.reverse(); expect(book.dirty()).toBe(true);
  } finally { stringify.mockRestore(); }
});
