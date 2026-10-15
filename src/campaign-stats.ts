import { payoutAmount, PLATFORMS, TIERS, type Campaign, type Platform, type Tier } from "./campaign";
import { FLAGS } from "./campaign-review";
import { pickLocale, type Localized } from "./types";

/**
 * 分享活動的統計看板（開業活動設計 §8，計畫 6 架構裁定 1–5）。一個活動、一個 batch、記憶體裡聚合。
 * 回應只有彙總數字與內容標題、handle：成員 id、收款帳號、分享碼、Provider 的入帳 id 都不出這支函式。
 *
 * ponytail: 每次請求都把整個活動的位置、稽核、發放、歸因讀進記憶體；開業活動量小（幾百份內容、幾千個歸因）沒問題。
 * 上萬筆時改成每晚彙總到統計表（依內容、依日），看板只讀彙總。
 */
const DAY = 86_400_000;
type Bucket = Platform | "multi";
const BUCKETS = [...PLATFORMS, "multi"] as const;
/** 成效多一桶：沒有已核准位置的內容帶來的歸因，讓各桶加起來等於總數。支出不需要（沒核准就不會發）。 */
const EFFECT_BUCKETS = [...BUCKETS, "unreviewed"] as const;

export type Retention = { eligible: number; retained: number };
export type Effect = { visitors: number; attributed: number; firstPlay: number; d7: Retention; d30: Retention; costPerD7: number | null; costPerD30: number | null };
export type Pool = { balance: number } | null;

/** 取最近名次（nearest-rank）：排序後第 ceil(p·n) 個；空的回 null。 */
export const percentile = (sorted: number[], p: number): number | null => (sorted.length ? sorted[Math.max(Math.ceil(p * sorted.length), 1) - 1]! : null);

const record = <K extends string, V>(keys: readonly K[], v: (k: K) => V) => Object.fromEntries(keys.map((k) => [k, v(k)])) as Record<K, V>;
const cost = (points: number, people: number) => (people ? points / people : null);

type PRow = { id: string; content_id: string; platform: Platform; requested_tier: Tier; approved_tier: Tier | null; review_status: string; counts_as_placement: number; created_at: number; dup_location: number; dup_image: number; burst: number; ever_needs_info: number; ever_resubmitted: number };
type ARow = { subject_id: string; actor_kind: string; reason: string; status: string | null; created_at: number };
type CRow = { id: string; title: string; card_id: number | null; names: string | null; handle: string; visitors: number };
type PayRow = { content_id: string; amount: number; settled_at: number | null };
type MRow = { content_id: string; registered_at: number; first_play_at: number | null; d7: number; d30: number; card_play: number };

