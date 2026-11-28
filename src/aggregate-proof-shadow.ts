import { siteRootOf } from '../shared/site-hosts';
import { bindMetricsDb, parseMetricsFlushMs } from './metrics-buffer';
import { bumpOp, type AggregateProofShadowFailure } from './ops-metrics';
import { HttpError, type Env } from './types';
import { AggregateProofD1ScanError, VisibilityProviderUnavailable } from './work-read-failures';

const ENABLED = "EXISTS(SELECT 1 FROM community_settings WHERE key='public_aggregate_proof_shadow' AND value='true')";
const LEASE_MS = 18_000;
const SAMPLE_INTERVAL = 20;
let untilSample = SAMPLE_INTERVAL;
type Context = Pick<ExecutionContext, 'waitUntil'>;
type Sample = { requestUrl: string; zone?: string; revision: number; startedAt: number; expiresAt: number; authority: Promise<void> };
class LeaseDeadline extends Error {}

/** Uses the initiating request's authority result. No consumer uses the shadow receipt. */
export function scheduleAggregateProofShadow(env: Env, ctx: Context, sample: Sample): void {
  const root = env.proofShadowDb;
  if (!root || --untilSample > 0) return;
  untilSample = SAMPLE_INTERVAL;
  try {
    // Neither lease I/O nor metrics advance the serving request's D1 session.
    const metricsDb = bindMetricsDb(root, root, ctx, parseMetricsFlushMs(env.METRICS_FLUSH_MS));
    ctx.waitUntil(observe(root, metricsDb, sample)
      .catch(() => bumpOp(metricsDb, 'aggregate_proof_shadow_failure', 'build', 'observation_error')));
  } catch {
    // A diagnostic scheduling failure cannot reject the legacy authorization.
  }
}

function primary(db: D1Database): D1Database | D1DatabaseSession {
  return typeof db.withSession === 'function' ? db.withSession('first-primary') : db;
}

async function waitForAuthority(authority: Promise<void>, deadline: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new LeaseDeadline()), Math.max(0, deadline - Date.now()));
  });
  try {
    await Promise.race([authority, timeout]);
    if (Date.now() >= deadline) throw new LeaseDeadline();
  } finally {
    clearTimeout(timer);
  }
}

function classify(error: unknown, publishing: boolean): AggregateProofShadowFailure {
  if (error instanceof VisibilityProviderUnavailable) return `provider_${error.reason}`;
  if (error instanceof LeaseDeadline) return 'lease_deadline';
  if (error instanceof AggregateProofD1ScanError) return 'd1_scan_error';
  if (error instanceof HttpError && error.message === 'visibility_sync_pending') return 'authority_denied';
  if (error instanceof HttpError && error.message === 'visibility_read_budget_exceeded') return 'budget';
  return publishing ? 'd1_publish_error' : 'other_scan_error';
}

async function publicationState(root: D1Database, scope: string, revision: number, lease: string, finished: number): Promise<AggregateProofShadowFailure | 'disabled'> {
  try {
    const row = await primary(root).prepare(`SELECT CASE
      WHEN NOT ${ENABLED} THEN 'disabled' WHEN m.revision<>? THEN 'publish_revision_changed'
      WHEN p.lease IS NULL OR p.lease<>? THEN 'publish_lease_lost'
      WHEN p.lease_until<=? THEN 'publish_lease_expired' ELSE 'publish_rejected' END AS reason
      FROM moderation_clock m LEFT JOIN public_aggregate_proof p ON p.scope=? WHERE m.id=1`)
      .bind(revision, lease, finished, scope).first<AggregateProofShadowFailure | 'disabled'>('reason');
    return row ?? 'publish_state_unavailable';
  } catch {
    return 'publish_state_unavailable';
  }
}

async function observe(root: D1Database, metricsDb: D1Database, sample: Sample): Promise<void> {
  const { requestUrl, zone, revision, startedAt, expiresAt, authority } = sample;
  const count = (outcome: 'sampled' | 'not_claimed' | 'success' | 'stopped') => bumpOp(metricsDb, 'aggregate_proof_shadow', 'build', outcome);
  const failure = (cause: AggregateProofShadowFailure) => bumpOp(metricsDb, 'aggregate_proof_shadow_failure', 'build', cause);
  let db: D1Database | D1DatabaseSession;
  try {
    db = primary(root);
    if (await db.prepare(`SELECT ${ENABLED} AS enabled`).first<number>('enabled') !== 1) return;
  } catch {
    await failure('setting_read_error');
    return;
  }

  const site = siteRootOf(new URL(requestUrl).hostname) ?? 'other';
  const scope = JSON.stringify(['shadow-v1', site, zone ?? 'all']);
  const lease = crypto.randomUUID();
  const deadline = startedAt + LEASE_MS;
  const now = Date.now();
  await count('sampled');
  if (now >= deadline) { await count('not_claimed'); return; }
  try {
    const claimed = await db.prepare(`INSERT INTO public_aggregate_proof(scope,revision,lease,lease_until)
      SELECT ?,?,?,? WHERE ${ENABLED} AND EXISTS(SELECT 1 FROM moderation_clock WHERE id=1 AND revision=?)
      ON CONFLICT(scope) DO UPDATE SET
        expires_at=CASE WHEN revision=excluded.revision THEN expires_at ELSE 0 END,
        revision=excluded.revision,lease=excluded.lease,lease_until=excluded.lease_until,
        failure_code='',failed_until=0
      WHERE revision<excluded.revision OR (revision=excluded.revision AND lease_until<=? AND expires_at<=?)
      RETURNING 1 AS won`).bind(scope, revision, lease, deadline, revision, now, now).first();
    if (!claimed) { await count('not_claimed'); return; }
  } catch {
    await failure('d1_claim_error');
    return;
  }

  let publishing = false;
  let published = false;
  try {
    await waitForAuthority(authority, deadline);
    const finished = Date.now();
    publishing = true;
    const saved = await db.prepare(`UPDATE public_aggregate_proof SET expires_at=?,lease='',lease_until=0
      WHERE scope=? AND revision=? AND lease=? AND lease_until>?
        AND ${ENABLED} AND EXISTS(SELECT 1 FROM moderation_clock WHERE id=1 AND revision=?)`)
      .bind(expiresAt, scope, revision, lease, finished, revision).run();
    published = saved.meta.changes === 1;
    if (published) {
      await count('success');
    } else {
      const reason = await publicationState(root, scope, revision, lease, finished);
      if (reason === 'disabled') await count('stopped');
      else await failure(reason);
    }
  } catch (error) {
    await failure(classify(error, publishing));
  } finally {
    if (!published) {
      try {
        await db.prepare("UPDATE public_aggregate_proof SET lease='',lease_until=0 WHERE scope=? AND revision=? AND lease=?")
          .bind(scope, revision, lease).run();
      } catch { await failure('d1_release_error'); }
    }
  }
}
