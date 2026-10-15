import { auditStmtIfChanged, type ActorKind } from "./audit";
import { getCampaign, payoutAmount, TIERS, type Tier } from "./campaign";
import { HttpError } from "./types";

/**
 * 分享活動的審核端（開業活動設計 §4.3、§5）：佇列、內容明細與重複標示、審核決定與通知。
 * 真人審核員與 AI 帳號都可以用；actor_kind 由路由層的 staff() 推出，不由請求自報。
 * 重複標示只是提示，不擋決定；回應裡沒有成員 id 與收款帳號，別人只以 handle 出現。
 */
export type Reviewer = { memberId: string; kind: Exclude<ActorKind, "system"> };
export type Flags = { duplicateLocation: boolean; duplicateImage: boolean; burst: boolean };

const QUEUE_PAGE = 20;
const STATUSES = ["submitted", "resubmitted", "needs_info", "approved", "rejected"] as const;
const DAY = 86_400_000;
const invalid = (field: string): never => { throw new HttpError(400, "share_invalid", undefined, { field }); };

/**
 * 三種重複標示（p＝位置、s＝內容、c＝活動）：
 * 同內容裡 location_key 相同的其他位置；同雜湊且掛在其他位置的截圖（跨內容跨人）；
 * 本人在這個活動、這筆提交前 24 小時內（不含這筆）的提交數達到門檻（門檻 N 標第 N+1 筆，沒設門檻不標）。
 */
const FLAGS = `
  EXISTS (SELECT 1 FROM share_placements o WHERE o.content_id = p.content_id AND o.location_key = p.location_key AND o.id <> p.id) AS dup_location,
  EXISTS (SELECT 1 FROM share_evidence e JOIN share_evidence o ON o.sha256 = e.sha256 AND o.placement_id IS NOT NULL AND o.placement_id <> p.id WHERE e.placement_id = p.id) AS dup_image,
  (c.flag_burst_threshold IS NOT NULL AND (
    SELECT count(*) FROM share_placements q JOIN share_contents qs ON qs.id = q.content_id
    WHERE qs.member_id = s.member_id AND qs.campaign_id = s.campaign_id AND q.id <> p.id AND q.created_at BETWEEN p.created_at - ${DAY} AND p.created_at
  ) >= c.flag_burst_threshold) AS burst`;
type FlagRow = { dup_location: number; dup_image: number; burst: number };
const flagsOf = (r: FlagRow): Flags => ({ duplicateLocation: !!r.dup_location, duplicateImage: !!r.dup_image, burst: !!r.burst });

// ---- 佇列 ---------------------------------------------------------------------

type QueueRow = FlagRow & {
  id: string; content_id: string; title: string; slug: string; handle: string; platform: string; location: string; url: string | null; published_at: number;
  requested_tier: Tier; approved_tier: Tier | null; review_status: string; version: number; created_at: number; evidence_count: number;
};

/** 沒指定狀態時是待審與重送合併；一律舊的在前。 */
export async function reviewQueue(db: D1Database, q: { status?: string; slug?: string; page: number }) {
  if (q.status !== undefined && !(STATUSES as readonly string[]).includes(q.status)) invalid("status");
  const statuses = JSON.stringify(q.status ? [q.status] : ["submitted", "resubmitted"]);
  const from = `FROM share_placements p JOIN share_contents s ON s.id = p.content_id JOIN campaigns c ON c.id = s.campaign_id JOIN members m ON m.id = s.member_id
    WHERE p.review_status IN (SELECT value FROM json_each(?1)) AND (?2 IS NULL OR c.slug = ?2)`;
  const [total, rows] = await db.batch([
    db.prepare(`SELECT count(*) AS n ${from}`).bind(statuses, q.slug ?? null),
    db.prepare(`SELECT p.id, p.content_id, s.title, c.slug, m.handle, p.platform, p.location, p.url, p.published_at, p.requested_tier, p.approved_tier, p.review_status, p.version, p.created_at,
      (SELECT count(*) FROM share_evidence e WHERE e.placement_id = p.id AND e.purged_at IS NULL) AS evidence_count, ${FLAGS}
      ${from} ORDER BY p.created_at, p.id LIMIT ?3 OFFSET ?4`).bind(statuses, q.slug ?? null, QUEUE_PAGE, (q.page - 1) * QUEUE_PAGE),
  ]);
  return {
    total: (total!.results[0] as { n: number }).n,
    items: (rows!.results as QueueRow[]).map((r) => ({
      id: r.id, contentId: r.content_id, contentTitle: r.title, campaignSlug: r.slug, applicant: { handle: r.handle },
      platform: r.platform, location: r.location, url: r.url, publishedAt: r.published_at, requestedTier: r.requested_tier, approvedTier: r.approved_tier,
      reviewStatus: r.review_status, version: r.version, createdAt: r.created_at, evidenceCount: r.evidence_count, flags: flagsOf(r),
    })),
  };
}

