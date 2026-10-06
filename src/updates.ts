import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { UPDATES, UPDATES_BUILD } from "./generated/updates";
import { PRIMARY_HOST } from "../shared/site-hosts";
import { UPDATE_LOCALES, pickUpdateText, type UpdateEntry, type UpdateItem, type UpdateLocale, type UpdateState, type UpdatesResponse } from "../shared/updates";
import { requireMember } from "./members";
import { HttpError, type Env } from "./types";

/**
 * 更新說明（What's New）。
 *
 * 內容是 updates/*.json，建置時驗證後打包進這個 Worker（src/generated/updates.ts）。所以說明跟它描述的
 * 程式碼永遠同一次部署上線：不可能先公告後上線，回滾時說明也跟著從 bundle 消失。
 *
 * D1 只記三件事：每則說明第一次被正式 Worker 服務的時間（update_entries）、會員的已讀狀態、
 * 給 Discord 的每日彙整與送出紀錄。出口各有自己的節奏：更新頁與 API 即時；首頁提示列由前端限流；
 * Discord 每天台北晚上八點之後一則，48 小時內內容變了就編輯同一則。
 */

const MINUTE = 60_000, HOUR = 3_600_000, DAY = 86_400_000;
const TAIPEI = 8 * HOUR;
/** 每日彙整在台北這個整點之後建立（每小時 :17 的排程與機器人輪詢都會檢查）。 */
export const DIGEST_HOUR = 20;
/** 彙整建立後這段時間內，說明改了或撤下會編輯已發的訊息；之後不再動。 */
export const DIGEST_EDIT_WINDOW = 48 * HOUR;
/** 不夠兩則又沒有重點時併到隔天，最多等這麼久。 */
const DIGEST_MAX_WAIT = 3 * DAY;
/** 首頁摘要只給最近這段時間的說明；更新頁拿全部。 */
const SUMMARY_WINDOW = 14 * DAY;
const STATS_WINDOW = 30 * DAY;
/** 回填（live 早於今天）的說明，回報者通知只在這段時間內還有意義。 */
const REPORT_BACKDATE_LIMIT = 2 * DAY;
const REPORT_MAX_ATTEMPTS = 6;

type Source = { entries: readonly UpdateEntry[]; build: string };
let source: Source = { entries: UPDATES, build: UPDATES_BUILD };
const registeredBuilds = new Set<string>();

/** 測試用：換一份說明（換 build id 才會重新登記）。 */
export function useUpdates(entries: readonly UpdateEntry[], build: string): void {
  source = { entries, build };
  registeredBuilds.clear();
}
export function restoreUpdates(): void {
  useUpdates(UPDATES, UPDATES_BUILD);
}

const visible = () => source.entries.filter((e) => !e.draft);
const byId = (id: string) => visible().find((e) => e.id === id);

export const updateLocale = (raw: string | undefined | null): UpdateLocale => {
  if (!raw) return "zh-Hant";
  if ((UPDATE_LOCALES as readonly string[]).includes(raw)) return raw as UpdateLocale;
  if (/^zh[-_](?:cn|hans|sg)/i.test(raw)) return "zh-Hans";
  if (raw.startsWith("en")) return "en";
  if (raw.startsWith("ja")) return "ja";
  if (raw.startsWith("ko")) return "ko";
  return "zh-Hant";
};

/** 網址的語言前綴：繁中是預設語言，沒有前綴。 */
const prefix = (locale: UpdateLocale) => (locale === "zh-Hant" ? "" : `/${locale}`);
const origin = `https://${PRIMARY_HOST}`;
export const updatesUrl = (locale: UpdateLocale, entry?: string, from?: string) =>
  `${origin}${prefix(locale)}/updates${from ? `?from=${from}` : ""}${entry ? `#${entry}` : ""}`;

