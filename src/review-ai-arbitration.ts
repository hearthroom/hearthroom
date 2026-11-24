import { parseReviewReasons } from "../shared/review-reasons";
import { HttpError } from "./types";
import { LATEST_FEEDBACK } from "./review-ai";
import { parseAiNote } from "./review-two-stage";
import { RETAIN_MS } from "./review";

/**
 * AI 分歧仲裁（owner 2026-11-23 22:22）：只看人工與 AI 結論相反的單，由管理員判誰對。
 * 仲裁不改原決定、不通知作者；可重新仲裁，統計取每筆建議最後一次。勾「加入參考範例」的會進下一版判準的參考樣本草稿。
 */

export const ARBITRATION_VALUES = ["human_right", "ai_right", "both_ok", "both_wrong"] as const;
export type ArbitrationValue = (typeof ARBITRATION_VALUES)[number];
export type Direction = "ai_stricter" | "human_stricter";
export const NOTE_MAX = 500;

/**
 * 人工那邊的結論：只認通過、駁回。不受理中的單還是待審（隨時可能被復原再審），不算有結論，
 * 否則管理員會在別人審之前從這裡看到 AI 的判斷。
 */
const HUMAN = `CASE WHEN s.status IN ('approved','rejected') THEN s.status END`;
/** 現在的分歧：人過 AI 不過（AI 較嚴），或人不過 AI 過（人較嚴）。交人、沒結論的不算。 */
const LIVE = `CASE WHEN (${HUMAN})='approved' AND a.verdict='reject' THEN 'ai_stricter'
  WHEN (${HUMAN})='rejected' AND a.verdict='pass' THEN 'human_stricter' END`;
const LAST = (col: string) => `(SELECT x.${col} FROM review_ai_arbitrations x WHERE x.suggestion_id=a.id ORDER BY x.created_at DESC, x.rowid DESC LIMIT 1)`;
const LATEST = LAST("value");
/** 已仲裁過的照仲裁當時的方向（之後被重新審核改判也還找得到）；沒仲裁過的看現在 */
const DIRECTION = `COALESCE((${LIVE}), ${LAST("direction")})`;
const HUMAN_NOW = `COALESCE(CASE WHEN (${LIVE}) IS NOT NULL THEN (${HUMAN}) END, ${LAST("human_decision")})`;

const base = `FROM review_ai_suggestions a JOIN review_submissions s ON s.id=a.submission_id`;
// 自己寫的卡不列：以卡為準（作者在這張卡任何一版的版本列上）。駁回後改判為通過時，原本那張單的版本列已轉給改判單，
// 以單為準就會漏掉作者自己（各處的 NOT EXISTS(... ov.card_id=s.card_id ...)）

export interface DisagreementFilter {
  state: "open" | "done" | "all"; criteria: string | null; direction: Direction | null; reason: string | null; limit: number; offset: number;
  /** 看的人：自己寫的卡不列（作者不該看到自己卡的審核判斷） */
  viewer: string;
}

const pickName = (raw: string | null): string => {
  try {
    const names = JSON.parse(raw ?? "{}") as Record<string, string>;
    return names["zh"] || names["zh-Hant"] || names["en"] || Object.values(names).find(Boolean) || "";
  } catch { return ""; }
};

