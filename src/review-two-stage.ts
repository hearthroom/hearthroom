import { assertReviewNotWithdrawn, getSubmission, hasStamped, RETAIN_MS, stamp, type DecisionInput, type StampResult } from "./review";
import { isReviewReason } from "../shared/review-reasons";
import { currentCriteria, suggestionsOf, type SuggestionView } from "./review-ai";
import { HttpError, type Env } from "./types";

/**
 * AI 為主、人為輔（owner 2026-11-24，ui-ai-first.md）：審核頁進來就看得到 AI 的建議，決定區預設就是它；
 * 定案照舊走蓋章，另外記下定案從哪來。雙盲（先送盲審判斷、再揭曉）已退場：/blind 路由、盲審讀寫與「看過 AI 才蓋章」的排除都拿掉了。
 * 舊流程留下的 review_blind_judgments 與 final_source='blind' 的事件只剩歷史資料；新的定案不再接受 blind。
 */

/** 定案來源：ai（照 AI，沒改）、modified（改了 AI 的建議）、human_no_ai（沒有 AI 建議可對照）。歷史資料另有 blind（舊雙盲「用我的」）。 */
export const FINAL_SOURCES = ["ai", "modified", "human_no_ai"] as const;
export type FinalSource = (typeof FINAL_SOURCES)[number];
/** 給 AI 的說明的原因類型：卡片內容、作者關聯（同一群人多帳號、量產群組）、作者歷史、判準本身有問題、其他 */
/** ai_inaccurate：審核員標「AI 判斷不準確」（定案時一起送，或定案後在結果頁改，見 setAiInaccurate） */
export const AI_NOTE_TYPES = ["card_content", "author_relation", "author_history", "criteria_issue", "other", "ai_inaccurate"] as const;
export const AI_NOTE_MAX = 500;
/** 定案與 AI 不一致時快照保留較久，等仲裁（最長 14 天；仲裁完成就縮回 7 天） */
export const DISAGREE_RETAIN_MS = 14 * 86_400_000;

export type AiState = { state: "ready" | "handoff"; suggestion: SuggestionView } | { state: "pending"; suggestion: null };

/** 這張單目前判準版本的 AI 建議：已判（過或不過）、交人，或還沒判（審卡員還沒用這一版巡到） */
export async function aiStateOf(db: D1Database, submissionId: string): Promise<AiState> {
  // 只看目前判準版本的建議（同版本只有一筆，重判是覆寫）；還沒用目前版本審過就是 pending
  const current = await currentCriteria(db);
  const latest = (await suggestionsOf(db, submissionId)).find((s) => s.verdict !== null && (current === null || s.criteriaVersion === current));
  if (!latest) return { state: "pending", suggestion: null };
  return { state: latest.verdict === "handoff" ? "handoff" : "ready", suggestion: latest };
}

const aiVerdictAsHuman = (v: string | null) => (v === "pass" ? "approve" : v === "reject" ? "reject" : null);

/** 給 AI 的說明：原因類型只收清單內的；說明 500 字內。都選填。 */
export function parseAiNote(types: unknown, note: unknown): { types: string[]; note: string } {
  if (types !== undefined && types !== null && (!Array.isArray(types) || types.some((t) => !(AI_NOTE_TYPES as readonly unknown[]).includes(t)))) {
    throw new HttpError(400, "invalid_arguments", undefined, { field: "aiNoteTypes" });
  }
  if (note !== undefined && note !== null && (typeof note !== "string" || note.trim().length > AI_NOTE_MAX)) throw new HttpError(400, "invalid_arguments", undefined, { field: "aiNote" });
  const set = new Set((types as string[] | null | undefined) ?? []);
  return { types: AI_NOTE_TYPES.filter((t) => set.has(t)), note: typeof note === "string" ? note.trim() : "" };
}

/**
 * 定案：
 * - ai：照 AI 的結論與理由蓋章（作者看到的是正式理由代碼與 AI 的說明草稿，或審核員改過的說明）；AI 沒判或交人不能選。
 * - modified：用這次送來的決定。human_no_ai：AI 還沒審時照一般流程送的決定；送出時 AI 其實已經判好就記成 modified。
 * 給作者的說明（駁回、通過附建議）由蓋章的 normalizeDecision 過內部字詞檢查。
 * 快照保留：定案與 AI 結論不同保留 14 天等仲裁，其他 7 天。
 */