/** 台北某天中午（回填說明的上線時間，取一天的中間，跨時區顯示也落在同一天）。 */
const taipeiNoon = (day: string) => Date.parse(`${day}T12:00:00+08:00`);
const taipeiDay = (now: number) => new Date(now + TAIPEI).toISOString().slice(0, 10);

async function count(env: Env, operation: string, outcome: "success" | "error"): Promise<void> {
  await env.DB.prepare("INSERT INTO update_metrics(operation,outcome,value) VALUES(?,?,1) ON CONFLICT(operation,outcome) DO UPDATE SET value=value+1")
    .bind(operation, outcome).run().catch(() => { console.warn("updates metric unavailable"); });
}

/**
 * 登記這個 build 帶來的說明：沒見過的寫入第一次上線時間，announce 變大的更新公告時間，
 * 連到回報案件的排進通知佇列。每個 build 只做一次（同一個 isolate 記在記憶體，跨 isolate 記在 KV）；
 * 重複執行無害，全部是 INSERT OR IGNORE 或有條件的 UPDATE。
 */
export async function registerUpdates(env: Env, now: number): Promise<void> {
  const build = source.build;
  if (registeredBuilds.has(build)) return;
  const flag = `updates:registered:${build}`;
  if (await env.CACHE.get(flag)) {
    registeredBuilds.add(build);
    return;
  }
  try {
    const rows = await env.DB.prepare("SELECT id,announce FROM update_entries").all<{ id: string; announce: number }>();
    const known = new Map(rows.results.map((r) => [r.id, r.announce]));
    const statements: D1PreparedStatement[] = [];
    for (const e of visible()) {
      const backdated = e.live ? Math.min(now, taipeiNoon(e.live)) : null;
      const at = backdated ?? now;
      const stored = known.get(e.id);
      if (stored === undefined)
        statements.push(env.DB.prepare("INSERT OR IGNORE INTO update_entries(id,first_live_at,announce,announced_at) VALUES(?,?,?,?)").bind(e.id, at, e.announce, at));
      else if (e.announce > stored)
        statements.push(env.DB.prepare("UPDATE update_entries SET announce=?,announced_at=? WHERE id=? AND announce<?").bind(e.announce, now, e.id, e.announce));
      if (e.reports.length && (backdated === null || now - backdated <= REPORT_BACKDATE_LIMIT))
        for (const c of e.reports)
          statements.push(env.DB.prepare("INSERT OR IGNORE INTO update_reports(entry_id,case_id,updated_at) VALUES(?,?,?)").bind(e.id, c, now));
    }
    for (let i = 0; i < statements.length; i += 50) await env.DB.batch(statements.slice(i, i + 50));
    await env.CACHE.put(flag, "1", { expirationTtl: 30 * 86400 });
    registeredBuilds.add(build);
    await count(env, "register", "success");
  } catch (error) {
    await count(env, "register", "error");
    throw error;
  }
}

type Lifecycle = { first_live_at: number; announced_at: number };

async function lifecycle(env: Env): Promise<Map<string, Lifecycle>> {
  const rows = await env.DB.prepare("SELECT id,first_live_at,announced_at FROM update_entries").all<Lifecycle & { id: string }>();
  return new Map(rows.results.map((r) => [r.id, r]));
}

const TIER_RANK = { highlight: 0, feature: 1, fix: 2 } as const;

/** 目前上線中的說明：在這個 bundle 裡、不是草稿、已經登記過。新的在前。 */
export async function liveUpdates(env: Env, now: number): Promise<(UpdateEntry & Lifecycle)[]> {
  await registerUpdates(env, now);
  const times = await lifecycle(env);
  return visible()
    .flatMap((e) => {
      const t = times.get(e.id);
      return t ? [{ ...e, ...t }] : [];
    })
    .sort((a, b) => b.announced_at - a.announced_at || TIER_RANK[a.tier] - TIER_RANK[b.tier] || (a.id < b.id ? 1 : -1));
}

