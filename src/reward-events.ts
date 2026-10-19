/**
 * 綺夢社伺服器上報給 Harbor 應用獎勵的事件（AppRewards 技術設計 §10.3）。
 * 任務、新手七日、推廣分層的進度由 Harbor 判定；只有綺夢社自己看得到的事由這裡報：
 *   share_open           分享連結被打開（Harper 2026-10-19：帶推薦碼 refCode，由 Harbor 對到分享者、擋本人）
 *   share_link_created   產生分享連結（新手第 6 階段）
 *   comment_posted       留言（含字數，Harbor 不收內容）
 *   comment_removed      留言被刪或被移除
 *   author_reply         作者在自己的卡下回覆（Harbor 會再核對作者）
 *   rating_set           評分
 * 背景換背景（background_changed）不報：玩家背景存在 Harbor，由 Harbor 自己記（Harper 2026-10-19）。
 *
 * 寫法：請求裡只寫一列待送清單（快、不會因為 Harbor 慢而拖慢留言），之後在背景與排程裡整批送。
 * 這把憑證只能上報、不能發點；沒設（B4 上線前、本機、分叉）就留在清單裡，超過 Harbor 收的時間窗就丟掉並計數。
 *
 * 隱私：不存 IP 原值，不送 IP。訪客只留匿名雜湊（IP 前綴＋UA，以 SHARE_VISITOR_SECRET 衍生、每週換的鑰匙做 HMAC），7 天後清掉。
 */
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { requireMember } from "./members";
import { bumpOp } from "./ops-metrics";
import { businessDay } from "./rewards";
import type { Env } from "./types";

export type RewardEventType = "share_open" | "share_link_created" | "comment_posted" | "comment_removed" | "author_reply" | "rating_set";

export interface RewardEvent {
  eventId: string;
  type: RewardEventType;
  accountNo?: number;
  refCode?: string;
  workRoleId?: string;
  occurredAt: string;
  attrs: Record<string, string | number>;
}

const HOUR = 3_600_000;
/** Harbor 拒收 48 小時以前的事件；留一小時餘裕，超過就不送了 */
const MAX_AGE = 47 * HOUR;
const BATCH = 100;
const REF_CODE = /^[A-Za-z0-9]{4,32}$/;
const BOT_UA = /bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|whatsapp|telegram|line\/|headless|lighthouse|curl|wget|python|httpclient/i;

export const rewardEventRoutes = new Hono<{ Bindings: Env }>();

// ---- 寫進待送清單 ----------------------------------------------------------------

export async function enqueueRewardEvent(db: D1Database, ev: RewardEvent, now: number): Promise<boolean> {
  try {
    const res = await db.prepare("INSERT OR IGNORE INTO reward_event_outbox (event_id, type, body, created_at, next_at) VALUES (?, ?, ?, ?, ?)")
      .bind(ev.eventId, ev.type, JSON.stringify(ev), now, now).run();
    if (res.meta.changes) await bumpOp(db, "reward_events", ev.type, "queued");
    return !!res.meta.changes;
  } catch {
    // 上報壞掉不能讓留言、評分失敗
    await bumpOp(db, "reward_events", ev.type, "error");
    return false;
  }
}