/** 分歧清單：最舊的先（待仲裁預設）。理由代碼篩選看兩邊任一邊有用到。 */
export async function listDisagreements(db: D1Database, f: DisagreementFilter) {
  const where = `WHERE (${DIRECTION}) IS NOT NULL
    AND (?1 IS NULL OR a.criteria_version=?1)
    AND (?2 IS NULL OR ${DIRECTION} = ?2)
    AND (?3='all' OR (?3='open' AND ${LATEST} IS NULL) OR (?3='done' AND ${LATEST} IS NOT NULL))
    AND (?4 IS NULL OR EXISTS(SELECT 1 FROM json_each(a.reasons) r WHERE r.value=?4) OR EXISTS(SELECT 1 FROM json_each(COALESCE(s.reject_reasons,'[]')) r WHERE r.value=?4))
    AND NOT EXISTS(SELECT 1 FROM hosting_versions ov WHERE ov.card_id=s.card_id AND ov.member_id=?5)`;
  const args = [f.criteria, f.direction, f.state, f.reason, f.viewer];
  const [rows, total] = await Promise.all([
    db.prepare(`SELECT a.id, a.submission_id, s.card_id, a.criteria_version, a.verdict, a.reasons, a.flags, a.confidence, a.created_at,
        s.decided_at, s.reject_reasons, ${HUMAN_NOW} AS human, ${DIRECTION} AS direction, ${LATEST} AS arbitration,
        -- 卡名：這一版的公開資料（改判通過後版本列在改判單上），都沒有就用卡片現在的名字
        COALESCE((SELECT json_extract(v.public_role,'$.names') FROM hosting_versions v WHERE v.submission_id IN (s.id, (SELECT f.id FROM review_submissions f WHERE f.flip_of=s.id AND f.status='approved'))),
          (SELECT c.names FROM cards c WHERE c.id=s.card_id)) AS names
      ${base} ${where} ORDER BY a.created_at ASC, a.id ASC LIMIT ${f.limit} OFFSET ${f.offset}`).bind(...args).all<Record<string, any>>(),
    db.prepare(`SELECT COUNT(*) AS n ${base} ${where}`).bind(...args).first<{ n: number }>(),
  ]);
  return {
    total: total?.n ?? 0,
    items: rows.results.map((r) => ({
      suggestionId: r.id, submissionId: r.submission_id, cardId: String(r.card_id), name: pickName(r.names), direction: r.direction as Direction,
      criteriaVersion: r.criteria_version,
      human: { decision: r.human, reasons: r.human === "rejected" ? parseReviewReasons(r.reject_reasons) : [], at: r.decided_at },
      ai: { verdict: r.verdict, reasons: JSON.parse(r.reasons), flags: JSON.parse(r.flags), confidence: r.confidence, at: r.created_at },
      arbitration: r.arbitration as ArbitrationValue | null,
    })),
  };
}

/** 單筆分歧的人工與 AI 兩邊（卡片內容由路由另讀）。審核員名字只給管理員這頁，報表與匯出不列。 */
export async function disagreementSides(db: D1Database, suggestionId: string, opts: { viewer: string; names: boolean }) {
  // 審核員、仲裁人的名字只給管理員（PM 2026-11-23）；一般審核員看得到結論，不看是誰
  const hideNames = (rows: Record<string, unknown>[], key: string) => (opts.names ? rows : rows.map((r) => ({ ...r, [key]: null })));
  const row = await db.prepare(`SELECT a.*, s.status, s.card_id, s.decided_at, s.reject_reasons, s.note AS human_note, s.source_role_id, s.provider, s.submitted_at,
      ${HUMAN_NOW} AS human, ${DIRECTION} AS direction ${base} WHERE a.id=?1 AND NOT EXISTS(SELECT 1 FROM hosting_versions ov WHERE ov.card_id=s.card_id AND ov.member_id=?2)`)
    .bind(suggestionId, opts.viewer).first<Record<string, any>>();
  if (!row || !row.direction) throw new HttpError(404, "disagreement_not_found");
  const [stamps, feedback, history] = await Promise.all([
    db.prepare(`SELECT st.verdict, st.created_at AS at, COALESCE(m.display_name, m.handle) AS reviewer FROM review_stamps st LEFT JOIN members m ON m.id=st.member_id
      WHERE st.submission_id=? ORDER BY st.created_at`).bind(row.submission_id).all(),
    db.prepare(`SELECT e.source AS value, e.at, COALESCE(m.display_name, m.handle) AS reviewer FROM review_events e LEFT JOIN members m ON m.id=e.actor_member_id
      WHERE ${LATEST_FEEDBACK} AND e.ai_suggestion_id=? ORDER BY e.at`).bind(suggestionId).all(),
    db.prepare(`SELECT x.value, x.reference_pool AS referencePool, x.note, json(x.note_types) AS noteTypes, x.created_at AS at, COALESCE(m.display_name, m.handle) AS arbiter
      FROM review_ai_arbitrations x LEFT JOIN members m ON m.id=x.member_id WHERE x.suggestion_id=? ORDER BY x.created_at, x.rowid`).bind(suggestionId).all(),
  ]);
  return {
    submission: { id: row.submission_id as string, cardId: String(row.card_id), status: row.status as string, submittedAt: row.submitted_at as number },
    direction: row.direction as Direction,
    human: {
      decision: row.human, reasons: row.human === "rejected" ? parseReviewReasons(row.reject_reasons) : [], note: (row.human_note as string) ?? "",
      at: row.decided_at, stamps: hideNames(stamps.results, "reviewer"), feedback: hideNames(feedback.results, "reviewer"),
    },
    ai: {
      suggestionId, criteriaVersion: row.criteria_version, model: row.model, verdict: row.verdict, reasons: JSON.parse(row.reasons), flags: JSON.parse(row.flags),
      confidence: row.confidence, note: row.note, phase: row.phase, at: row.created_at,
    },
    arbitrations: hideNames(history.results, "arbiter"),
  };
}