function toItem(e: UpdateEntry & Lifecycle, locale: UpdateLocale, withBody: boolean): UpdateItem {
  return {
    id: e.id,
    tier: e.tier,
    audience: e.audience,
    liveAt: e.first_live_at,
    announcedAt: e.announced_at,
    title: pickUpdateText(e.title, locale),
    body: withBody && e.body ? pickUpdateText(e.body, locale) : null,
    try: e.try,
    spotlight: e.spotlight,
  };
}

export async function listUpdates(env: Env, locale: UpdateLocale, view: "summary" | "full", now: number): Promise<UpdatesResponse> {
  const live = await liveUpdates(env, now);
  const recent = live.filter((e) => e.first_live_at > now - STATS_WINDOW);
  const items = (view === "summary" ? live.filter((e) => e.announced_at > now - SUMMARY_WINDOW) : live).map((e) => toItem(e, locale, view === "full"));
  return {
    items,
    stats: { features: recent.filter((e) => e.tier !== "fix").length, fixes: recent.filter((e) => e.tier === "fix").length, days: STATS_WINDOW / DAY },
  };
}

/** 給通知與推播用的一句標題（說明撤下了就是 null）。 */
export function updateTitle(id: string, locale: string): string | null {
  const e = byId(id);
  return e ? pickUpdateText(e.title, updateLocale(locale)) : null;
}

// ---- 會員已讀狀態 -----------------------------------------------------------------

const STATE_SPOTLIGHT_LIMIT = 200;

function parseState(raw: unknown, now: number): UpdateState {
  const b = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const time = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= now + DAY ? Math.floor(v) : 0);
  const spotlights = Array.isArray(b.spotlights) ? b.spotlights.filter((k): k is string => typeof k === "string" && /^[a-z][a-z0-9.-]{0,39}$/.test(k)) : [];
  return {
    seenThrough: time(b.seenThrough),
    stripClosedAt: time(b.stripClosedAt),
    stripDays: typeof b.stripDays === "number" && Number.isInteger(b.stripDays) && b.stripDays >= 0 && b.stripDays <= 30 ? b.stripDays : 0,
    stripDay: typeof b.stripDay === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.stripDay) ? b.stripDay : "",
    spotlights: [...new Set(spotlights)].slice(-STATE_SPOTLIGHT_LIMIT),
  };
}

type StateRow = { seen_through: number; strip_closed_at: number; strip_days: number; strip_day: string; spotlights: string };
const rowState = (r: StateRow): UpdateState => ({
  seenThrough: r.seen_through,
  stripClosedAt: r.strip_closed_at,
  stripDays: r.strip_days,
  stripDay: r.strip_day,
  spotlights: JSON.parse(r.spotlights) as string[],
});

async function readState(env: Env, member: string): Promise<UpdateState | null> {
  const r = await env.DB.prepare("SELECT seen_through,strip_closed_at,strip_days,strip_day,spotlights FROM member_update_state WHERE member_id=?").bind(member).first<StateRow>();
  return r ? rowState(r) : null;
}

/**
 * 合併兩台裝置的狀態：看過的時間與關掉提示列的時間取較晚的，用過的入口取聯集；
 * 「提示列出現了幾天」照最後寫的那台（它是那台裝置上連續沒理會的天數，不能相加）。
 */
