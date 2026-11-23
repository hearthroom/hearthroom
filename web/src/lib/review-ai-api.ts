import { authHeaders, json, type ReviewAiSuggestion, type ReviewFinalSource } from "./api";
import { COMMUNITY_API } from "./config";
import { currentProvider } from "./provider";
import { currentSurface } from "./track";

/**
 * AI 審卡影子模式的審核員與管理員介面（任務 2026-11-23-ai-card-review）。服務端在 src/review-ai-routes.ts。
 *
 * 揭曉（/review/:id/ai）只在這位審核員送過盲審判斷、自己蓋章或不受理之後才呼叫；伺服器也擋（403 ai_hidden_until_decided）。
 * 分歧、仲裁、報表、參考範例只給管理員。所有寫入都帶新的 operationId。
 */

const headers = (token: string) => ({ "X-From": currentSurface(), "X-Provider": currentProvider(), ...authHeaders(token) });
const post = (token: string, body: unknown) => ({ method: "POST", headers: { ...headers(token), "Content-Type": "application/json" }, body: JSON.stringify(body) });

export type AiVerdict = "pass" | "reject" | "handoff";
export type AiFeedback = "ai_right" | "ai_wrong" | "both_ok";
export const AI_FEEDBACK_VALUES: readonly AiFeedback[] = ["ai_right", "ai_wrong", "both_ok"];
export type Arbitration = "human_right" | "ai_right" | "both_ok" | "both_wrong";
export const ARBITRATION_VALUES: readonly Arbitration[] = ["human_right", "ai_right", "both_ok", "both_wrong"];
export type Direction = "ai_stricter" | "human_stricter";
export type HumanDecision = "approved" | "rejected" | "dropped";
/** 審核標記（AI 只能打這三種；作者看不到） */
export const AI_FLAGS = ["ai_unedited", "copied_text", "mass_produced"] as const;

export type AiSuggestion = ReviewAiSuggestion;
export interface AiReveal { suggestions: AiSuggestion[]; myFeedback: { suggestionId: string; value: AiFeedback }[] }

export async function fetchReviewAi(id: string, token: string): Promise<AiReveal> {
  return json(await fetch(`${COMMUNITY_API}/review/${encodeURIComponent(id)}/ai`, { headers: headers(token) }));
}
export async function sendAiFeedback(id: string, token: string, body: { suggestionId: string; value: AiFeedback; operationId: string }): Promise<{ value: AiFeedback }> {
  return json(await fetch(`${COMMUNITY_API}/review/${encodeURIComponent(id)}/ai-feedback`, post(token, body)));
}

export interface DisagreementItem {
  suggestionId: string; submissionId: string; cardId: string; name: string; direction: Direction; criteriaVersion: string;
  human: { decision: HumanDecision; reasons: string[]; at: number | null };
  ai: { verdict: "pass" | "reject"; reasons: string[]; flags: string[]; confidence: number | null; at: number };
  arbitration: Arbitration | null;
}
export interface DisagreementQuery { state: "open" | "done" | "all"; direction?: Direction | null; criteria?: string | null; reason?: string | null; limit: number; offset: number }

export async function fetchDisagreements(token: string, q: DisagreementQuery): Promise<{ total: number; items: DisagreementItem[] }> {
  const p = new URLSearchParams({ state: q.state, limit: String(q.limit), offset: String(q.offset) });
  if (q.direction) p.set("direction", q.direction);
  if (q.criteria) p.set("criteria", q.criteria);
  if (q.reason) p.set("reason", q.reason);
  return json(await fetch(`${COMMUNITY_API}/review-ai/disagreements?${p}`, { headers: headers(token) }));
}

/** 卡片內容：與 AI 讀到的同一份封存版本（長文已截斷） */
export interface AiCardContent {
  name: string; summary: string; tags: string[]; originalWork: string | null; userName: string; setting: string; speech: string; instructions: string; examples: string;
  openings: { mode: string; page: string; welcome: string; alternates: string[]; prologue: string[] };
  lorebook: { entryCount: number; entries: { name: string; content: string }[] };
}
export type AiUpdate = null | { state: "no_base" | "unreadable" | "missing" } | { state: "ready"; baseKind: string; fields: { key: string; before: string; after: string }[]; lorebook: { added: number; removed: number; modified: number } };
export interface DisagreementDetail {
  submission: { id: string; cardId: string; status: string; submittedAt: number };
  direction: Direction;
  human: { decision: HumanDecision; reasons: string[]; note: string; at: number | null; stamps: { verdict: "approve" | "reject"; at: number; reviewer: string | null }[]; feedback: { value: AiFeedback; at: number; reviewer: string | null }[] };
  ai: { suggestionId: string; criteriaVersion: string; model: string; verdict: "pass" | "reject"; reasons: string[]; flags: string[]; confidence: number | null; note: string; phase: string; at: number };
  arbitrations: { value: Arbitration; referencePool: "pass" | "reject" | null; note: string; /** 給 AI 的說明的原因類型（伺服器回 JSON 字串；舊紀錄沒有） */ noteTypes?: string | AiNoteType[] | null; at: number; arbiter: string | null; /** 這次在頁面上剛送出的（伺服器對非管理員不回名字） */ mine?: boolean }[];
  content: ({ state: "ready" } & { card: AiCardContent }) | { state: "unavailable" };
  update: AiUpdate;
}