/** 成員在 Harbor 的公開數字帳號；沒有 Harbor 身分就是 null（那就不是 Harbor 的玩家，不報）。 */
export async function harborAccountNo(db: D1Database, memberId: string): Promise<number | null> {
  const row = await db.prepare("SELECT external_id FROM member_identities WHERE member_id = ? AND provider = 'harbor'").bind(memberId).first<{ external_id: string }>();
  const n = Number(row?.external_id);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** Harbor 卡片的 roleId；別家供應商的卡不報。 */
export async function harborRoleId(db: D1Database, cardId: string): Promise<string | null> {
  const row = await db.prepare("SELECT source_role_id FROM cards WHERE id = ? AND provider = 'harbor'").bind(cardId).first<{ source_role_id: string }>();
  return row?.source_role_id ?? null;
}

/** 字數：中日韓一字一單位，英文以字元計；空白不算（Harbor 用它判斷留言是否達門檻）。 */
export const textUnits = (s: string): number => [...s.replace(/\s+/g, "")].length;

/**
 * 上報失敗不能讓留言、評分、刪除、審核失敗：那些寫入已經成功了，回錯誤只會讓人重送一次。
 * 查不到身分、寫不進清單都只計數，不往外丟。
 */
async function safely(db: D1Database, type: RewardEventType, run: () => Promise<void>): Promise<void> {
  try { await run(); } catch { await bumpOp(db, "reward_events", type, "error"); }
}

/** 留言公開了（直接公開，或待審後放行）：報留言；作者在自己的卡下回覆另報一筆，Harbor 會再核對作者。 */
export async function reportComment(db: D1Database, input: { cardId: string; memberId: string; commentId: string; content: string; reply: boolean; now: number }): Promise<void> {
  await safely(db, "comment_posted", async () => {
    const [accountNo, card] = await Promise.all([
      harborAccountNo(db, input.memberId),
      db.prepare("SELECT source_role_id, author_num_id FROM cards WHERE id = ? AND provider = 'harbor'").bind(input.cardId).first<{ source_role_id: string; author_num_id: number }>(),
    ]);
    if (!accountNo || !card) return;
    const workRoleId = card.source_role_id;
    const occurredAt = new Date(input.now).toISOString();
    await enqueueRewardEvent(db, { eventId: `comment_posted:${input.commentId}`, type: "comment_posted", accountNo, workRoleId, occurredAt, attrs: { commentId: input.commentId, textUnits: textUnits(input.content) } }, input.now);
    if (input.reply && Number(card.author_num_id) === accountNo) await enqueueRewardEvent(db, { eventId: `author_reply:${input.commentId}`, type: "author_reply", accountNo, workRoleId, occurredAt, attrs: { commentId: input.commentId } }, input.now);
  });
}

export async function reportCommentRemoved(db: D1Database, input: { cardId: string | null; memberId: string; commentId: string; now: number }): Promise<void> {
  if (!input.cardId) return;
  await safely(db, "comment_removed", async () => {
    const [accountNo, workRoleId] = await Promise.all([harborAccountNo(db, input.memberId), harborRoleId(db, input.cardId!)]);
    if (!accountNo || !workRoleId) return;
    await enqueueRewardEvent(db, { eventId: `comment_removed:${input.commentId}`, type: "comment_removed", accountNo, workRoleId, occurredAt: new Date(input.now).toISOString(), attrs: { commentId: input.commentId } }, input.now);
  });
}

export async function reportRating(db: D1Database, input: { cardId: string; memberId: string; now: number }): Promise<void> {
  await safely(db, "rating_set", async () => {
    const [accountNo, workRoleId] = await Promise.all([harborAccountNo(db, input.memberId), harborRoleId(db, input.cardId)]);
    if (!accountNo || !workRoleId) return;
    // 同一張卡一天報一次就夠：Harbor 只認「第一次評分」
    await enqueueRewardEvent(db, { eventId: `rating_set:${input.cardId}:${accountNo}:${businessDay(input.now)}`, type: "rating_set", accountNo, workRoleId, occurredAt: new Date(input.now).toISOString(), attrs: {} }, input.now);
  });
}

// ---- 分享連結被打開 --------------------------------------------------------------

/** 每週一 04:00（台北）換鑰匙：跨週無法串起同一個訪客。 */
function weekKey(now: number): string {
  const day = businessDay(now);
  const d = new Date(`${day}T00:00:00Z`);
  const monday = new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86_400_000);
  return monday.toISOString().slice(0, 10);
}


