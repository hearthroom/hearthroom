import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetDb, restoreUpstream, role } from "./helpers";
import { upsertCard } from "../src/cards";
import { syncHeat } from "../src/heat";
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

// 熱度每小時整批從 Harbor 讀：逐張讀詳情一小時只輪得完幾十張，榜單會落後一天以上。
describe("熱度同步", () => {
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
});
