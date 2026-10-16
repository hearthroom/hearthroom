import { auditStmt } from "./audit";
import { attachEvidence, attachFailed } from "./campaign-evidence";
import { campaignPhase, getCampaign, locationKey, memberLightCaps, payoutAmount, PLATFORMS, TIERS, type Campaign, type Tier } from "./campaign";
import { HttpError } from "./types";

/**
 * 分享活動的申請端（開業活動設計 §4.1–4.3）：提交位置、補件重送、我的申請。權限（登入、Harbor 帳號）在這裡檢查，
 * 因為收款帳號就是登入的那個帳號。每次寫入（內容、位置、截圖掛上、稽核）都在同一個 batch。
 */
export type Applicant = { id: string; provider: string; externalId: number };

const RATE_WINDOW = 60_000;
const RATE_MAX = 6;
/** 發布時間可以比伺服器時間晚一點（使用者時鐘偏差），再晚就是填錯。 */
const CLOCK_SKEW = 5 * 60_000;
const CODE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const CODE_RETRIES = 3;

const invalid = (field: string): never => { throw new HttpError(400, "share_invalid", undefined, { field }); };

// ---- 驗證 ---------------------------------------------------------------------

const text = (v: unknown, field: string, min: number, max: number): string => {
  const s = typeof v === "string" ? v.trim() : "";
  return s.length >= min && s.length <= max && typeof v === "string" ? s : invalid(field);
};
const oneOf = <T extends string>(v: unknown, list: readonly T[], field: string): T => ((list as readonly unknown[]).includes(v) ? (v as T) : invalid(field));
/** 只收 http／https 網址；沒給、null、空字串都是「沒有連結」。 */
const urlOf = (v: unknown): string | null => {
  if (v === undefined || v === null || (typeof v === "string" && !v.trim())) return null;
  if (typeof v !== "string" || v.trim().length > 2000) invalid("url");
  try {
    const u = new URL((v as string).trim());
    if (u.protocol === "http:" || u.protocol === "https:") return (v as string).trim();
  } catch {
    // 落到下面
  }
  return invalid("url");
};
const publishedAtOf = (v: unknown, c: Campaign, now: number): number =>
  Number.isSafeInteger(v) && (v as number) <= now + CLOCK_SKEW && (v as number) >= (c.startsAt ?? 0) ? (v as number) : invalid("publishedAt");
const evidenceIdsOf = (v: unknown): string[] => (v === undefined || v === null ? [] : Array.isArray(v) ? v : invalid("evidenceIds"));

// ---- batch 守門 ---------------------------------------------------------------

/** 前一條寫入改到 0 列就讓整個 batch 失敗（錯誤訊息帶著代碼，用法同 attachEvidence 的守門語句）。 */
const unlessChanged = (db: D1Database, code: string) => db.prepare(`SELECT json_extract('{}', IIF(changes() > 0, '$', '${code}'))`);
const RECENT = "(SELECT count(*) FROM share_placements p JOIN share_contents s ON s.id = p.content_id WHERE s.member_id = ? AND p.created_at > ?)";

/** batch 失敗時：守門代碼轉成對應的錯，截圖的守門交給 attachFailed。 */
function guardFailed(e: unknown): never {
  const msg = String(e);
  if (msg.includes("campaign_rate_limited")) throw new HttpError(429, "campaign_rate_limited");
  if (msg.includes("share_not_editable")) throw new HttpError(409, "share_not_editable");
  return attachFailed(e);
}

/**
 * 同一個操作編號這個人做過同一種動作（重送同一筆時也要是同一個位置）：回那一次的位置 id。
 * 編號被別種操作或別的位置用過不是重送，回衝突（審核員本人也可能是申請人，審核決定也記在 share_placement 底下）。
 */
async function priorPlacement(db: D1Database, memberId: string, operationId: string, action: "submit" | "resubmit", placementId?: string): Promise<string | null> {
  const r = await db.prepare("SELECT subject_kind, subject_id, action FROM audit_log WHERE actor_member_id = ? AND operation_id = ?").bind(memberId, operationId).first<{ subject_kind: string; subject_id: string; action: string }>();
  if (!r) return null;
  if (r.subject_kind !== "share_placement" || r.action !== action || (placementId !== undefined && r.subject_id !== placementId)) throw new HttpError(409, "campaign_operation_repeated");
  return r.subject_id;
}
const contentOf = async (db: D1Database, placementId: string) => (await db.prepare("SELECT content_id FROM share_placements WHERE id = ?").bind(placementId).first<string>("content_id"))!;

function shareCode(): string {
  const out: string[] = [];
  while (out.length < 8) for (const b of crypto.getRandomValues(new Uint8Array(16))) if (b < 252 && out.length < 8) out.push(CODE_CHARS[b % 36]!); // 252 = 36×7，不偏
  return out.join("");
}

