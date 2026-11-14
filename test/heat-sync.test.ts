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

it("syncs talk counts in the heat batch, retains missing counts and writes changed rows once", async () => {
  await card("talk-change", "h-talk-change", 1);
  await card("heat-change", "h-heat-change", 1);
  await card("missing-talk", "h-missing-talk", 1);
  await env.DB.prepare("UPDATE cards SET talk_num=9 WHERE provider='harbor'").run();
  const baseline = await env.DB.prepare("UPDATE cards SET heat=2 WHERE provider='harbor'").run();
  const talkBaseline = await env.DB.prepare("UPDATE cards SET talk_num=0 WHERE source_role_id='talk-change'").run();
  const baselineWrites = baseline.meta.rows_written + talkBaseline.meta.rows_written;
  await env.DB.prepare("UPDATE cards SET heat=1,talk_num=9 WHERE provider='harbor'").run();
  upstream.fetchHeats = async () => ({ heat: { "h-talk-change": 2, "h-heat-change": 2, "h-missing-talk": 2 }, talkNum: { "h-talk-change": 0, "h-heat-change": 9 } });
  const originalBatch = env.DB.batch.bind(env.DB);
  let written = 0;
  let reads = 0;
  const measured = { ...env, DB: new Proxy(env.DB, { get(target, key) {
    if (key === "batch") return async (statements: D1PreparedStatement[]) => {
      const results = await originalBatch(statements);
      written += results.reduce((n, r) => n + r.meta.rows_written, 0);
      reads += results.reduce((n, r) => n + r.meta.rows_read, 0);
      return results;
    };
    const value = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  } }) };
  expect(await syncHeat(measured)).toMatchObject({ updated: 3, talk_updated: 1 });
  expect(written).toBeLessThanOrEqual(baselineWrites);
  expect(reads).toBeLessThan(100);
  expect((await env.DB.prepare("SELECT talk_num FROM cards WHERE source_role_id='talk-change'").first())?.talk_num).toBe(0);
  expect((await env.DB.prepare("SELECT talk_num FROM cards WHERE source_role_id='missing-talk'").first())?.talk_num).toBe(9);
  expect(await syncHeat(measured)).toMatchObject({ updated: 0, talk_updated: 0 });
  expect(written).toBeLessThanOrEqual(baselineWrites);
});

// 熱度每 10 分鐘整批從 Harbor 讀，逐張同步卡片詳情則維持原排程。
describe("熱度同步", () => {
  it("updates talk count even when heat is unchanged, and ignores a replaced hosted binding", async () => {
    await card("talk-only", "h-talk-only", 8);
    upstream.fetchHeats = async () => ({ heat: { "h-talk-only": 8 }, talkNum: { "h-talk-only": 12 } });
    expect(await syncHeat(env)).toMatchObject({ updated: 1, talk_updated: 1 });
    expect(await heatOf("talk-only")).toBe(8);
    expect((await env.DB.prepare("SELECT talk_num FROM cards WHERE source_role_id='talk-only'").first())?.talk_num).toBe(12);
    upstream.fetchHeats = async () => {
      await env.DB.prepare("UPDATE cards SET approved_hosted_role_id='replacement' WHERE source_role_id='talk-only'").run();
      return { heat: { "h-talk-only": 99 }, talkNum: { "h-talk-only": 99 } };
    };
    expect(await syncHeat(env)).toMatchObject({ updated: 0, talk_updated: 0 });
    expect(await heatOf("talk-only")).toBe(8);
  });

  it("每 10 分鐘的專用排程只同步熱度，不執行其他卡片同步", async () => {
    expect(HEAT_CRON).toBe("2-59/10 * * * *");
    await card("scheduled", "h-scheduled", 1);
    const asked: string[][] = [];
    upstream.fetchHeats = async (_env, ids) => {
      asked.push([...ids]);
      return { heat: { "h-scheduled": 80 }, talkNum: { "h-scheduled": 12 } };
    };
    let detailReads = 0;
    upstream.fetchRole = async () => { detailReads++; throw new Error("unrelated card sync"); };
    const ctx = createExecutionContext();
    const points: { indexes: string[]; doubles: number[] }[] = [];
    const measured = { ...env, EVENTS: { writeDataPoint: (point: any) => points.push(point) } as AnalyticsEngineDataset };
    await worker.scheduled(createScheduledController({ cron: "2-59/10 * * * *" }), measured, ctx);
    await waitOnExecutionContext(ctx);
    expect(asked).toEqual([["h-scheduled"]]);
    expect(await heatOf("scheduled")).toBe(80);
    expect(detailReads).toBe(0);
    expect(points.find((p) => p.indexes[0] === "heat_sync")?.doubles[4]).toBe(1);
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
      return { heat: { "h-a": 120, "h-b": 5 }, talkNum: {} };
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
      return { heat: Object.fromEntries(ids.map((id) => [id, 50])), talkNum: {} };
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
    upstream.fetchHeats = async (_env, ids) => ({ heat: Object.fromEntries(ids.map((id) => [id, 7])), talkNum: Object.fromEntries(ids.map((id) => [id, 2])) });
    const batch = env.DB.batch.bind(env.DB);
    let rowsRead = 0;
    const measured = { ...env, DB: new Proxy(env.DB, { get(target, key) {
      if (key === "batch") return async (statements: D1PreparedStatement[]) => {
        const results = await batch(statements);
        rowsRead += results.reduce((n, r) => n + r.meta.rows_read, 0);
        return results;
      };
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    } }) };
    expect(await syncHeat(measured)).toMatchObject({ batches: 6, failed: 0, updated: 1100, talk_updated: 1100 });
    // Three indexed passes plus changed-column index maintenance remain linear;
    // a provider-wide or nested JSON scan exceeds this bound by orders of magnitude.
    expect(rowsRead).toBeLessThan(25000);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM cards WHERE heat=7").first<{ n: number }>())!.n).toBe(1100);
    // 沒變的不再寫
    expect(await syncHeat(env)).toMatchObject({ updated: 0 });
  });

  it("只同步已過審的卡", async () => {
    await card("ok", "h-ok", 0);
    await card("rejected", "h-rejected", 0);
    await env.DB.prepare("UPDATE cards SET status='rejected' WHERE source_role_id='rejected'").run();
    const asked: string[] = [];
    upstream.fetchHeats = async (_env, ids) => { asked.push(...ids); return { heat: Object.fromEntries(ids.map((id) => [id, 9])), talkNum: {} }; };
    await syncHeat(env);
    expect(asked).toEqual(["h-ok"]);
  });
});
