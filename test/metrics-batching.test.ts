import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import type { Env } from "../src/types";
import { bumpHarborProxy, bumpOp, opsMetrics } from "../src/ops-metrics";
import { metric as authMetric } from "../src/account-auth";
import {
  bindMetricsDb,
  flushMetrics,
  metricsBufferStatsForTest,
  parseMetricsFlushMs,
  recordCommunityMetric,
  recordLibraryMetric,
  registerMetricsContext,
  resetMetricsBufferForTest,
  type MetricBatchStats,
} from "../src/metrics-buffer";
import { resetDb } from "./helpers";

function instrumentDb(db: D1Database): { db: D1Database; stats: { runs: number; batches: number; rowsWritten: number } } {
  const stats = { runs: 0, batches: 0, rowsWritten: 0 };
  const wrapStmt = (stmt: D1PreparedStatement): D1PreparedStatement =>
    new Proxy(stmt, {
      get(target, prop, receiver) {
        if (prop === "bind") {
          return (...values: unknown[]) => wrapStmt(target.bind(...values));
        }
        if (prop === "run") {
          return async () => {
            stats.runs += 1;
            const res = await target.run();
            stats.rowsWritten += res.meta?.rows_written ?? 0;
            return res;
          };
        }
        const value = Reflect.get(target, prop, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  const wrapped = new Proxy(db, {
    get(target, prop, receiver) {
      if (prop === "prepare") {
        return (query: string) => wrapStmt(target.prepare(query));
      }
      if (prop === "batch") {
        return async <T = unknown>(statements: D1PreparedStatement[]) => {
          stats.batches += 1;
          const results = await target.batch<T>(statements);
          for (const r of results) stats.rowsWritten += r.meta?.rows_written ?? 0;
          return results;
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { db: wrapped, stats };
}

function makeCtx(opts: { closed?: () => boolean } = {}) {
  const pending: Promise<unknown>[] = [];
  return {
    pending,
    ctx: {
      waitUntil(promise: Promise<unknown>) {
        if (opts.closed?.()) throw new Error("ExecutionContext already closed");
        pending.push(Promise.resolve(promise));
      },
      passThroughOnException() {},
    } as unknown as ExecutionContext,
    async drain() {
      while (pending.length) {
        const batch = pending.splice(0, pending.length);
        await Promise.all(batch);
      }
    },
  };
}

async function readTotals(db: D1Database) {
  const [ops, community, library, auth] = await Promise.all([
    db.prepare("SELECT metric, operation, outcome, value FROM ops_metrics ORDER BY metric, operation, outcome").all(),
    db.prepare("SELECT operation, outcome, value FROM community_metrics ORDER BY operation, outcome").all(),
    db.prepare("SELECT operation, outcome, value FROM library_metrics ORDER BY operation, outcome").all(),
    db.prepare("SELECT operation, provider, outcome, value FROM account_auth_metrics ORDER BY operation, provider, outcome").all(),
  ]);
  return {
    ops: ops.results,
    community: community.results,
    library: library.results,
    auth: auth.results,
  };
}

describe("telemetry metrics batching", () => {
  beforeEach(async () => {
    await resetDb();
    resetMetricsBufferForTest();
  });

  it("parses METRICS_FLUSH_MS safely with 0 default and 15s cap", () => {
    expect(parseMetricsFlushMs(undefined)).toBe(0);
    expect(parseMetricsFlushMs("")).toBe(0);
    expect(parseMetricsFlushMs("0")).toBe(0);
    expect(parseMetricsFlushMs("-10")).toBe(0);
    expect(parseMetricsFlushMs("abc")).toBe(0);
    expect(parseMetricsFlushMs("10000")).toBe(10_000);
    expect(parseMetricsFlushMs("60000")).toBe(15_000);
  });

  it("batches four counter tables across requests, preserves weighted totals, and cuts D1 rows_written >90%", async () => {
    const runWorkload = async (flushMs: number, warmRows: boolean) => {
      await resetDb();
      resetMetricsBufferForTest();
      const emitAll = async (targetDb: D1Database, targetEnv: Env, targetCtx: ExecutionContext) => {
        const proxyReq = new Request("https://sukisuki.ai/hh-api/open/v1/roles");
        // 205 mixed telemetry events mirroring production ratio (ops ~60%, community ~25%, library ~10%, auth ~5%).
        for (let i = 0; i < 90; i++) {
          await bumpOp(targetDb, "visibility_read", i % 3 === 0 ? "list" : "detail", i % 15 === 0 ? "denied" : "allow");
        }
        for (let i = 0; i < 30; i++) {
          await bumpOp(targetDb, "visibility_provider_retry", "public_batch", i % 5 === 0 ? "exhausted" : "recovered", i % 2 === 0 ? 1 : 2);
        }
        for (let i = 0; i < 5; i++) {
          await bumpHarborProxy(targetDb, proxyReq, 502);
        }
        for (let i = 0; i < 50; i++) {
          await recordCommunityMetric(targetDb, i % 2 === 0 ? "member" : "bridge", i % 10 === 0 ? "denied" : "success", targetCtx);
        }
        for (let i = 0; i < 20; i++) {
          await recordLibraryMetric(targetDb, i % 2 === 0 ? "conversations_get" : "favorites_get", i % 7 === 0 ? "error" : "success", targetCtx);
        }
        for (let i = 0; i < 10; i++) {
          await authMetric(targetEnv, i % 2 === 0 ? "refresh" : "route-prepare", i % 2 === 0 ? "harbor" : "site", i % 5 === 0 ? "denied" : "ok");
        }
      };

      if (warmRows) {
        const { ctx: warmCtx, drain: warmDrain } = makeCtx();
        registerMetricsContext(env.DB, { rootDb: env.DB, ctx: warmCtx, flushMs: 0 });
        await emitAll(env.DB, { ...env, METRICS_FLUSH_MS: "0" }, warmCtx);
        await warmDrain();
      }

      const { db, stats } = instrumentDb(env.DB);
      const { ctx, drain } = makeCtx();
      const scopedDb = bindMetricsDb(db, db, ctx, flushMs);
      const testEnv = { ...env, DB: scopedDb, METRICS_FLUSH_MS: String(flushMs) };

      await emitAll(scopedDb, testEnv, ctx);
      await drain();
      const totals = await readTotals(env.DB);
      return { stats, totals };
    };

    const beforeWarm = await runWorkload(0, true);
    const afterWarm = await runWorkload(25, true);

    expect(afterWarm.totals).toEqual(beforeWarm.totals);
    // Steady-state (warm series): 205 events -> 205 rows_written before, 17 rows_written after (91.7% reduction).
    expect(beforeWarm.stats.rowsWritten).toBe(205);
    expect(afterWarm.stats.rowsWritten).toBe(17);
    expect(afterWarm.stats.batches).toBe(1);
    expect(afterWarm.stats.runs).toBe(0);
    expect(1 - afterWarm.stats.rowsWritten / beforeWarm.stats.rowsWritten).toBeGreaterThan(0.9);

    const beforeCold = await runWorkload(0, false);
    const afterCold = await runWorkload(25, false);
    expect(afterCold.totals).toEqual(beforeCold.totals);
    // Cold-start (initial INSERT writes table + PK index = 2 rows per new key): 222 -> 34 (84.7% reduction).
    expect(beforeCold.stats.rowsWritten).toBe(222);
    expect(afterCold.stats.rowsWritten).toBe(34);
    expect(afterCold.stats.batches).toBe(1);
  });

  it("isolates per-request ExecutionContext across concurrent requests sharing env.DB", async () => {
    let fastClosed = false;
    const slowCtx = makeCtx();
    const fastCtx = makeCtx({ closed: () => fastClosed });

    // Two concurrent requests share the same underlying env.DB binding.
    const slowDb = bindMetricsDb(env.DB, env.DB, slowCtx.ctx, 25);
    const fastDb = bindMetricsDb(env.DB, env.DB, fastCtx.ctx, 25);

    // Fast request finishes and closes its ExecutionContext before slow request emits a metric.
    expect(fastDb).not.toBe(slowDb);
    fastClosed = true;

    // Slow request must still schedule on its own ExecutionContext, never on fastCtx.
    await bumpOp(slowDb, "visibility_read", "detail", "allow");
    expect(slowCtx.pending).toHaveLength(1);
    expect(fastCtx.pending).toHaveLength(0);

    await slowCtx.drain();
    expect(await opsMetrics(env.DB)).toContain('hearthroom_visibility_reads_total{surface="detail",outcome="allow"} 1');
  });

  it("handles real multi-request workerd SELF.fetch calls without cross-request I/O errors", async () => {
    const [r1, r2, r3] = await Promise.all([
      SELF.fetch("https://sukisuki.ai/v1/me/favorites"),
      SELF.fetch("https://sukisuki.ai/v1/me/community/notifications/summary"),
      SELF.fetch("https://sukisuki.ai/v1/health"),
    ]);
    expect(r1.status).toBe(401);
    expect(r2.status).toBe(401);
    expect(r3.status).toBe(200);

    const metricsRes = await SELF.fetch("https://sukisuki.ai/metrics");
    expect(metricsRes.status).toBe(200);
    const body = await metricsRes.text();
    expect(body).toContain('hearthroom_library_requests_total{operation="favorites_get",outcome="denied"} 1');
    expect(body).toContain('hearthroom_community_requests_total{operation="member",outcome="denied"} 1');
  });

  it("flushes pending isolate deltas before serving /metrics and /internal/auth/metrics while preserving auth", async () => {
    const { ctx } = makeCtx();
    const batchedEnv = {
      ...env,
      METRICS_FLUSH_MS: "10000",
      AUTH_METRICS_SECRET: "secret-batch-check",
    };

    await worker.fetch(new Request("https://sukisuki.ai/v1/me/favorites"), batchedEnv, ctx);
    await worker.fetch(new Request("https://sukisuki.ai/v1/me/community/notifications/summary"), batchedEnv, ctx);
    expect(metricsBufferStatsForTest().pendingEvents).toBeGreaterThanOrEqual(2);

    // Public /metrics flushes本 isolate pending using the request's own DB session before reading.
    const pubRes = await worker.fetch(new Request("https://sukisuki.ai/metrics"), batchedEnv, ctx);
    expect(pubRes.status).toBe(200);
    const pubText = await pubRes.text();
    expect(pubText).toContain('hearthroom_library_requests_total{operation="favorites_get",outcome="denied"} 1');
    expect(pubText).toContain('hearthroom_community_requests_total{operation="member",outcome="denied"} 1');
    expect(metricsBufferStatsForTest().pendingEvents).toBe(0);

    // Enqueue an auth metric and verify /internal/auth/metrics enforces Bearer auth before flushing.
    const scopedDb = bindMetricsDb(env.DB, env.DB, ctx, 10_000);
    await authMetric({ ...batchedEnv, DB: scopedDb }, "route-prepare", "site", "ok");
    expect(metricsBufferStatsForTest().pendingEvents).toBe(1);

    const denied = await worker.fetch(new Request("https://sukisuki.ai/internal/auth/metrics"), batchedEnv, ctx);
    expect(denied.status).toBe(401);
    expect(metricsBufferStatsForTest().pendingEvents).toBe(1);

    const allowed = await worker.fetch(
      new Request("https://sukisuki.ai/internal/auth/metrics", { headers: { Authorization: "Bearer secret-batch-check" } }),
      batchedEnv,
      ctx,
    );
    expect(allowed.status).toBe(200);
    expect(await allowed.text()).toContain('hearthroom_auth_operations_total{operation="route-prepare",provider="site",outcome="ok"} 1');
    expect(metricsBufferStatsForTest().pendingEvents).toBe(0);
  });

  it("flushes scheduled() cron telemetry immediately at end of run without waiting 10s", async () => {
    const httpCtx = makeCtx();
    const cronCtx = makeCtx();
    const batchedEnv = {
      ...env,
      METRICS_FLUSH_MS: "10000",
      AUTH_KEYRING: JSON.stringify({
        active: "k1",
        keys: { k1: btoa("0123456789abcdef0123456789abcdef") },
      }),
    };

    // Simulate an unrelated HTTP request already holding a 10s schedule.
    await worker.fetch(new Request("https://sukisuki.ai/v1/me/favorites"), batchedEnv, httpCtx.ctx);
    expect(metricsBufferStatsForTest().scheduled).toBe(true);

    // Trigger hourly maintenance cron (accountAuthMaintenance emits cleanup/site/ok).
    const started = Date.now();
    await worker.scheduled(
      { cron: "17 * * * *", scheduledTime: Date.now(), noRetry() {} } as ScheduledController,
      batchedEnv,
      cronCtx.ctx,
    );
    await cronCtx.drain();
    // Must complete promptly (well under 10s) and persist cron metrics even though httpCtx was scheduled.
    expect(Date.now() - started).toBeLessThan(3_000);
    const authRow = await env.DB
      .prepare("SELECT value FROM account_auth_metrics WHERE operation='cleanup' AND provider='site' AND outcome='ok'")
      .first<{ value: number }>();
    expect(authRow?.value).toBe(1);
  });

  it("flushes immediately when pending events reach threshold without waiting for flushMs", async () => {
    const { db, stats } = instrumentDb(env.DB);
    const { ctx, pending } = makeCtx();
    const scopedDb = bindMetricsDb(db, db, ctx, 10_000);

    for (let i = 0; i < 500; i++) {
      await bumpOp(scopedDb, "visibility_read", "list", "unavailable");
    }
    // Wait only for the urgent flush promise (the second waitUntil), not the 10s timer.
    expect(pending.length).toBeGreaterThanOrEqual(2);
    await pending[pending.length - 1];

    expect(stats.batches).toBe(1);
    // First insert of a brand-new series writes table row + PK index row (2 rows_written).
    expect(stats.rowsWritten).toBe(2);
    expect(await opsMetrics(env.DB)).toContain('hearthroom_visibility_reads_total{surface="list",outcome="unavailable"} 500');

    // Second wave on the warm series writes only 1 row_written for another 500 events.
    for (let i = 0; i < 500; i++) {
      await bumpOp(scopedDb, "visibility_read", "list", "unavailable");
    }
    await pending[pending.length - 1];
    expect(stats.batches).toBe(2);
    expect(stats.rowsWritten).toBe(3);
    expect(await opsMetrics(env.DB)).toContain('hearthroom_visibility_reads_total{surface="list",outcome="unavailable"} 1000');
  });

  it("respects backoff during error storms and does not strand deltas when delayedFlush hits nextRetryAt", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { ctx, drain } = makeCtx();
      let failCount = 1;
      const flakyDb = new Proxy(env.DB, {
        get(target, prop, receiver) {
          if (prop === "batch") {
            return async <T = unknown>(statements: D1PreparedStatement[]) => {
              if (failCount > 0) {
                failCount -= 1;
                throw new Error("D1_TEMP_FAIL");
              }
              return target.batch<T>(statements);
            };
          }
          const value = Reflect.get(target, prop, receiver);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      const scopedDb = bindMetricsDb(flakyDb, flakyDb, ctx, 30);

      // Enqueue a normal event (schedules 30ms delayedFlush).
      await bumpOp(scopedDb, "visibility_read", "list", "unavailable", 1);
      // An early forced flush fails -> sets nextRetryAt (~1000ms ahead) and re-queues delta.
      const early = await flushMetrics(flakyDb, { force: true });
      expect(early.failed).toBe(true);
      expect(metricsBufferStatsForTest().nextRetryAt).toBeGreaterThan(Date.now());

      // Now simulate an error storm (500 more events) while in backoff:
      // urgent branch must NOT fire force:true on every event and burn through MAX_RETRIES.
      for (let i = 0; i < 500; i++) {
        await bumpOp(scopedDb, "visibility_read", "list", "unavailable", 1);
      }
      expect(metricsBufferStatsForTest().consecutiveFailures).toBe(1);
      expect(metricsBufferStatsForTest().pendingEvents).toBe(501);

      // When delayedFlush wakes and waits out backoff, it succeeds with all 501 events intact.
      await drain();
      expect(await opsMetrics(env.DB)).toContain('hearthroom_visibility_reads_total{surface="list",outcome="unavailable"} 501');
      expect(metricsBufferStatsForTest().pendingEvents).toBe(0);
    } finally {
      warn.mockRestore();
    }
  });

  it("isolates account_auth_metrics failures even under METRICS_FLUSH_MS=0 emergency rollback", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const failingDb = new Proxy(env.DB, {
        get(target, prop) {
          if (prop === "prepare") {
            return (sql: string) => {
              if (sql.includes("account_auth_metrics")) {
                return {
                  bind: () => ({
                    run: async () => {
                      throw new Error("D1_AUTH_METRIC_DOWN");
                    },
                  }),
                };
              }
              return target.prepare(sql);
            };
          }
          const value = Reflect.get(target, prop);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      await expect(authMetric({ ...env, DB: failingDb, METRICS_FLUSH_MS: "0" }, "refresh", "harbor", "ok")).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalledWith("Account authorization metric unavailable");
    } finally {
      warn.mockRestore();
    }
  });

  it("waits briefly for an in-flight background batch on forced scrape without cross-request Promise sharing", async () => {
    const { ctx } = makeCtx();
    let releaseBatch!: () => void;
    let batchStarted!: () => void;
    const startedPromise = new Promise<void>((r) => { batchStarted = r; });
    const delayedBatchDb = new Proxy(env.DB, {
      get(target, prop, receiver) {
        if (prop === "batch") {
          return async <T = unknown>(statements: D1PreparedStatement[]) => {
            batchStarted();
            await new Promise<void>((r) => { releaseBatch = r; });
            return target.batch<T>(statements);
          };
        }
        const value = Reflect.get(target, prop, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const scopedDb = bindMetricsDb(delayedBatchDb, delayedBatchDb, ctx, 10_000);
    await bumpOp(scopedDb, "visibility_read", "list", "allow", 7);

    // Start background flush #1 (holds activeFlushes = 1 while D1 batch is mid-flight).
    const bgFlush = flushMetrics(delayedBatchDb, { force: true });
    await startedPromise;
    expect(metricsBufferStatsForTest().flushing).toBe(true);

    // Concurrent scrape arrives mid-batch; release D1 after 40ms.
    setTimeout(() => releaseBatch(), 40);
    const scrapeText = await opsMetrics(env.DB);
    await bgFlush;
    expect(scrapeText).toContain('hearthroom_visibility_reads_total{surface="list",outcome="allow"} 7');
    expect(metricsBufferStatsForTest().flushing).toBe(false);
  });

  it("coexists with direct transactional ops_metrics writes (review_correction / review_length_exemption)", async () => {
    const { ctx, drain } = makeCtx();
    const scopedDb = bindMetricsDb(env.DB, env.DB, ctx, 25);
    await bumpOp(scopedDb, "review_correction", "correct", "replay");
    await env.DB.batch([
      env.DB.prepare("INSERT INTO ops_metrics VALUES('review_correction','correct','success',1) ON CONFLICT(metric,operation,outcome) DO UPDATE SET value=value+1"),
    ]);
    await bumpOp(scopedDb, "review_correction", "correct", "success");
    await drain();
    const out = await opsMetrics(env.DB);
    expect(out).toContain('hearthroom_review_corrections_total{operation="correct",outcome="replay"} 1');
    expect(out).toContain('hearthroom_review_corrections_total{operation="correct",outcome="success"} 2');
  });

  it("retries transient D1 batch failures without losing counts and drops after retry limit", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { ctx } = makeCtx();
      let failTimes = 2;
      const flakyDb = new Proxy(env.DB, {
        get(target, prop, receiver) {
          if (prop === "batch") {
            return async <T = unknown>(statements: D1PreparedStatement[]) => {
              if (failTimes > 0) {
                failTimes -= 1;
                throw new Error("D1_TRANSIENT_UNAVAILABLE");
              }
              return target.batch<T>(statements);
            };
          }
          const value = Reflect.get(target, prop, receiver);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      const scopedDb = bindMetricsDb(flakyDb, flakyDb, ctx, 10_000);
      await bumpOp(scopedDb, "visibility_read", "detail", "allow", 3);
      await bumpOp(scopedDb, "visibility_read", "detail", "allow", 2);

      const f1: MetricBatchStats = await flushMetrics(flakyDb, { force: true });
      expect(f1.failed).toBe(true);
      expect(metricsBufferStatsForTest().pendingKeys).toBe(1);

      const f2 = await flushMetrics(flakyDb, { force: true });
      expect(f2.failed).toBe(true);
      expect(metricsBufferStatsForTest().pendingKeys).toBe(1);

      const f3 = await flushMetrics(flakyDb, { force: true });
      expect(f3.failed).toBe(false);
      expect(f3.statements).toBe(1);
      expect(await opsMetrics(env.DB)).toContain('hearthroom_visibility_reads_total{surface="detail",outcome="allow"} 5');

      failTimes = 10;
      await bumpOp(scopedDb, "visibility_read", "detail", "denied", 1);
      await flushMetrics(flakyDb, { force: true }); // failure 1 -> requeue
      await flushMetrics(flakyDb, { force: true }); // failure 2 -> requeue
      await flushMetrics(flakyDb, { force: true }); // failure 3 -> drop
      expect(metricsBufferStatsForTest().pendingKeys).toBe(0);
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("documents at-least-once duplicate risk on ambiguous commit (committed then transport error) and isolate restart monotonicity", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { ctx } = makeCtx();
      let breakAfterCommit = true;
      const ambiguousDb = new Proxy(env.DB, {
        get(target, prop, receiver) {
          if (prop === "batch") {
            return async <T = unknown>(statements: D1PreparedStatement[]) => {
              const res = await target.batch<T>(statements);
              if (breakAfterCommit) {
                breakAfterCommit = false;
                throw new Error("D1_RESPONSE_INTERRUPTED_AFTER_COMMIT");
              }
              return res;
            };
          }
          const value = Reflect.get(target, prop, receiver);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      const scopedDb = bindMetricsDb(ambiguousDb, ambiguousDb, ctx, 10_000);
      await bumpOp(scopedDb, "visibility_read", "social", "allow", 4);

      const first = await flushMetrics(ambiguousDb, { force: true });
      expect(first.failed).toBe(true);
      const retry = await flushMetrics(ambiguousDb, { force: true });
      expect(retry.failed).toBe(false);
      // Ambiguous commit + retry is at-least-once: 4 committed + 4 replayed = 8.
      expect(await opsMetrics(env.DB)).toContain('hearthroom_visibility_reads_total{surface="social",outcome="allow"} 8');

      // Simulate isolate restart: unflushed in-memory delta is lost, persisted counter keeps increasing monotonically.
      await bumpOp(scopedDb, "visibility_read", "social", "allow", 2);
      resetMetricsBufferForTest();
      expect(metricsBufferStatsForTest().pendingKeys).toBe(0);
      const freshDb = bindMetricsDb(env.DB, env.DB, ctx, 10_000);
      await bumpOp(freshDb, "visibility_read", "social", "allow", 1);
      await flushMetrics(env.DB, { force: true });
      expect(await opsMetrics(env.DB)).toContain('hearthroom_visibility_reads_total{surface="social",outcome="allow"} 9');
    } finally {
      warn.mockRestore();
    }
  });
});