/** 仲裁一筆分歧：寫仲裁紀錄＋一筆審核事件。同一個 operationId 重送回同一筆，不重複寫。 */
export async function arbitrate(db: D1Database, input: { suggestionId: string; memberId: string; value: unknown; addToReference: unknown; note: unknown; noteTypes?: unknown; operationId: string; now: number }) {
  if (typeof input.value !== "string" || !(ARBITRATION_VALUES as readonly string[]).includes(input.value)) throw new HttpError(400, "invalid_arguments", undefined, { field: "value" });
  const value = input.value as ArbitrationValue;
  const note = input.note === undefined || input.note === null ? "" : input.note;
  if (typeof note !== "string" || note.length > NOTE_MAX) throw new HttpError(400, "invalid_arguments", undefined, { field: "note" });
  const add = input.addToReference === true;
  const noteTypes = parseAiNote(input.noteTypes, null).types;
  if (add && value !== "human_right" && value !== "ai_right") throw new HttpError(400, "reference_needs_a_winner", undefined, { field: "addToReference" });
  const row = await db.prepare(`SELECT a.id, a.submission_id, a.verdict, a.reasons, s.card_id, s.reject_reasons, ${HUMAN_NOW} AS human, ${DIRECTION} AS direction,
      ${LAST("reasons")} AS last_reasons ${base} WHERE a.id=?1 AND NOT EXISTS(SELECT 1 FROM hosting_versions ov WHERE ov.card_id=s.card_id AND ov.member_id=?2)`)
    .bind(input.suggestionId, input.memberId).first<{ id: string; submission_id: string; verdict: string; reasons: string; card_id: number; reject_reasons: string | null; human: string; direction: string | null; last_reasons: string | null }>();
  if (!row || !row.direction) throw new HttpError(404, "disagreement_not_found");
  // 池＝仲裁後的正確結論：人對取人工結論（通過→pass、駁回／不受理→reject），AI 對取 AI 結論
  const pool = !add ? null : value === "ai_right" ? row.verdict : row.human === "approved" ? "pass" : "reject";
  const humanDecision = row.human === "approved" ? "approved" : "rejected";
  // 再仲裁時兩邊可能已經不相反了（改判、AI 重寫）：沿用上一次記下的理由
  const disputed = row.last_reasons ?? JSON.stringify(row.direction === "ai_stricter" ? JSON.parse(row.reasons) : parseReviewReasons(row.reject_reasons));
  const id = crypto.randomUUID();
  await db.batch([
    db.prepare(`INSERT INTO review_ai_arbitrations (id,suggestion_id,submission_id,member_id,value,direction,human_decision,reasons,reference_pool,note,note_types,operation_id,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(member_id,operation_id) DO NOTHING`)
      .bind(id, row.id, row.submission_id, input.memberId, value, row.direction, humanDecision, disputed, pool, note.trim(), JSON.stringify(noteTypes), input.operationId, input.now),
    // 仲裁完成：快照保留期縮回定案後 7 天（不一致時原本留到 14 天等仲裁）
    db.prepare("UPDATE review_snapshot_retention SET expires_at=MIN(expires_at, decided_at+?) WHERE submission_id=?").bind(RETAIN_MS, row.submission_id),
    db.prepare(`INSERT OR IGNORE INTO review_events(event_key,spec_version,submission_id,card_id,at,action,actor_kind,actor_member_id,source,ai_suggestion_id)
      SELECT 'aiarb:'||x.id,1,x.submission_id,?,x.created_at,'ai_arbitration','reviewer',x.member_id,x.value,x.suggestion_id
      FROM review_ai_arbitrations x WHERE x.member_id=? AND x.operation_id=?`).bind(row.card_id, input.memberId, input.operationId),
  ]);
  const saved = await db.prepare("SELECT id, suggestion_id, value, reference_pool FROM review_ai_arbitrations WHERE member_id=? AND operation_id=?")
    .bind(input.memberId, input.operationId).first<{ id: string; suggestion_id: string; value: string; reference_pool: string | null }>();
  if (saved!.suggestion_id !== row.id || saved!.value !== value) throw new HttpError(409, "arbitration_operation_repeated");
  return { id: saved!.id, value: saved!.value as ArbitrationValue, referencePool: saved!.reference_pool as "pass" | "reject" | null };
}