// ---- 提交 ---------------------------------------------------------------------

export type ApplyResult = { placementId: string; content: ContentView };

export async function submitPlacement(db: D1Database, member: Applicant, slug: string, body: Record<string, unknown>, operationId: string, now: number): Promise<ApplyResult> {
  if (member.provider !== "harbor") invalid("account");
  const prior = await priorPlacement(db, member.id, operationId, "submit");
  if (prior) return result(db, member.id, prior);

  const campaign = await getCampaign(db, slug);
  if (!campaign || campaign.slug !== slug || campaign.status === "draft") throw new HttpError(404, "campaign_not_found");
  if (campaignPhase(campaign, now) !== "open") throw new HttpError(409, "campaign_not_open");

  if ((body.contentId === undefined) === (body.content === undefined)) invalid("content");
  const fresh = body.content as Record<string, unknown> | undefined;
  if (fresh !== undefined && (!fresh || typeof fresh !== "object" || Array.isArray(fresh))) invalid("content");
  const title = fresh ? text(fresh.title, "title", 1, 120) : null;
  const cardId = fresh?.cardId ?? null;
  if (cardId !== null && !Number.isSafeInteger(cardId)) invalid("cardId");
  const platform = oneOf(body.platform, PLATFORMS, "platform");
  const location = text(body.location, "location", 1, 200);
  const publishedAt = publishedAtOf(body.publishedAt, campaign, now);
  const url = urlOf(body.url);
  const note = body.note === undefined || body.note === null ? "" : text(body.note, "note", 0, 1000);
  const requestedTier = oneOf(body.requestedTier, TIERS, "requestedTier");
  const evidenceIds = evidenceIdsOf(body.evidenceIds);
  if (!url && !evidenceIds.length) invalid("evidence");

  // 先擋一次省下後面的查詢；真正的上限在位置的條件式 INSERT，並發的提交才越不過去。
  if (((await db.prepare(`SELECT ${RECENT} AS n`).bind(member.id, now - RATE_WINDOW).first<number>("n")) ?? 0) >= RATE_MAX) throw new HttpError(429, "campaign_rate_limited");
  if (body.contentId !== undefined) {
    const own = typeof body.contentId === "string" && (await db.prepare("SELECT 1 AS ok FROM share_contents WHERE id = ? AND member_id = ? AND campaign_id = ?").bind(body.contentId, member.id, campaign.id).first("ok"));
    if (!own) throw new HttpError(404, "share_content_not_found");
  }
  if (cardId !== null && !(await db.prepare("SELECT 1 AS ok FROM cards WHERE id = ?").bind(cardId).first("ok"))) invalid("cardId");

  const placementId = crypto.randomUUID();
  const contentId = fresh ? crypto.randomUUID() : (body.contentId as string);
  const actor = { actorMemberId: member.id, actorKind: "human" as const, now };
  const placement = { contentId, platform, location, publishedAt, url, note, requestedTier, evidenceIds };

  for (let attempt = 0; ; attempt++) {
    const code = shareCode();
    const writes: D1PreparedStatement[] = [];
    if (fresh) {
      writes.push(
        db.prepare("INSERT INTO share_contents (id, campaign_id, member_id, recipient_account_no, card_id, title, share_code, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
          .bind(contentId, campaign.id, member.id, member.externalId, cardId, title, code, now, now),
        // 衍生編號：同一次提交的兩筆稽核共用使用者的操作編號，唯一鍵不允許重複。
        auditStmt(db, { ...actor, subjectKind: "share_content", subjectId: contentId, action: "create", after: { campaignId: campaign.id, title, cardId, shareCode: code }, operationId: `${operationId}:content` }),
      );
    }
    writes.push(
      db.prepare(
        `INSERT INTO share_placements (id, content_id, platform, location, location_key, published_at, url, note, requested_tier, created_at, updated_at)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${RECENT} < ?`,
      ).bind(placementId, contentId, platform, location, locationKey(platform, location, url), publishedAt, url, note, requestedTier, now, now, member.id, now - RATE_WINDOW, RATE_MAX),
      unlessChanged(db, "campaign_rate_limited"),
      ...attachEvidence(db, member.id, placementId, evidenceIds, now),
      auditStmt(db, { ...actor, subjectKind: "share_placement", subjectId: placementId, action: "submit", after: placement, operationId }),
    );
    try {
      await db.batch(writes);
      return result(db, member.id, placementId);
    } catch (e) {
      // 並發的同一次重試輸在稽核唯一鍵（或截圖已被掛走、或剛好撞到上限）：先看是不是已經做過。
      const again = await priorPlacement(db, member.id, operationId, "submit");
      if (again) return result(db, member.id, again);
      if (/UNIQUE constraint failed: share_contents\.share_code/.test(String(e)) && attempt < CODE_RETRIES) continue;
      guardFailed(e);
    }
  }
}

// ---- 補件重送 -----------------------------------------------------------------

type PlacementRow = {
  id: string; content_id: string; platform: string; location: string; published_at: number; url: string | null; note: string;
  requested_tier: Tier; review_status: string; version: number; member_id: string; campaign_id: string;
};

/** 只有 needs_info 可改；平台不能改（換平台就是另一個位置）。截圖只能追加。 */
export async function resubmitPlacement(db: D1Database, member: Applicant, id: string, body: Record<string, unknown>, operationId: string, now: number): Promise<ApplyResult> {
  const prior = await priorPlacement(db, member.id, operationId, "resubmit", id);
  if (prior) return result(db, member.id, prior);
  const p = await db.prepare(
    "SELECT p.id, p.content_id, p.platform, p.location, p.published_at, p.url, p.note, p.requested_tier, p.review_status, p.version, s.member_id, s.campaign_id FROM share_placements p JOIN share_contents s ON s.id = p.content_id WHERE p.id = ?",
  ).bind(id).first<PlacementRow>();
  if (!p || p.member_id !== member.id) throw new HttpError(404, "share_placement_not_found");
  if (p.review_status !== "needs_info") throw new HttpError(409, "share_not_editable");
  const campaign = (await getCampaign(db, p.campaign_id))!;
  if (campaign.submitDeadline !== null && now >= campaign.submitDeadline) throw new HttpError(409, "campaign_submit_closed");

  const location = body.location === undefined ? p.location : text(body.location, "location", 1, 200);
  const publishedAt = body.publishedAt === undefined ? p.published_at : publishedAtOf(body.publishedAt, campaign, now);
  const url = body.url === undefined ? p.url : urlOf(body.url);
  const note = body.note === undefined ? p.note : body.note === null ? "" : text(body.note, "note", 0, 1000);
  const requestedTier = body.requestedTier === undefined ? p.requested_tier : oneOf(body.requestedTier, TIERS, "requestedTier");
  const evidenceIds = evidenceIdsOf(body.evidenceIds);
  if (!url && !evidenceIds.length) {
    const kept = await db.prepare("SELECT count(*) AS n FROM share_evidence WHERE placement_id = ? AND purged_at IS NULL").bind(id).first<number>("n");
    if (!kept) invalid("evidence");
  }

  const before = { location: p.location, publishedAt: p.published_at, url: p.url, note: p.note, requestedTier: p.requested_tier, version: p.version };
  const after = { location, publishedAt, url, note, requestedTier, version: p.version + 1, evidenceIds };
  try {
    await db.batch([
      db.prepare(
        "UPDATE share_placements SET location = ?, location_key = ?, published_at = ?, url = ?, note = ?, requested_tier = ?, review_status = 'resubmitted', version = version + 1, updated_at = ? WHERE id = ? AND review_status = 'needs_info' AND version = ?",
      ).bind(location, locationKey(p.platform, location, url), publishedAt, url, note, requestedTier, now, id, p.version),
      unlessChanged(db, "share_not_editable"),
      ...attachEvidence(db, member.id, id, evidenceIds, now),
      auditStmt(db, { subjectKind: "share_placement", subjectId: id, actorMemberId: member.id, actorKind: "human", action: "resubmit", before, after, operationId, now }),
    ]);
  } catch (e) {
    const again = await priorPlacement(db, member.id, operationId, "resubmit", id);
    if (again) return result(db, member.id, again);
    guardFailed(e);
  }
  return result(db, member.id, id);
}

// ---- 我的申請 -----------------------------------------------------------------

export type PayoutState = "none" | "awaiting" | "processing" | "queued" | "paid";
export type PlacementView = {
  id: string; platform: string; location: string; url: string | null; publishedAt: number; requestedTier: Tier; approvedTier: Tier | null;
  reviewStatus: string; reviewReason: string | null; evidence: { id: string }[]; createdAt: number;
};
export type ContentView = {
  id: string; campaignSlug: string; title: string; cardId: number | null; shareCode: string;
  approvedTier: Tier | null; approvedAmount: number; paidTotal: number; payoutState: PayoutState; placements: PlacementView[];
};

type ContentRow = { id: string; campaign_id: string; slug: string; tiers: string; extra_placement_amount: number | null; light_limit: number | null; timezone: string | null; title: string; card_id: number | null; share_code: string };
type PRow = { id: string; content_id: string; platform: string; location: string; url: string | null; published_at: number; requested_tier: Tier; approved_tier: Tier | null; review_status: string; review_reason: string | null; counts_as_placement: number; created_at: number };
type PayRow = { content_id: string; status: string; amount: number };

/** 發放狀態，依序判斷：排隊 → 處理中（含最新一筆失敗且還有得發）→ 沒有可發 → 待發放 → 已發放。 */
function payoutStateOf(payouts: PayRow[], target: number, due: number): PayoutState {
  if (payouts.some((x) => x.status === "blocked_insufficient")) return "queued";
  if (payouts.some((x) => x.status === "pending") || (payouts[0]?.status === "failed" && due > 0)) return "processing";
  if (target === 0) return "none";
  return due > 0 ? "awaiting" : "paid";
}

/**
 * 本人的內容與位置。只回申請人該看的：不回點數池、審核員、Provider 的錯誤、收款帳號；理由只在補件或駁回時回。
 * filter.contentId 給提交／重送的回應用。
 */
export async function myContents(db: D1Database, memberId: string, filter: { slug?: string; contentId?: string }): Promise<ContentView[]> {
  const contents = (await db.prepare(
    `SELECT s.id, s.campaign_id, c.slug, c.tiers, c.extra_placement_amount, c.light_limit, c.timezone, s.title, s.card_id, s.share_code FROM share_contents s JOIN campaigns c ON c.id = s.campaign_id
     WHERE s.member_id = ?1 AND (?2 IS NULL OR c.slug = ?2) AND (?3 IS NULL OR s.id = ?3) ORDER BY s.created_at DESC, s.id`,
  ).bind(memberId, filter.slug ?? null, filter.contentId ?? null).all<ContentRow>()).results;
  if (!contents.length) return [];
  const ids = JSON.stringify(contents.map((x) => x.id));
  const [placements, evidence, payouts] = await db.batch([
    db.prepare(`SELECT id, content_id, platform, location, url, published_at, requested_tier, approved_tier, review_status, review_reason, counts_as_placement, created_at
                FROM share_placements WHERE content_id IN (SELECT value FROM json_each(?)) ORDER BY created_at, id`).bind(ids),
    db.prepare(`SELECT e.id, e.placement_id FROM share_evidence e JOIN share_placements p ON p.id = e.placement_id
                WHERE p.content_id IN (SELECT value FROM json_each(?)) AND e.purged_at IS NULL ORDER BY e.created_at, e.id`).bind(ids),
    // 新的在前：payoutStateOf 看第一筆判斷「最新一筆」。
    db.prepare("SELECT content_id, status, amount FROM share_payouts WHERE content_id IN (SELECT value FROM json_each(?)) ORDER BY created_at DESC, id DESC").bind(ids),
  ]);
  const shots = groupBy(evidence!.results as { id: string; placement_id: string }[], (e) => e.placement_id);
  const byContent = groupBy(placements!.results as PRow[], (p) => p.content_id);
  const paysOf = groupBy(payouts!.results as PayRow[], (p) => p.content_id);
  // 群聊分享每週上限：照活動分開算（同一個人可能參加好幾個活動）
  const caps = new Map<string, number>();
  for (const c of new Map(contents.map((x) => [x.campaign_id, x])).values()) {
    for (const [k, v] of await memberLightCaps(db, { id: c.campaign_id, lightLimit: c.light_limit, timezone: c.timezone }, [memberId])) caps.set(k, v);
  }
  return contents.map((s) => {
    const ps = byContent.get(s.id) ?? [];
    const pays = paysOf.get(s.id) ?? [];
    const paidTotal = pays.filter((x) => x.status === "paid").reduce((a, x) => a + x.amount, 0);
    const { tier, target, due } = payoutAmount(
      ps.map((p) => ({ reviewStatus: p.review_status, approvedTier: p.approved_tier, countsAsPlacement: !!p.counts_as_placement })),
      { tiers: JSON.parse(s.tiers), extraPlacementAmount: s.extra_placement_amount }, paidTotal, caps.get(s.id),
    );
    return {
      id: s.id, campaignSlug: s.slug, title: s.title, cardId: s.card_id, shareCode: s.share_code,
      approvedTier: tier, approvedAmount: target, paidTotal, payoutState: payoutStateOf(pays, target, due),
      placements: ps.map((p) => ({
        id: p.id, platform: p.platform, location: p.location, url: p.url, publishedAt: p.published_at, requestedTier: p.requested_tier, approvedTier: p.approved_tier,
        reviewStatus: p.review_status, reviewReason: p.review_status === "needs_info" || p.review_status === "rejected" ? p.review_reason : null,
        evidence: (shots.get(p.id) ?? []).map((e) => ({ id: e.id })), createdAt: p.created_at,
      })),
    };
  });
}

const groupBy = <T>(rows: T[], key: (r: T) => string) => {
  const m = new Map<string, T[]>();
  for (const r of rows) m.set(key(r), [...(m.get(key(r)) ?? []), r]);
  return m;
};

async function result(db: D1Database, memberId: string, placementId: string): Promise<ApplyResult> {
  const [content] = await myContents(db, memberId, { contentId: await contentOf(db, placementId) });
  return { placementId, content: content! };
}
