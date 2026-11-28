import { claim, CLAIM_TTL_MS, EARLIER_DECIDED, release, RETAIN_MS, stamp } from "./review";
import { aiStateOf } from "./review-two-stage";
import { currentCriteria } from "./review-ai";
import { reviewEventStatement } from "./review-v2";
import { bumpOp } from "./ops-metrics";
import { HttpError, type Env } from "./types";

/**
 * AI 審卡快速通道（任務 2026-11-25-ai-review-fast-track，owner 2026-11-25）：
 * 旗標符合目前判準時，擴大到新卡與更新。旗標關閉時沿用已上架且分級未變的更新路徑。
 * 兩條路徑都需要目前判準的通過和無審核標記，並保留人工領取、字數及出版狀態守衛。
 *
 * - 觸發：審卡員寫下結論（PUT /v1/review-ai/submissions/:id/suggestion，待審單）之後立刻判一次。
 *   不符合就什麼都不做，單子照舊留在人工佇列；AI 沒判、交人、逾時、出錯也一樣留著。
 * - 核准走人工核准同一條路：系統身分先領取（跟審核員一樣，領取有效期內別人領不到），再用那一次領取蓋章（stamp）。
 *   上架、作者通知、更新通知、獎勵、分級下限全照一般核准；資料庫的領取、冷凍、不受理守衛照樣擋。
 * - 系統身分：FAST_TRACK_ACTOR 是固定字串，不是 UUID，不會跟任何成員撞號；不在成員表也不在審核員表，
 *   所以不能登入、不能用任何審核員路由。它的章在審核紀錄、詳情頁標成「AI 快速通道」。
 * - 章數：快速通道這一章本身就足額（stamp 的 final.system），之後 STAMPS_REQUIRED 調高也一樣。
 * - 撤回：管理員對這張單用一般的改判（approved → rejected，review-correction.ts）：這次更新改為駁回、
 *   上架版本退回前一個核准版本、作者收到駁回通知。審核員沒蓋這一章，所以只有管理員能改判。
 * - 安全部門看已上架版本，不看審核佇列（owner 確認），自動放行不需要對接。
 */
export const FAST_TRACK_ACTOR = "system:ai-fast-track";
export const FAST_TRACK_SOURCE = "ai_fast_track";

export type FastTrackOutcome = "approved" | "ineligible_status" | "ineligible_rating" | "ineligible_flags" | "ineligible_verdict" | "skipped_decided" | "error";
/** 通過了結構條件（卡片狀態、分級、流程）的結果：報表的自動通過率以它為分母 */
export const FAST_TRACK_ELIGIBLE: readonly FastTrackOutcome[] = ["approved", "ineligible_verdict", "ineligible_flags"];

interface Row {
  status: string; kind: string; card_id: number; flip_of: string | null; reopen_of: string | null; claimed_by: string | null; claimed_at: number | null;
  rating: string | null; rating_descriptors: string | null;
  stamped: number; decided: number; held: number; dropped: number; drop_case_open: number; after_drop: number; previous_status: string | null;
  card_status: string; approved_version_id: string | null; public_blocked: number; board_hidden: number; live_rating: string | null; live_descriptors: string | null;
  candidate_pending: number; live_state: string | null; live_submission_status: string | null; version_blocked: number; open_case: number; correcting: number; restricted: number;
}

/**
 * 資格（全部成立才走）。順序固定：人工已處理 → 卡片與流程 → 分級 → AI 結論 → 審核標記。
 * 結構條件（前三項）的 SQL：
 *   - 單子待審、沒有任何審核章、沒有託管核准決定、沒有人在有效期內領著；
 *   - 不是改判單、重新審核單；卡沒冷凍、單沒在不受理中、這張卡沒有還開著的不受理案件、不是不受理後改版重送；
 *   - 上次定案為駁回的改稿重送由人工處理；擴大通道也檢查這次的封存版本和託管發布許可；
 *   - 卡片目前已核准上架：cards.status='approved'、有上架版本、上架版本的單仍是通過、版本狀態 approved；
 *     沒被隱藏或封鎖（board_hidden、public_blocked）、上架版本沒被處置封鎖、沒有開著的處置案件、
 *     上架那張單沒有進行中的改判；託管作品是公開、沒有限制、同步完成；
 *   - 舊通道才要求分級與內容標示一致；擴大通道照一般核准路徑處理分級。
 */