/** 被勾進參考範例、而且最後一次仲裁仍是那個結論的建議（重新仲裁取消勾選的不算）。 */
export async function referenceCandidates(db: D1Database, criteria: string | null, limit: number) {
  const rows = await db.prepare(`SELECT x.suggestion_id, x.reference_pool, x.value, x.reasons AS disputed, a.criteria_version, a.flags,
      s.id AS submission_id, s.reject_reasons, s.source_role_id, s.provider, ${HUMAN_NOW} AS human
    FROM review_ai_arbitrations x JOIN review_ai_suggestions a ON a.id=x.suggestion_id JOIN review_submissions s ON s.id=a.submission_id
    WHERE x.rowid=(SELECT y.rowid FROM review_ai_arbitrations y WHERE y.suggestion_id=x.suggestion_id ORDER BY y.created_at DESC, y.rowid DESC LIMIT 1)
      AND x.reference_pool IS NOT NULL AND (?1 IS NULL OR a.criteria_version=?1)
    ORDER BY x.created_at DESC LIMIT ${limit}`).bind(criteria).all<Record<string, any>>();
  return rows.results.map((r) => ({
    suggestionId: r.suggestion_id as string, submissionId: r.submission_id as string, sourceRoleId: r.source_role_id as string, provider: r.provider as string,
    criteriaVersion: r.criteria_version as string, verdict: r.reference_pool as "pass" | "reject", arbitration: r.value as ArbitrationValue,
    // 進駁回池時，正確的一邊就是分歧裡「不過」的那一邊：用仲裁當時記下的理由
    reasons: r.reference_pool === "pass" ? [] : JSON.parse(r.disputed),
    flags: r.value === "ai_right" ? JSON.parse(r.flags) : [],
  }));
}