// ---- 內容明細 -----------------------------------------------------------------

type ContentRow = { id: string; campaign_id: string; member_id: string; slug: string; tiers: string; extra_placement_amount: number | null; title: string; card_id: number | null; share_code: string; created_at: number; handle: string };
type PRow = FlagRow & {
  id: string; platform: string; location: string; location_key: string; url: string | null; published_at: number; note: string; requested_tier: Tier; approved_tier: Tier | null;
  review_status: string; review_reason: string | null; reviewed_kind: string | null; reviewed_at: number | null; counts_as_placement: number; version: number; created_at: number;
};

export async function contentDetail(db: D1Database, id: string) {
  const s = await db.prepare(
    "SELECT s.id, s.campaign_id, s.member_id, c.slug, c.tiers, c.extra_placement_amount, s.title, s.card_id, s.share_code, s.created_at, m.handle FROM share_contents s JOIN campaigns c ON c.id = s.campaign_id JOIN members m ON m.id = s.member_id WHERE s.id = ?",
  ).bind(id).first<ContentRow>();
  if (!s) throw new HttpError(404, "share_content_not_found");
  const [placements, evidence, images, payouts, history] = await db.batch([
    db.prepare(`SELECT p.id, p.platform, p.location, p.location_key, p.url, p.published_at, p.note, p.requested_tier, p.approved_tier, p.review_status, p.review_reason,
      p.reviewed_kind, p.reviewed_at, p.counts_as_placement, p.version, p.created_at, ${FLAGS}
      FROM share_placements p JOIN share_contents s ON s.id = p.content_id JOIN campaigns c ON c.id = s.campaign_id WHERE p.content_id = ? ORDER BY p.created_at, p.id`).bind(id),
    db.prepare("SELECT e.id, e.placement_id, e.purged_at FROM share_evidence e JOIN share_placements p ON p.id = e.placement_id WHERE p.content_id = ? ORDER BY e.created_at, e.id").bind(id),
    // 同雜湊的截圖掛在哪個別的位置：只回對方的內容 id 與申請人 handle。
    db.prepare(`SELECT DISTINCT e.placement_id, os.id AS content_id, om.handle FROM share_evidence e JOIN share_placements p ON p.id = e.placement_id
      JOIN share_evidence o ON o.sha256 = e.sha256 AND o.placement_id IS NOT NULL AND o.placement_id <> e.placement_id
      JOIN share_placements op ON op.id = o.placement_id JOIN share_contents os ON os.id = op.content_id JOIN members om ON om.id = os.member_id
      WHERE p.content_id = ? ORDER BY os.id`).bind(id),
    db.prepare("SELECT id, amount, target_total, status, attempts, error, created_at, settled_at FROM share_payouts WHERE content_id = ? ORDER BY created_at DESC, id DESC").bind(id),
    db.prepare(`SELECT x.id, x.title, x.created_at, (SELECT COALESCE(sum(amount), 0) FROM share_payouts WHERE content_id = x.id AND status = 'paid') AS paid_total
      FROM share_contents x WHERE x.member_id = ? AND x.campaign_id = ? AND x.id <> ? ORDER BY x.created_at DESC, x.id`).bind(s.member_id, s.campaign_id, id),
  ]);
  const ps = placements!.results as PRow[];
  const shots = evidence!.results as { id: string; placement_id: string; purged_at: number | null }[];
  const dupImages = images!.results as { placement_id: string; content_id: string; handle: string }[];
  type PayRow = { id: string; amount: number; target_total: number; status: string; attempts: number; error: string | null; created_at: number; settled_at: number | null };
  const pays = payouts!.results as PayRow[];
  const paidTotal = pays.filter((x) => x.status === "paid").reduce((a, x) => a + x.amount, 0);
  return {
    content: { id: s.id, campaignSlug: s.slug, title: s.title, cardId: s.card_id, shareCode: s.share_code, applicant: { handle: s.handle }, createdAt: s.created_at },
    placements: ps.map((p) => ({
      id: p.id, platform: p.platform, location: p.location, locationKey: p.location_key, url: p.url, publishedAt: p.published_at, note: p.note,
      requestedTier: p.requested_tier, approvedTier: p.approved_tier, reviewStatus: p.review_status, reviewReason: p.review_reason,
      reviewedKind: p.reviewed_kind, reviewedAt: p.reviewed_at, countsAsPlacement: !!p.counts_as_placement, version: p.version, createdAt: p.created_at,
      evidence: shots.filter((e) => e.placement_id === p.id).map((e) => ({ id: e.id, purged: e.purged_at !== null })),
      flags: flagsOf(p),
      duplicates: {
        location: ps.filter((o) => o.id !== p.id && o.location_key === p.location_key).map((o) => o.id),
        image: dupImages.filter((d) => d.placement_id === p.id).map((d) => ({ contentId: d.content_id, handle: d.handle })),
      },
    })),
    payout: payoutAmount(
      ps.map((p) => ({ reviewStatus: p.review_status, approvedTier: p.approved_tier, countsAsPlacement: !!p.counts_as_placement })),
      { tiers: JSON.parse(s.tiers), extraPlacementAmount: s.extra_placement_amount }, paidTotal,
    ),
    paidTotal,
    payouts: pays.map((x) => ({ id: x.id, amount: x.amount, targetTotal: x.target_total, status: x.status, attempts: x.attempts, error: x.error, createdAt: x.created_at, settledAt: x.settled_at })),
    history: (history!.results as { id: string; title: string; created_at: number; paid_total: number }[]).map((x) => ({ id: x.id, title: x.title, createdAt: x.created_at, paidTotal: x.paid_total })),
  };
}