export async function saveState(env: Env, member: string, raw: unknown, now: number): Promise<UpdateState> {
  const incoming = parseState(raw, now);
  const current = await readState(env, member);
  const merged: UpdateState = current
    ? {
        seenThrough: Math.max(current.seenThrough, incoming.seenThrough),
        stripClosedAt: Math.max(current.stripClosedAt, incoming.stripClosedAt),
        stripDays: incoming.stripDays,
        stripDay: incoming.stripDay,
        spotlights: [...new Set([...current.spotlights, ...incoming.spotlights])].slice(-STATE_SPOTLIGHT_LIMIT),
      }
    : incoming;
  try {
    await env.DB.prepare(
      `INSERT INTO member_update_state(member_id,seen_through,strip_closed_at,strip_days,strip_day,spotlights,updated_at) VALUES(?,?,?,?,?,?,?)
       ON CONFLICT(member_id) DO UPDATE SET seen_through=MAX(seen_through,excluded.seen_through),strip_closed_at=MAX(strip_closed_at,excluded.strip_closed_at),
       strip_days=excluded.strip_days,strip_day=excluded.strip_day,spotlights=excluded.spotlights,updated_at=excluded.updated_at`,
    ).bind(member, merged.seenThrough, merged.stripClosedAt, merged.stripDays, merged.stripDay, JSON.stringify(merged.spotlights), now).run();
    await count(env, "state_write", "success");
  } catch (error) {
    await count(env, "state_write", "error");
    throw error;
  }
  return merged;
}

// ---- 每日 Discord 彙整 --------------------------------------------------------------

const enc = new TextEncoder();
async function sha(text: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", enc.encode(text));
  return [...new Uint8Array(d)].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** 彙整裡還看得到的說明與它們目前的文字；撤下的說明不在裡面。 */
async function digestContent(ids: string[]): Promise<{ entries: UpdateEntry[]; hash: string }> {
  const entries = ids.flatMap((id) => (byId(id) ? [byId(id)!] : []));
  return { entries, hash: await sha(JSON.stringify(entries.map((e) => [e.id, e.tier, e.title]))) };
}

/**
 * 台北晚上八點之後、今天還沒有彙整時建立一則：上次彙整之後才公告的說明。
 * 至少兩則，或有一則重點，才值得單獨發；不然併到隔天，最多等三天。
 */
async function buildDigest(env: Env, now: number): Promise<void> {
  const local = new Date(now + TAIPEI);
  if (local.getUTCHours() < DIGEST_HOUR) return;
  const day = taipeiDay(now);
  if (await env.DB.prepare("SELECT 1 FROM update_digests WHERE day=?").bind(day).first()) return;
  const prev = await env.DB.prepare("SELECT MAX(cutoff) AS cutoff FROM update_digests").first<{ cutoff: number | null }>();
  // 第一則彙整沒有「上次」：往回看到最久會等的那天，被延後的那一則才不會因此掉出去
  const since = prev?.cutoff ?? now - DIGEST_MAX_WAIT - DAY;
  const live = await liveUpdates(env, now);
  // 回填的說明（live 早於寫說明的那天）只屬於更新頁：那些變化早就上線了，不該在今天的彙整裡當新消息。
  // 回填之後又加 announce 再公告的，announced_at 會晚於第一次上線，照常收進來。
  const fresh = live.filter((e) => e.announced_at > since && e.announced_at <= now && !(e.live && e.announced_at === e.first_live_at));
  if (!fresh.length) return;
  const oldest = Math.min(...fresh.map((e) => e.announced_at));
  if (fresh.length < 2 && !fresh.some((e) => e.tier === "highlight") && oldest > now - DIGEST_MAX_WAIT) return;
  const ids = fresh.sort((a, b) => TIER_RANK[a.tier] - TIER_RANK[b.tier] || b.announced_at - a.announced_at).map((e) => e.id);
  const { hash } = await digestContent(ids);
  try {
    await env.DB.prepare("INSERT OR IGNORE INTO update_digests(day,entry_ids,revision,content_hash,cutoff,created_at) VALUES(?,?,1,?,?,?)")
      .bind(day, JSON.stringify(ids), hash, now, now).run();
    await count(env, "digest_build", "success");
  } catch (error) {
    await count(env, "digest_build", "error");
    throw error;
  }
}

/** 48 小時內的彙整：說明改了字或被撤下，revision 加一，機器人會編輯原訊息。 */
async function refreshDigests(env: Env, now: number): Promise<void> {
  const rows = await env.DB.prepare("SELECT day,entry_ids,content_hash FROM update_digests WHERE created_at>?").bind(now - DIGEST_EDIT_WINDOW)
    .all<{ day: string; entry_ids: string; content_hash: string }>();
  for (const r of rows.results) {
    const { hash } = await digestContent(JSON.parse(r.entry_ids) as string[]);
    if (hash !== r.content_hash)
      await env.DB.prepare("UPDATE update_digests SET revision=revision+1,content_hash=? WHERE day=? AND content_hash=?").bind(hash, r.day, r.content_hash).run();
  }
}

/** 每小時排程：登記、建彙整、刷新 revision、清掉一個月前的紀錄。 */
export async function maintainUpdates(env: Env, now: number): Promise<void> {
  await registerUpdates(env, now);
  await buildDigest(env, now);
  await refreshDigests(env, now);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM update_deliveries WHERE day IN (SELECT day FROM update_digests WHERE created_at<?)").bind(now - 30 * DAY),
    env.DB.prepare("DELETE FROM update_digests WHERE created_at<?").bind(now - 30 * DAY),
    env.DB.prepare("DELETE FROM update_reports WHERE state<>'pending' AND updated_at<?").bind(now - 90 * DAY),
  ]);
}

