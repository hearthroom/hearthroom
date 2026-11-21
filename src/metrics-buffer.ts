/**
 * Isolate-scoped write coalescing for the four high-volume D1 telemetry counters:
 *   - ops_metrics (metric, operation, outcome)
 *   - community_metrics (operation, outcome)
 *   - library_metrics (operation, outcome)
 *   - account_auth_metrics (operation, provider, outcome)
 *
 * Design invariants:
 * - Only plain data (Map<string, PendingRecord>, counters, tokens, timestamps)
 *   is shared across requests in the isolate. No I/O Promise, timer handle, or
 *   D1DatabaseSession is ever shared or mutated across requests.
 * - Request-scoped ExecutionContext bindings are keyed only on per-request DB
 *   handles (never on the shared env.DB instance), preventing concurrent
 *   requests from overwriting each other's ExecutionContext.
 * - When METRICS_FLUSH_MS is "0" or unset, writes pass straight through to D1
 *   so existing unit tests and emergency rollback behave identically.
 * - When METRICS_FLUSH_MS > 0 (production default: 10000 ms), deltas aggregate
 *   by exact label tuple and flush in a single D1 batch on timer expiry, event
 *   threshold (error storms), cron completion, or metrics scrape.
 * - Transient D1 batch failures re-queue only uncommitted chunks up to
 *   MAX_RETRIES times with backoff. If D1 commits before a response transport
 *   interruption, retry is at-least-once for that batch; counters stay
 *   monotonic across isolate restarts.
 */

export type OpsMetricEntry = { table: "ops"; metric: string; operation: string; outcome: string; delta: number };
export type CommunityMetricEntry = { table: "community"; operation: string; outcome: string; delta: number };
export type LibraryMetricEntry = { table: "library"; operation: string; outcome: string; delta: number };
export type AuthMetricEntry = { table: "auth"; operation: string; provider: string; outcome: string; delta: number };
export type MetricEntry = OpsMetricEntry | CommunityMetricEntry | LibraryMetricEntry | AuthMetricEntry;

export interface MetricsBinding {
  rootDb: D1Database;
  ctx?: Pick<ExecutionContext, "waitUntil">;
  flushMs: number;
  /** When true (e.g. scheduled cron), rely on explicit end-of-run flush instead of a 10s sleep timer. */
  deferToExplicitFlush?: boolean;
}

export interface MetricBatchStats {
  statements: number;
  events: number;
  failed: boolean;
}

type PendingRecord = {
  entry: MetricEntry;
  events: number;
};

const MAX_FLUSH_MS = 15_000;
const MAX_PENDING_EVENTS = 500;
const MAX_PENDING_KEYS = 200;
const MAX_BATCH_STATEMENTS = 80;
const MAX_RETRIES = 2;
const STALE_SCHEDULE_BUFFER_MS = 15_000;
const SCRAPE_WAIT_STEP_MS = 25;
const SCRAPE_WAIT_MAX_STEPS = 10;

let bindings = new WeakMap<D1Database, MetricsBinding>();

const state = {
  epoch: 0,
  pending: new Map<string, PendingRecord>(),
  pendingEvents: 0,
  scheduled: false,
  scheduledAt: 0,
  scheduleToken: 0,
  activeFlushes: 0,
  consecutiveFailures: 0,
  nextRetryAt: 0,
};

export function parseMetricsFlushMs(raw: string | undefined): number {
  if (!raw) return 0;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return 0;
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return 0;
  return Math.min(parsed, MAX_FLUSH_MS);
}

/**
 * Bind a per-request DB handle to the current request's ExecutionContext.
 * Never attach a request-scoped binding directly to the shared env.DB object;
 * when db === rootDb, wrap it in a lightweight per-request Proxy handle.
 */
export function bindMetricsDb(
  db: D1Database,
  rootDb: D1Database,
  ctx: Pick<ExecutionContext, "waitUntil"> | undefined,
  flushMs: number,
  opts: { deferToExplicitFlush?: boolean } = {},
): D1Database {
  if (flushMs <= 0) return db;
  const handle = db === rootDb ? createScopedDbHandle(db) : db;
  bindings.set(handle, { rootDb, ctx, flushMs, deferToExplicitFlush: opts.deferToExplicitFlush });
  return handle;
}

/** Direct registration for isolated unit tests using a dedicated DB instance. */
export function registerMetricsContext(db: D1Database, binding: MetricsBinding): void {
  bindings.set(db, binding);
}