const previousStatus = () => `(SELECT p.status FROM review_submissions p WHERE ${EARLIER_DECIDED("p", "s")} ORDER BY p.submitted_at DESC, p.rowid DESC LIMIT 1)`;
const PENDING_PUBLICATION = `EXISTS(SELECT 1 FROM hosting_versions v WHERE v.submission_id=s.id AND v.state='pending'
  AND NOT EXISTS(SELECT 1 FROM managed_work_access m WHERE m.work_id=v.work_id
    AND NOT EXISTS(SELECT 1 FROM work_publication_permits g WHERE g.version_id=v.version_id AND g.state='prepared' AND g.epoch=m.epoch)))`;

async function loadRow(db: D1Database, submissionId: string): Promise<Row | null> {
  return db.prepare(`SELECT s.status, s.kind, s.card_id, s.flip_of, s.reopen_of, s.claimed_by, s.claimed_at, s.rating, s.rating_descriptors,
      EXISTS(SELECT 1 FROM review_stamps st WHERE st.submission_id=s.id) AS stamped,
      EXISTS(SELECT 1 FROM work_review_decisions d WHERE d.submission_id=s.id) AS decided,
      EXISTS(SELECT 1 FROM review_holds h WHERE h.card_id=s.card_id) AS held,
      EXISTS(SELECT 1 FROM review_drops d WHERE d.submission_id=s.id AND d.restored_at IS NULL) AS dropped,
      EXISTS(SELECT 1 FROM review_drop_cases k WHERE k.card_id=s.card_id AND k.closed_at IS NULL) AS drop_case_open,
      COALESCE((SELECT f.after_drop FROM review_submission_features f WHERE f.submission_id=s.id), 0) AS after_drop,
      ${previousStatus()} AS previous_status,
      c.status AS card_status, c.approved_version_id, c.public_blocked, c.board_hidden, c.rating AS live_rating, c.rating_descriptors AS live_descriptors,
      lv.state AS live_state, ls.status AS live_submission_status,
      ${PENDING_PUBLICATION} AND NOT EXISTS(SELECT 1 FROM hosting_versions v JOIN moderation_blocked_versions b
        ON b.version_id=v.version_id WHERE v.submission_id=s.id) AS candidate_pending,
      EXISTS(SELECT 1 FROM moderation_blocked_versions b WHERE b.version_id=c.approved_version_id) AS version_blocked,
      EXISTS(SELECT 1 FROM moderation_cases m WHERE m.provider=c.provider AND m.source_role_id=c.source_role_id AND m.status IN ('pending','disputed')) AS open_case,
      EXISTS(SELECT 1 FROM review_corrections x WHERE x.submission_id=ls.id AND x.state IN ('pending','applying')) AS correcting,
      EXISTS(SELECT 1 FROM managed_work_access p WHERE p.provider=c.provider AND p.source_role_id=c.source_role_id
        AND ((c.approved_version_id IS NOT NULL AND p.access<>'public') OR p.restriction<>'none' OR p.sync_state<>'complete')) AS restricted
    FROM review_submissions s JOIN cards c ON c.id=s.card_id
    LEFT JOIN hosting_versions lv ON lv.version_id=c.approved_version_id
    LEFT JOIN review_submissions ls ON ls.id=lv.submission_id
    WHERE s.id=?`).bind(submissionId).first<Row>();
}