const DIGEST_COPY: Record<UpdateLocale, { heading: (m: number, d: number) => string; fixes: string; more: string }> = {
  "zh-Hant": { heading: (m, d) => `綺夢社 ${m}/${d} 的更新`, fixes: "修正", more: "看全部更新" },
  "zh-Hans": { heading: (m, d) => `绮梦社 ${m}/${d} 的更新`, fixes: "修复", more: "查看全部更新" },
  en: { heading: (m, d) => `What's new on Hearthroom, ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1]} ${d}`, fixes: "Fixes", more: "See all updates" },
  ja: { heading: (m, d) => `Hearthroom ${m}月${d}日の更新`, fixes: "修正", more: "すべての更新を見る" },
  ko: { heading: (m, d) => `Hearthroom ${m}월 ${d}일 업데이트`, fixes: "수정", more: "전체 업데이트 보기" },
};

async function renderDigest(day: string, ids: string[], locale: UpdateLocale) {
  const { entries } = await digestContent(ids);
  const [, m, d] = day.split("-").map(Number) as [number, number, number];
  const copy = DIGEST_COPY[locale];
  const line = (e: UpdateEntry) => ({ title: pickUpdateText(e.title, locale), url: updatesUrl(locale, e.id, "discord") });
  // 機器人靠這個網址（加上標題）在頻道裡認回自己發過的那一則，所以每天每種語言都要不一樣
  const page = `${origin}${prefix(locale)}/updates?from=discord&day=${day}`;
  return {
    heading: copy.heading(m, d),
    url: page,
    items: entries.filter((e) => e.tier !== "fix").map((e) => ({ tier: e.tier as "highlight" | "feature", ...line(e) })),
    fixesHeading: copy.fixes,
    fixes: entries.filter((e) => e.tier === "fix").map(line),
    moreLabel: copy.more,
    moreUrl: page,
  };
}

// ---- 機器人（Hearthkeeper）操作 -----------------------------------------------------

const SNOWFLAKE = /^\d{17,20}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const CASE_RE = /^[0-9a-f]{24}$/;

function locales(raw: unknown): UpdateLocale[] {
  if (!Array.isArray(raw)) throw new HttpError(400, "community_input");
  const list = raw.filter((l): l is UpdateLocale => (UPDATE_LOCALES as readonly string[]).includes(l));
  return [...new Set(list)];
}

