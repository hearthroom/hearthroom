import { expect, it, vi } from 'vitest';
import { writePublicKv } from '../src/public-kv-write';

function fixture() {
  const releases: (() => void)[] = [];
  const put = vi.fn((_key: string, _payload: string, _options: unknown) => new Promise<void>(resolve => releases.push(resolve)));
  return { cache: { put }, put, release: () => releases.splice(0).forEach(resolve => resolve()) };
}
const entry = (content = 'public', expiresAt = 300_000) => ({
  content, expiresAt, payload: JSON.stringify({ value: content, expires: expiresAt }), expirationTtl: 300,
});

it('keeps the earlier deadline, but writes changed data and shorter deadlines', async () => {
  const f = fixture();
  const first = writePublicKv(f.cache, 'same', entry());
  const later = writePublicKv(f.cache, 'same', entry('public', 300_500));
  expect(later).toBe(first);
  const changed = writePublicKv(f.cache, 'same', entry('changed', 300_600));
  const shorter = writePublicKv(f.cache, 'same', entry('changed', 250_000));
  await Promise.resolve();
  expect(f.put).toHaveBeenCalledTimes(3);
  expect(JSON.parse(f.put.mock.calls[0][1]).expires).toBe(300_000);
  expect(JSON.parse(f.put.mock.calls[2][1]).expires).toBe(250_000);
  f.release(); await Promise.all([first, later, changed, shorter]);
});

it('isolates bindings and semantic keys even when public content is identical', async () => {
  const a = fixture(), b = fixture();
  const writes = [writePublicKv(a.cache, 'general:r1', entry()), writePublicKv(a.cache, 'adult:r1', entry()),
    writePublicKv(a.cache, 'general:r2', entry()), writePublicKv(b.cache, 'general:r1', entry())];
  await Promise.resolve();
  expect(a.put).toHaveBeenCalledTimes(3); expect(b.put).toHaveBeenCalledTimes(1);
  a.release(); b.release(); await Promise.all(writes);
});

it('retries a failed write instead of retaining failure as a cache hit', async () => {
  const put = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
  const cache = { put };
  const first = writePublicKv(cache, 'same', entry());
  const duplicate = writePublicKv(cache, 'same', entry());
  const results = await Promise.allSettled([first, duplicate]);
  expect(results.map(value => value.status)).toEqual(['rejected', 'rejected']);
  await expect(writePublicKv(cache, 'same', entry())).resolves.toBeUndefined();
  expect(put).toHaveBeenCalledTimes(2);
});

it('an older completed write cannot remove a newer in-flight value', async () => {
  const f = fixture();
  const old = writePublicKv(f.cache, 'same', entry('old'));
  await Promise.resolve();
  f.release();
  const next = writePublicKv(f.cache, 'same', entry('next'));
  await old;
  expect(writePublicKv(f.cache, 'same', entry('next'))).toBe(next);
  f.release(); await next;
  // Completed writes are not retained as a second cache with its own lifetime.
  const again = writePublicKv(f.cache, 'same', entry('next'));
  await Promise.resolve(); f.release(); await again;
  expect(f.put).toHaveBeenCalledTimes(3);
});

it('still writes large public payloads and unique keys beyond the retention budget', async () => {
  const f = fixture();
  const large = entry('x'.repeat(70_000));
  const writes = [writePublicKv(f.cache, 'large', large), writePublicKv(f.cache, 'large', large)];
  for (let i = 0; i < 80; i++) writes.push(writePublicKv(f.cache, `unique:${i}`, entry()));
  await Promise.resolve();
  expect(f.put).toHaveBeenCalledTimes(82);
  expect(f.put.mock.calls.filter(call => call[0] === 'large').every(call => call[1] === large.payload)).toBe(true);
  f.release(); await Promise.all(writes);
});