const descriptorSet = (raw: string | null): string[] | null => {
  if (raw === null || raw === "") return [];
  try { const v = JSON.parse(raw); return Array.isArray(v) && v.every((x) => typeof x === "string") ? [...new Set(v as string[])].sort() : null; } catch { return null; }
};
const sameDescriptors = (a: string | null, b: string | null) => {
  const x = descriptorSet(a), y = descriptorSet(b);
  return x !== null && y !== null && x.length === y.length && x.every((v, i) => v === y[i]);
};

/** self：系統自己已經領著（領取後的重新檢查），自己的領取不算「人工在處理」 */
function structural(r: Row, now: number, expanded: boolean, self = false): FastTrackOutcome | null {
  const claimedLive = !!r.claimed_by && r.claimed_at !== null && now - r.claimed_at < CLAIM_TTL_MS && !(self && r.claimed_by === FAST_TRACK_ACTOR);
  if (r.status !== "pending" || r.stamped || r.decided || claimedLive) return "skipped_decided";
  if (r.flip_of || r.reopen_of || r.held || r.dropped || r.drop_case_open || r.after_drop) return "ineligible_status";
  if (r.public_blocked || r.board_hidden || r.version_blocked || r.open_case || r.correcting || r.restricted) return "ineligible_status";
  if (r.previous_status === "rejected" || (expanded && (!r.candidate_pending || !r.rating))) return "ineligible_status";
  if (expanded && r.kind === "first" && !r.approved_version_id && r.card_status === "pending") return null;
  if (r.card_status !== "approved" || !r.approved_version_id || r.live_state !== "approved" || r.live_submission_status !== "approved") return "ineligible_status";
  if (!expanded && r.previous_status !== "approved") return "ineligible_status";
  if (!expanded && (!r.rating || r.rating !== r.live_rating || !sameDescriptors(r.rating_descriptors, r.live_descriptors))) return "ineligible_rating";
  return null;
}

/**
 * 審卡員剛寫下結論後判一次快速通道。不丟錯：任何失敗都記成 error，單子留在人工佇列。
 * trigger＝剛寫下的那筆建議（編號與更新時間），每一筆結論只記一次判定事件。
 */
export async function tryFastTrack(env: Env, submissionId: string, trigger: { suggestionId: string; at: number }, now = Date.now()): Promise<FastTrackOutcome> {
  const db = env.DB;
  let outcome: FastTrackOutcome;
  let row: Row | null = null;
  let expanded = false;
  // 核准時判定事件跟蓋章同一批寫（recorded）：報表的核准數不會超過分母
  let recorded = false;
  try {
    row = await loadRow(db, submissionId);
    if (!row) return "skipped_decided";
    const criteria = await currentCriteria(db);
    expanded = !!criteria && env.REVIEW_AI_AUTO_APPROVE_CRITERIA === criteria;
    outcome = structural(row, now, expanded) ?? await verdictGate(db, submissionId, trigger, criteria);
    if (outcome === "approved") ({ outcome, recorded } = await approve(env, submissionId, trigger, now, expanded));
  } catch (error) {
    outcome = "error";
    console.error("AI 快速通道判定失敗", error instanceof HttpError ? error.status : "internal");
  }
  if (row && !recorded) {
    try {
      const { meta } = await checkEvent(db, submissionId, row.card_id, trigger, outcome, now).run();
      if (expanded && meta.changes && outcome !== "skipped_decided") {
        await bumpOp(db, "review_ai_auto_approve", row.kind === "first" ? "new_card" : "update", "manual");
      }
    } catch { console.error("AI 快速通道判定事件寫入失敗"); }
  }
  await bumpOp(db, "review_fast_track", "evaluate", outcome);
  return outcome;
}