/**
 * 口徑：
 * - 漏斗：位置數，前段是「曾經到過」的階段。submitted＝全部位置（每個位置都提交過一次）；needsInfo＝至少有一筆結果為 needs_info 的
 *   decide 稽核；resubmitted＝至少有一筆 resubmit 稽核；approved／rejected＝目前狀態（兩者都是終點，核准後只能改檔位、拒絕後不能改）。
 *   paidContents＝至少一筆 paid 發放的內容數。byTier 的 submitted 依申請檔位、approved 依核准檔位；byPlatform 依位置的平台。
 * - 審核：pending＝目前待審或重送中的位置數（佇列長度）。第一次決定＝位置最早的一筆 decide 稽核，耗時＝稽核時間 − 位置建立時間；
 *   中位數與 P90 取最近名次，只涵蓋已經有過決定的位置（還在佇列裡的不在內，要搭配 pending 看）。
 *   byActor＝decide 稽核筆數依 actor_kind。rejectReasons＝結果為 rejected 的 decide 稽核理由，去頭尾空白後原文比對，
 *   次數多的在前、同次數依字串排序，取前 10。duplicateRate＝有任一重複標示（同位置、同截圖、短時間大量）的位置 ÷ 全部位置，沒有位置時 0。
 * - 支出：只算 paid。每筆依內容「現在」的核准檔位（payoutAmount 的 tier）與平台歸類（裁定 4：已核准位置只有一個平台歸那個平台，
 *   多個歸 multi；沒有已核准位置的內容不歸任何平台與檔位）。byDay 依 settled_at 的 UTC 日期，由舊到新。
 * - 點數池（只給管理員，由路由決定要不要給 pool）：burn7d＝近 7 天所有活動的 paid 發放總點數（池是全站共用的）；
 *   daysLeft＝floor(balance ÷ (burn7d ÷ 7))，burn7d 為 0 時 null。
 * - 成效：visitors＝本活動各分享碼的訪客計數總和；attributed＝歸因列數；firstPlay＝有首玩時間的歸因數。
 *   留存（裁定 3，UTC 日序，r＝floor(registered_at ÷ 日)）：D7 分母＝registered_at ≤ now − 14 天，分子＝其中在 r+7…r+13 有活躍日的人；
 *   D30 分母＝registered_at ≤ now − 37 天，分子＝在 r+30…r+36 有活躍日的人。costPerD7／D30＝已發點數 ÷ 留存人數，0 人時 null。
 *   byPlatform 與 topContents 用同一套口徑（byPlatform 另有 unreviewed：內容沒有已核准位置的歸因，各桶加起來等於總數），點數只算那個平台／那份內容的 paid；topContents 依歸因數、訪客數多的在前，取 20。
 * - 作者：share_contents.card_id 有值的卡；attributed＝經這張卡的內容歸因的人數；firstPlays＝其中在這張卡上有對話記錄的人
 *   （member_conversations.role_id＝cards.source_role_id，供應商相同）。
 */