async function pending(env: Env, b: Record<string, unknown>, now: number) {
  const langs = locales(b.locales);
  await registerUpdates(env, now);
  await buildDigest(env, now);
  await refreshDigests(env, now);
  const digests = await env.DB.prepare("SELECT day FROM update_digests WHERE created_at>?").bind(now - DIGEST_EDIT_WINDOW).all<{ day: string }>();
  const fresh: D1PreparedStatement[] = [];
  for (const d of digests.results) for (const l of langs)
    fresh.push(env.DB.prepare("INSERT OR IGNORE INTO update_deliveries(day,locale,updated_at) VALUES(?,?,?)").bind(d.day, l, now));
  if (fresh.length) await env.DB.batch(fresh);
  const due = langs.length
    ? await env.DB.prepare(
        `SELECT d.day,d.locale FROM update_deliveries d JOIN update_digests g ON g.day=d.day
         WHERE d.locale IN (${langs.map(() => "?").join(",")}) AND g.created_at>? AND g.revision>d.delivered_revision AND d.due_at<=? AND d.lease_until<=?
         ORDER BY d.day,d.locale LIMIT 10`,
      ).bind(...langs, now - DIGEST_EDIT_WINDOW, now, now).all<{ day: string; locale: string }>()
    : { results: [] };
  const reports = await env.DB.prepare("SELECT entry_id,case_id FROM update_reports WHERE state='pending' AND retry_at<=? ORDER BY updated_at LIMIT 20").bind(now)
    .all<{ entry_id: string; case_id: string }>();
  return {
    version: 1,
    digests: due.results,
    reports: reports.results.filter((r) => byId(r.entry_id)).slice(0, 10).map((r) => ({ entry: r.entry_id, case: r.case_id })),
  };
}

async function project(env: Env, b: Record<string, unknown>, now: number) {
  const day = String(b.day), locale = String(b.locale), channel = String(b.channel);
  if (!DAY_RE.test(day) || !(UPDATE_LOCALES as readonly string[]).includes(locale) || !SNOWFLAKE.test(channel)) throw new HttpError(400, "community_input");
  const lease = crypto.randomUUID();
  await env.DB.prepare("INSERT OR IGNORE INTO update_deliveries(day,locale,updated_at) SELECT day,?,? FROM update_digests WHERE day=?").bind(locale, now, day).run();
  const d = await env.DB.prepare(
    `UPDATE update_deliveries SET lease=?,lease_until=? WHERE day=? AND locale=? AND due_at<=? AND lease_until<=?
     AND EXISTS(SELECT 1 FROM update_digests g WHERE g.day=update_deliveries.day AND g.created_at>?)
     RETURNING channel_id,message_id`,
  ).bind(lease, now + 2 * MINUTE, day, locale, now, now, now - DIGEST_EDIT_WINDOW).first<{ channel_id: string | null; message_id: string | null }>();
  if (!d) throw new HttpError(409, "update_delivery_busy");
  const g = (await env.DB.prepare("SELECT entry_ids,revision FROM update_digests WHERE day=?").bind(day).first<{ entry_ids: string; revision: number }>())!;
  return {
    day,
    locale,
    revision: g.revision,
    lease,
    messageId: d.channel_id === channel ? d.message_id : null,
    digest: await renderDigest(day, JSON.parse(g.entry_ids) as string[], locale as UpdateLocale),
  };
}

