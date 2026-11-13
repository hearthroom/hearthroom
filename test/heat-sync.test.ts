import { createExecutionContext, createScheduledController, env, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetDb, restoreUpstream, role } from "./helpers";
import { upsertCard } from "../src/cards";
import { HEAT_CRON, syncHeat } from "../src/heat";
import worker from "../src/index";
import { opsMetrics } from "../src/ops-metrics";
import { upstream } from "../src/upstream";
import { HttpError } from "../src/types";

beforeEach(resetDb);
afterEach(restoreUpstream);

/** 登記一張卡並綁上過審的封存版；hosted 為 null＝還沒有封存版。 */
async function card(roleId: string, hosted: string | null, heat = 0) {
  await upsertCard(env.DB, role({ roleId }), 1);
  await env.DB.prepare("UPDATE cards SET provider='harbor', approved_hosted_role_id=?, heat=? WHERE source_role_id=?").bind(hosted, heat, roleId).run();
}
const heatOf = async (roleId: string) =>
  (await env.DB.prepare("SELECT heat FROM cards WHERE source_role_id=?").bind(roleId).first<{ heat: number }>())!.heat;

// 熱度每 10 分鐘整批從 Harbor 讀，逐張同步卡片詳情則維持原排程。
describe("熱度同步", () => {
  it("每 10 分鐘的專用排程只同步熱度，不執行其他卡片同步", async () => {
    expect(HEAT_CRON).toBe("2-59/10 * * * *");
    await card("scheduled", "h-scheduled", 1);
    const asked: string[][] = [];
    upstream.fetchHeats = async (_env, ids) => {
      asked.push([...ids]);
      return { "h-scheduled": 80 };
    };
    let detailReads = 0;
    upstream.fetchRole = async () => { detailReads++; throw new Error("unrelated card sync"); };
    const ctx = createExecutionContext();
    await worker.scheduled(createScheduledController({ cron: "2-59/10 * * * *" }), env, ctx);
    await waitOnExecutionContext(ctx);
    expect(asked).toEqual([["h-scheduled"]]);
    expect(await heatOf("scheduled")).toBe(80);
    expect(detailReads).toBe(0);
    expect(await opsMetrics(env.DB)).toContain('hearthroom_card_heat_sync_total{operation="batch",outcome="success"} 1');
  });

  it("用封存版的 id 批次讀，回寫熱度；Harbor 沒回的卡保留原值", async () => {
    await card("a", "h-a", 1);
    await card("b", "h-b", 2);
    await card("c", "h-c", 7);
    await card("draft", null, 3);
    const asked: string[][] = [];
    upstream.fetchHeats = async (_env, ids) => {
      asked.push([...ids]);
      return { "h-a": 120, "h-b": 5 };
    };
    expect(await syncHeat(env)).toMatchObject({ batches: 1, failed: 0, updated: 2 });
    expect(asked.flat().sort()).toEqual(["h-a", "h-b", "h-c"]);
    expect([await heatOf("a"), await heatOf("b"), await heatOf("c"), await heatOf("draft")]).toEqual([120, 5, 7, 3]);
  });

  it("分批讀；一批失敗不影響其他批，失敗那批保留原值等下一輪", async () => {
    for (const id of ["a", "b", "c", "d", "e"]) await card(id, `h-${id}`, 1);
    let calls = 0;
    upstream.fetchHeats = async (_env, ids) => {
      calls++;
      expect(ids.length).toBeLessThanOrEqual(2);
      if (ids.includes("h-c")) throw new HttpError(502, "upstream down");
      return Object.fromEntries(ids.map((id) => [id, 50]));
    };
    expect(await syncHeat(env, 2)).toMatchObject({ batches: 3, failed: 1 });
    expect(calls).toBe(3);
    const heats = await Promise.all(["a", "b", "c", "d", "e"].map(heatOf));
    expect(heats.filter((n) => n === 50)).toHaveLength(3);
    expect(await heatOf("c")).toBe(1);
    const metrics = await opsMetrics(env.DB);
    expect(metrics).toContain('hearthroom_card_heat_sync_total{operation="batch",outcome="success"} 2');
    expect(metrics).toContain('hearthroom_card_heat_sync_total{operation="batch",outcome="error"} 1');
  });

  it("上千張一起變動也寫得進去（每批一句更新，不是每張卡一句）", async () => {
    const stmts = [];
    for (let i = 0; i < 1100; i++) {
      const rid = `bulk-${i}`;
      stmts.push(env.DB.prepare("INSERT INTO card_numbers(provider,source_role_id) VALUES('harbor',?)").bind(rid));
      stmts.push(env.DB.prepare(`INSERT INTO cards(id,source_role_id,author_num_id,registered_at,last_synced_at,zone,provider,status,approved_hosted_role_id)
        VALUES((SELECT num FROM card_numbers WHERE provider='harbor' AND source_role_id=?),?,1,0,0,'zh','harbor','approved',?)`).bind(rid, rid, `h-${rid}`));
    }
    await env.DB.batch(stmts);
    upstream.fetchHeats = async (_env, ids) => Object.fromEntries(ids.map((id) => [id, 7]));
    const writeReads: number[] = [];
    const db = new Proxy(env.DB, {
      get(target, key) {
        if (key === "batch") return async (statements: D1PreparedStatement[]) => {
          const results = await target.batch(statements);
          writeReads.push(...results.map((result) => result.meta.rows_read));
          return results;
        };
        const value = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    expect(await syncHeat({ ...env, DB: db })).toMatchObject({ batches: 6, failed: 0, updated: 1100 });
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM cards WHERE heat=7").first<{ n: number }>())!.n).toBe(1100);
    // A 200-card batch must use hosted IDs to find its targets, without scanning
    // every Harbor card against every JSON entry. This is a read-row budget, not a timer.
    expect(writeReads).toHaveLength(6);
    expect(Math.max(...writeReads)).toBeLessThan(4000);
    // 沒變的不再寫
    expect(await syncHeat(env)).toMatchObject({ updated: 0 });
  });

  it("共用封存id仍全部更新、其他provider不動，零熱度可寫且額外回傳不擴大更新", async () => {
    await card("shared-a", "h-shared", 3);
    await card("shared-b", "h-shared", 4);
    await card("other-provider", "h-shared", 5);
    await env.DB.prepare("UPDATE cards SET provider='lunatalk' WHERE source_role_id='other-provider'").run();
    await card("not-returned", "h-missing", 6);
    upstream.fetchHeats = async () => ({ "h-shared": 0, "not-requested": 999 });
    expect(await syncHeat(env)).toMatchObject({ batches: 1, failed: 0, updated: 2 });
    expect(await Promise.all(["shared-a", "shared-b", "other-provider", "not-returned"].map(heatOf))).toEqual([0, 0, 5, 6]);
    expect(await syncHeat(env)).toMatchObject({ updated: 0 });
  });

  it("只同步已過審的卡", async () => {
    await card("ok", "h-ok", 0);
    await card("rejected", "h-rejected", 0);
    await env.DB.prepare("UPDATE cards SET status='rejected' WHERE source_role_id='rejected'").run();
    const asked: string[] = [];
    upstream.fetchHeats = async (_env, ids) => { asked.push(...ids); return Object.fromEntries(ids.map((id) => [id, 9])); };
    await syncHeat(env);
    expect(asked).toEqual(["h-ok"]);
  });
});
