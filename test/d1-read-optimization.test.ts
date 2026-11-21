import { env, SELF } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import type { Env } from "../src/types";
import { catalogTagCounts, ratingCounts, upsertCard } from "../src/cards";
import { countTop, listTop, postComment, setLike, type CommentTarget } from "../src/comments";
import { publicCandidatePage, publicCandidates } from "../src/work-pagination";
import { filterPublicRows, provePublicAggregates } from "../src/work-read";
import { readOwnerVisibilities } from "../src/work-sharing";
import { workPolicyGateway } from "../src/work-policy";
import { bearer, identities, makeMember, resetDb, restoreUpstream, role } from "./helpers";
import { seal, sign } from "../src/community/crypto";
import { cravingKey, localDay } from "../shared/suki-care";
import { tagNamesFor } from "../shared/tag-catalog";

type QueryRecord = { sql: string; reads: number; writes: number; rows: number; plan: string[] };

function instrumentReadsWrites(db: D1Database, explain = false): { db: D1Database; log: QueryRecord[] } {
  const log: QueryRecord[] = [];
  const wrapStmt = (stmt: D1PreparedStatement, sql: string, bound: unknown[] = []): D1PreparedStatement =>
    new Proxy(stmt, {
      get(target, prop) {
        if (prop === "bind") {
          return (...values: unknown[]) => wrapStmt(target.bind(...values), sql, values);
        }
        if (prop === "all" || prop === "first" || prop === "run") {
          return async () => {
            let plan: string[] = [];
            if (explain && /^\s*(?:SELECT|WITH)\b/i.test(sql)) {
              const p = await db.prepare(`EXPLAIN QUERY PLAN ${sql}`).bind(...bound).all<{ detail: string }>();
              plan = p.results.map((r) => r.detail);
            }
            if (prop === "all") {
              const res = await target.all();
              log.push({ sql, reads: res.meta?.rows_read ?? 0, writes: res.meta?.rows_written ?? 0, rows: res.results.length, plan });
              return res;
            }
            if (prop === "first") {
              // Capture meta via all() on a clone or target.first() — use raw execution via all() only for SELECT measurement if needed.
              const res = await target.all();
              log.push({ sql, reads: res.meta?.rows_read ?? 0, writes: res.meta?.rows_written ?? 0, rows: res.results.length, plan });
              return (res.results[0] ?? null) as never;
            }
            const res = await target.run();
            log.push({ sql, reads: res.meta?.rows_read ?? 0, writes: res.meta?.rows_written ?? 0, rows: 0, plan });
            return res;
          };
        }
        const value = Reflect.get(target, prop);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });

  // Track original sql + binds for batch statements too.
  const stmtMeta = new WeakMap<object, { sql: string; bound: unknown[]; raw: D1PreparedStatement }>();
  const trackStmt = (raw: D1PreparedStatement, sql: string, bound: unknown[] = []): D1PreparedStatement => {
    const proxied = wrapStmt(raw, sql, bound);
    const outer = new Proxy(proxied, {
      get(target, prop) {
        if (prop === "bind") {
          return (...values: unknown[]) => trackStmt(raw.bind(...values), sql, values);
        }
        return Reflect.get(target, prop);
      },
    });
    stmtMeta.set(outer, { sql, bound, raw });
    return outer;
  };

  const wrapDb = <D extends object>(source: D): D =>
    new Proxy(source, {
      get(target, prop) {
        if (prop === "withSession") {
          return (constraint?: string) => wrapDb((target as unknown as D1Database).withSession(constraint));
        }
        if (prop === "prepare") {
          return (sql: string) => trackStmt((target as unknown as D1Database).prepare(sql), sql);
        }
        if (prop === "batch") {
          return async <T = unknown>(statements: D1PreparedStatement[]) => {
            const metas = statements.map((s) => stmtMeta.get(s));
            const rawStmts = statements.map((s, i) => metas[i]?.raw ?? s);
            const plans: string[][] = [];
            for (let i = 0; i < rawStmts.length; i++) {
              const m = metas[i];
              if (explain && m && /^\s*(?:SELECT|WITH)\b/i.test(m.sql)) {
                const p = await db.prepare(`EXPLAIN QUERY PLAN ${m.sql}`).bind(...m.bound).all<{ detail: string }>();
                plans.push(p.results.map((r) => r.detail));
              } else {
                plans.push([]);
              }
            }
            const results = await (target as unknown as D1Database).batch<T>(rawStmts);
            results.forEach((res, i) => {
              log.push({
                sql: metas[i]?.sql ?? "<batch>",
                reads: res.meta?.rows_read ?? 0,
                writes: res.meta?.rows_written ?? 0,
                rows: res.results?.length ?? 0,
                plan: plans[i] ?? [],
              });
            });
            return results;
          };
        }
        const value = Reflect.get(target, prop);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  return { db: wrapDb(db), log };
}

describe("D1 read optimization (Batch 2)", () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    restoreUpstream();
  });

  it("#2 comments index: eliminates full table scan for COUNT and newest pagination on normal and hot cards while preserving removed-with-replies and pinned semantics", async () => {
    const author = await makeMember(1001);
    const fan = await makeMember(2001);
    const hotCard = await upsertCard(env.DB, role({ roleId: "hot-card", authorNumId: 1001 }), 1000);
    const smallCard = await upsertCard(env.DB, role({ roleId: "small-card", authorNumId: 1001 }), 1001);

    // Seed 2,000 comments across other cards + 500 top-level comments on hotCard + 30 on smallCard.
    await env.DB.batch([
      env.DB.prepare(`WITH RECURSIVE seq(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM seq WHERE n<1500)
        INSERT INTO comments(id, card_id, member_id, content, created_at, status, reply_count, like_count)
        SELECT 'other-'||n, 900000 + (n % 25), ?, 'other '||n, 1000 + n, 'visible', 0, n % 5 FROM seq`).bind(fan),
      // Hot card: 460 visible, 20 removed with reply_count=2 (must appear as placeholder), 10 removed with reply_count=0 (hidden), 10 deleted (hidden).
      env.DB.prepare(`WITH RECURSIVE seq(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM seq WHERE n<460)
        INSERT INTO comments(id, card_id, member_id, content, created_at, status, reply_count, like_count, pinned_at)
        SELECT 'hot-vis-'||n, ?, ?, 'hot '||n, 10000 + n, 'visible', CASE WHEN n <= 5 THEN 1 ELSE 0 END, n % 50, CASE WHEN n = 1 THEN 5000 ELSE NULL END FROM seq`).bind(Number(hotCard.id), fan),
      env.DB.prepare(`WITH RECURSIVE seq(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM seq WHERE n<20)
        INSERT INTO comments(id, card_id, member_id, content, created_at, deleted_at, status, reply_count, like_count)
        SELECT 'hot-rem-keep-'||n, ?, ?, 'removed '||n, 20000 + n, 25000, 'removed', 2, 0 FROM seq`).bind(Number(hotCard.id), fan),
      env.DB.prepare(`WITH RECURSIVE seq(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM seq WHERE n<10)
        INSERT INTO comments(id, card_id, member_id, content, created_at, deleted_at, status, reply_count, like_count)
        SELECT 'hot-rem-drop-'||n, ?, ?, 'removed0 '||n, 21000 + n, 25000, 'removed', 0, 0 FROM seq`).bind(Number(hotCard.id), fan),
      env.DB.prepare(`WITH RECURSIVE seq(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM seq WHERE n<10)
        INSERT INTO comments(id, card_id, member_id, content, created_at, deleted_at, status, reply_count, like_count)
        SELECT 'hot-del-'||n, ?, ?, 'deleted '||n, 22000 + n, 25000, 'deleted', 0, 0 FROM seq`).bind(Number(hotCard.id), fan),
      // Small card: 30 visible top-level comments.
      env.DB.prepare(`WITH RECURSIVE seq(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM seq WHERE n<30)
        INSERT INTO comments(id, card_id, member_id, content, created_at, status, reply_count, like_count)
        SELECT 'small-vis-'||n, ?, ?, 'small '||n, 30000 + n, 'visible', 0, n % 10 FROM seq`).bind(Number(smallCard.id), fan),
    ]);
    await env.DB.prepare("ANALYZE").run();

    const targetHot: CommentTarget = { kind: "card", card: { id: hotCard.id, provider: "harbor", authorNumId: 1001, adult: false } };
    const targetSmall: CommentTarget = { kind: "card", card: { id: smallCard.id, provider: "harbor", authorNumId: 1001, adult: false } };
    const viewer = { memberId: null, moderator: false };

    const { db: mDb, log } = instrumentReadsWrites(env.DB, true);
    const smallPage = await listTop(mDb, targetSmall, viewer, 1, "new");
    const hotNewPage = await listTop(mDb, targetHot, viewer, 1, "new");
    const hotHotPage = await listTop(mDb, targetHot, viewer, 1, "hot");
    const hotCountOnly = await countTop(mDb, targetHot);

    // Measure write cost of posting a top-level comment, reply, and like (use fresh poster to avoid 6/min rate limit).
    const poster = await makeMember(2002);
    const { db: wDb, log: wLog } = instrumentReadsWrites(env.DB, false);
    const posted = await postComment(wDb, { target: targetSmall, memberId: poster, content: "new top", now: 50000 });
    await postComment(wDb, { target: targetSmall, memberId: poster, content: "new reply", rootId: posted.commentId, now: 50001 });
    await setLike(wDb, posted.commentId, author, true, 50002);

    const countQueries = log.filter((q) => q.sql.startsWith("SELECT COUNT(*) AS n FROM comments"));
    const listQueries = log.filter((q) => q.sql.includes("FROM comments c JOIN members m") && q.sql.includes("LIMIT ?3 OFFSET ?4"));
    console.log("COMMENTS_BENCH", JSON.stringify({
      smallTotal: smallPage.total,
      hotTotal: hotNewPage.total,
      hotCountOnly,
      counts: countQueries.map((q) => ({ reads: q.reads, plan: q.plan })),
      lists: listQueries.map((q) => ({ reads: q.reads, plan: q.plan })),
      writes: wLog.filter((q) => q.writes > 0).map((q) => ({ sql: q.sql.slice(0, 50), writes: q.writes })),
    }));

    // Functional invariants: 460 visible + 20 removed-with-replies = 480; pinned first on page 1.
    expect(smallPage.total).toBe(30);
    expect(smallPage.comments).toHaveLength(20);
    expect(hotNewPage.total).toBe(480);
    expect(hotNewPage.comments).toHaveLength(20);
    expect(hotNewPage.comments[0].commentId).toBe("hot-vis-1");
    expect(hotNewPage.comments[0].isPinned).toBe(true);
    expect(hotNewPage.comments[1].commentId).toBe("hot-rem-keep-20");
    expect(hotNewPage.comments[1].removed).toBe(true);
    expect(hotHotPage.total).toBe(480);
    expect(hotCountOnly).toBe(460);

    // Performance assertions: no full SCAN of comments on any of these queries, and newest avoids TEMP B-TREE ORDER BY.
    for (const q of countQueries) {
      expect(q.plan.join("\n")).not.toMatch(/\bSCAN comments\b/);
    }
    for (const q of listQueries) {
      expect(q.plan.join("\n")).not.toMatch(/\bSCAN c\b/);
    }
    // Small card COUNT + newest page should read far fewer rows than the 2,030-row table.
    expect(countQueries[0].reads).toBeLessThan(100);
    expect(listQueries[0].reads).toBeLessThan(150);
    // Hot card newest page should use index order without TEMP B-TREE for ORDER BY.
    expect(listQueries[1].plan.join("\n")).not.toContain("USE TEMP B-TREE FOR ORDER BY");
    expect(listQueries[1].reads).toBeLessThan(200);
  });

  it("#3 expired notification cleanup: moved out of Discord pending polling, reads enforce 30-day retention, daily cron purges expired rows", async () => {
    identities({ reader: 30001 });
    const member = await makeMember(30001);
    const otherMember = await makeMember(30002);
    const now = Date.now();
    const expiredAt = now - 31 * 86_400_000;
    const freshAt = now - 60_000;

    await env.DB.batch([
      env.DB.prepare("INSERT INTO community_notifications(event_key,member_id,kind,path,created_at,delivered) VALUES(?,?,?,?,?,0)")
        .bind("expired-1", member, "comment", "/cards/1", expiredAt),
      env.DB.prepare("INSERT INTO community_notifications(event_key,member_id,kind,path,created_at,delivered) VALUES(?,?,?,?,?,0)")
        .bind("fresh-1", member, "comment", "/cards/1", freshAt),
      env.DB.prepare(`WITH RECURSIVE seq(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM seq WHERE n<400)
        INSERT INTO community_notifications(event_key,member_id,kind,path,created_at,delivered)
        SELECT 'bulk-'||n, ?, 'comment', '/cards/1', ?, 1 FROM seq`).bind(otherMember, freshAt),
    ]);

    // Check unread summary and list exclude the expired row BEFORE any purge runs.
    const listRes = await SELF.fetch("https://c.test/v1/me/community/notifications", { headers: bearer("reader") });
    expect(listRes.status).toBe(200);
    const listBody = await listRes.json() as { items: { created_at: number }[] };
    expect(listBody.items).toHaveLength(1);
    expect(listBody.items[0].created_at).toBe(freshAt);

    const summaryRes = await SELF.fetch("https://c.test/v1/me/community/notifications/summary", { headers: bearer("reader") });
    expect(summaryRes.status).toBe(200);
    expect(await summaryRes.json()).toEqual({ unread: 1 });

    // Trigger Discord bridge /internal/community/pending with an instrumented DB and verify it does NOT run DELETE FROM community_notifications.
    const bridgeKey = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    const guildId = "123456789012345678";
    const bridgeEnv = { ...env, COMMUNITY_ENABLED: "true", COMMUNITY_BRIDGE_KEY: bridgeKey, COMMUNITY_SITE_URL: "https://c.test", COMMUNITY_GUILD_ID: guildId };
    const callBridge = async (op: string, bodyObj: Record<string, unknown>, targetDb: D1Database) => {
      const ts = String(now);
      const nonce = crypto.randomUUID();
      const payload = JSON.stringify({ guild: guildId, ...bodyObj });
      const sig = await sign(bridgeKey, "POST", `/internal/community/${op}`, ts, nonce, payload);
      return worker.fetch(
        new Request(`https://c.test/internal/community/${op}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Community-Time": ts,
            "X-Community-Nonce": nonce,
            "X-Community-Signature": sig,
          },
          body: payload,
        }),
        { ...bridgeEnv, DB: targetDb } as Env,
        { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext,
      );
    };

    // Opt member into Discord DM to verify pending DM query and single-notification fetch also enforce 30-day retention.
    await env.DB.batch([
      env.DB.prepare("INSERT INTO community_subjects(discord_id) VALUES('123456789012345679')"),
      env.DB.prepare("INSERT INTO discord_links(member_id,discord_id,name,version,state,created_at) VALUES(?,'123456789012345679','reader','v1','active',?)").bind(member, now),
      env.DB.prepare("INSERT INTO community_preferences(member_id,notifications,discord_dm) VALUES(?,1,1)").bind(member),
    ]);
    const expiredRow = await env.DB.prepare("SELECT id FROM community_notifications WHERE event_key='expired-1'").first<{ id: string }>();
    const freshRow = await env.DB.prepare("SELECT id FROM community_notifications WHERE event_key='fresh-1'").first<{ id: string }>();

    const { db: mDb, log } = instrumentReadsWrites(env.DB, false);
    const pendingRes = await callBridge("pending", {}, mDb);
    expect(pendingRes.status).toBe(200);
    const pendingBody = await pendingRes.json() as { notifications: { id: string }[] };
    expect(pendingBody.notifications.map((n) => n.id)).toEqual([freshRow!.id]);

    const notifDeletes = log.filter((q) => /DELETE\s+FROM\s+community_notifications/i.test(q.sql));
    console.log("PENDING_NOTIF_DELETES", notifDeletes.length);
    expect(notifDeletes).toHaveLength(0);

    // Direct single-notification fetch for the expired row also enforces retention (404).
    const expiredFetch = await callBridge("notification", { id: expiredRow!.id, delivered: true }, env.DB);
    expect(expiredFetch.status).toBe(404);
    // Expired row is still in table until daily purge runs.
    const beforePurge = await env.DB.prepare("SELECT COUNT(*) AS n FROM community_notifications WHERE event_key='expired-1'").first<{ n: number }>();
    expect(beforePurge?.n).toBe(1);

    // Daily cron (RANK_CRON = "23 16 * * *") purges expired notifications without deleting fresh ones.
    const waits: Promise<unknown>[] = [];
    await worker.scheduled(
      { cron: "23 16 * * *", scheduledTime: now, noRetry() {} } as ScheduledController,
      env,
      { waitUntil(p: Promise<unknown>) { waits.push(Promise.resolve(p)); }, passThroughOnException() {} } as unknown as ExecutionContext,
    );
    await Promise.all(waits);
    const afterExpired = await env.DB.prepare("SELECT COUNT(*) AS n FROM community_notifications WHERE event_key='expired-1'").first<{ n: number }>();
    const afterFresh = await env.DB.prepare("SELECT COUNT(*) AS n FROM community_notifications WHERE event_key='fresh-1'").first<{ n: number }>();
    expect(afterExpired?.n).toBe(0);
    expect(afterFresh?.n).toBe(1);
    expect(seal).toBeTypeOf("function");
  });

  it("#4-1 testCardIdsForRows: avoids re-reading cards table in filterPublicRows and reuses exclusion set across provePublicAggregates batches", async () => {
    const testMember = await makeMember(9001);
    await env.DB.prepare("UPDATE members SET account_class='test' WHERE id=?").bind(testMember).run();
    const retired = await makeMember(279);
    await env.DB.prepare("INSERT INTO legacy_account_fence(public_no,member_id,handle,request_id,created_at) VALUES(279,?,'ret-279','req-1',1)").bind(retired).run();
    await makeMember(1001);

    await env.DB.batch([
      env.DB.prepare(`WITH RECURSIVE seq(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM seq WHERE n<200)
        INSERT INTO cards(id,provider,source_role_id,zone,author_num_id,author_name,names,summaries,tags,registered_at,last_synced_at,status)
        SELECT 300000+n,'harbor','r-'||n,'zh',CASE WHEN n<=5 THEN 9001 WHEN n=6 THEN 279 ELSE 1001 END,'Author','{"zh":"C"}','{"zh":"S"}','[]',n,n,'approved' FROM seq`),
    ]);
    const rows = (await env.DB.prepare("SELECT * FROM cards ORDER BY id").all<any>()).results;
    const { db: mDb, log } = instrumentReadsWrites(env.DB, false);
    const filtered = await filterPublicRows({ ...env, DB: mDb } as Env, rows, "list");
    expect(filtered.rows).toHaveLength(194);

    const exclusionQueries = log.filter((q) => q.sql.includes("excluded_members") || q.sql.includes("account_class='test'"));
    const exclusionReads = exclusionQueries.reduce((s, q) => s + q.reads, 0);
    console.log("TEST_CARD_IDS_READS", { count: exclusionQueries.length, reads: exclusionReads, sql: exclusionQueries.map((q) => q.sql.slice(0, 80)) });
    // Should read only the small excluded member/identity set (not 200 cards + 200 json_each rows).
    expect(exclusionReads).toBeLessThan(60);

    // Also verify provePublicAggregates across 2 batches (205 managed cards) queries excluded_members only ONCE.
    await resetDb();
    const owner = await makeMember(1005);
    const retired2 = await makeMember(279);
    await env.DB.prepare("INSERT INTO legacy_account_fence(public_no,member_id,handle,request_id,created_at) VALUES(279,?,'ret-279','req-1',1)").bind(retired2).run();
    await env.DB.batch([
      env.DB.prepare(`WITH RECURSIVE seq(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM seq WHERE n<205)
        INSERT INTO works(id,member_id,source_provider,source_role_id,created_at)
        SELECT 'pw-'||n,?,'harbor','pr-'||n,1 FROM seq`).bind(owner),
      env.DB.prepare(`WITH RECURSIVE seq(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM seq WHERE n<205)
        INSERT INTO managed_work_access(work_id,provider,source_role_id,access,epoch,restriction,sync_state,moderation_revision,confirmed_moderation_revision)
        SELECT 'pw-'||n,'harbor','pr-'||n,'public',1,'none','complete',1,1 FROM seq`),
      env.DB.prepare(`WITH RECURSIVE seq(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM seq WHERE n<205)
        INSERT INTO cards(id,provider,source_role_id,zone,author_num_id,author_name,names,summaries,tags,registered_at,last_synced_at,status)
        SELECT 350000+n,'harbor','pr-'||n,'zh',1005,'Author','{"zh":"C"}','{"zh":"S"}','[]',n,n,'approved' FROM seq`),
    ]);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { items: { sourceRoleId: string; workId: string; targetRoleId: string }[] };
      return Response.json({
        items: body.items.map((item) => ({
          ...item,
          managed: true,
          access: "public",
          restriction: "none",
          epoch: 1,
          shareRoleId: item.targetRoleId,
          approvedRoleId: item.targetRoleId,
          targetReadable: true,
          listed: true,
        })),
      });
    });
    const { db: pDb, log: pLog } = instrumentReadsWrites(env.DB, false);
    await provePublicAggregates({ ...env, DB: pDb, HOSTING_SERVICE_KEY: "test-key" } as Env, "zh");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const aggExcl = pLog.filter((q) => q.sql.includes("excluded_members"));
    expect(aggExcl).toHaveLength(1);
  });

  it("#4-2 ownerVisibilityBatch: avoids duplicate managed_work_access read when refresh is empty, still re-reads after refresh", async () => {
    const owner = await makeMember(1002);
    const sources = ["src-1", "src-2", "src-3"];
    await env.DB.batch(
      sources.flatMap((s, i) => [
        env.DB.prepare("INSERT INTO works(id,member_id,source_provider,source_role_id,created_at) VALUES(?,?,'harbor',?,1)")
          .bind(`w-${i + 1}`, owner, s),
        env.DB.prepare("INSERT INTO managed_work_access(work_id,provider,source_role_id,access,epoch,restriction,sync_state,moderation_revision,confirmed_moderation_revision) VALUES(?,'harbor',?,'public',1,'none','complete',1,1)")
          .bind(`w-${i + 1}`, s),
      ]),
    );
    vi.spyOn(workPolicyGateway, "owners").mockResolvedValue(
      sources.map((s, i) => ({
        managed: true,
        workId: `w-${i + 1}`,
        sourceRoleId: s,
        access: "public",
        epoch: 1,
        restriction: "none",
        providerRestriction: "none",
        approvedRoleId: "",
        revisionState: "same",
        restorable: false,
        restoreReason: "none",
        policyRevision: "p1",
        approvalRevision: "a1",
        operationId: "",
        state: "complete",
        replayed: false,
      })),
    );
    const { db: mDb, log } = instrumentReadsWrites(env.DB, false);
    await readOwnerVisibilities({ ...env, DB: mDb } as Env, sources, "token");
    const mwaReads = log.filter((q) => q.sql.includes("FROM managed_work_access"));
    console.log("OWNER_MWA_READS", mwaReads.length);
    expect(mwaReads).toHaveLength(1);

    // When epoch advanced (refresh.length > 0), ownerVisibilityBatch MUST re-read managed_work_access after refresh.
    vi.spyOn(workPolicyGateway, "owners").mockResolvedValue(
      sources.map((s, i) => ({
        managed: true,
        workId: `w-${i + 1}`,
        sourceRoleId: s,
        access: "public",
        epoch: i === 0 ? 2 : 1,
        restriction: "none",
        providerRestriction: "none",
        approvedRoleId: "",
        revisionState: "same",
        restorable: false,
        restoreReason: "none",
        policyRevision: "p1",
        approvalRevision: "a1",
        operationId: "",
        state: "complete",
        replayed: false,
      })),
    );
    const { db: rDb, log: rLog } = instrumentReadsWrites(env.DB, false);
    await readOwnerVisibilities({ ...env, DB: rDb } as Env, sources, "token");
    const mwaReadsAfterRefresh = rLog.filter((q) => q.sql.includes("FROM managed_work_access WHERE provider='harbor' AND source_role_id IN"));
    expect(mwaReadsAfterRefresh).toHaveLength(2);
  });

  it("#4-3 publicCandidates: skips discarded COUNT(*) when managed_work_access is non-empty, keeps exact total when unmanaged", async () => {
    await makeMember(1001);
    await env.DB.prepare(`WITH RECURSIVE seq(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM seq WHERE n<250)
      INSERT INTO cards(id,provider,source_role_id,zone,author_num_id,author_name,names,summaries,tags,heat,registered_at,last_synced_at,status)
      SELECT 400000+n,'harbor','board-'||n,'zh',1001,'Author','{"zh":"C"}','{"zh":"S"}','[]',n,n,n,'approved' FROM seq`).run();
    const source = { zone: "zh" as const, sort: "hot" as const, limit: 24, offset: 0, allowNsfw: false };
    const pos = { raw: 0, trail: [], binding: "b" };

    // Unmanaged catalog: still computes exact total=250.
    const unmanagedCand = await publicCandidates(env, source, 0);
    const unmanagedPage = await publicCandidatePage(env, unmanagedCand, pos, { limit: 24, offset: 0, lang: "zh-Hant", allowNsfw: false }, source);
    expect(unmanagedCand.total).toBe(250);
    expect(unmanagedPage.total).toBe(250);

    // Managed catalog (production state): publicCandidatePage always returns total=null, so publicCandidates skips COUNT(*).
    const owner = await makeMember(1003);
    await env.DB.batch([
      env.DB.prepare("INSERT INTO works(id,member_id,source_provider,source_role_id,created_at) VALUES('w-any',?,'harbor','other-role',1)").bind(owner),
      env.DB.prepare("INSERT INTO managed_work_access(work_id,provider,source_role_id,access,epoch,restriction,sync_state,moderation_revision,confirmed_moderation_revision) VALUES('w-any','harbor','other-role','private',1,'none','complete',1,1)"),
    ]);
    const { db: mDb, log } = instrumentReadsWrites(env.DB, false);
    const managedCand = await publicCandidates({ ...env, DB: mDb } as Env, source, 0);
    const countQueries = log.filter((q) => q.sql.startsWith("SELECT COUNT(*) AS n FROM cards"));
    console.log("PUBLIC_CANDIDATES_COUNT_QUERIES", countQueries.length, managedCand.total);
    expect(countQueries).toHaveLength(0);
    expect(managedCand.total).toBeNull();
  });

  it("#4-4 suki visit cravingMet: indexes card lookup instead of provider scan, and short-circuits when already craved or no story today", async () => {
    identities({ sukiFan: 40001 });
    const fan = await makeMember(40001);
    const now = Date.now();
    const day = localDay(now, -480);
    const targetTag = (tagNamesFor(cravingKey(day)) ?? ["劇情"])[0]!;

    await env.DB.batch([
      env.DB.prepare(`WITH RECURSIVE seq(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM seq WHERE n<400)
        INSERT INTO cards(id,provider,source_role_id,zone,author_num_id,author_name,names,summaries,tags,registered_at,last_synced_at,status)
        SELECT 500000+n,'harbor','noise-'||n,'zh',1001,'Author','{"zh":"N"}','{"zh":"S"}','["other"]',n,n,'approved' FROM seq`),
      env.DB.prepare("INSERT INTO cards(id,provider,source_role_id,approved_hosted_role_id,zone,author_num_id,author_name,names,summaries,tags,registered_at,last_synced_at,status) VALUES(500999,'harbor','crave-src','crave-hosted','zh',1001,'Author','{\"zh\":\"C\"}','{\"zh\":\"S\"}',?,1,1,'approved')")
        .bind(JSON.stringify([targetTag])),
    ]);
    await env.DB.prepare("ANALYZE").run();

    // Visit 1: no conversations yet today -> short-circuits cravingMet (0 cards read).
    const { db: db1, log: log1 } = instrumentReadsWrites(env.DB, true);
    const r1 = await worker.fetch(
      new Request("https://c.test/v1/me/suki/visit", { method: "POST", headers: { ...bearer("sukiFan"), "Content-Type": "application/json" }, body: JSON.stringify({ tzOffset: -480 }) }),
      { ...env, DB: db1 } as Env,
      { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext,
    );
    expect(r1.status).toBe(200);
    const craving1 = log1.filter((q) => q.sql.includes("json_each(c.tags)"));
    expect(craving1).toHaveLength(0);

    // Play the card via its approved_hosted_role_id today, then visit -> cravingMet runs using index seek (not 400-row cards scan).
    await env.DB.prepare("INSERT INTO member_conversations(member_id,provider,role_id,conversation_id,created_at,updated_at) VALUES(?,?,?,?,?,?)")
      .bind(fan, "harbor", "crave-hosted", "conv-today", now, now).run();
    const { db: db2, log: log2 } = instrumentReadsWrites(env.DB, true);
    const r2 = await worker.fetch(
      new Request("https://c.test/v1/me/suki/visit", { method: "POST", headers: { ...bearer("sukiFan"), "Content-Type": "application/json" }, body: JSON.stringify({ tzOffset: -480 }) }),
      { ...env, DB: db2 } as Env,
      { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext,
    );
    expect(r2.status).toBe(200);
    const body2 = await r2.json() as { news: { kind: string }[]; state: { cravedDay?: string } };
    expect(body2.news.map((n) => n.kind)).toContain("craved");
    expect(body2.state.cravedDay).toBe(day);
    const craving2 = log2.filter((q) => q.sql.includes("json_each(c.tags)"));
    console.log("SUKI_CRAVING_READS", craving2.map((q) => ({ reads: q.reads, plan: q.plan })));
    expect(craving2.length).toBe(1);
    expect(craving2[0].reads).toBeLessThan(50);

    // Visit 3 on the same day: cravedDay === day -> short-circuits cravingMet completely.
    const { db: db3, log: log3 } = instrumentReadsWrites(env.DB, true);
    const r3 = await worker.fetch(
      new Request("https://c.test/v1/me/suki/visit", { method: "POST", headers: { ...bearer("sukiFan"), "Content-Type": "application/json" }, body: JSON.stringify({ tzOffset: -480 }) }),
      { ...env, DB: db3 } as Env,
      { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext,
    );
    expect(r3.status).toBe(200);
    expect(log3.filter((q) => q.sql.includes("json_each(c.tags)"))).toHaveLength(0);
  });

  it("#4-5 /v1/tags/counts: computes catalogTagCounts and ratingCounts in one cards scan with identical results across all scopes", async () => {
    await env.DB.prepare(`WITH RECURSIVE seq(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM seq WHERE n<300)
      INSERT INTO cards(id,provider,source_role_id,zone,author_num_id,author_name,names,summaries,tags,rating,registered_at,last_synced_at,status)
      SELECT 600000+n,'harbor','tc-'||n,CASE WHEN n%3=0 THEN 'en' ELSE 'zh' END,1001,'Author','{"zh":"T"}','{"zh":"S"}',
        CASE WHEN n%2=0 THEN '["Story","Game"]' ELSE '["Story"]' END,
        CASE n%6 WHEN 0 THEN 'G' WHEN 1 THEN 'P' WHEN 2 THEN 'PG12' WHEN 3 THEN 'PG15' WHEN 4 THEN 'R' ELSE NULL END,
        n,n,'approved' FROM seq`).run();

    for (const query of ["zone=zh", "zone=zh&rating=G", "zone=zh&rating=PG15", "zone=en&tag=story"]) {
      const url = `https://c.test/v1/tags/counts?${query}`;
      const params = new URL(url).searchParams;
      const scope = {
        zone: params.get("zone") ?? "zh",
        tagGroups: params.get("tag") ? [tagNamesFor(params.get("tag")!) ?? [params.get("tag")!]] : [],
        allowNsfw: false,
        maxRating: (params.get("rating") as "G" | "PG15" | null) ?? undefined,
      };
      const expectedCounts = await catalogTagCounts(env.DB, scope);
      const expectedRatings = await ratingCounts(env.DB, scope);

      const { db: mDb, log } = instrumentReadsWrites(env.DB, false);
      const res = await worker.fetch(
        new Request(url),
        { ...env, DB: mDb } as Env,
        { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext,
      );
      expect(res.status).toBe(200);
      const body = await res.json() as { counts: Record<string, number>; ratings: Record<string, number> };
      expect(body.counts).toEqual(expectedCounts);
      expect(body.ratings).toEqual(expectedRatings);

      const cardsScans = log.filter((q) => q.sql.includes("FROM cards c WHERE") && q.sql.includes("GROUP BY"));
      console.log("TAG_COUNTS_SCANS", query, cardsScans.map((q) => ({ reads: q.reads, sql: q.sql.slice(0, 60) })));
      expect(cardsScans).toHaveLength(1);
    }
  });
});
