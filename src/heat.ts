import { bumpOp } from "./ops-metrics";
import { upstream, type HeatBatch } from "./upstream";
import type { Env } from "./types";

/** 熱度同步的排程，跟 wrangler.toml 的 crons 對應。 */
export const HEAT_CRON = "2-59/10 * * * *";
/** Harbor 一次最多回 200 張（/open/v1/role/heat）。 */
export const HEAT_BATCH = 200;
/**
 * 一次執行最多 50 個對外請求（見 wrangler.toml SYNC_BATCH_SIZE 的說明），D1 的讀寫也算；
 * 留給一次讀卡、一次寫回、兩筆指標與餘裕，其餘都給 Harbor 的批次。44 批 × 200＝8800 張。
 */
const HEAT_CALLS = 44;

/**
 * 每 10 分鐘把所有已過審卡片的熱度從 Harbor 整批讀回 D1。
 *
 * 跟逐張同步（syncBatch）分開跑在自己的排程裡：那邊每輪已經吃滿子請求額度，而且一輪只輪 45 張，
 * 熱度要的是「每張卡每 10 分鐘都更新」，只有批次讀得到。一批失敗就保留那批的舊值，下一輪再讀。
 */
export async function syncHeat(env: Env, batchSize = HEAT_BATCH): Promise<{ batches: number; failed: number; updated: number; talk_updated: number; skipped: number; ms: number }> {
  const started = Date.now();
  const rows = (
    await env.DB.prepare("SELECT id, approved_hosted_role_id AS hosted FROM cards WHERE provider='harbor' AND status='approved' AND approved_hosted_role_id IS NOT NULL ORDER BY id")
      .all<{ id: number; hosted: string }>()
  ).results;
  const capacity = HEAT_CALLS * batchSize;
  if (rows.length > capacity) console.warn("heat sync: more cards than one run can read; the rest wait", { cards: rows.length, capacity });
  const writes: D1PreparedStatement[] = [];
  const talkWrites: boolean[] = [];
  let batches = 0;
  let failed = 0;
  for (let i = 0; i < Math.min(rows.length, capacity); i += batchSize) {
    const chunk = rows.slice(i, i + batchSize);
    batches++;
    let stats: HeatBatch;
    try {
      stats = await upstream.fetchHeats(env, chunk.map((r) => r.hosted));
    } catch {
      failed++;
      console.error("heat sync batch failed");
      continue;
    }
    // Batch by community primary key, retaining the hosted binding as a guard
    // against a concurrently published replacement version.
    const values = Object.fromEntries(chunk.map(({ id, hosted }) => [id, { hosted, heat: stats.heat[hosted], talkNum: stats.talkNum[hosted] }]));
    // Both counters first, then only heat, then only talk count. Each row is updated
    // once, and unchanged columns do not rewrite their indexes. D1 batch is atomic.
    const heat = "coalesce(json_extract(j.value,'$.heat'),cards.heat)";
    const talk = "coalesce(json_extract(j.value,'$.talkNum'),cards.talk_num)";
    const from = "FROM json_each(?) j WHERE cards.id=CAST(j.key AS INTEGER) AND cards.provider='harbor' AND cards.approved_hosted_role_id=json_extract(j.value,'$.hosted')";
    // NOT INDEXED still permits INTEGER PRIMARY KEY lookups, and prevents the
    // provider index from reversing this into a full-card scan for each batch.
    const target = "UPDATE cards NOT INDEXED";
    const payload = JSON.stringify(values);
    const hasHeat = chunk.some(({ hosted }) => stats.heat[hosted] !== undefined);
    const hasTalk = chunk.some(({ hosted }) => stats.talkNum[hosted] !== undefined);
    const add = (set: string, condition: string, updatesTalk: boolean) => {
      writes.push(env.DB.prepare(`${target} SET ${set} ${from} AND ${condition}`).bind(payload));
      talkWrites.push(updatesTalk);
    };
    if (hasHeat && hasTalk) add(`heat=${heat},talk_num=${talk}`, `cards.heat<>${heat} AND cards.talk_num<>${talk}`, true);
    if (hasHeat) add(`heat=${heat}`, `cards.heat<>${heat}`, false);
    if (hasTalk) add(`talk_num=${talk}`, `cards.talk_num<>${talk}`, true);
  }
  const results = writes.length ? await env.DB.batch(writes) : [];
  const updated = results.reduce((n, r) => n + (r.meta.changes ?? 0), 0);
  const talk_updated = results.reduce((n, r, i) => n + (talkWrites[i] ? r.meta.changes ?? 0 : 0), 0);
  if (batches > failed) await bumpOp(env.DB, "card_heat", "batch", "success", batches - failed);
  if (failed) await bumpOp(env.DB, "card_heat", "batch", "error", failed);
  return { batches, failed, updated, talk_updated, skipped: Math.max(0, rows.length - capacity), ms: Date.now() - started };
}
