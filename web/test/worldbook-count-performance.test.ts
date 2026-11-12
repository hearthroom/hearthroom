import { afterEach, expect, it, vi } from 'vitest';
import { effectScope, reactive, nextTick } from 'vue';
import { useWorldbookCounts } from '../src/lib/worldbook-counts';
import { worldbookReviewCounts } from '../src/lib/draft-review-length';
import type { WorldbookEntryDraft } from '../src/lib/role-draft';
const scopes: ReturnType<typeof effectScope>[] = [];
afterEach(() => { scopes.splice(0).forEach(s => s.stop()); vi.useRealTimers(); vi.restoreAllMocks(); });
function setup(n = 4001) {
  vi.useFakeTimers();
  const entries = reactive(Array.from({ length: n }, (_, i) => ({ name: `entry${i}`, content: `條目${i}` + '合成'.repeat(i < 3501 ? 150 : i < 3901 ? 1000 : 4000), keywords: [], isEnabled: true, isConstant: i % 20 === 0 })) as WorldbookEntryDraft[]);
  const scope = effectScope(); scopes.push(scope);
  const counts = scope.run(() => useWorldbookCounts(() => entries, () => entries, () => true))!;
  return { entries, counts };
}
it('4001 entries yield before parsing and a content edit parses only that entry', async () => {
  const segment = vi.spyOn(Intl.Segmenter.prototype, 'segment');
  const { entries, counts } = setup();
  expect(segment).not.toHaveBeenCalled();
  expect(counts.value).toBeNull();
  await vi.runAllTimersAsync();
  expect(counts.value?.total).toBeGreaterThan(2_000_000);
  // This fixture contains only BMP letters and digits, so its length is an
  // independent total oracle without parsing the entire book a second time.
  const initialTotal = entries.reduce((total, row) => total + row.content.length, 0);
  expect(counts.value?.total).toBe(initialTotal);
  const previousEntryTotal = worldbookReviewCounts([entries[2000]])!.total;
  segment.mockClear();
  entries[2000] = { ...entries[2000], content: '修改內容' };
  await nextTick(); await vi.runAllTimersAsync();
  expect(segment).toHaveBeenCalledTimes(1);
  expect(counts.value?.total).toBe(initialTotal - previousEntryTotal + worldbookReviewCounts([entries[2000]])!.total);
// The budget is yielding and parse count, not total wall time on a shared CI
// runner. Keep the full 4001-entry fixture while allowing its first count to finish.
}, 30_000);
it('metadata changes reuse counts; disabled and constant flags retain shared semantics', async () => {
  const { entries, counts } = setup(3); await vi.runAllTimersAsync();
  const segment = vi.spyOn(Intl.Segmenter.prototype, 'segment');
  entries[1].name = 'renamed'; entries[1].isConstant = true; entries[0].isEnabled = false;
  await nextTick(); await vi.runAllTimersAsync();
  expect(segment).not.toHaveBeenCalled();
  expect(counts.value).toEqual({ ...worldbookReviewCounts(entries), reviewConstant: worldbookReviewCounts(entries)?.constant });
});
it('cancels superseded batches and clears results when loading becomes unavailable', async () => {
  vi.useFakeTimers(); const state = reactive({ ready: true, entries: [{ content: '甲', isConstant: true, keywords: [], name: '' }] as WorldbookEntryDraft[] });
  const scope = effectScope(); scopes.push(scope);
  const counts = scope.run(() => useWorldbookCounts(() => state.entries, () => state.entries, () => state.ready))!;
  state.entries = [{ ...state.entries[0], content: '乙丙' }]; await nextTick(); await vi.runAllTimersAsync();
  expect(counts.value).toEqual({ total: 2, constant: 2, reviewConstant: 2 });
  state.ready = false; await nextTick(); expect(counts.value).toBeNull();
});
it('review constants include other bound books without including their nonconstant text', async () => {
  vi.useFakeTimers();
  const current = reactive([{ name: '', keywords: [], content: '甲乙', isConstant: false }] as WorldbookEntryDraft[]);
  const other = reactive([{ name: '', keywords: [], content: '丙丁戊', isConstant: true }, { name: '', keywords: [], content: '己庚', isConstant: false }] as WorldbookEntryDraft[]);
  const scope = effectScope(); scopes.push(scope);
  const counts = scope.run(() => useWorldbookCounts(() => current, () => [...other, ...current], () => true))!;
  await vi.runAllTimersAsync(); expect(counts.value).toEqual({ total: 2, constant: 0, reviewConstant: 3 });
  current[0].isConstant = true; await nextTick(); await vi.runAllTimersAsync();
  expect(counts.value).toEqual({ total: 2, constant: 2, reviewConstant: 5 });
});
it('disposed editors do not publish queued counts', async () => {
  const { counts } = setup(3); scopes[0].stop(); await vi.runAllTimersAsync(); expect(counts.value).toBeNull();
});
