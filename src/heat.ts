import { bumpOp } from "./ops-metrics";
import { upstream } from "./upstream";
import type { Env } from "./types";

/** 熱度同步的排程，跟 wrangler.toml 的 crons 對應。 */
export const HEAT_CRON = "47 * * * *";
/** Harbor 一次最多回 200 張（/open/v1/role/heat）。 */
export const HEAT_BATCH = 200;
/**
 * 一次執行最多 50 個對外請求（見 wrangler.toml SYNC_BATCH_SIZE 的說明），D1 的讀寫也算；
 * 留給一次讀卡、一次寫回、兩筆指標與餘裕，其餘都給 Harbor 的批次。44 批 × 200＝8800 張。
 */
const HEAT_CALLS = 44;

/**
 * 每小時把所有已過審卡片的熱度從 Harbor 整批讀回 D1。
 *
 * 跟逐張同步（syncBatch）分開跑在自己的排程裡：那邊每輪已經吃滿子請求額度，而且一輪只輪 45 張，
 * 熱度要的是「每張卡每小時都更新」，只有批次讀得到。一批失敗就保留那批的舊值，下一輪再讀。
 */
export async function syncHeat(env: Env, batchSize = HEAT_BATCH): Promise<{ batches: number; failed: number; updated: number; skipped: number; ms: number }> {
  const started = Date.now();
  const rows = (
    await env.DB.prepare("SELECT approved_hosted_role_id AS hosted FROM cards WHERE provider='harbor' AND status='approved' AND approved_hosted_role_id IS NOT NULL ORDER BY id")
      .all<{ hosted: string }>()
  ).results;
  const capacity = HEAT_CALLS * batchSize;
  if (rows.length > capacity) console.warn("heat sync: more cards than one run can read; the rest wait", { cards: rows.length, capacity });
  const writes: D1PreparedStatement[] = [];
  let batches = 0;
  let failed = 0;
  for (let i = 0; i < Math.min(rows.length, capacity); i += batchSize) {
    const chunk = rows.slice(i, i + batchSize);
    batches++;
    let heats: Record<string, number>;
    try {
      heats = await upstream.fetchHeats(env, chunk.map((r) => r.hosted));
    } catch {
      failed++;
      console.error("heat sync batch failed");
      continue;
    }
    // 一批一句更新（不是一張卡一句）：上千張同時變動時，整輪的寫入仍只有幾十句。只寫數字真的變了的。
    writes.push(
      env.DB.prepare("UPDATE cards SET heat=j.value FROM json_each(?) j WHERE cards.provider='harbor' AND cards.approved_hosted_role_id=j.key AND cards.heat<>j.value")
        .bind(JSON.stringify(Object.fromEntries(chunk.filter((r) => heats[r.hosted] !== undefined).map((r) => [r.hosted, heats[r.hosted]])))),
    );
  }
  const updated = writes.length ? (await env.DB.batch(writes)).reduce((n, r) => n + (r.meta.changes ?? 0), 0) : 0;
  if (batches > failed) await bumpOp(env.DB, "card_heat", "batch", "success", batches - failed);
  if (failed) await bumpOp(env.DB, "card_heat", "batch", "error", failed);
  return { batches, failed, updated, skipped: Math.max(0, rows.length - capacity), ms: Date.now() - started };
}
