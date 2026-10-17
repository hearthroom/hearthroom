import { auditStmt, auditStmtIfChanged, type ActorKind } from "./audit";
import { cleanLocalized, IMAGE_KEY, imageUrl, type Localized } from "./blog";
import { bumpOp } from "./ops-metrics";
import { HttpError } from "./types";

/**
 * 分享獎勵活動（開業活動設計 §3、§4.4）：設定、發放金額計算、位置正規化。純資料層，權限在路由層檢查。
 * 業務數字（檔位金額、追加金額、門檻、保留天數、截止時間）全部存在 campaigns，程式裡沒有金額常數。
 * 錢不在這裡：點數池與入帳在 Provider，這裡只算「該發多少」。
 */
export const TIERS = ["light", "original", "guide", "video"] as const;
export type Tier = (typeof TIERS)[number];
/** 檔位高低就是列舉順序：內容的檔位＝核准位置裡最高的一檔。 */
export const tierRank = (t: Tier): number => TIERS.indexOf(t);

/**
 * 分享平台。清單在程式裡維護（0068 起資料庫只擋長度），申請時只收這裡的值。
 * video、forum 是開幕前的舊選項，保留給既有資料與統計；表單改用 web 端依語言排的清單。
 */
export const PLATFORMS = ["qq_group", "moments", "tieba", "xiaohongshu", "bilibili", "douyin", "weibo", "bahamut", "discord", "dcard", "ptt", "threads", "facebook", "youtube", "x", "reddit", "tiktok", "video", "forum", "other"] as const;
export type Platform = (typeof PLATFORMS)[number];

export type Actor = { memberId: string | null; kind: ActorKind };
export type CampaignStatus = "draft" | "active" | "ended";

export type Campaign = {
  id: string; slug: string; title: Localized; intro: Localized;
  /** 編輯器回存時帶回的原始 key；bannerUrl 由它算出。 */
  bannerKey: string | null; bannerUrl: string | null;
  startsAt: number | null; endsAt: number | null; timezone: string | null; submitDeadline: number | null; payoutDeadline: number | null;
  tiers: Partial<Record<Tier, number>>; extraPlacementAmount: number | null; flagBurstThreshold: number | null; evidenceRetentionDays: number;
  /** 隨手分享（light）每人每週最多發放幾個位置；null＝不限（見 lightCaps） */
  lightLimit: number | null;
  /** 推薦到首頁：進行中或即將開始時出現在看板輪播。不影響啟用條件。 */
  featured: boolean;
  status: CampaignStatus; version: number; createdAt: number; updatedAt: number;
};
/** 可編輯的欄位；沒給的視為清空（整份覆寫，跟部落格一樣）。 */
export type CampaignInput = {
  id?: string; expectedVersion?: number; slug: string; title: Localized; intro?: Localized; bannerKey?: string | null;
  startsAt?: number | null; endsAt?: number | null; timezone?: string | null; submitDeadline?: number | null; payoutDeadline?: number | null;
  tiers?: Partial<Record<Tier, number>>; extraPlacementAmount?: number | null; lightLimit?: number | null; flagBurstThreshold?: number | null; evidenceRetentionDays?: number; featured?: boolean;
};

// ---- 計算 ---------------------------------------------------------------------

export type PlacementForPay = { reviewStatus: string; approvedTier: Tier | null; countsAsPlacement: boolean };

/**
 * 目標金額＝最高檔金額＋追加金額×(算數的核准位置數−1)；沒有任何算數的位置就是 0。due 是還沒發的部分，不會是負數。全專案只有這一份。
 * cap 是隨手分享（light）每週上限算下來，這份內容最多能算幾個位置（lightCaps）；沒給就不封頂。
 */