/** 仲裁統計：每個判準版本，最後一次仲裁的分佈；各理由代碼在分歧裡「人錯」「AI 錯」的次數。 */
export async function arbitrationStats(db: D1Database, input: { from: number; to: number; criteria: string | null }) {
  const rows = await db.prepare(`SELECT a.criteria_version AS v, x.value, x.reasons
    FROM review_ai_arbitrations x JOIN review_ai_suggestions a ON a.id=x.suggestion_id JOIN review_submissions s ON s.id=a.submission_id
    WHERE x.rowid=(SELECT y.rowid FROM review_ai_arbitrations y WHERE y.suggestion_id=x.suggestion_id ORDER BY y.created_at DESC, y.rowid DESC LIMIT 1)
      AND s.submitted_at>=? AND s.submitted_at<? AND (?3 IS NULL OR a.criteria_version=?3)`).bind(input.from, input.to, input.criteria).all<Record<string, any>>();
  const out = new Map<string, { values: Record<ArbitrationValue, number>; reasons: Record<string, { humanWrong: number; aiWrong: number }> }>();
  for (const r of rows.results) {
    const g = out.get(r.v) ?? out.set(r.v, { values: { human_right: 0, ai_right: 0, both_ok: 0, both_wrong: 0 }, reasons: {} }).get(r.v)!;
    g.values[r.value as ArbitrationValue]++;
    // 仲裁當時「不過」那一邊的理由
    const codes: string[] = JSON.parse(r.reasons);
    for (const code of codes) {
      const c = (g.reasons[code] ??= { humanWrong: 0, aiWrong: 0 });
      if (r.value === "ai_right") c.humanWrong++;
      if (r.value === "human_right") c.aiWrong++;
    }
  }
  return Object.fromEntries(out);
}

/**
 * 給 AI 的說明（管理員，判準調整用）：定案與仲裁時寫的原因類型與說明全文，最新的在前。
 * 不列審核員是誰；作者端看不到。
 */
export async function aiNotes(db: D1Database, input: { from: number; to: number; type: string | null; limit: number }) {
  const rows = await db.prepare(`SELECT * FROM (
      SELECT 'final' AS kind, e.at, e.ai_note_types AS types, e.ai_note AS note, e.final_source AS finalSource, e.action AS decision, NULL AS arbitration,
        (SELECT a.criteria_version FROM review_ai_suggestions a WHERE a.id=e.ai_suggestion_id) AS criteriaVersion, e.card_id AS cardId
      FROM review_events e WHERE e.final_source IS NOT NULL AND (e.ai_note IS NOT NULL OR e.ai_note_types IS NOT NULL) AND e.at>=?1 AND e.at<?2
      UNION ALL
      SELECT 'arbitration', x.created_at, x.note_types, NULLIF(x.note,''), NULL, x.human_decision, x.value, a.criteria_version, s.card_id
      FROM review_ai_arbitrations x JOIN review_ai_suggestions a ON a.id=x.suggestion_id JOIN review_submissions s ON s.id=x.submission_id
      WHERE (x.note<>'' OR x.note_types<>'[]') AND x.created_at>=?1 AND x.created_at<?2
    ) WHERE (?3 IS NULL OR EXISTS(SELECT 1 FROM json_each(COALESCE(types,'[]')) t WHERE t.value=?3))
    ORDER BY at DESC LIMIT ${input.limit}`).bind(input.from, input.to, input.type).all<Record<string, any>>();
  return rows.results.map((r) => ({ ...r, cardId: String(r.cardId), types: JSON.parse(r.types ?? "[]") as string[] }));
}

/**
 * AI 說服你了嗎（owner 2026-11-24）：一致率只是參考，主指標是分歧時 AI 的理由能不能說服人。
 * 和仲裁「誰對」是兩件事：不寫仲裁、不寫審核事件、不動快照保留期。每位審核員每筆分歧一列，改選就覆蓋，統計取這一列（最後一次選擇）。
 */
export const PERSUASION_VALUES = ["convinced", "not_convinced"] as const;
export type PersuasionValue = (typeof PERSUASION_VALUES)[number];
/** 已判不到這個數只給計數、不給比例（沿用審核統計的抑制門檻） */
export const PERSUASION_MIN = 10;