/** pool 由路由給：不是管理員或 Provider 問不到時是 null（這個 Promise 不會 reject）。 */
export async function campaignStats(db: D1Database, campaign: Campaign, now: number, pool: Promise<Pool>) {
  const id = campaign.id;
  const [placements, audits, contents, payouts, burn, attributions] = await db.batch([
    db.prepare(`SELECT p.id, p.content_id, p.platform, p.requested_tier, p.approved_tier, p.review_status, p.counts_as_placement, p.created_at, ${FLAGS}
        , EXISTS (SELECT 1 FROM audit_log a WHERE a.subject_kind = 'share_placement' AND a.subject_id = p.id AND a.action = 'decide' AND json_extract(a.after_json, '$.reviewStatus') = 'needs_info') AS ever_needs_info
        , EXISTS (SELECT 1 FROM audit_log a WHERE a.subject_kind = 'share_placement' AND a.subject_id = p.id AND a.action = 'resubmit') AS ever_resubmitted
      FROM share_placements p JOIN share_contents s ON s.id = p.content_id JOIN campaigns c ON c.id = s.campaign_id WHERE s.campaign_id = ?`).bind(id),
    db.prepare(`SELECT a.subject_id, a.actor_kind, a.reason, json_extract(a.after_json, '$.reviewStatus') AS status, a.created_at
      FROM audit_log a JOIN share_placements p ON p.id = a.subject_id JOIN share_contents s ON s.id = p.content_id
      WHERE a.subject_kind = 'share_placement' AND a.action = 'decide' AND s.campaign_id = ?`).bind(id),
    db.prepare(`SELECT s.id, s.title, s.card_id, k.names, m.handle, (SELECT COALESCE(sum(v.visits), 0) FROM campaign_share_visits v WHERE v.share_code = s.share_code) AS visitors
      FROM share_contents s JOIN members m ON m.id = s.member_id LEFT JOIN cards k ON k.id = s.card_id WHERE s.campaign_id = ?`).bind(id),
    db.prepare("SELECT x.content_id, x.amount, x.settled_at FROM share_payouts x JOIN share_contents s ON s.id = x.content_id WHERE x.status = 'paid' AND s.campaign_id = ?").bind(id),
    db.prepare("SELECT COALESCE(sum(amount), 0) AS n FROM share_payouts WHERE status = 'paid' AND settled_at > ?").bind(now - 7 * DAY),
    // 留存與首玩在 SQL 裡判斷，成員 id 不進記憶體。SQLite 的整數除法對正數就是 floor。
    db.prepare(`SELECT a.content_id, a.registered_at, a.first_play_at,
        CASE WHEN a.registered_at > ?2 THEN -1 ELSE EXISTS (SELECT 1 FROM campaign_active_days d WHERE d.member_id = a.member_id AND d.day BETWEEN a.registered_at / ${DAY} + 7 AND a.registered_at / ${DAY} + 13) END AS d7,
        CASE WHEN a.registered_at > ?3 THEN -1 ELSE EXISTS (SELECT 1 FROM campaign_active_days d WHERE d.member_id = a.member_id AND d.day BETWEEN a.registered_at / ${DAY} + 30 AND a.registered_at / ${DAY} + 36) END AS d30,
        EXISTS (SELECT 1 FROM share_contents s JOIN cards k ON k.id = s.card_id JOIN member_conversations mc ON mc.role_id = k.source_role_id AND mc.provider = k.provider
                WHERE s.id = a.content_id AND mc.member_id = a.member_id) AS card_play
      FROM campaign_attributions a WHERE a.campaign_id = ?1`).bind(id, now - 14 * DAY, now - 37 * DAY),
  ]);
  const ps = placements!.results as PRow[];
  const as = audits!.results as ARow[];
  const cs = contents!.results as CRow[];
  const pays = payouts!.results as PayRow[];
  const ms = attributions!.results as MRow[];

  // 每份內容現在的檔位與平台（裁定 4）。
  const tierOf = new Map<string, Tier | null>();
  const bucketOf = new Map<string, Bucket | null>();
  for (const c of cs) {
    const mine = ps.filter((p) => p.content_id === c.id);
    tierOf.set(c.id, payoutAmount(mine.map((p) => ({ reviewStatus: p.review_status, approvedTier: p.approved_tier, countsAsPlacement: !!p.counts_as_placement })), campaign, 0).tier);
    const platforms = new Set(mine.filter((p) => p.review_status === "approved").map((p) => p.platform));
    bucketOf.set(c.id, platforms.size === 0 ? null : platforms.size === 1 ? [...platforms][0]! : "multi");
  }

  // ---- 漏斗 ----
  const count = (status: string) => ps.filter((p) => p.review_status === status).length;
  const byTier = record(TIERS, () => ({ submitted: 0, approved: 0 }));
  const byPlatform = record(PLATFORMS, () => ({ submitted: 0, approved: 0 }));
  for (const p of ps) {
    byTier[p.requested_tier].submitted++;
    if (p.approved_tier) byTier[p.approved_tier].approved++;
    byPlatform[p.platform].submitted++;
    if (p.review_status === "approved") byPlatform[p.platform].approved++;
  }

  // ---- 審核 ----
  const first = new Map<string, number>();
  for (const a of as) first.set(a.subject_id, Math.min(first.get(a.subject_id) ?? Infinity, a.created_at));
  const created = new Map(ps.map((p) => [p.id, p.created_at]));
  const waits = [...first].map(([pid, at]) => at - created.get(pid)!).sort((a, b) => a - b);
  const reasons = new Map<string, number>();
  for (const a of as) {
    const r = a.reason.trim();
    if (a.status === "rejected" && r) reasons.set(r, (reasons.get(r) ?? 0) + 1);
  }

  // ---- 支出 ----
  const paidOf = new Map<string, number>();
  const spendTier = record(TIERS, () => 0);
  const spendBucket = record(BUCKETS, () => 0);
  const days = new Map<string, number>();
  for (const x of pays) {
    paidOf.set(x.content_id, (paidOf.get(x.content_id) ?? 0) + x.amount);
    const t = tierOf.get(x.content_id), b = bucketOf.get(x.content_id);
    if (t) spendTier[t] += x.amount;
    if (b) spendBucket[b] += x.amount;
    if (x.settled_at !== null) {
      const d = new Date(x.settled_at).toISOString().slice(0, 10);
      days.set(d, (days.get(d) ?? 0) + x.amount);
    }
  }
  const paidTotal = pays.reduce((a, x) => a + x.amount, 0);
  const balance = await pool;
  const burn7d = (burn!.results[0] as { n: number }).n;

  // ---- 成效 ----
  const effectOf = (rows: MRow[], visitors: number, points: number): Effect => {
    const d7 = { eligible: rows.filter((m) => m.d7 >= 0).length, retained: rows.filter((m) => m.d7 === 1).length };
    const d30 = { eligible: rows.filter((m) => m.d30 >= 0).length, retained: rows.filter((m) => m.d30 === 1).length };
    return { visitors, attributed: rows.length, firstPlay: rows.filter((m) => m.first_play_at !== null).length, d7, d30, costPerD7: cost(points, d7.retained), costPerD30: cost(points, d30.retained) };
  };
  const sum = (xs: CRow[]) => xs.reduce((a, c) => a + c.visitors, 0);
  const rowsOf = (ids: Set<string>) => ms.filter((m) => ids.has(m.content_id));
  const paidIn = (ids: Set<string>) => [...ids].reduce((a, c) => a + (paidOf.get(c) ?? 0), 0);
  const effectBy = record(EFFECT_BUCKETS, (b) => {
    const xs = cs.filter((c) => (bucketOf.get(c.id) ?? "unreviewed") === b);
    const ids = new Set(xs.map((c) => c.id));
    return effectOf(rowsOf(ids), sum(xs), paidIn(ids));
  });
  const topContents = cs
    .map((c) => ({ ...effectOf(rowsOf(new Set([c.id])), c.visitors, paidOf.get(c.id) ?? 0), contentId: c.id, title: c.title, handle: c.handle }))
    .sort((a, b) => b.attributed - a.attributed || b.visitors - a.visitors || (a.contentId < b.contentId ? -1 : 1))
    .slice(0, 20);

  // ---- 作者 ----
  const cards = new Map<number, { name: string; ids: Set<string> }>();
  for (const c of cs) {
    if (c.card_id === null) continue;
    const card = cards.get(c.card_id) ?? { name: c.names ? (pickLocale(JSON.parse(c.names) as Localized, "zh-Hant") ?? "") : "", ids: new Set<string>() };
    card.ids.add(c.id);
    cards.set(c.card_id, card);
  }
  const authors = [...cards].map(([cardId, card]) => {
    const rows = rowsOf(card.ids);
    return { cardId, cardName: card.name, attributed: rows.length, firstPlays: rows.filter((m) => m.card_play).length };
  }).sort((a, b) => b.attributed - a.attributed || a.cardId - b.cardId);

  return {
    funnel: {
      submitted: ps.length, needsInfo: ps.filter((p) => p.ever_needs_info).length, resubmitted: ps.filter((p) => p.ever_resubmitted).length,
      approved: count("approved"), rejected: count("rejected"),
      paidContents: paidOf.size, byTier, byPlatform,
    },
    review: {
      pending: count("submitted") + count("resubmitted"),
      firstDecisionMedianMs: percentile(waits, 0.5), firstDecisionP90Ms: percentile(waits, 0.9),
      byActor: { human: as.filter((a) => a.actor_kind === "human").length, ai: as.filter((a) => a.actor_kind === "ai").length },
      rejectReasons: [...reasons].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count || (a.reason < b.reason ? -1 : a.reason > b.reason ? 1 : 0)).slice(0, 10),
      duplicateRate: ps.length ? ps.filter((p) => p.dup_location || p.dup_image || p.burst).length / ps.length : 0,
    },
    spend: {
      paidTotal, byTier: spendTier, byPlatform: spendBucket,
      byDay: [...days].sort(([a], [b]) => (a < b ? -1 : 1)).map(([day, points]) => ({ day, points })),
      pool: balance ? { balance: balance.balance, burn7d, daysLeft: burn7d ? Math.floor(balance.balance / (burn7d / 7)) : null } : null,
    },
    effect: { ...effectOf(ms, sum(cs), paidTotal), byPlatform: effectBy, topContents },
    authors,
    generatedAt: now,
  };
}