async function ack(env: Env, b: Record<string, unknown>, now: number) {
  const day = String(b.day), locale = String(b.locale), lease = String(b.lease), revision = Number(b.revision);
  const row = await env.DB.prepare("SELECT lease_until FROM update_deliveries WHERE day=? AND locale=? AND lease=?").bind(day, locale, lease).first<{ lease_until: number }>();
  if (!row) return { accepted: false };
  try {
    if (b.failed === true) {
      await env.DB.prepare("UPDATE update_deliveries SET lease=NULL,lease_until=0,due_at=?,updated_at=? WHERE day=? AND locale=? AND lease=?").bind(now + MINUTE, now, day, locale, lease).run();
      await count(env, "delivery_ack", "error");
      return { accepted: true };
    }
    if (!SNOWFLAKE.test(String(b.channel)) || (b.deleted !== true && !SNOWFLAKE.test(String(b.messageId)))) throw new HttpError(400, "community_input");
    const channel = String(b.channel), message = b.deleted === true ? null : String(b.messageId);
    const g = await env.DB.prepare("SELECT revision FROM update_digests WHERE day=?").bind(day).first<{ revision: number }>();
    if (!g || g.revision !== revision || row.lease_until <= now) {
      // 內容在送出途中又變了：記住訊息在哪，下一輪輪詢會再編輯它
      await env.DB.prepare("UPDATE update_deliveries SET channel_id=?,message_id=?,lease=NULL,lease_until=0,due_at=0,updated_at=? WHERE day=? AND locale=? AND lease=?")
        .bind(channel, message, now, day, locale, lease).run();
      return { accepted: false };
    }
    const r = await env.DB.prepare("UPDATE update_deliveries SET channel_id=?,message_id=?,delivered_revision=?,lease=NULL,lease_until=0,due_at=0,updated_at=? WHERE day=? AND locale=? AND lease=?")
      .bind(channel, message, revision, now, day, locale, lease).run();
    await count(env, "delivery_ack", "success");
    return { accepted: r.meta.changes === 1 };
  } catch (error) {
    if (!(error instanceof HttpError)) await count(env, "delivery_ack", "error");
    throw error;
  }
}

async function report(env: Env, b: Record<string, unknown>) {
  const entry = String(b.entry), kase = String(b.case);
  const job = await env.DB.prepare("SELECT 1 FROM update_reports WHERE entry_id=? AND case_id=? AND state='pending'").bind(entry, kase).first();
  const e = byId(entry);
  if (!job || !e) throw new HttpError(404, "not_found");
  return { entry, case: kase, titles: e.title, url: updatesUrl("zh-Hant", entry) };
}

async function reportAck(env: Env, b: Record<string, unknown>, now: number) {
  const entry = String(b.entry), kase = String(b.case), outcome = String(b.outcome);
  if (!CASE_RE.test(kase) || !["delivered", "missing", "failed"].includes(outcome)) throw new HttpError(400, "community_input");
  const job = await env.DB.prepare("SELECT attempts FROM update_reports WHERE entry_id=? AND case_id=? AND state='pending'").bind(entry, kase).first<{ attempts: number }>();
  if (!job) return { accepted: false };
  if (outcome === "failed") {
    const attempts = job.attempts + 1;
    await env.DB.prepare("UPDATE update_reports SET attempts=?,state=?,retry_at=?,updated_at=? WHERE entry_id=? AND case_id=?")
      .bind(attempts, attempts >= REPORT_MAX_ATTEMPTS ? "missing" : "pending", now + 10 * MINUTE, now, entry, kase).run();
    await count(env, "report_notify", "error");
    return { accepted: true };
  }
  const statements = [env.DB.prepare("UPDATE update_reports SET state=?,updated_at=? WHERE entry_id=? AND case_id=? AND state='pending'").bind(outcome === "delivered" ? "done" : "missing", now, entry, kase)];
  if (outcome === "delivered" && typeof b.reporter === "string" && SNOWFLAKE.test(b.reporter))
    // 只有具名回報才帶 reporter；匿名案件的身分不會離開機器人。沒有綁定本站帳號或關了通知的人就不寫。
    statements.push(env.DB.prepare(
      `INSERT OR IGNORE INTO community_notifications(event_key,member_id,kind,path,created_at,extra)
       SELECT ?,l.member_id,'report_shipped',?,?,? FROM discord_links l
       WHERE l.discord_id=? AND l.state='active'
       AND NOT EXISTS(SELECT 1 FROM community_preferences p WHERE p.member_id=l.member_id AND p.notifications=0)`,
    ).bind(`report_shipped:${entry}:${kase}`, `/updates#${entry}`, now, JSON.stringify({ entry }), b.reporter));
  await env.DB.batch(statements);
  await count(env, "report_notify", "success");
  return { accepted: true };
}

