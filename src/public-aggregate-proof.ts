/// <reference lib="es2024.promise" />

import { bumpOp } from './ops-metrics';
import { HttpError, type Env } from './types';
import { provePublicAggregates } from './work-read';
import { siteRootOf } from '../shared/site-hosts';

const PROOF_MS = 30_000;
const REFRESH_BEFORE_MS = 15_000;
const FAILURE_BACKOFF_MS = 2_000;
type Context = Pick<ExecutionContext, 'waitUntil'>;
type Proof = { revision: number; expiresAt: number; hit: boolean };
type SharedRow = {
  clock_revision: number;
  revision: number | null;
  expires_at: number;
  lease_until: number;
  failure_code: string;
  failed_until: number;
};
const inFlight = new Map<string, Promise<Proof | null>>();
const unavailable = () => new HttpError(503, 'visibility_provider_unavailable');

function valid(row: SharedRow, now: number): boolean {
  return row.revision === row.clock_revision && Number.isSafeInteger(row.expires_at)
    && row.expires_at > now && row.expires_at <= now + PROOF_MS;
}

async function readProof(db: D1Database, scope: string): Promise<SharedRow> {
  // The aggregate handlers make this their first query in a primary D1 session.
  const row = await db.prepare(`SELECT m.revision AS clock_revision,p.revision,coalesce(p.expires_at,0) AS expires_at,
    coalesce(p.lease_until,0) AS lease_until,coalesce(p.failure_code,'') AS failure_code,coalesce(p.failed_until,0) AS failed_until
    FROM moderation_clock m LEFT JOIN public_aggregate_proof p ON p.scope=? WHERE m.id=1`)
    .bind(scope).first<SharedRow>().catch(() => { throw unavailable(); });
  if (!row) throw unavailable();
  return row;
}

function failureCode(error: unknown): string {
  if (error instanceof HttpError && ['visibility_sync_pending', 'visibility_read_budget_exceeded'].includes(error.message)) return error.message;
  return 'visibility_provider_unavailable';
}

async function buildProof(env: Env, scope: string, zone: string | undefined, initial: SharedRow, background: boolean): Promise<Proof | null> {
  const db = env.DB;
  const revision = initial.clock_revision;
  const replaceAt = background ? initial.expires_at : 0;
  const deadline = performance.now() + PROOF_MS;
  let row = initial;
  for (let delay = 100; performance.now() < deadline; delay = Math.min(delay * 2, 1500)) {
    const now = Date.now();
    if (row.clock_revision !== revision) throw unavailable();
    if (valid(row, now) && row.expires_at > replaceAt) return { revision, expiresAt: row.expires_at, hit: true };
    if (row.revision === revision && row.failed_until > now) throw new HttpError(503, row.failure_code);
    if (row.revision !== revision || row.lease_until <= now) {
      const lease = crypto.randomUUID();
      const expiresAt = now + PROOF_MS;
      const claimed = await db.prepare(`INSERT INTO public_aggregate_proof(scope,revision,lease,lease_until)
        SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM moderation_clock WHERE id=1 AND revision=?)
        ON CONFLICT(scope) DO UPDATE SET
          expires_at=CASE WHEN revision=excluded.revision THEN expires_at ELSE 0 END,
          revision=excluded.revision,lease=excluded.lease,lease_until=excluded.lease_until,
          failure_code='',failed_until=0
        WHERE revision<excluded.revision
          OR (revision=excluded.revision AND lease_until<=? AND expires_at<=? AND failed_until<=?)
        RETURNING 1 AS won`).bind(scope, revision, lease, expiresAt, revision, now, Math.max(now, replaceAt), now).first();
      if (claimed) {
        const operation = background ? 'refresh' : 'cold';
        try {
          await provePublicAggregates(env, zone, expiresAt);
          const finished = Date.now();
          if (finished >= expiresAt) throw unavailable();
          const saved = await db.prepare(`UPDATE public_aggregate_proof SET expires_at=?,lease='',lease_until=0
            WHERE scope=? AND revision=? AND lease=? AND lease_until>?
              AND EXISTS(SELECT 1 FROM moderation_clock WHERE id=1 AND revision=?)`)
            .bind(expiresAt, scope, revision, lease, finished, revision).run();
          if (!saved.meta.changes) throw unavailable();
          await bumpOp(db, 'aggregate_proof', operation, 'success');
          return { revision, expiresAt, hit: false };
        } catch (error) {
          const code = failureCode(error);
          const denied = code === 'visibility_sync_pending';
          await db.prepare(`UPDATE public_aggregate_proof SET lease='',lease_until=0,
            expires_at=CASE WHEN ? THEN 0 ELSE expires_at END,failure_code=?,failed_until=?
            WHERE scope=? AND revision=? AND lease=?`)
            .bind(denied ? 1 : 0, code, Date.now() + FAILURE_BACKOFF_MS, scope, revision, lease).run().catch(() => {});
          await bumpOp(db, 'aggregate_proof', operation, denied ? 'denied' : 'unavailable');
          throw new HttpError(503, code);
        }
      }
    }
    // Only an expired/cold request waits for another isolate's result.
    if (background) return null;
    await new Promise(resolve => setTimeout(resolve, Math.min(delay, Math.max(0, deadline - performance.now()))));
    row = await readProof(db, scope);
  }
  throw unavailable();
}

function startProof(env: Env, ctx: Context, scope: string, zone: string | undefined, row: SharedRow, key: string, background: boolean) {
  // Cross-request waiters only share a native settlement gate. The producer's
  // D1 session and Provider fetches stay in its own execution context.
  const gate = Promise.withResolvers<Proof | null>();
  inFlight.set(key, gate.promise);
  ctx.waitUntil((async () => {
    try {
      gate.resolve(await buildProof(env, scope, zone, row, background));
    } catch (error) {
      gate.reject(error instanceof HttpError ? error : unavailable());
    } finally {
      inFlight.delete(key);
    }
  })());
  return gate.promise;
}

export async function getPublicAggregateProof(env: Env, ctx: Context, requestUrl: string, zone?: string): Promise<Proof> {
  // Version the key so receipts from the retired shared implementation are ignored.
  // Wildcard worker routes must not let request hostnames allocate D1 rows.
  const site = siteRootOf(new URL(requestUrl).hostname) ?? 'other';
  const scope = JSON.stringify(['v3', site, zone ?? 'all']);
  const row = await readProof(env.DB, scope);
  const key = JSON.stringify([scope, row.clock_revision]);
  const now = Date.now();
  const pending = inFlight.get(key);
  if (valid(row, now)) {
    if (!pending && row.expires_at - now <= REFRESH_BEFORE_MS && row.lease_until <= now && row.failed_until <= now) {
      ctx.waitUntil(startProof(env, ctx, scope, zone, row, key, true).catch(() => {}));
    }
    return { revision: row.clock_revision, expiresAt: row.expires_at, hit: true };
  }
  let proof = await (pending ?? startProof(env, ctx, scope, zone, row, key, false));
  if (!proof) {
    // The local background refresh lost its lease race. Read the winner or
    // wait for its result with the original request's bounded cold path.
    const current = await readProof(env.DB, scope);
    const currentKey = JSON.stringify([scope, current.clock_revision]);
    proof = await (inFlight.get(currentKey) ?? startProof(env, ctx, scope, zone, current, currentKey, false));
  }
  if (!proof || proof.expiresAt <= Date.now()) throw unavailable();
  return proof;
}