export function payoutAmount(placements: PlacementForPay[], campaign: Pick<Campaign, "tiers" | "extraPlacementAmount">, paidTotal: number, cap?: number): { tier: Tier | null; target: number; due: number } {
  const approved = placements.filter((p) => p.reviewStatus === "approved" && p.approvedTier);
  if (!approved.length) return { tier: null, target: 0, due: 0 };
  const tier = approved.map((p) => p.approvedTier!).reduce((a, b) => (tierRank(b) > tierRank(a) ? b : a));
  const counted = approved.filter((p) => p.countsAsPlacement).length;
  const count = cap === undefined ? counted : Math.min(counted, cap);
  if (!count) return { tier, target: 0, due: 0 };
  const target = (campaign.tiers[tier] ?? 0) + (campaign.extraPlacementAmount ?? 0) * Math.max(count - 1, 0);
  return { tier, target, due: Math.max(target - paidTotal, 0) };
}

// ---- 隨手分享（light）每週上限 ------------------------------------------------------
/*
 * owner 2026-10-17：輕量那一檔一則就給積分，會有人找一堆群洗；提交照收、審核照做，但發放每人每週最多 light_limit 個。
 * 週＝分享貼出的時間（published_at）在活動時區的週一 00:00 起算。同一週裡照核准先後（reviewed_at）給名額，
 * 已發過的通常先核准，名額不會被晚核准的倒搶。只封頂最高檔是輕量的內容；升級成原創以上的內容不算。
 */
const DAY_MS = 86_400_000;
function tzOffset(ms: number, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(ms);
  const n = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  return Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second")) - Math.floor(ms / 1000) * 1000;
}
/** 週一起算的週序號（1970-01-01 是週四，所以位移 3 天） */
export const weekOf = (ms: number, tz: string) => Math.floor((Math.floor((ms + tzOffset(ms, tz)) / DAY_MS) + 3) / 7);