async function hmacHex(key: string, data: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** IP 只取前綴（IPv4 前三段、IPv6 前四組）再雜湊：同一個家用網路換手機仍算同一個人，也不留下可還原的位址。 */
const ipPrefix = (ip: string) => (ip.includes(":") ? ip.split(":").slice(0, 4).join(":") : ip.split(".").slice(0, 3).join("."));

export async function visitorHash(env: Env, ip: string, ua: string, now: number): Promise<string> {
  const week = await hmacHex(env.SHARE_VISITOR_SECRET ?? "", `share-visitor:${weekKey(now)}`);
  return (await hmacHex(week, `${ipPrefix(ip)}|${ua}`)).slice(0, 32);
}

rewardEventRoutes.post("/v1/share/open", bodyLimit({ maxSize: 512, onError: (c) => c.body(null, 204) }), async (c) => {
  // 不需登入、不透露碼存不存在：什麼情況都回 204
  const allowed = await c.env.VISIT_LIMIT?.limit({ key: c.req.header("cf-connecting-ip") || "anon" });
  if (allowed && !allowed.success) return c.body(null, 204);
  const body = (await c.req.json().catch(() => ({}))) as { ref?: unknown };
  const ref = typeof body.ref === "string" && REF_CODE.test(body.ref) ? body.ref : null;
  if (!ref) { await bumpOp(c.env.DB, "reward_events", "share_open", "dropped"); return c.body(null, 204); }
  const ua = c.req.header("User-Agent") ?? "";
  // 沒設訪客鑰匙就不算：每個 isolate 各用一把隨機鑰匙的話，同一個人會被算成好幾個（部署要設 SHARE_VISITOR_SECRET）
  if (!c.env.SHARE_VISITOR_SECRET || !ua || BOT_UA.test(ua)) { await bumpOp(c.env.DB, "reward_events", "share_open", "dropped"); return c.body(null, 204); }
  const now = Date.now();
  const day = businessDay(now);
  const hash = await visitorHash(c.env, c.req.header("cf-connecting-ip") ?? "", ua, now);
  const fresh = await c.env.DB.prepare("INSERT OR IGNORE INTO share_opens (ref_code, day, visitor_hash, created_at) VALUES (?, ?, ?, ?)").bind(ref, day, hash, now).run();
  if (!fresh.meta.changes) { await bumpOp(c.env.DB, "reward_events", "share_open", "dropped"); return c.body(null, 204); }
  // 登入的訪客帶上自己的帳號，Harbor 才擋得掉「自己打開自己的連結」
  let viewer: number | null = null;
  if (c.req.header("Authorization")) {
    try { viewer = await harborAccountNo(c.env.DB, (await requireMember(c)).id); } catch { viewer = null; }
  }
  const attrs: Record<string, string | number> = { visitorHash: hash };
  if (viewer) attrs.viewerAccountNo = viewer;
  await enqueueRewardEvent(c.env.DB, { eventId: `share_open:${ref}:${day}:${hash}`, type: "share_open", refCode: ref, occurredAt: new Date(now).toISOString(), attrs }, now);
  c.executionCtx.waitUntil(flushRewardEvents(c.env, now).catch(() => undefined));
  return c.body(null, 204);
});

rewardEventRoutes.post("/v1/me/share/created", bodyLimit({ maxSize: 512, onError: (c) => c.body(null, 204) }), async (c) => {
  const member = await requireMember(c);
  const body = (await c.req.json().catch(() => ({}))) as { roleId?: unknown };
  const roleId = typeof body.roleId === "string" && body.roleId.length <= 64 ? body.roleId : null;
  if (!roleId) return c.body(null, 204);
  const card = await c.env.DB.prepare("SELECT id FROM cards WHERE source_role_id = ? AND provider = 'harbor'").bind(roleId).first<{ id: string }>();
  const accountNo = await harborAccountNo(c.env.DB, member.id);
  if (!card || !accountNo) return c.body(null, 204);
  const now = Date.now();
  // 新手第 6 階段每個帳號只算一次；同一張卡一天報一次就夠
  await enqueueRewardEvent(c.env.DB, { eventId: `share_link_created:${accountNo}:${roleId}:${businessDay(now)}`, type: "share_link_created", accountNo, workRoleId: roleId, occurredAt: new Date(now).toISOString(), attrs: {} }, now);
  c.executionCtx.waitUntil(flushRewardEvents(c.env, now).catch(() => undefined));
  return c.body(null, 204);
});

// ---- 送出 ------------------------------------------------------------------------

/**
 * 跟 Harbor 換應用令牌（client_credentials，只有 rewards.report）並送一批事件。
 * 抽成一個物件，測試換掉它，不打真的 Harbor。
 */
let cached: { token: string; until: number } | null = null;
export const rewardTransport = {
  async token(env: Env): Promise<string> {
    if (cached && cached.until > Date.now() + 60_000) return cached.token;
    const res = await fetch(`${env.PROVIDER_API_BASE_HARBOR}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: env.HARBOR_REWARDS_CLIENT_ID ?? "", client_secret: env.HARBOR_REWARDS_CLIENT_SECRET ?? "", scope: "rewards.report" }),
    });
    if (!res.ok) throw new Error(`reward token ${res.status}`);
    const body = (await res.json()) as { access_token: string; expires_in?: number };
    cached = { token: body.access_token, until: Date.now() + (body.expires_in ?? 3600) * 1000 };
    return cached.token;
  },
  async send(env: Env, token: string, events: RewardEvent[]): Promise<{ ok: boolean; status: number }> {
    const res = await fetch(`${env.PROVIDER_API_BASE_HARBOR}/open/v1/app/rewards/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ events }),
    });
    return { ok: res.ok, status: res.status };
  },
};