export async function fetchDisagreement(suggestionId: string, token: string): Promise<DisagreementDetail> {
  return json(await fetch(`${COMMUNITY_API}/review-ai/disagreements/${encodeURIComponent(suggestionId)}`, { headers: headers(token) }));
}
export async function arbitrate(suggestionId: string, token: string, body: { value: Arbitration; addToReference: boolean; note: string; noteTypes: AiNoteType[]; operationId: string }): Promise<{ id: string; value: Arbitration; referencePool: "pass" | "reject" | null }> {
  return json(await fetch(`${COMMUNITY_API}/review-ai/disagreements/${encodeURIComponent(suggestionId)}/arbitration`, post(token, body)));
}

type Cell3 = { pass: number; reject: number; handoff: number };
export interface AiReportVersion {
  criteriaVersion: string; total: number; ai: Cell3;
  matrix: { approved: Cell3; rejected: Cell3; dropped: Cell3 };
  agreement: number | null; comparable: number; aiStricter: number; humanStricter: number;
  handoffRate: number | null; refusalRate: number | null; costUsd: number;
  arbitration: { values: Record<Arbitration, number>; reasons: Record<string, { humanWrong: number; aiWrong: number }> } | null;
  /** 兩段式定案來源的筆數，與其中改用 AI 結論的筆數（舊版伺服器不帶） */
  finalSource?: Partial<Record<ReviewFinalSource, number>>;
  corrected?: number;
}
export async function fetchAiReport(token: string, days: number, now = Date.now()): Promise<{ from: number; to: number; versions: AiReportVersion[] }> {
  const p = new URLSearchParams({ from: String(now - days * 86_400_000), to: String(now) });
  return json(await fetch(`${COMMUNITY_API}/review-ai/report?${p}`, { headers: headers(token) }));
}

export interface ReferenceCandidate { id: string; verdict: "pass" | "reject"; reasons: string[]; flags: string[]; why: string; originalWork: boolean; tags: string[]; excerpt: { opening: string; setting: string }; source: { criteriaVersion: string; arbitration: Arbitration } }
export async function fetchReferenceCandidates(token: string): Promise<{ items: ReferenceCandidate[]; skipped: number }> {
  return json(await fetch(`${COMMUNITY_API}/review-ai/reference-candidates?limit=30`, { headers: headers(token) }));
}

/** 給 AI 的說明：原因類型（可多選）與一段 500 字內的說明。定案與仲裁共用，只用來調整判準，不給作者看 */
export const AI_NOTE_TYPES = ["card_content", "author_relation", "author_history", "criteria_issue", "other"] as const;
export type AiNoteType = (typeof AI_NOTE_TYPES)[number];
export const AI_NOTE_MAX = 500;
export const FINAL_SOURCES: readonly ReviewFinalSource[] = ["blind", "ai", "modified", "human_no_ai"];

/** kind=final：定案時寫的（finalSource 是定案來源）；kind=arbitration：仲裁時寫的（arbitration 是仲裁結果） */
export interface AiNoteItem {
  kind: "final" | "arbitration"; at: number; types: AiNoteType[]; note: string | null;
  finalSource: ReviewFinalSource | null; arbitration: Arbitration | null; criteriaVersion: string | null; cardId: string;
}
export const AI_NOTES_LIMIT = 100;
export async function fetchAiNotes(token: string, q: { days: number; type: AiNoteType | null }, now = Date.now()): Promise<{ from: number; to: number; items: AiNoteItem[] }> {
  const p = new URLSearchParams({ from: String(now - q.days * 86_400_000), to: String(now), limit: String(AI_NOTES_LIMIT) });
  if (q.type) p.set("type", q.type);
  return json(await fetch(`${COMMUNITY_API}/review-ai/notes?${p}`, { headers: headers(token) }));
}

/** 原因類型：陣列或 JSON 字串都收，清單外的與讀不懂的丟掉 */
export function noteTypesOf(v: unknown): AiNoteType[] {
  let list: unknown = v;
  if (typeof v === "string") { try { list = JSON.parse(v); } catch { return []; } }
  return Array.isArray(list) ? AI_NOTE_TYPES.filter((t) => list.includes(t)) : [];
}