/** 每次判定一筆系統事件（source＝結果），報表的分母從這裡算；同一筆 AI 結論只記一次 */
const checkEvent = (db: D1Database, submissionId: string, cardId: number, trigger: { suggestionId: string; at: number }, outcome: FastTrackOutcome, now: number) =>
  reviewEventStatement(db, {
    key: `fast_track:${submissionId}:${trigger.suggestionId}:${trigger.at}`, submissionId, cardId, at: now, action: "fast_track_check",
    actorKind: "system", source: outcome, aiSuggestionId: trigger.suggestionId,
  });

/**
 * AI 結論：目前判準版本（必須有）最新的一筆是「通過」、沒有審核標記；而且同一判準版本裡，任何審卡員對這張單
 * 都沒有判過不通過或交人、沒有打過標記（之後多一個審卡員時，任一個有疑慮就交人工）。
 */
async function verdictGate(db: D1Database, submissionId: string, trigger: { suggestionId: string; at: number }, current: string | null): Promise<FastTrackOutcome> {
  const ai = await aiStateOf(db, submissionId);
  if (!current || ai.state !== "ready" || ai.suggestion.criteriaVersion !== current || ai.suggestion.verdict !== "pass"
    || ai.suggestion.id !== trigger.suggestionId || ai.suggestion.at !== trigger.at) return "ineligible_verdict";
  if (ai.suggestion.flags.length) return "ineligible_flags";
  const any = await db.prepare(`SELECT COALESCE(MAX(verdict IS NOT NULL AND verdict<>'pass'), 0) AS doubt, COALESCE(MAX(json_array_length(flags) > 0), 0) AS flagged
    FROM review_ai_suggestions WHERE submission_id=? AND criteria_version=?`).bind(submissionId, current).first<{ doubt: number; flagged: number }>();
  if (any?.doubt) return "ineligible_verdict";
  if (any?.flagged) return "ineligible_flags";
  return "approved";
}

/** 測試用的接縫：領取之後、蓋章那一批之前插入動作（模擬這段時間裡卡片被處置或 Worker 出錯） */
export const fastTrackSeams: { afterClaim: ((submissionId: string) => Promise<void>) | null; beforeStamp: ((submissionId: string) => Promise<void>) | null } = { afterClaim: null, beforeStamp: null };

/**
 * 系統的領取一寫下去就已經「領了 44 分鐘」：Worker 在領取與蓋章之間掛掉時，一分鐘後領取就逾時，
 * 審核員不會被擋 45 分鐘。一般情況下沒核准的每條路都會在 finally 放回。
 */
const SYSTEM_CLAIM_WINDOW_MS = 60_000;

/** 核准交易再確認投稿、現行公開狀態與 AI 建議仍符合自動發布資格。 */
const eligibleAtWrite = () => `EXISTS(SELECT 1 FROM review_submissions s JOIN cards c ON c.id=s.card_id
  WHERE s.id=?1 AND s.status='pending' AND s.flip_of IS NULL AND s.reopen_of IS NULL
  AND c.status=?5 AND c.approved_version_id IS ?6 AND c.public_blocked=0 AND c.board_hidden=0
  AND s.rating IS ?7 AND s.rating_descriptors IS ?8
  AND (c.approved_version_id IS NULL OR EXISTS(SELECT 1 FROM hosting_versions v
    JOIN review_submissions p ON p.id=v.submission_id AND p.status='approved'
    WHERE v.version_id=c.approved_version_id AND v.state='approved'
    AND (?9 OR (c.rating IS ?10 AND c.rating_descriptors IS ?11))
    AND NOT EXISTS(SELECT 1 FROM review_corrections x WHERE x.submission_id=p.id AND x.state IN ('pending','applying'))))
  AND NOT EXISTS(SELECT 1 FROM moderation_blocked_versions b WHERE b.version_id=c.approved_version_id
    OR b.version_id=(SELECT v.version_id FROM hosting_versions v WHERE v.submission_id=s.id))
  AND ${previousStatus()} IS NOT 'rejected'
  AND (?9=0 OR ${PENDING_PUBLICATION})
  AND NOT EXISTS(SELECT 1 FROM moderation_cases m WHERE m.provider=c.provider AND m.source_role_id=c.source_role_id AND m.status IN ('pending','disputed'))
  AND NOT EXISTS(SELECT 1 FROM review_holds h WHERE h.card_id=s.card_id)
  AND NOT EXISTS(SELECT 1 FROM review_drop_cases d WHERE d.card_id=s.card_id AND d.closed_at IS NULL)
  AND NOT EXISTS(SELECT 1 FROM managed_work_access p WHERE p.provider=c.provider AND p.source_role_id=c.source_role_id
    AND ((c.approved_version_id IS NOT NULL AND p.access<>'public') OR p.restriction<>'none' OR p.sync_state<>'complete'))
  AND NOT EXISTS(SELECT 1 FROM community_settings WHERE key='review_ai_criteria' AND value<>json_quote(?12))
  AND EXISTS(SELECT 1 FROM review_ai_suggestions a WHERE a.id=?13 AND a.submission_id=s.id
    AND a.criteria_version=?12 AND a.updated_at=?14 AND a.verdict='pass' AND json_array_length(a.flags)=0)
  AND NOT EXISTS(SELECT 1 FROM review_ai_suggestions a WHERE a.submission_id=s.id AND a.criteria_version=?12
    AND ((a.verdict IS NOT NULL AND a.verdict<>'pass') OR json_array_length(a.flags)>0)))`;