export async function finalize(db: D1Database, env: Env, input: {
  submissionId: string; memberId: string; now: number; generation?: string; source: unknown; decision: Omit<DecisionInput, "submissionId" | "memberId" | "now" | "generation"> | null;
  aiNoteTypes: unknown; aiNote: unknown;
  /** 照 AI：畫面上顯示的那一筆建議。審卡員在這之間重判了就回 409，讓審核員先看新的判斷 */
  aiSuggestionId?: unknown;
  /** 那一筆建議當時的更新時間（同一版判準重判時 id 不變，要靠它認出換過了） */
  aiSuggestionAt?: unknown;
  /** 照 AI：審核員改過的給作者說明（沒給就用 AI 的草稿） */
  authorNote?: unknown;
  /** 審核員標「AI 判斷不準確」 */
  aiInaccurate?: unknown;
}): Promise<StampResult & { finalSource: FinalSource }> {
  // 舊雙盲的 blind（用我的盲審）不再接受：盲審判斷已不會產生
  if (typeof input.source !== "string" || !(FINAL_SOURCES as readonly string[]).includes(input.source)) throw new HttpError(400, "invalid_arguments", undefined, { field: "finalSource" });
  await assertReviewNotWithdrawn(db, input.submissionId);
  let source = input.source as FinalSource;
  const ai = await aiStateOf(db, input.submissionId);
  const types = Array.isArray(input.aiNoteTypes) ? [...input.aiNoteTypes] : input.aiNoteTypes === undefined || input.aiNoteTypes === null ? [] : input.aiNoteTypes;
  if (input.aiInaccurate === true && Array.isArray(types) && !types.includes("ai_inaccurate")) types.push("ai_inaccurate");
  const note = parseAiNote(types, input.aiNote);
  let decision: Omit<DecisionInput, "submissionId" | "memberId" | "now" | "generation">;
  if (source === "ai") {
    if (ai.state !== "ready") throw new HttpError(409, "ai_choice_unavailable");
    if (input.aiSuggestionId !== undefined && input.aiSuggestionId !== null
      && (input.aiSuggestionId !== ai.suggestion.id || (typeof input.aiSuggestionAt === "number" && input.aiSuggestionAt !== ai.suggestion.at))) throw new HttpError(409, "ai_changed");
    const verdict = aiVerdictAsHuman(ai.suggestion.verdict)!;
    const reasons = ai.suggestion.reasons.filter(isReviewReason);
    if (verdict === "reject" && !reasons.length) throw new HttpError(409, "ai_choice_unavailable");
    // 給作者的說明：審核員在畫面上改過就用改過的，否則用 AI 寫的草稿
    const authorNote = verdict === "reject" ? (typeof input.authorNote === "string" ? input.authorNote.trim() : ai.suggestion.authorNote) : "";
    decision = { verdict, note: authorNote, reasons: verdict === "reject" ? reasons : undefined, coaching: false, marks: input.decision?.marks ?? [], suggestions: undefined };
  } else {
    if (!input.decision) throw new HttpError(400, "invalid_arguments", undefined, { field: "verdict" });
    if (source === "human_no_ai" && ai.state === "ready") source = "modified";
    decision = input.decision;
  }
  const aiVerdict = ai.state === "ready" ? aiVerdictAsHuman(ai.suggestion.verdict) : null;
  const retainMs = aiVerdict && aiVerdict !== decision.verdict ? DISAGREE_RETAIN_MS : RETAIN_MS;
  const result = await stamp(db, {
    ...decision, submissionId: input.submissionId, memberId: input.memberId, now: input.now, generation: input.generation,
    final: { source, aiSuggestionId: ai.suggestion?.id ?? null, aiNoteTypes: note.types, aiNote: note.note, retainMs },
  }, env);
  return { ...result, finalSource: source };
}

/** 這張單最後一次定案事件（報表讀它的原因類型算「AI 判斷不準確」）與它對照的 AI 結論 */
async function finalEventOf(db: D1Database, submissionId: string) {
  return db.prepare(`SELECT e.id, e.ai_note_types, (SELECT a.verdict FROM review_ai_suggestions a WHERE a.id=e.ai_suggestion_id) AS ai_verdict
    FROM review_events e WHERE e.submission_id=? AND e.final_source IS NOT NULL ORDER BY e.at DESC, e.id DESC LIMIT 1`)
    .bind(submissionId).first<{ id: number; ai_note_types: string | null; ai_verdict: string | null }>();
}
const typesOf = (raw: string | null): string[] => { try { const v = raw ? JSON.parse(raw) : []; return Array.isArray(v) ? v : []; } catch { return []; } };

/** 這張單定案時記下的「AI 判斷不準確」（沒有定案事件就是 false） */
export async function aiInaccurateOf(db: D1Database, submissionId: string): Promise<boolean> {
  return typesOf((await finalEventOf(db, submissionId))?.ai_note_types ?? null).includes("ai_inaccurate");
}

/**
 * 定案後標或取消「AI 判斷不準確」（ui-ai-first.md：可在定案前後標）：改的是定案那一筆事件的原因類型，
 * 跟定案時一起送的是同一個訊號，報表只算一次。定過這張單的審核員或管理員可以改；同一個值重送不寫。
 * 只認有 AI 結論（通過／駁回）對照的定案；不改送審狀態、不通知作者。
 */
export async function setAiInaccurate(db: D1Database, input: { submissionId: string; memberId: string; role: string | null; value: unknown }): Promise<{ inaccurate: boolean }> {
  if (typeof input.value !== "boolean") throw new HttpError(400, "invalid_arguments", undefined, { field: "inaccurate" });
  const s = await getSubmission(db, input.submissionId);
  // 定案前照舊跟著定案一起送（審核頁的切換鈕），這條路只給已定案的單
  if (s.status !== "approved" && s.status !== "rejected") throw new HttpError(409, "review_not_decided");
  // 只給做這個決定的審核員：管理員看別人的定案是唯讀（UI/UX、PM 2026-11-25）
  if (!(await hasStamped(db, s.id, input.memberId))) throw new HttpError(403, "ai_inaccurate_not_allowed");
  const ev = await finalEventOf(db, s.id);
  if (!ev || (ev.ai_verdict !== "pass" && ev.ai_verdict !== "reject")) throw new HttpError(409, "ai_inaccurate_unavailable");
  const before = typesOf(ev.ai_note_types);
  if (before.includes("ai_inaccurate") !== input.value) {
    const next = parseAiNote(input.value ? [...before, "ai_inaccurate"] : before.filter((t) => t !== "ai_inaccurate"), null).types;
    // 只在讀到的那一版沒被別人改過時才寫（兩人同時切換不會互相蓋掉）
    await db.prepare("UPDATE review_events SET ai_note_types=? WHERE id=? AND ai_note_types IS ?").bind(next.length ? JSON.stringify(next) : null, ev.id, ev.ai_note_types).run();
  }
  return { inaccurate: input.value };
}