// ---- 決定 ---------------------------------------------------------------------

export type Decision = "approve" | "reject" | "needs_info";
type DRow = {
  id: string; member_id: string; campaign_id: string; requested_tier: Tier; approved_tier: Tier | null; review_status: string; review_reason: string | null;
  reviewed_kind: string | null; reviewed_at: number | null; counts_as_placement: number; version: number;
};
const DECIDE_ROW = `SELECT p.id, s.member_id, s.campaign_id, p.requested_tier, p.approved_tier, p.review_status, p.review_reason, p.reviewed_kind, p.reviewed_at, p.counts_as_placement, p.version
  FROM share_placements p JOIN share_contents s ON s.id = p.content_id WHERE p.id = ?`;

/** 每種決定可以從哪些狀態做：已核准只能再核准（改檔位或是否算位置）；已拒絕不能再改；等補件的可以直接核准或拒絕。 */
const FROM: Record<Decision, readonly string[]> = {
  approve: ["submitted", "resubmitted", "needs_info", "approved"],
  reject: ["submitted", "resubmitted", "needs_info"],
  needs_info: ["submitted", "resubmitted"],
};
const STATUS_OF: Record<Decision, string> = { approve: "approved", reject: "rejected", needs_info: "needs_info" };
const NOTICE_OF: Record<Decision, string> = { approve: "share_approved", reject: "share_rejected", needs_info: "share_needs_info" };

const view = (r: DRow) => ({
  id: r.id, reviewStatus: r.review_status, approvedTier: r.approved_tier, countsAsPlacement: !!r.counts_as_placement, reviewReason: r.review_reason,
  reviewedKind: r.reviewed_kind, reviewedAt: r.reviewed_at, version: r.version,
});
export type DecisionResult = { placement: ReturnType<typeof view>; payout: null };
const current = async (db: D1Database, id: string): Promise<DecisionResult> => ({ placement: view((await db.prepare(DECIDE_ROW).bind(id).first<DRow>())!), payout: null });

/** 這個操作編號這個人用過：是同一個位置的決定就回目前狀態，否則是衝突。 */
async function replayed(db: D1Database, actorId: string, operationId: string, placementId: string): Promise<boolean> {
  const r = await db.prepare("SELECT subject_kind, subject_id, action FROM audit_log WHERE actor_member_id = ? AND operation_id = ?").bind(actorId, operationId).first<{ subject_kind: string; subject_id: string; action: string }>();
  if (!r) return false;
  if (r.subject_kind !== "share_placement" || r.action !== "decide" || r.subject_id !== placementId) throw new HttpError(409, "campaign_operation_repeated");
  return true;
}

/**
 * 審核決定。條件式 UPDATE（版本與狀態都要符合）→ 稽核（changes() 串接）→ 通知（以這一次的稽核列存在為條件），同一個 batch：
 * 並發的第二個決定改不到列，什麼都不寫，回 409 share_version_conflict。發放由 Task 6 接上，這裡 payout 一律 null。
 * 指標（decide 的成功／被拒／出錯）由路由依狀態碼記。
 */