function createScopedDbHandle(db: D1Database): D1Database {
  return new Proxy(db, {
    get(target, prop) {
      const value = Reflect.get(target, prop);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function keyOf(entry: MetricEntry): string {
  switch (entry.table) {
    case "ops":
      return `ops\0${entry.metric}\0${entry.operation}\0${entry.outcome}`;
    case "community":
      return `community\0${entry.operation}\0${entry.outcome}`;
    case "library":
      return `library\0${entry.operation}\0${entry.outcome}`;
    case "auth":
      return `auth\0${entry.operation}\0${entry.provider}\0${entry.outcome}`;
  }
}

function prepareEntry(db: D1Database, entry: MetricEntry): D1PreparedStatement {
  switch (entry.table) {
    case "ops":
      return db
        .prepare("INSERT INTO ops_metrics VALUES (?1, ?2, ?3, ?4) ON CONFLICT(metric, operation, outcome) DO UPDATE SET value = value + ?4")
        .bind(entry.metric, entry.operation, entry.outcome, entry.delta);
    case "community":
      return db
        .prepare("INSERT INTO community_metrics VALUES (?1, ?2, ?3) ON CONFLICT(operation, outcome) DO UPDATE SET value = value + ?3")
        .bind(entry.operation, entry.outcome, entry.delta);
    case "library":
      return db
        .prepare("INSERT INTO library_metrics(operation, outcome, value) VALUES (?1, ?2, ?3) ON CONFLICT(operation, outcome) DO UPDATE SET value = value + ?3")
        .bind(entry.operation, entry.outcome, entry.delta);
    case "auth":
      return db
        .prepare("INSERT INTO account_auth_metrics VALUES (?1, ?2, ?3, ?4) ON CONFLICT(operation, provider, outcome) DO UPDATE SET value = value + ?4")
        .bind(entry.operation, entry.provider, entry.outcome, entry.delta);
  }
}

function addToPending(entry: MetricEntry, events = 1): boolean {
  const key = keyOf(entry);
  const existing = state.pending.get(key);
  if (existing) {
    existing.entry.delta += entry.delta;
    existing.events += events;
    state.pendingEvents += events;
    return true;
  }
  if (state.pending.size >= MAX_PENDING_KEYS) {
    console.warn("Telemetry metrics buffer full; dropping overflow key");
    return false;
  }
  state.pending.set(key, { entry: { ...entry }, events });
  state.pendingEvents += events;
  return true;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function retryBackoffMs(delayMs: number, failureCount: number): number {
  const base = Math.min(2_000, 500 * 2 ** Math.max(0, failureCount - 1));
  return delayMs > 0 && delayMs <= 100 ? Math.min(delayMs, base) : base;
}

async function flushWithRetryLoop(rootDb: D1Database, delayMs: number, epoch: number): Promise<void> {
  if (state.epoch !== epoch || !state.pending.size) return;
  if (state.nextRetryAt > Date.now()) {
    const waitMs = Math.min(delayMs > 0 && delayMs <= 100 ? delayMs : 2_000, state.nextRetryAt - Date.now());
    if (waitMs > 0) await sleep(waitMs);
    if (state.epoch !== epoch || !state.pending.size) return;
  }

  let result = await flushMetrics(rootDb, { force: true });
  while (result.failed && state.epoch === epoch && state.pending.size > 0 && state.consecutiveFailures > 0 && state.consecutiveFailures <= MAX_RETRIES) {
    await sleep(retryBackoffMs(delayMs, state.consecutiveFailures));
    if (state.epoch !== epoch || !state.pending.size) return;
    result = await flushMetrics(rootDb, { force: true });
  }
}

async function delayedFlush(rootDb: D1Database, delayMs: number, epoch: number, token: number): Promise<void> {
  if (delayMs > 0) await sleep(delayMs);
  if (state.epoch !== epoch) return;
  // Only the active schedule token may clear the scheduled flag so a stale
  // timer waking late cannot clobber a newer schedule.
  if (state.scheduleToken === token) {
    state.scheduled = false;
  } else {
    return;
  }
  if (!state.pending.size) return;
  await flushWithRetryLoop(rootDb, delayMs, epoch);
}

/** Flush pending deltas with bounded retry inside the caller's waitUntil budget (used by cron finish & background loops). */
export async function flushMetricsWithRetry(db: D1Database, delayMs = 1_000): Promise<void> {
  await flushWithRetryLoop(db, delayMs, state.epoch);
}

/**
 * Flush pending isolate deltas to D1.
 * Uses the caller-provided `db` directly so request-scoped scrapes (e.g.
 * GET /metrics with a "first-primary" session) advance their own session
 * bookmark before reading back the tables. Background flushes pass rootDb.
 */
export async function flushMetrics(db: D1Database, opts: { force?: boolean } = {}): Promise<MetricBatchStats> {
  const epoch = state.epoch;
  // Wait briefly (using this request's own timer, never awaiting another
  // request's I/O Promise) when another flush is already mid-batch so a
  // forced scrape reads freshly committed counters.
  if (opts.force && state.activeFlushes > 0) {
    for (let step = 0; step < SCRAPE_WAIT_MAX_STEPS && state.activeFlushes > 0 && state.epoch === epoch; step++) {
      await sleep(SCRAPE_WAIT_STEP_MS);
    }
    if (state.epoch !== epoch) return { statements: 0, events: 0, failed: false };
  }

  if (!state.pending.size) return { statements: 0, events: 0, failed: false };
  if (!opts.force && Date.now() < state.nextRetryAt) {
    return { statements: 0, events: 0, failed: false };
  }

  const records = [...state.pending.values()];
  const totalEvents = records.reduce((sum, r) => sum + r.events, 0);
  state.pending.clear();
  state.pendingEvents = 0;
  state.activeFlushes += 1;

  let writtenStatements = 0;
  try {
    for (let i = 0; i < records.length; i += MAX_BATCH_STATEMENTS) {
      const chunk = records.slice(i, i + MAX_BATCH_STATEMENTS);
      try {
        await db.batch(chunk.map((rec) => prepareEntry(db, rec.entry)));
        writtenStatements += chunk.length;
      } catch {
        if (state.epoch !== epoch) return { statements: writtenStatements, events: totalEvents, failed: true };
        const remaining = records.slice(i);
        state.consecutiveFailures += 1;
        if (state.consecutiveFailures <= MAX_RETRIES) {
          for (const rec of remaining) addToPending(rec.entry, rec.events);
          state.nextRetryAt = Date.now() + Math.min(30_000, 1_000 * 2 ** (state.consecutiveFailures - 1));
          // If a scrape or direct flush failed with no timer scheduled, ensure
          // a retry timer is armed on the caller's own ExecutionContext when available.
          const binding = bindings.get(db);
          if (binding?.ctx && !binding.deferToExplicitFlush && binding.flushMs > 0 && !state.scheduled) {
            try {
              const waitMs = Math.max(100, Math.min(binding.flushMs, state.nextRetryAt - Date.now()));
              scheduleTimer(binding, binding.ctx, waitMs);
            } catch {
              console.warn("Telemetry metrics retry scheduling unavailable");
            }
          }
        } else {
          // Drop after exceeding retry cap so sustained D1 failure cannot grow memory unbounded.
          state.consecutiveFailures = 0;
          state.nextRetryAt = 0;
          console.warn("Telemetry metrics batch dropped after retries");
        }
        return { statements: writtenStatements, events: totalEvents, failed: true };
      }
    }

    if (state.epoch === epoch && state.activeFlushes === 1) {
      state.consecutiveFailures = 0;
      state.nextRetryAt = 0;
    }
    return { statements: writtenStatements, events: totalEvents, failed: false };
  } finally {
    if (state.epoch === epoch) state.activeFlushes = Math.max(0, state.activeFlushes - 1);
  }
}

function scheduleTimer(binding: MetricsBinding, ctx: Pick<ExecutionContext, "waitUntil">, delayMs: number): void {
  const token = ++state.scheduleToken;
  state.scheduled = true;
  state.scheduledAt = Date.now();
  ctx.waitUntil(delayedFlush(binding.rootDb, delayMs, state.epoch, token));
}

function scheduleOrFlush(binding: MetricsBinding, fallbackCtx?: Pick<ExecutionContext, "waitUntil">): Promise<void> | void {
  const ctx = fallbackCtx ?? binding.ctx;
  const now = Date.now();
  const urgent = state.pendingEvents >= MAX_PENDING_EVENTS || state.pending.size >= MAX_PENDING_KEYS;

  if (!ctx) {
    if (urgent) return flushMetrics(binding.rootDb, { force: false }).then(() => {});
    return;
  }

  try {
    if (urgent) {
      // Respect backoff and active flushes during storms so transient errors
      // do not burn through MAX_RETRIES in milliseconds and drop the burst.
      if (state.activeFlushes > 0 || now < state.nextRetryAt) {
        if (!state.scheduled || now - state.scheduledAt > binding.flushMs + STALE_SCHEDULE_BUFFER_MS) {
          const waitMs = Math.max(100, Math.min(binding.flushMs, state.nextRetryAt - now));
          scheduleTimer(binding, ctx, waitMs);
        }
        return;
      }
      ctx.waitUntil(flushWithRetryLoop(binding.rootDb, binding.flushMs, state.epoch));
      return;
    }

    if (binding.deferToExplicitFlush) return;

    if (!state.scheduled || now - state.scheduledAt > binding.flushMs + STALE_SCHEDULE_BUFFER_MS) {
      scheduleTimer(binding, ctx, binding.flushMs);
    }
  } catch {
    console.warn("Telemetry metrics flush scheduling unavailable");
  }
}

async function recordMetric(
  db: D1Database,
  entry: MetricEntry,
  opts: {
    ctx?: Pick<ExecutionContext, "waitUntil">;
    backgroundDirect?: boolean;
    warnMessage?: string;
  } = {},
): Promise<void> {
  if (!Number.isFinite(entry.delta) || entry.delta <= 0) return;
  const binding = bindings.get(db);
  if (!binding || binding.flushMs <= 0) {
    const run = async () => {
      try {
        await prepareEntry(db, entry).run();
      } catch {
        if (opts.warnMessage) console.warn(opts.warnMessage);
      }
    };
    if (opts.backgroundDirect && opts.ctx) {
      try {
        opts.ctx.waitUntil(run());
      } catch {
        if (opts.warnMessage) console.warn(opts.warnMessage);
      }
      return;
    }
    await run();
    return;
  }

  addToPending(entry);
  const maybePromise = scheduleOrFlush(binding, opts.ctx);
  if (maybePromise) await maybePromise;
}

export async function recordOpsMetric(
  db: D1Database,
  metric: string,
  operation: string,
  outcome: string,
  delta = 1,
  warnMessage = "Ops metric unavailable",
): Promise<void> {
  await recordMetric(db, { table: "ops", metric, operation, outcome, delta }, { warnMessage });
}

export async function recordCommunityMetric(
  db: D1Database,
  operation: string,
  outcome: string,
  ctx?: Pick<ExecutionContext, "waitUntil">,
): Promise<void> {
  await recordMetric(
    db,
    { table: "community", operation, outcome, delta: 1 },
    { ctx, backgroundDirect: true, warnMessage: "Community request metric unavailable" },
  );
}

export async function recordLibraryMetric(
  db: D1Database,
  operation: string,
  outcome: string,
  ctx?: Pick<ExecutionContext, "waitUntil">,
): Promise<void> {
  await recordMetric(
    db,
    { table: "library", operation, outcome, delta: 1 },
    { ctx, backgroundDirect: true, warnMessage: "Library request metric unavailable" },
  );
}

export async function recordAuthMetric(
  db: D1Database,
  operation: string,
  provider: string,
  outcome: string,
): Promise<void> {
  await recordMetric(
    db,
    { table: "auth", operation, provider, outcome, delta: 1 },
    { warnMessage: "Account authorization metric unavailable" },
  );
}

export function resetMetricsBufferForTest(): void {
  state.epoch += 1;
  state.scheduleToken += 1;
  state.pending.clear();
  state.pendingEvents = 0;
  state.scheduled = false;
  state.scheduledAt = 0;
  state.activeFlushes = 0;
  state.consecutiveFailures = 0;
  state.nextRetryAt = 0;
  bindings = new WeakMap<D1Database, MetricsBinding>();
}

export function metricsBufferStatsForTest(): {
  pendingKeys: number;
  pendingEvents: number;
  scheduled: boolean;
  flushing: boolean;
  consecutiveFailures: number;
  nextRetryAt: number;
} {
  return {
    pendingKeys: state.pending.size,
    pendingEvents: state.pendingEvents,
    scheduled: state.scheduled,
    flushing: state.activeFlushes > 0,
    consecutiveFailures: state.consecutiveFailures,
    nextRetryAt: state.nextRetryAt,
  };
}
