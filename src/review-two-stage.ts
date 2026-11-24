import { guardDecision, normalizeDecision, getSubmission, RETAIN_MS, stamp, type DecisionInput, type StampResult } from "./review";
import { reviewEventStatement } from "./review-v2";
import { REVIEW_REASON_VERSION, isReviewReason } from "../shared/review-reasons";
import { currentCriteria, suggestionsOf, type SuggestionView } from "./review-ai";
import { guardAuthorNote } from "./author-note-guard";
import { HttpError, type Env } from "./types";

/**
 * 兩段式決定（owner 2026-11-24）：審核員先送「盲審判斷」（只記錄、不改送審狀態，內容與查重照常可看），
 * 看 AI 的判斷，再定案：一致一鍵確認；不一致選用我的、用 AI 的或修改後定案。定案照舊走蓋章。
 *
 * 盲審判斷是沒看過 AI 的獨立判斷：人機對照用它，不用定案（定案時已經看過 AI）。
 * 盲審送出後鎖定，只有本人看得到；別人領取要自己盲審。不受理、冷凍、重新審核不走兩段式。
 */

export const FINAL_SOURCES = ["blind", "ai", "modified", "human_no_ai"] as const;
export type FinalSource = (typeof FINAL_SOURCES)[number];
/** 給 AI 的說明的原因類型：卡片內容、作者關聯（同一群人多帳號、量產群組）、作者歷史、判準本身有問題、其他 */
/** ai_inaccurate：審核員標「AI 判斷不準確」（AI 為主，owner 2026-11-24；定案時一起送） */
export const AI_NOTE_TYPES = ["card_content", "author_relation", "author_history", "criteria_issue", "other", "ai_inaccurate"] as const;
export const AI_NOTE_MAX = 500;
/** 定案與 AI 不一致時快照保留較久，等仲裁（最長 14 天；仲裁完成就縮回 7 天） */
export const DISAGREE_RETAIN_MS = 14 * 86_400_000;

export interface BlindPayload { verdict: "approve" | "reject"; note: string; reasons: string[]; coaching: boolean; marks: string[]; suggestions: string[] }
export interface BlindView { id: string; verdict: "approve" | "reject"; payload: BlindPayload; at: number }

export async function blindOf(db: D1Database, submissionId: string, memberId: string): Promise<BlindView | null> {
  const row = await db.prepare("SELECT id, verdict, payload, created_at FROM review_blind_judgments WHERE submission_id=? AND member_id=?")
    .bind(submissionId, memberId).first<{ id: string; verdict: "approve" | "reject"; payload: string; created_at: number }>();
  return row ? { id: row.id, verdict: row.verdict, payload: JSON.parse(row.payload), at: row.created_at } : null;
}

export type AiState = { state: "ready" | "handoff"; suggestion: SuggestionView } | { state: "pending"; suggestion: null };

/** 這張單目前判準版本的 AI 建議：已判（過或不過）、交人，或還沒判（審卡員還沒用這一版巡到） */
export async function aiStateOf(db: D1Database, submissionId: string): Promise<AiState> {
  // 只看目前判準版本的建議（同版本只有一筆，重判是覆寫）；還沒用目前版本審過就是 pending
  const current = await currentCriteria(db);
  const latest = (await suggestionsOf(db, submissionId)).find((s) => s.verdict !== null && (current === null || s.criteriaVersion === current));
  if (!latest) return { state: "pending", suggestion: null };
  return { state: latest.verdict === "handoff" ? "handoff" : "ready", suggestion: latest };
}