export interface FlushResult { sent: number; rejected: number; retry: number; expired: number }

/** 送出到期的事件：成功記送出時間；4xx（格式不對、不收）不重試；5xx 與網路錯誤退避重試；太舊的丟掉。 */
export async function flushRewardEvents(env: Env, now: number): Promise<FlushResult> {
  const db = env.DB;
  const out: FlushResult = { sent: 0, rejected: 0, retry: 0, expired: 0 };
  const stale = await db.prepare("SELECT type, COUNT(*) AS n FROM reward_event_outbox WHERE sent_at IS NULL AND created_at < ? GROUP BY type").bind(now - MAX_AGE).all<{ type: string; n: number }>();
  for (const r of stale.results) { out.expired += r.n; await bumpOp(db, "reward_events", r.type, "expired", r.n); }
  if (stale.results.length) await db.prepare("DELETE FROM reward_event_outbox WHERE sent_at IS NULL AND created_at < ?").bind(now - MAX_AGE).run();
  if (!env.HARBOR_REWARDS_CLIENT_ID || !env.HARBOR_REWARDS_CLIENT_SECRET) return out;
  const due = await db.prepare("SELECT event_id, type, body, attempts FROM reward_event_outbox WHERE sent_at IS NULL AND next_at <= ? ORDER BY created_at LIMIT ?").bind(now, BATCH).all<{ event_id: string; type: string; body: string; attempts: number }>();
  if (!due.results.length) return out;
  const events = due.results.map((r) => JSON.parse(r.body) as RewardEvent);
  let result: { ok: boolean; status: number };
  try {
    result = await rewardTransport.send(env, await rewardTransport.token(env), events);
  } catch {
    result = { ok: false, status: 0 };
  }
  const byType = new Map<string, number>();
  for (const r of due.results) byType.set(r.type, (byType.get(r.type) ?? 0) + 1);
  // 令牌被拒：丟掉手上的，下一輪重新換（客戶端被撤銷或輪替密鑰之後）
  if (result.status === 401 || result.status === 403) cached = null;
  // 只有「這批本身不收」（400、413、422…）才不重送；沒開獎勵（404）、權限或令牌（401／403）、限流、伺服器錯誤都是設定或暫時的事，留著等它好
  const retryable = !result.ok && (result.status === 0 || result.status >= 500 || [401, 403, 404, 408, 429].includes(result.status));
  if (!retryable) {
    await db.batch(due.results.map((r) => db.prepare("UPDATE reward_event_outbox SET sent_at = ?, attempts = attempts + 1 WHERE event_id = ?").bind(now, r.event_id)));
    for (const [type, n] of byType) await bumpOp(db, "reward_events", type, result.ok ? "sent" : "rejected", n);
    if (result.ok) out.sent = due.results.length; else out.rejected = due.results.length;
    return out;
  }
  // 暫時不通：照次數退避（1、2、4…最多 60 分鐘）
  await db.batch(due.results.map((r) => db.prepare("UPDATE reward_event_outbox SET attempts = attempts + 1, next_at = ? WHERE event_id = ?").bind(now + Math.min(60, 2 ** r.attempts) * 60_000, r.event_id)));
  for (const [type, n] of byType) await bumpOp(db, "reward_events", type, "error", n);
  out.retry = due.results.length;
  return out;
}

/** 排程：送出待送清單；訪客雜湊 7 天後清掉；送出過的列兩天後清掉。 */
export async function rewardEventMaintenance(env: Env, now: number): Promise<void> {
  await flushRewardEvents(env, now);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM share_opens WHERE created_at < ?").bind(now - 7 * 24 * HOUR),
    env.DB.prepare("DELETE FROM reward_event_outbox WHERE sent_at IS NOT NULL AND sent_at < ?").bind(now - 48 * HOUR),
  ]);
}
