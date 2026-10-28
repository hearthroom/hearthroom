import { afterEach, expect, it, vi } from 'vitest';
import { pushStageToast, stageToasts } from '../src/lib/stage-host';
afterEach(() => { vi.useRealTimers(); stageToasts.list = []; });
it('keeps a failure readable for five seconds and preserves ordinary feedback duration', async () => {
 vi.useFakeTimers();
 pushStageToast('Failure', 'error');pushStageToast('Done', 'success');
 await vi.advanceTimersByTimeAsync(2800);
 expect(stageToasts.list.map(t=>t.text)).toEqual(['Failure']);
 await vi.advanceTimersByTimeAsync(2199);
 expect(stageToasts.list).toHaveLength(1);
 await vi.advanceTimersByTimeAsync(1);
 expect(stageToasts.list).toHaveLength(0);
});
it('keeps a long informational fallback readable for the requested six seconds', async () => {
 vi.useFakeTimers();
 pushStageToast('Preference fallback', 'info', 6000);
 await vi.advanceTimersByTimeAsync(5999);
 expect(stageToasts.list.map(t=>t.text)).toEqual(['Preference fallback']);
 await vi.advanceTimersByTimeAsync(1);
 expect(stageToasts.list).toHaveLength(0);
});