/** 評一筆分歧：能打開這筆分歧的審核員都能評（自己的卡、已不是分歧的 404）。同一個選擇重送只更新時間。 */
export async function persuade(db: D1Database, input: { suggestionId: string; memberId: string; value: unknown; now: number }) {
  if (typeof input.value !== "string" || !(PERSUASION_VALUES as readonly string[]).includes(input.value)) throw new HttpError(400, "invalid_arguments", undefined, { field: "value" });
  const row = await db.prepare(`SELECT a.id, a.submission_id, a.updated_at, ${DIRECTION} AS direction ${base}
      WHERE a.id=?1 AND NOT EXISTS(SELECT 1 FROM hosting_versions ov WHERE ov.card_id=s.card_id AND ov.member_id=?2)`)
    .bind(input.suggestionId, input.memberId).first<{ id: string; submission_id: string; updated_at: number; direction: string | null }>();
  if (!row || !row.direction) throw new HttpError(404, "disagreement_not_found");
  // 記下評的是 AI 哪一次的判斷（建議的 updated_at）：AI 重判後舊的評價不再算
  await db.prepare(`INSERT INTO review_ai_persuasion (suggestion_id,member_id,submission_id,value,created_at,updated_at,suggestion_at) VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(suggestion_id,member_id) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at, suggestion_at=excluded.suggestion_at`)
    .bind(row.id, input.memberId, row.submission_id, input.value, input.now, input.now, row.updated_at).run();
  return { value: input.value as PersuasionValue, updatedAt: input.now };
}

/** 評價還算數：評的是 AI 現在這一次的判斷（AI 重判後舊的評價不算） */
const CURRENT = "p.suggestion_at>=a.updated_at";

/** 這位審核員對這筆分歧最後一次的選擇（只回自己的，別人的不回）；AI 重判後回到未評 */
export async function myPersuasion(db: D1Database, suggestionId: string, memberId: string): Promise<PersuasionValue | null> {
  const row = await db.prepare(`SELECT p.value FROM review_ai_persuasion p JOIN review_ai_suggestions a ON a.id=p.suggestion_id
    WHERE p.suggestion_id=? AND p.member_id=? AND ${CURRENT}`).bind(suggestionId, memberId).first<{ value: PersuasionValue }>();
  return row?.value ?? null;
}

/** 一段期間內（按選擇時間）的被說服筆數：清單頁頂的本週比例，不看判準版本與清單篩選 */
export async function persuasionWindow(db: D1Database, from: number, to: number) {
  // 只算還是分歧、評的是 AI 現在判斷的那些（跟清單同一個分歧口徑）
  const row = await db.prepare(`SELECT COUNT(*) AS rated, COALESCE(SUM(p.value='convinced'),0) AS convinced
    FROM review_ai_persuasion p JOIN review_ai_suggestions a ON a.id=p.suggestion_id JOIN review_submissions s ON s.id=a.submission_id
    WHERE p.updated_at>=? AND p.updated_at<? AND ${CURRENT} AND (${DIRECTION}) IS NOT NULL`)
    .bind(from, to).first<{ rated: number; convinced: number }>();
  const rated = row?.rated ?? 0;
  return { convinced: row?.convinced ?? 0, rated, suppressed: rated < PERSUASION_MIN };
}

/** 報表：每個判準版本的被說服筆數。期間口徑與仲裁統計相同（送審時間），每人每筆取最後一次 */
export async function persuasionStats(db: D1Database, input: { from: number; to: number; criteria: string | null }) {
  const rows = await db.prepare(`SELECT a.criteria_version AS v, COUNT(*) AS rated, SUM(p.value='convinced') AS convinced
    FROM review_ai_persuasion p JOIN review_ai_suggestions a ON a.id=p.suggestion_id JOIN review_submissions s ON s.id=a.submission_id
    WHERE s.submitted_at>=? AND s.submitted_at<? AND (?3 IS NULL OR a.criteria_version=?3) AND ${CURRENT} AND (${DIRECTION}) IS NOT NULL GROUP BY a.criteria_version`)
    .bind(input.from, input.to, input.criteria).all<{ v: string; rated: number; convinced: number }>();
  return Object.fromEntries(rows.results.map((r) => [r.v, { convinced: r.convinced, rated: r.rated }]));
}
