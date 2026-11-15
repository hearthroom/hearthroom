type Binding = Pick<KVNamespace, 'put'>;
type Write = { content: string; payload: string; expiresAt: number; expirationTtl: number };
type Pending = { content: string; expiresAt: number; promise: Promise<void> };
const pending = new WeakMap<Binding, Map<string, Pending>>();
const MAX_KEYS = 64;
const MAX_PAYLOAD = 65_536;

/** Public projections only. Share in-flight writes, never loaded or returned objects. */
export function writePublicKv(cache: Binding, key: string, entry: Write): Promise<void> {
  let writes = pending.get(cache);
  const previous = writes?.get(key);
  // Keeping the earlier deadline cannot extend the caller's freshness allowance.
  if (previous?.content === entry.content && previous.expiresAt <= entry.expiresAt) {
    return previous.promise;
  }
  // A unique/large response still gets written; it simply cannot retain isolate memory.
  if (entry.payload.length > MAX_PAYLOAD || (!previous && (writes?.size ?? 0) >= MAX_KEYS)) {
    return cache.put(key, entry.payload, { expirationTtl: entry.expirationTtl });
  }
  if (!writes) {
    writes = new Map();
    pending.set(cache, writes);
  }
  const active = writes;
  const current: Pending = {
    content: entry.content,
    expiresAt: entry.expiresAt,
    promise: Promise.resolve().then(() => cache.put(key, entry.payload, {
      expirationTtl: entry.expirationTtl,
    })).finally(() => {
      if (active.get(key) === current) active.delete(key);
    }),
  };
  active.set(key, current);
  return current.promise;
}
