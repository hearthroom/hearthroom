/// <reference lib="es2024.promise" />

import { bumpOp, type AggregateProofFailureCause } from './ops-metrics';
import { HttpError, type Env } from './types';
import { AggregateProofD1ScanError, AggregateProofDeadline, provePublicAggregates, VisibilityProviderUnavailable } from './work-read';
import { siteRootOf } from '../shared/site-hosts';

const PROOF_MS = 30_000;
const REFRESH_BEFORE_MS = 15_000;
// Leave headroom under the Worker's 30 s waitUntil lifetime.
const BUILD_LEASE_MS = 18_000;
const FAILURE_BACKOFF_MS = 2_000;
type Context = Pick<ExecutionContext, 'waitUntil'>;
type ProofWindow = { revision: number; expiresAt: number };
type Pending = { promise: Promise<ProofWindow | null>; deadline: number };
type SharedRow = {
  clock_revision: number;
  revision: number | null;
  expires_at: number;
  lease_until: number;
  failure_code: string;
  failed_until: number;
};
const inFlight = new Map<string, Pending>();
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

function classifyFailure(error: unknown, phase: 'scan' | 'publish'): AggregateProofFailureCause {
  if (error instanceof VisibilityProviderUnavailable) return `provider_${error.reason}`;
  if (error instanceof AggregateProofDeadline) return 'lease_deadline';
  if (error instanceof AggregateProofD1ScanError) return 'd1_scan_error';
  const code = failureCode(error);
  if (code === 'visibility_sync_pending') return 'authority_denied';
  if (code === 'visibility_read_budget_exceeded') return 'budget';
  return phase === 'publish' ? 'd1_publish_error' : 'other_scan_error';
}

async function observePublishRejection(env: Env, scope: string, revision: number, lease: string, finished: number): Promise<AggregateProofFailureCause> {
  try {
    const db = env.freshAggregateDb?.() ?? env.DB;
    // Read current state before clearing our lease. The observation never
    // grants visibility or changes the rejection status.
    return await db.prepare(`SELECT CASE WHEN m.revision<>? THEN 'publish_revision_changed'
      WHEN p.lease IS NULL OR p.lease<>? THEN 'publish_lease_lost'
      WHEN p.lease_until<=? THEN 'publish_lease_expired' ELSE 'publish_rejected' END AS reason
      FROM moderation_clock m LEFT JOIN public_aggregate_proof p ON p.scope=? WHERE m.id=1`)
      .bind(revision, lease, finished, scope).first<AggregateProofFailureCause>('reason') ?? 'publish_state_unavailable';
  } catch {
    return 'publish_state_unavailable';
  }
}