export type PlacementForCap = PlacementForPay & { contentId: string; publishedAt: number; reviewedAt: number | null; id: string };
/** 每份最高檔是輕量的內容，最多能算幾個位置；沒在表裡的內容不封頂。 */
export function lightCaps(placements: PlacementForCap[], limit: number | null, tz: string): Map<string, number> {
  const caps = new Map<string, number>();
  if (limit === null) return caps;
  const approved = placements.filter((p) => p.reviewStatus === "approved" && p.approvedTier);
  const top = new Map<string, Tier>();
  for (const p of approved) { const t = top.get(p.contentId); if (!t || tierRank(p.approvedTier!) > tierRank(t)) top.set(p.contentId, p.approvedTier!); }
  for (const [id, t] of top) if (t === "light") caps.set(id, 0);
  const used = new Map<number, number>();
  const order = approved.filter((p) => caps.has(p.contentId) && p.countsAsPlacement)
    .sort((a, b) => (a.reviewedAt ?? 0) - (b.reviewedAt ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const p of order) {
    const w = weekOf(p.publishedAt, tz);
    if ((used.get(w) ?? 0) >= limit) continue;
    used.set(w, (used.get(w) ?? 0) + 1);
    caps.set(p.contentId, caps.get(p.contentId)! + 1);
  }
  return caps;
}
/** 從資料庫讀這些人在這個活動的核准位置，算出每份內容的上限。活動沒設上限就是空表（不封頂）。 */
export async function memberLightCaps(db: D1Database, campaign: Pick<Campaign, "id" | "lightLimit" | "timezone">, memberIds: string[]): Promise<Map<string, number>> {
  if (campaign.lightLimit === null || !memberIds.length) return new Map();
  const rows = (await db.prepare(
    `SELECT p.id, p.content_id, p.published_at, p.reviewed_at, p.review_status, p.approved_tier, p.counts_as_placement FROM share_placements p
     JOIN share_contents s ON s.id = p.content_id WHERE s.campaign_id = ? AND s.member_id IN (SELECT value FROM json_each(?)) AND p.review_status = 'approved'`,
  ).bind(campaign.id, JSON.stringify(memberIds)).all<{ id: string; content_id: string; published_at: number; reviewed_at: number | null; review_status: string; approved_tier: Tier | null; counts_as_placement: number }>()).results;
  return lightCaps(rows.map((r) => ({ id: r.id, contentId: r.content_id, publishedAt: r.published_at, reviewedAt: r.reviewed_at, reviewStatus: r.review_status, approvedTier: r.approved_tier, countsAsPlacement: !!r.counts_as_placement })),
    campaign.lightLimit, campaign.timezone || "Asia/Taipei");
}

/** 分享連結常見的追蹤參數：同一個網址帶不同來源參數仍是同一個位置。 */
const TRACKING = /^(utm_.*|fbclid|gclid|spm|from|share_source|share_medium|share_from|share_plat|share_tag|vd_source|igshid|si)$/i;

/**
 * 判斷「同一個位置」的 key（重複標示用）。有網址：主機（含非預設連接埠）小寫去 www.、去追蹤參數、片段與結尾斜線，其餘參數排序；
 * 路徑大小寫保留（影片編號之類分大小寫）。沒網址或解析失敗：平台＋正規化後的位置名。
 */
export function locationKey(platform: string, location: string, url: string | null): string {
  if (url) {
    try {
      const u = new URL(url.trim());
      if (u.protocol === "http:" || u.protocol === "https:") {
        const params = [...u.searchParams].filter(([k]) => !TRACKING.test(k)).sort(([a, x], [b, y]) => (a === b ? (x < y ? -1 : x > y ? 1 : 0) : a < b ? -1 : 1));
        const qs = new URLSearchParams(params).toString();
        return `url:${u.host.toLowerCase().replace(/^www\./, "")}${u.pathname.replace(/\/+$/, "")}${qs ? `?${qs}` : ""}`;
      }
    } catch {
      // 不是網址就退回位置名
    }
  }
  return `${platform}:${location.normalize("NFKC").toLowerCase().trim().replace(/\s+/g, " ")}`;
}

// ---- 階段與啟用條件 -------------------------------------------------------------

/** 進行中的時段是 [startsAt, endsAt)。 */
export function campaignPhase(c: Pick<Campaign, "status" | "startsAt" | "endsAt">, now: number): "draft" | "upcoming" | "open" | "ended" {
  if (c.status !== "active") return c.status;
  if (c.endsAt !== null && now >= c.endsAt) return "ended";
  if (c.startsAt !== null && now < c.startsAt) return "upcoming";
  return "open";
}

const isPosInt = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) > 0;
const validTimezone = (tz: string) => {
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

/** 啟用（以及已啟用活動的每次修改）要求設定完整：時間有先後、四檔金額與追加金額都設好。 */
export function canActivate(c: Campaign): { ok: true } | { ok: false; field: string } {
  const fail = (field: string) => ({ ok: false as const, field });
  if (c.startsAt === null) return fail("startsAt");
  if (c.endsAt === null) return fail("endsAt");
  if (!c.timezone || !validTimezone(c.timezone)) return fail("timezone");
  if (c.submitDeadline === null) return fail("submitDeadline");
  if (c.payoutDeadline === null) return fail("payoutDeadline");
  if (c.startsAt >= c.endsAt) return fail("endsAt");
  if (c.endsAt > c.submitDeadline) return fail("submitDeadline");
  if (c.submitDeadline > c.payoutDeadline) return fail("payoutDeadline");
  for (const t of TIERS) if (!isPosInt(c.tiers[t])) return fail(`tiers.${t}`);
  if (c.extraPlacementAmount === null) return fail("extraPlacementAmount");
  return { ok: true };
}

// ---- 列與轉換 ------------------------------------------------------------------

type Row = {
  id: string; slug: string; title: string; intro: string; banner_key: string | null; starts_at: number | null; ends_at: number | null;
  timezone: string | null; submit_deadline: number | null; payout_deadline: number | null; tiers: string; extra_placement_amount: number | null; light_limit: number | null;
  flag_burst_threshold: number | null; evidence_retention_days: number; featured: number; status: CampaignStatus; version: number; created_at: number; updated_at: number;
};
const EDITABLE = ["slug", "title", "intro", "banner_key", "starts_at", "ends_at", "timezone", "submit_deadline", "payout_deadline", "tiers", "extra_placement_amount", "light_limit", "flag_burst_threshold", "evidence_retention_days", "featured"] as const;
type Editable = Pick<Row, (typeof EDITABLE)[number]>;

const toCampaign = (r: Row): Campaign => ({
  id: r.id, slug: r.slug, title: JSON.parse(r.title), intro: JSON.parse(r.intro), bannerKey: r.banner_key, bannerUrl: imageUrl(r.banner_key),
  startsAt: r.starts_at, endsAt: r.ends_at, timezone: r.timezone, submitDeadline: r.submit_deadline, payoutDeadline: r.payout_deadline,
  tiers: JSON.parse(r.tiers), extraPlacementAmount: r.extra_placement_amount, lightLimit: r.light_limit, flagBurstThreshold: r.flag_burst_threshold,
  evidenceRetentionDays: r.evidence_retention_days, featured: r.featured === 1, status: r.status, version: r.version, createdAt: r.created_at, updatedAt: r.updated_at,
});
/** 稽核的改前改後：設定本身，不含時間戳與衍生的網址。 */
const auditView = ({ id: _, bannerUrl: _u, createdAt: _c, updatedAt: _t, ...rest }: Campaign) => rest;

const row = (db: D1Database, idOrSlug: string) => db.prepare("SELECT * FROM campaigns WHERE id = ?1 OR slug = ?1 ORDER BY id = ?1 DESC LIMIT 1").bind(idOrSlug).first<Row>();

export async function getCampaign(db: D1Database, idOrSlug: string): Promise<Campaign | null> {
  const r = await row(db, idOrSlug);
  return r ? toCampaign(r) : null;
}
async function mustCampaign(db: D1Database, id: string): Promise<Campaign> {
  const c = await getCampaign(db, id);
  if (!c) throw new HttpError(404, "campaign_not_found");
  return c;
}

export async function listCampaigns(db: D1Database, opts: { includeDraft: boolean }): Promise<Campaign[]> {
  const rows = await db.prepare(`SELECT * FROM campaigns ${opts.includeDraft ? "" : "WHERE status != 'draft'"} ORDER BY created_at DESC, id`).all<Row>();
  return rows.results.map(toCampaign);
}

// ---- 驗證 ---------------------------------------------------------------------

const SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/;
const invalid = (field: string): never => { throw new HttpError(400, "campaign_invalid", undefined, { field }); };
const nullableInt = (v: unknown, field: string, ok: (n: number) => boolean): number | null => {
  if (v === undefined || v === null) return null;
  return Number.isSafeInteger(v) && ok(v as number) ? (v as number) : invalid(field);
};

function cleanTiers(v: unknown): Partial<Record<Tier, number>> {
  if (v === undefined || v === null) return {};
  if (typeof v !== "object" || Array.isArray(v)) invalid("tiers");
  const given = v as Record<string, unknown>;
  for (const [k, n] of Object.entries(given)) if (!(TIERS as readonly string[]).includes(k) || (n !== undefined && !isPosInt(n))) invalid("tiers");
  return Object.fromEntries(TIERS.filter((t) => given[t] !== undefined).map((t) => [t, given[t]]));
}

function clean(input: CampaignInput): Editable {
  if (typeof input.slug !== "string" || !SLUG.test(input.slug)) invalid("slug");
  const time = (v: unknown, field: string) => nullableInt(v, field, (n) => n >= 0);
  const banner = input.bannerKey ?? null;
  if (banner !== null && (typeof banner !== "string" || !IMAGE_KEY.test(banner))) invalid("bannerKey");
  const tz = input.timezone ?? null;
  if (tz !== null && (typeof tz !== "string" || tz.length > 64 || !validTimezone(tz))) invalid("timezone");
  const retention = input.evidenceRetentionDays ?? 90;
  if (!Number.isSafeInteger(retention) || retention < 1 || retention > 3650) invalid("evidenceRetentionDays");
  const featured = input.featured ?? false;
  if (typeof featured !== "boolean") invalid("featured");
  return {
    slug: input.slug,
    title: JSON.stringify(cleanLocalized(input.title, "title", 120, true, "campaign_invalid")),
    intro: JSON.stringify(cleanLocalized(input.intro ?? {}, "intro", 20000, false, "campaign_invalid")),
    banner_key: banner, starts_at: time(input.startsAt, "startsAt"), ends_at: time(input.endsAt, "endsAt"), timezone: tz,
    submit_deadline: time(input.submitDeadline, "submitDeadline"), payout_deadline: time(input.payoutDeadline, "payoutDeadline"),
    tiers: JSON.stringify(cleanTiers(input.tiers)),
    extra_placement_amount: nullableInt(input.extraPlacementAmount, "extraPlacementAmount", (n) => n >= 0),
    light_limit: nullableInt(input.lightLimit, "lightLimit", (n) => n >= 1),
    flag_burst_threshold: nullableInt(input.flagBurstThreshold, "flagBurstThreshold", (n) => n >= 1),
    evidence_retention_days: retention, featured: featured ? 1 : 0,
  };
}

// ---- 寫入 ---------------------------------------------------------------------

type SettingsAction = "create" | "update" | "activate" | "end";

/**
 * 同一個操作編號已經做過（連點、斷線重試）：回那一次的活動 id，呼叫端照原樣回現況、不再寫。
 * 只認同一個動作（建立／修改／啟用／結束）；修改與改狀態還要是同一個活動。拿去做別的事一律 409。
 */
async function priorSubject(db: D1Database, actor: Actor, operationId: string, action: SettingsAction, id?: string): Promise<string | null> {
  const r = await db.prepare("SELECT subject_kind, subject_id, action FROM audit_log WHERE actor_member_id IS ? AND operation_id = ?").bind(actor.memberId, operationId)
    .first<{ subject_kind: string; subject_id: string; action: string }>();
  if (!r) return null;
  if (r.subject_kind !== "campaign" || r.action !== action || (id !== undefined && r.subject_id !== id)) throw new HttpError(409, "campaign_operation_repeated");
  return r.subject_id;
}

const conflict = async (db: D1Database, id: string): Promise<never> => {
  const r = await db.prepare("SELECT version FROM campaigns WHERE id = ?").bind(id).first<{ version: number }>();
  if (!r) throw new HttpError(404, "campaign_not_found");
  throw new HttpError(409, "campaign_version_conflict", undefined, { version: r.version });
};

/**
 * 執行 batch，回最後的活動。並發的同一次重送會輸在稽核唯一鍵或版本條件上：先看是不是已經做過，是就回現況；
 * 不是才把 slug 衝突轉成 409、把條件式更新改到 0 列轉成版本衝突。
 */
async function commit(db: D1Database, id: string, writes: D1PreparedStatement[], actor: Actor, operationId: string, action: SettingsAction, scope?: string): Promise<Campaign> {
  try {
    const [first] = await db.batch(writes);
    if (!first!.meta.changes) {
      const prior = await priorSubject(db, actor, operationId, action, scope);
      if (prior) return mustCampaign(db, prior);
      await conflict(db, id);
    }
  } catch (e) {
    if (e instanceof HttpError || !/UNIQUE constraint failed/.test(String(e))) throw e;
    const prior = await priorSubject(db, actor, operationId, action, scope);
    if (prior) return mustCampaign(db, prior);
    if (/campaigns\.slug/.test(String(e))) throw new HttpError(409, "campaign_slug_taken");
    throw e;
  }
  await bumpOp(db, "campaign", "settings", "success");
  return mustCampaign(db, id);
}

const audit = (id: string, actor: Actor, action: string, before: Campaign | null, after: Campaign, operationId: string, now: number) => ({
  subjectKind: "campaign" as const, subjectId: id, actorMemberId: actor.memberId, actorKind: actor.kind, action,
  before: before ? auditView(before) : {}, after: auditView(after), operationId, now,
});

/** 建立（沒有 id）或修改（帶 expectedVersion）。已啟用或已結束的活動，改完仍要符合啟用條件。 */
export async function saveCampaign(db: D1Database, input: CampaignInput, actor: Actor, operationId: string, now: number): Promise<Campaign> {
  const prior = await priorSubject(db, actor, operationId, input.id === undefined ? "create" : "update", input.id);
  if (prior) return mustCampaign(db, prior);
  const c = clean(input);
  // 發卡獎勵活動（創作季）跟分享活動共用 /campaign/:slug：同名會讓其中一個找不到
  if (await db.prepare("SELECT 1 AS ok FROM card_reward_campaigns WHERE slug = ?").bind(c.slug).first("ok")) throw new HttpError(409, "campaign_slug_taken");
  const values = EDITABLE.map((k) => c[k]);
  if (input.id === undefined) {
    const id = crypto.randomUUID();
    const after = toCampaign({ ...c, id, status: "draft", version: 1, created_at: now, updated_at: now });
    return commit(db, id, [
      db.prepare(`INSERT INTO campaigns (id, ${EDITABLE.join(", ")}, created_by, created_at, updated_at) VALUES (?, ${EDITABLE.map(() => "?").join(", ")}, ?, ?, ?)`).bind(id, ...values, actor.memberId ?? actor.kind, now, now),
      auditStmt(db, audit(id, actor, "create", null, after, operationId, now)),
    ], actor, operationId, "create");
  }
  if (!Number.isInteger(input.expectedVersion)) invalid("expectedVersion");
  const prev = await row(db, input.id);
  if (!prev || prev.id !== input.id) throw new HttpError(404, "campaign_not_found");
  if (prev.version !== input.expectedVersion) await conflict(db, prev.id);
  const after = toCampaign({ ...prev, ...c, version: prev.version + 1, updated_at: now });
  if (after.status !== "draft") {
    const ok = canActivate(after);
    if (!ok.ok) invalid(ok.field);
  }
  return commit(db, prev.id, [
    db.prepare(`UPDATE campaigns SET ${EDITABLE.map((k) => `${k} = ?`).join(", ")}, version = version + 1, updated_at = ? WHERE id = ? AND version = ?`).bind(...values, now, prev.id, prev.version),
    auditStmtIfChanged(db, audit(prev.id, actor, "update", toCampaign(prev), after, operationId, now)),
  ], actor, operationId, "update", prev.id);
}

/** 草稿 → 進行中（設定要完整）→ 已結束。結束是終點；已經是目標狀態就回現況、不寫。 */
export async function setCampaignStatus(db: D1Database, id: string, status: "active" | "ended", actor: Actor, operationId: string, now: number): Promise<Campaign> {
  const action = status === "active" ? "activate" : "end";
  const prior = await priorSubject(db, actor, operationId, action, id);
  if (prior) return mustCampaign(db, prior);
  const prev = await row(db, id);
  if (!prev || prev.id !== id) throw new HttpError(404, "campaign_not_found");
  const before = toCampaign(prev);
  if (before.status === status) return before;
  if (before.status === "ended") throw new HttpError(409, "campaign_ended");
  if (status === "ended" && before.status !== "active") throw new HttpError(409, "campaign_not_active");
  if (status === "active") {
    const ok = canActivate(before);
    if (!ok.ok) invalid(ok.field);
  }
  const after = { ...before, status, version: before.version + 1, updatedAt: now };
  return commit(db, id, [
    db.prepare("UPDATE campaigns SET status = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?").bind(status, now, id, before.version),
    auditStmtIfChanged(db, audit(id, actor, action, before, after, operationId, now)),
  ], actor, operationId, action, id);
}
