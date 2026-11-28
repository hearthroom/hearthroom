import { boardCache } from './board-cache';
import { HttpError, type Env } from './types';
import { provePublicAggregates } from './work-read';

const PROOF_MS = 30_000;
const REFRESH_BEFORE_MS = 7_500;
const FAILURE_BACKOFF_MS = 2_000;
type Proof = { expiresAt: number; hit: boolean };
type SharedRow = {
  clock_revision: number; revision: number | null; expires_at: number;
  lease_until: number; failure_code: string; failed_until: number;
};
const inFlight = new Map<string, Promise<Proof>>();
const unavailable = () => new HttpError(503, 'visibility_provider_unavailable');
const policyChanged = (error: unknown) => error instanceof HttpError && error.message === 'visibility_sync_pending';

function validExpiry(expiresAt: number, now: number): boolean {
  return Number.isSafeInteger(expiresAt) && expiresAt > now && expiresAt <= now + PROOF_MS;
}

async function sharedProof(env: Env, scope: string, revision: number): Promise<SharedRow> {
  const row = await env.DB.prepare(`SELECT m.revision AS clock_revision,p.revision,coalesce(p.expires_at,0) AS expires_at,
    coalesce(p.lease_until,0) AS lease_until,coalesce(p.failure_code,'') AS failure_code,coalesce(p.failed_until,0) AS failed_until
    FROM moderation_clock m LEFT JOIN public_aggregate_proof p ON p.scope=? WHERE m.id=1`).bind(scope).first<SharedRow>();
  if (!row || row.clock_revision !== revision) throw unavailable();
  return row;
}

function boundedFailure(error: unknown): string {
  if (policyChanged(error)) return 'visibility_sync_pending';
  if (error instanceof HttpError && error.message === 'visibility_read_budget_exceeded') return error.message;
  return 'visibility_provider_unavailable';
}

async function rememberProof(cache: Cache | undefined, key: Request, expiresAt: number): Promise<void> {
  const remaining = Math.floor((expiresAt - Date.now()) / 1000);
  if (!cache || remaining <= 0) return;
  await cache.put(key, new Response(null, { headers: {
    'Cache-Control': `public, max-age=${remaining}`,
    'X-Proof-Expires-At': String(expiresAt),
  } })).catch(() => { console.warn('Public aggregate proof cache write unavailable'); });
}

async function buildSharedProof(
  env: Env, scope: string, zone: string | undefined, revision: number, replaceAt: number,
): Promise<Proof> {
  const db = env.DB;
  const deadline = performance.now() + PROOF_MS;
  for (let delay = 100; performance.now() < deadline; delay = Math.min(delay * 2, 1500)) {
    const row = await sharedProof(env, scope, revision);
    const now = Date.now();
    if (row.revision === revision && row.expires_at > replaceAt && validExpiry(row.expires_at, now)) {
      return { expiresAt: row.expires_at, hit: true };
    }
    if (row.revision === revision && row.failed_until > now) throw new HttpError(503, row.failure_code);
    if (row.revision === null || row.revision < revision || row.lease_until <= now) {
      const lease = crypto.randomUUID();
      const expiresAt = now + PROOF_MS;
      const claimed = await db.prepare(`INSERT INTO public_aggregate_proof(scope,revision,lease,lease_until)
        VALUES(?,?,?,?) ON CONFLICT(scope) DO UPDATE SET
          expires_at=CASE WHEN revision=excluded.revision THEN expires_at ELSE 0 END,
          revision=excluded.revision,lease=excluded.lease,lease_until=excluded.lease_until,
          failure_code='',failed_until=0
        WHERE revision<excluded.revision
          OR (revision=excluded.revision AND lease_until<=? AND expires_at<=? AND failed_until<=?)
        RETURNING 1 AS won`).bind(scope, revision, lease, expiresAt, now, Math.max(now, replaceAt), now).first();
      if (claimed) {
        try {
          await provePublicAggregates(env, zone, expiresAt);
          const finished = Date.now();
          if (finished >= expiresAt) throw unavailable();
          const saved = await db.prepare(`UPDATE public_aggregate_proof SET expires_at=?,lease='',lease_until=0
            WHERE scope=? AND revision=? AND lease=? AND lease_until>?
              AND EXISTS(SELECT 1 FROM moderation_clock WHERE id=1 AND revision=?)`)
            .bind(expiresAt, scope, revision, lease, finished, revision).run();
          if (!saved.meta.changes) throw unavailable();
          return { expiresAt, hit: false };
        } catch (error) {
          await db.prepare(`UPDATE public_aggregate_proof SET lease='',lease_until=0,
            expires_at=CASE WHEN ? THEN 0 ELSE expires_at END,failure_code=?,failed_until=?
            WHERE scope=? AND revision=? AND lease=?`)
            .bind(policyChanged(error) ? 1 : 0, boundedFailure(error), Date.now() + FAILURE_BACKOFF_MS, scope, revision, lease)
            .run().catch(() => {});
          throw error;
        }
      }
    }
    // Another isolate owns the expensive proof. A bounded wait reads its
    // result by primary key, with no duplicate catalog scan.
    await new Promise(resolve => setTimeout(resolve, Math.min(delay, Math.max(0, deadline - performance.now()))));
  }
  throw unavailable();
}