async function buildProof(env: Env, ctx: Context, scope: string, zone: string | undefined, initial: SharedRow, background: boolean, deadline: number): Promise<ProofWindow | null> {
  const db = env.DB;
  const revision = initial.clock_revision;
  const replaceAt = background ? initial.expires_at : 0;
  let row = initial;
  for (let delay = 100; Date.now() < deadline; delay = Math.min(delay * 2, 1500)) {
    const now = Date.now();
    if (row.clock_revision !== revision) throw unavailable();
    if (valid(row, now) && row.expires_at > replaceAt) return { revision, expiresAt: row.expires_at };
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
        RETURNING 1 AS won`).bind(scope, revision, lease, deadline, revision, now, Math.max(now, replaceAt), now).first();
      if (claimed) {
        const operation = background ? 'refresh' : 'cold';
        let phase: 'scan' | 'publish' = 'scan';
        let rejectedPublication: AggregateProofFailureCause | undefined;
        try {
          await provePublicAggregates(env, zone, deadline);
          const finished = Date.now();
          if (finished >= deadline) throw new AggregateProofDeadline();
          phase = 'publish';
          const saved = await db.prepare(`UPDATE public_aggregate_proof SET expires_at=?,lease='',lease_until=0
            WHERE scope=? AND revision=? AND lease=? AND lease_until>?
              AND EXISTS(SELECT 1 FROM moderation_clock WHERE id=1 AND revision=?)`)
            .bind(expiresAt, scope, revision, lease, finished, revision).run();
          if (!saved.meta.changes) {
            rejectedPublication = await observePublishRejection(env, scope, revision, lease, finished);
            throw unavailable();
          }
          ctx.waitUntil(bumpOp(db, 'aggregate_proof', operation, 'success'));
          return { revision, expiresAt };
        } catch (error) {
          const code = failureCode(error);
          const denied = code === 'visibility_sync_pending';
          ctx.waitUntil(bumpOp(db, 'aggregate_proof_failure', operation, rejectedPublication ?? classifyFailure(error, phase)));
          await db.prepare(`UPDATE public_aggregate_proof SET lease='',lease_until=0,
            expires_at=CASE WHEN ? THEN 0 ELSE expires_at END,failure_code=?,failed_until=?
            WHERE scope=? AND revision=? AND lease=?`)
            .bind(denied ? 1 : 0, code, Date.now() + FAILURE_BACKOFF_MS, scope, revision, lease).run().catch(() => {});
          ctx.waitUntil(bumpOp(db, 'aggregate_proof', operation, denied ? 'denied' : 'unavailable'));
          throw new HttpError(503, code);
        }
      }
    }
    // Only an expired/cold request waits for another isolate's result.
    if (background) return null;
    await new Promise(resolve => setTimeout(resolve, Math.min(delay, Math.max(0, deadline - Date.now()))));
    row = await readProof(db, scope);
  }
  throw unavailable();
}

function activeProof(key: string): Pending | undefined {
  const pending = inFlight.get(key);
  if (pending && pending.deadline > Date.now()) return pending;
  inFlight.delete(key);
}

async function waitForProof(pending: Pending): Promise<ProofWindow | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>(resolve => {
    timer = setTimeout(() => resolve(null), Math.max(0, pending.deadline - Date.now()));
  });
  try {
    return await Promise.race([pending.promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function startProof(env: Env, ctx: Context, scope: string, zone: string | undefined, row: SharedRow, key: string, background: boolean): Pending {
  // Cross-request waiters only share a native settlement gate. The producer's
  // D1 session and Provider fetches stay in its own execution context.
  const gate = Promise.withResolvers<ProofWindow | null>();
  const pending = { promise: gate.promise, deadline: Date.now() + BUILD_LEASE_MS };
  inFlight.set(key, pending);
  ctx.waitUntil((async () => {
    try {
      gate.resolve(await buildProof(env, ctx, scope, zone, row, background, pending.deadline));
    } catch (error) {
      gate.reject(error instanceof HttpError ? error : unavailable());
    } finally {
      if (inFlight.get(key) === pending) inFlight.delete(key);
    }
  })());
  return pending;
}

function scopeOf(requestUrl: string, zone: string | undefined): string {
  // Version the key so receipts from the retired shared implementation are ignored.
  // Wildcard worker routes must not let request hostnames allocate D1 rows.
  const site = siteRootOf(new URL(requestUrl).hostname) ?? 'other';
  return JSON.stringify(['v3', site, zone ?? 'all']);
}

/** Start in a fresh primary session after waiting for a cold or expired proof. */
export async function confirmPublicAggregateProof(db: D1Database, requestUrl: string, zone?: string): Promise<ProofWindow | null> {
  const row = await readProof(db, scopeOf(requestUrl, zone));
  return valid(row, Date.now()) ? { revision: row.clock_revision, expiresAt: row.expires_at } : null;
}

export async function getPublicAggregateProof(env: Env, ctx: Context, requestUrl: string, zone?: string): Promise<ProofWindow & { hit: boolean }> {
  const scope = scopeOf(requestUrl, zone);
  const row = await readProof(env.DB, scope);
  const key = JSON.stringify([scope, row.clock_revision]);
  const now = Date.now();
  const pending = activeProof(key);
  if (valid(row, now)) {
    if (!pending && row.expires_at - now <= REFRESH_BEFORE_MS && row.lease_until <= now && row.failed_until <= now) {
      ctx.waitUntil(startProof(env, ctx, scope, zone, row, key, true).promise.catch(() => {}));
    }
    return { revision: row.clock_revision, expiresAt: row.expires_at, hit: true };
  }
  let proof = await waitForProof(pending ?? startProof(env, ctx, scope, zone, row, key, false));
  if (!proof) {
    // The producer lost the lease or stopped responding. Try the shared
    // result or lease once more without awaiting the abandoned gate.
    const current = await readProof(env.DB, scope);
    const currentKey = JSON.stringify([scope, current.clock_revision]);
    proof = await waitForProof(activeProof(currentKey) ?? startProof(env, ctx, scope, zone, current, currentKey, false));
  }
  if (!proof || proof.expiresAt <= Date.now()) throw unavailable();
  return { ...proof, hit: false };
}