/** 盲審判斷：檢查規則跟蓋章一樣（待審、自己領著、字數、理由…），但只記錄。每人每單一筆，送出後鎖定。 */
export async function recordBlind(db: D1Database, input: DecisionInput): Promise<BlindView> {
  const row = await getSubmission(db, input.submissionId);
  if (row.reopen_of) throw new HttpError(409, "blind_not_applicable");
  // 改判單只有通過或撤回改判（撤回走 /flip/withdraw）
  if (row.flip_of && input.verdict === "reject") throw new HttpError(409, "review_flip_use_withdraw");
  if (await blindOf(db, row.id, input.memberId)) throw new HttpError(409, "blind_already_recorded");
  await guardDecision(db, row, input);
  const d = await normalizeDecision(db, row, input);
  const payload: BlindPayload = {
    verdict: input.verdict, note: d.note, reasons: d.rejection?.reasons ?? [], coaching: d.coaching, marks: d.marks, suggestions: d.suggestions,
  };
  const id = crypto.randomUUID();
  await db.batch([
    db.prepare("INSERT INTO review_blind_judgments (id, submission_id, member_id, verdict, payload, created_at) VALUES (?,?,?,?,?,?) ON CONFLICT(submission_id, member_id) DO NOTHING")
      .bind(id, row.id, input.memberId, input.verdict, JSON.stringify(payload), input.now),
    reviewEventStatement(db, {
      key: `blind:${row.id}:${input.memberId}`, submissionId: row.id, cardId: row.card_id, at: input.now, action: "blind_judgment",
      from: "pending", to: input.verdict, actorKind: "reviewer", actorMemberId: input.memberId,
      reasons: payload.reasons.length ? payload.reasons : null, reasonVersion: payload.reasons.length ? REVIEW_REASON_VERSION : null,
      claimElapsedMs: row.claimed_at === null ? null : Math.max(0, input.now - row.claimed_at),
    }),
  ]);
  const saved = await blindOf(db, row.id, input.memberId);
  if (saved!.id !== id) throw new HttpError(409, "blind_already_recorded");
  return saved!;
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
 * - blind：用盲審原樣蓋章；human_no_ai：沒等 AI（AI 還沒判或交人；AI 剛好判完就記成 blind）。
 * - ai：照 AI 的結論與理由蓋章（作者看到的是正式理由代碼）；AI 沒判或交人不能選。
 * - modified：用這次送來的決定。
 * 快照保留：定案與 AI 結論不同保留 14 天等仲裁，其他 7 天。
 */
export async function finalize(db: D1Database, env: Env, input: {
  submissionId: string; memberId: string; now: number; generation?: string; source: unknown; decision: Omit<DecisionInput, "submissionId" | "memberId" | "now" | "generation"> | null;
  aiNoteTypes: unknown; aiNote: unknown;
  /** 用 AI 的：畫面上顯示的那一筆建議。審卡員在這之間重判了就回 409，讓審核員先看新的判斷 */
  aiSuggestionId?: unknown;
  /** 那一筆建議當時的更新時間（同一版判準重判時 id 不變，要靠它認出換過了） */
  aiSuggestionAt?: unknown;
  /** 用 AI 的：審核員改過的給作者說明（沒給就用 AI 的草稿） */
  authorNote?: unknown;
  /** 審核員標「AI 判斷不準確」 */
  aiInaccurate?: unknown;
}): Promise<StampResult & { finalSource: FinalSource }> {
  if (typeof input.source !== "string" || !(FINAL_SOURCES as readonly string[]).includes(input.source)) throw new HttpError(400, "invalid_arguments", undefined, { field: "finalSource" });
  let source = input.source as FinalSource;
  // AI 為主（owner 2026-11-24）：不再需要先送盲審判斷。舊流程送過盲審的照舊可以「用我的」
  const blind = await blindOf(db, input.submissionId, input.memberId);
  const ai = await aiStateOf(db, input.submissionId);
  const types = Array.isArray(input.aiNoteTypes) ? [...input.aiNoteTypes] : input.aiNoteTypes === undefined || input.aiNoteTypes === null ? [] : input.aiNoteTypes;
  if (input.aiInaccurate === true && Array.isArray(types) && !types.includes("ai_inaccurate")) types.push("ai_inaccurate");
  const note = parseAiNote(types, input.aiNote);
  let decision: Omit<DecisionInput, "submissionId" | "memberId" | "now" | "generation">;
  if (source === "blind" && !blind) throw new HttpError(409, "blind_required");
  // 這次有送決定內容就以這次為準：改版前送過盲審的審核員，畫面上的新選擇不能被舊的盲審蓋掉
  if (source === "human_no_ai" && (input.decision || !blind)) {
    // AI 還沒審：照一般流程送出的決定；AI 其實已經好了就記成「改了 AI」
    if (!input.decision) throw new HttpError(400, "invalid_arguments", undefined, { field: "verdict" });
    if (ai.state === "ready") source = "modified";
    if (typeof input.decision.note === "string" && input.decision.verdict === "reject") guardAuthorNote(input.decision.note);
    decision = input.decision;
  } else if (source === "blind" || source === "human_no_ai") {
    if (source === "human_no_ai" && ai.state === "ready") source = "blind";
    decision = { verdict: blind!.payload.verdict, note: blind!.payload.note, reasons: blind!.payload.reasons, coaching: blind!.payload.coaching, marks: blind!.payload.marks, suggestions: blind!.payload.suggestions };
  } else if (source === "ai") {
    if (ai.state !== "ready") throw new HttpError(409, "ai_choice_unavailable");
    if (input.aiSuggestionId !== undefined && input.aiSuggestionId !== null
      && (input.aiSuggestionId !== ai.suggestion.id || (typeof input.aiSuggestionAt === "number" && input.aiSuggestionAt !== ai.suggestion.at))) throw new HttpError(409, "ai_changed");
    const verdict = aiVerdictAsHuman(ai.suggestion.verdict)!;
    const reasons = ai.suggestion.reasons.filter(isReviewReason);
    if (verdict === "reject" && !reasons.length) throw new HttpError(409, "ai_choice_unavailable");
    // 給作者的說明：審核員在畫面上改過就用改過的，否則用 AI 寫的草稿；兩者都過內部字詞檢查
    const authorNote = verdict === "reject" ? (typeof input.authorNote === "string" ? input.authorNote.trim() : ai.suggestion.authorNote) : "";
    guardAuthorNote(authorNote);
    decision = { verdict, note: authorNote, reasons: verdict === "reject" ? reasons : undefined, coaching: false, marks: blind?.payload.marks ?? input.decision?.marks ?? [], suggestions: undefined };
  } else {
    if (!input.decision) throw new HttpError(400, "invalid_arguments", undefined, { field: "verdict" });
    // 修改後常從 AI 的草稿改起：駁回說明會給作者，一樣不能帶內部資訊（通過的補充說明作者看不到）
    if (typeof input.decision.note === "string" && input.decision.verdict === "reject") guardAuthorNote(input.decision.note);
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