async function approve(env: Env, submissionId: string, trigger: { suggestionId: string; at: number }, now: number, expanded: boolean): Promise<{ outcome: FastTrackOutcome; recorded: boolean }> {
  const db = env.DB;
  const no = (outcome: FastTrackOutcome) => ({ outcome, recorded: false });
  // 領取前再看一次 AI 結論：審卡員可能剛重判
  const ai = await aiStateOf(db, submissionId);
  if (ai.state !== "ready" || ai.suggestion.verdict !== "pass" || ai.suggestion.flags.length
    || ai.suggestion.id !== trigger.suggestionId || ai.suggestion.at !== trigger.at) return no("ineligible_verdict");
  let generation: string;
  try {
    generation = (await claim(db, submissionId, FAST_TRACK_ACTOR, now - CLAIM_TTL_MS + SYSTEM_CLAIM_WINDOW_MS)).claim_generation;
  } catch (error) {
    if (error instanceof HttpError && error.status === 409) return no("skipped_decided");
    throw error;
  }
  let approved = false;
  // 重新讀一次：領取之前判的結構條件，這段時間裡卡片可能被下架、封鎖、處置
  const recheck = async () => {
    const row = await loadRow(db, submissionId);
    return { row, denial: row ? structural(row, now, expanded, true) : "skipped_decided" as const };
  };
  try {
    await fastTrackSeams.afterClaim?.(submissionId);
    const { row, denial } = await recheck();
    if (!row || denial) return no(denial ?? "skipped_decided");
    await fastTrackSeams.beforeStamp?.(submissionId);
    const s = ai.suggestion;
    // 稽核跟蓋章同一批：附 AI 判定摘要（判準版本、理由代碼、審核標記、建議編號）。同一張單只會有一筆。
    // 它同時是這一批的守衛：這一刻若不再符合發布資格，actor_kind 寫成不合法的值，
    // CHECK 失敗讓整批（蓋章、核准、上架）一起不寫；D1 的 batch 不能 RAISE，用約束代替
    const audit = db.prepare(`INSERT INTO audit_log (id, subject_kind, subject_id, actor_member_id, actor_kind, action, reason, before_json, after_json, operation_id, created_at)
      SELECT ?2, 'review_submission', ?1, NULL, CASE WHEN ${eligibleAtWrite()} THEN 'ai' ELSE 'fast_track_guard_changed' END,
        'review_fast_track_approve', '', json_object('status', 'pending'), ?3, ?2, ?4
      WHERE EXISTS(SELECT 1 FROM review_submissions WHERE id=?1)
      ON CONFLICT(id) DO NOTHING`)
      .bind(submissionId, `fast-track:${submissionId}`,
        JSON.stringify({ criteriaVersion: s.criteriaVersion, reasons: s.reasons, flags: s.flags, suggestionId: s.id, model: s.model, finalSource: FAST_TRACK_SOURCE }), now, row.card_status, row.approved_version_id,
        row.rating, row.rating_descriptors, Number(expanded), row.live_rating, row.live_descriptors, s.criteriaVersion, s.id, s.at);
    try {
      await stamp(db, {
        submissionId, memberId: FAST_TRACK_ACTOR, verdict: "approve", note: "", now, generation,
        final: { source: FAST_TRACK_SOURCE, aiSuggestionId: s.id, aiNoteTypes: [], aiNote: "", retainMs: RETAIN_MS,
          system: { writes: [audit, checkEvent(db, submissionId, row.card_id, trigger, "approved", now)] } },
      }, env);
      approved = true;
      return { outcome: "approved", recorded: true };
    } catch (error) {
      // 託管作品：核准決定已經記下、只差同步完成（之後由排程補完）＝已核准
      if (await db.prepare("SELECT 1 FROM review_stamps WHERE submission_id = ? AND member_id = ?").bind(submissionId, FAST_TRACK_ACTOR).first()) {
        approved = true;
        return { outcome: "approved", recorded: true };
      }
      const { denial } = await recheck();
      if (denial) return no(denial);
      const verdict = await verdictGate(db, submissionId, trigger, await currentCriteria(db));
      if (verdict !== "approved") return no(verdict);
      if (error instanceof HttpError && error.status === 409) return no("skipped_decided");
      throw error;
    }
  } finally {
    if (!approved) await release(db, submissionId, FAST_TRACK_ACTOR, generation).catch(() => console.error("AI 快速通道放回領取失敗"));
  }
}