/** /internal/community/update-* 的分派；呼叫端已驗過簽章與伺服器。 */
export async function updateBridge(env: Env, op: string, b: Record<string, unknown>, now: number) {
  if (op === "update-pending") return pending(env, b, now);
  if (op === "update-project") return project(env, b, now);
  if (op === "update-ack") return ack(env, b, now);
  if (op === "update-report") return report(env, b);
  if (op === "update-report-ack") return reportAck(env, b, now);
  throw new HttpError(404, "not_found");
}

// ---- Atom ------------------------------------------------------------------------

const FEED_TITLE: Record<UpdateLocale, string> = {
  "zh-Hant": "綺夢社更新紀錄",
  "zh-Hans": "绮梦社更新记录",
  en: "Hearthroom updates",
  ja: "Hearthroom の更新履歴",
  ko: "Hearthroom 업데이트 기록",
};
const xml = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[ch]!);

export async function updatesFeed(env: Env, locale: UpdateLocale, now: number): Promise<string> {
  const live = (await liveUpdates(env, now)).slice(0, 50);
  const self = `${origin}${prefix(locale)}/updates.atom`;
  const updated = new Date(live[0]?.announced_at ?? now).toISOString();
  const entries = live.map((e) => {
    const title = pickUpdateText(e.title, locale);
    const summary = e.body ? `${title} ${pickUpdateText(e.body, locale)}` : title;
    return `<entry><id>${xml(updatesUrl(locale, e.id))}</id><title>${xml(title)}</title><link href="${xml(updatesUrl(locale, e.id))}"/><updated>${new Date(e.announced_at).toISOString()}</updated><summary>${xml(summary)}</summary></entry>`;
  });
  return `<?xml version="1.0" encoding="utf-8"?>\n<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="${locale}"><id>${xml(self)}</id><title>${xml(FEED_TITLE[locale])}</title><link rel="self" href="${xml(self)}"/><link href="${xml(updatesUrl(locale))}"/><updated>${updated}</updated>${entries.join("")}</feed>\n`;
}

// ---- 路由 ------------------------------------------------------------------------

export const updatesRoutes = new Hono<{ Bindings: Env }>();

updatesRoutes.get("/v1/updates", async (c) => {
  const locale = updateLocale(c.req.query("lang"));
  const view = c.req.query("view") === "full" ? "full" : "summary";
  const body = await listUpdates(c.env, locale, view, Date.now());
  c.header("Cache-Control", "public, max-age=300");
  return c.json(body);
});

updatesRoutes.get("/v1/me/updates/state", async (c) => {
  c.header("Cache-Control", "private, no-store");
  const m = await requireMember(c);
  return c.json({ state: await readState(c.env, m.id) });
});

updatesRoutes.put("/v1/me/updates/state", bodyLimit({ maxSize: 16 * 1024, onError: () => { throw new HttpError(400, "community_input"); } }), async (c) => {
  c.header("Cache-Control", "private, no-store");
  const m = await requireMember(c);
  const body = await c.req.json().catch(() => { throw new HttpError(400, "invalid_json"); });
  return c.json({ state: await saveState(c.env, m.id, body, Date.now()) });
});

const feed = async (c: { env: Env; header: (k: string, v: string) => void; body: (b: string) => Response }, locale: UpdateLocale) => {
  const text = await updatesFeed(c.env, locale, Date.now());
  c.header("Content-Type", "application/atom+xml; charset=utf-8");
  c.header("Cache-Control", "public, max-age=600");
  return c.body(text);
};
updatesRoutes.get("/updates.atom", (c) => feed(c, "zh-Hant"));
updatesRoutes.get("/:locale{zh-Hans|en|ja|ko}/updates.atom", (c) => feed(c, c.req.param("locale") as UpdateLocale));