export async function decidePlacement(db: D1Database, id: string, actor: Reviewer, body: Record<string, unknown>, operationId: string, now: number): Promise<DecisionResult> {
  const decision = body.decision as Decision;
  if (!Object.hasOwn(FROM, decision)) invalid("decision");
  if (!Number.isSafeInteger(body.expectedVersion)) invalid("expectedVersion");
  const reason = body.reason === undefined || body.reason === null ? "" : typeof body.reason === "string" ? body.reason.trim() : invalid("reason");
  if (reason.length > 500 || (decision !== "approve" && !reason)) invalid("reason");
  if (decision === "approve" && body.tier !== undefined && !(TIERS as readonly unknown[]).includes(body.tier)) invalid("tier");
  if (decision === "approve" && body.countsAsPlacement !== undefined && typeof body.countsAsPlacement !== "boolean") invalid("countsAsPlacement");

  if (await replayed(db, actor.memberId, operationId, id)) return current(db, id);
  const p = await db.prepare(DECIDE_ROW).bind(id).first<DRow>();
  if (!p) throw new HttpError(404, "share_placement_not_found");
  if (p.member_id === actor.memberId) throw new HttpError(403, "share_self_review");
  if (p.version !== body.expectedVersion) throw new HttpError(409, "share_version_conflict", undefined, { version: p.version });
  if (!FROM[decision].includes(p.review_status)) throw new HttpError(409, "share_already_decided");
  if (decision === "needs_info") {
    const campaign = (await getCampaign(db, p.campaign_id))!;
    if (campaign.submitDeadline !== null && now >= campaign.submitDeadline) throw new HttpError(409, "campaign_submit_closed");
  }

  const tier: Tier | null = decision === "approve" ? ((body.tier as Tier | undefined) ?? p.approved_tier ?? p.requested_tier) : null;
  const counts = decision === "approve" && typeof body.countsAsPlacement === "boolean" ? Number(body.countsAsPlacement) : p.counts_as_placement;
  const regrade = p.review_status === "approved";
  // 已核准再核准、檔位與是否算位置都沒變：沒有要寫的。
  if (regrade && tier === p.approved_tier && counts === p.counts_as_placement) return { placement: view(p), payout: null };

  const status = STATUS_OF[decision];
  const version = p.version + 1;
  const before = { reviewStatus: p.review_status, approvedTier: p.approved_tier, countsAsPlacement: !!p.counts_as_placement, reviewReason: p.review_reason, version: p.version };
  const after = { reviewStatus: status, approvedTier: tier, countsAsPlacement: !!counts, reviewReason: reason || null, version };
  const auditId = crypto.randomUUID();
  const writes = [
    db.prepare(
      `UPDATE share_placements SET review_status = ?, approved_tier = ?, counts_as_placement = ?, review_reason = ?, reviewed_by = ?, reviewed_kind = ?, reviewed_at = ?, version = version + 1, updated_at = ?
       WHERE id = ? AND version = ? AND review_status IN (SELECT value FROM json_each(?))`,
    ).bind(status, tier, counts, reason || null, actor.memberId, actor.kind, now, now, id, p.version, JSON.stringify(FROM[decision])),
    auditStmtIfChanged(db, { id: auditId, subjectKind: "share_placement", subjectId: id, actorMemberId: actor.memberId, actorKind: actor.kind, action: "decide", reason, before, after, operationId, now }),
  ];
  // 改檔位不再通知一次「通過了」。理由只給補件與拒絕；不放金額、檔位或點數池。
  if (!regrade) {
    writes.push(db.prepare(
      `INSERT OR IGNORE INTO community_notifications (event_key, member_id, kind, path, created_at, extra, delivered)
       SELECT ?, ?, ?, '/me/campaign', ?, ?, 1 WHERE EXISTS (SELECT 1 FROM audit_log WHERE id = ?)
       AND NOT EXISTS (SELECT 1 FROM community_preferences pr WHERE pr.member_id = ? AND pr.notifications = 0)`,
    ).bind(`share:${id}:${version}:${NOTICE_OF[decision]}`, p.member_id, NOTICE_OF[decision], now, decision === "approve" ? null : JSON.stringify({ reason }), auditId, p.member_id));
  }

  let changed = 0;
  try {
    changed = (await db.batch(writes))[0]!.meta.changes;
  } catch (e) {
    // 並發的同一次重試輸在稽核唯一鍵：已經做過就回目前狀態。
    if (await replayed(db, actor.memberId, operationId, id)) return current(db, id);
    throw e;
  }
  if (!changed) {
    if (await replayed(db, actor.memberId, operationId, id)) return current(db, id);
    const v = await db.prepare("SELECT version FROM share_placements WHERE id = ?").bind(id).first<number>("version");
    throw new HttpError(409, "share_version_conflict", undefined, { version: v });
  }
  return current(db, id);
}