/** 報表：依判準版本，快速通道核准件數、符合結構條件的件數（分母）、核准後被撤回（改判為駁回）的件數。時間窗看送審時間。 */
export async function fastTrackStats(db: D1Database, input: { from: number; to: number; criteria?: string | null }) {
  const eligible = FAST_TRACK_ELIGIBLE.map((o) => `'${o}'`).join(",");
  const rows = await db.prepare(`SELECT a.criteria_version AS v,
      COUNT(DISTINCT CASE WHEN e.action='approve' AND e.final_source='${FAST_TRACK_SOURCE}' THEN s.id END) AS approved,
      COUNT(DISTINCT CASE WHEN e.action='fast_track_check' AND e.source IN (${eligible}) THEN s.id END) AS eligible,
      COUNT(DISTINCT CASE WHEN e.action='approve' AND e.final_source='${FAST_TRACK_SOURCE}'
        AND EXISTS(SELECT 1 FROM review_corrections x WHERE x.submission_id=s.id AND x.state='complete') THEN s.id END) AS revoked
    FROM review_events e JOIN review_ai_suggestions a ON a.id=e.ai_suggestion_id JOIN review_submissions s ON s.id=e.submission_id
    WHERE e.action IN ('approve','fast_track_check') AND (e.action='fast_track_check' OR e.final_source='${FAST_TRACK_SOURCE}')
      AND s.submitted_at>=?1 AND s.submitted_at<?2 AND (?3 IS NULL OR a.criteria_version=?3)
    GROUP BY a.criteria_version`).bind(input.from, input.to, input.criteria ?? null).all<{ v: string; approved: number; eligible: number; revoked: number }>();
  const out: Record<string, { approved: number; eligible: number; rate: number | null; revoked: number }> = {};
  for (const r of rows.results) out[r.v] = { approved: r.approved, eligible: r.eligible, rate: r.eligible ? r.approved / r.eligible : null, revoked: r.revoked };
  return out;
}
