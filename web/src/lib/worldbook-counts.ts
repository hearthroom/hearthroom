import { onScopeDispose, shallowRef, watchEffect } from 'vue';
import { effectiveCharacters } from '../../../shared/review-count';
import type { WorldbookEntryDraft } from './role-draft';

/** Keep the shared counting semantics, but yield between short batches and reuse unchanged text.
 * The cache belongs to this editor scope; private book text is never retained globally.
 */
export function useWorldbookCounts(
  entries: () => readonly WorldbookEntryDraft[],
  reviewEntries: () => readonly WorldbookEntryDraft[],
  ready: () => boolean,
) {
  const result = shallowRef<{ total: number; constant: number; reviewConstant: number } | null>(null);
  const cache = new WeakMap<WorldbookEntryDraft, { content: string; count: number }>();
  const stop = watchEffect((cleanup) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    cleanup(() => clearTimeout(timer));
    result.value = null;
    if (!ready()) return;
    // Read reactive fields here so edits invalidate the batch before it can publish stale counts.
    const snapshot = (rows: readonly WorldbookEntryDraft[]) => rows.map(row => ({ row, content: row.content, enabled: row.isEnabled !== false, constant: row.isConstant === true }));
    const current = snapshot(entries());
    const review = snapshot(reviewEntries()).filter(row => row.enabled && row.constant);
    const pending = [...current.filter(row => row.enabled), ...review];
    let index = 0;
    function batch() {
      const start = performance.now();
      try {
        while (index < pending.length) {
          const item = pending[index++];
          if (cache.get(item.row)?.content !== item.content) cache.set(item.row, { content: item.content, count: effectiveCharacters(item.content) });
          if (performance.now() - start >= 8) { timer = setTimeout(batch, 0); return; }
        }
        const count = (item: typeof current[number]) => item.enabled ? cache.get(item.row)!.count : 0;
        result.value = {
          total: current.reduce((sum, item) => sum + count(item), 0),
          constant: current.reduce((sum, item) => sum + (item.constant ? count(item) : 0), 0),
          reviewConstant: review.reduce((sum, item) => sum + count(item), 0),
        };
      } catch { result.value = null; } // Same unavailable-count behavior as draft-review-length.
    }
    timer = setTimeout(batch, 0);
  });
  onScopeDispose(stop);
  return result;
}