export async function proveCachedPublicAggregates(
  env: Env, ctx: Pick<ExecutionContext, 'waitUntil'>, requestUrl: string, zone: string | undefined, revision: number,
): Promise<Proof> {
  const url = new URL('/__aggregate-proof', requestUrl);
  url.searchParams.set('zone', zone ?? 'all');
  url.searchParams.set('revision', String(revision));
  const key = new Request(url);
  const scope = JSON.stringify([boardCache.namespace, url.origin, zone ?? 'all']);
  let cache: Cache | undefined;
  let cachedExpiry = 0;
  try {
    cache = await caches.open(`${boardCache.namespace}-aggregate-proof-v2`);
    const stored = await cache.match(key);
    cachedExpiry = Number(stored?.headers.get('X-Proof-Expires-At'));
  } catch {
    console.warn('Public aggregate proof cache read unavailable');
  }
  const now = Date.now();
  let current = validExpiry(cachedExpiry, now);
  if (current && cachedExpiry - now > REFRESH_BEFORE_MS) return { expiresAt: cachedExpiry, hit: true };
  if (current) {
    // Another isolate can invalidate the receipt during the refresh window.
    // Every edge copy of that receipt has the same hard expiry.
    const row = await sharedProof(env, scope, revision).catch(() => { throw unavailable(); });
    const checkedAt = Date.now();
    current = row.revision === revision && validExpiry(row.expires_at, checkedAt);
    if (current && row.expires_at > cachedExpiry) ctx.waitUntil(rememberProof(cache, key, row.expires_at));
    cachedExpiry = row.expires_at;
    if (current && (cachedExpiry - checkedAt > REFRESH_BEFORE_MS || row.failed_until > checkedAt)) {
      return { expiresAt: cachedExpiry, hit: true };
    }
  }

  let pending = inFlight.get(key.url);
  const hit = Boolean(pending);
  if (!pending) {
    const gate = Promise.withResolvers<Proof>();
    pending = gate.promise;
    inFlight.set(key.url, pending);
    ctx.waitUntil((async () => {
      try {
        const result = await buildSharedProof(env, scope, zone, revision, current ? cachedExpiry : now);
        gate.resolve(result);
        await rememberProof(cache, key, result.expiresAt);
      } catch (error) {
        gate.reject(error instanceof HttpError ? error : unavailable());
        if (cache && policyChanged(error)) await cache.delete(key).catch(() => {});
      } finally {
        inFlight.delete(key.url);
      }
    })());
  }
  if (current) {
    // Failure never lengthens the previous proof. Requests after its hard
    // expiry have to await a newly verified result.
    ctx.waitUntil(pending.catch(() => {}));
    if (validExpiry(cachedExpiry, Date.now())) return { expiresAt: cachedExpiry, hit: true };
  }
  const proof = await pending;
  if (!validExpiry(proof.expiresAt, Date.now())) throw unavailable();
  return { expiresAt: proof.expiresAt, hit: hit || proof.hit };
}
