import { REVIEW_REASONS, isReviewReason } from "../../../shared/review-reasons";
import type { ReviewAiState } from "./api";
import type { AiSuggestion, Arbitration, HumanDecision } from "./review-ai-api";

/**
 * 揭曉區與仲裁頁共用的判斷（純函式，元件只排版）。
 *
 * 比對規則（ui-reveal.md「請 PM 裁定」1）：不受理算「駁回」、重新審核的「維持通過」算「通過」；畫面上照寫人的動作名稱。
 * 交人（handoff）不算一致也不算不同，沒有覆核。
 */

/** 判準版本 v<n> 的數字；比大小用數字，v10 在 v9 之後 */
export const versionNumber = (v: string) => Number(/^v(\d+)$/.exec(v)?.[1] ?? -1);

/**
 * 一張單可能有多個判準版本的建議：揭曉最新版本那一筆。只打標記、沒下結論的那種（verdict=null）不算，
 * 覆核也不收它。同版本只會有一筆（伺服器唯一鍵），保險起見再以時間取新的。
 */
export function latestSuggestion(list: readonly AiSuggestion[]): AiSuggestion | null {
  let best: AiSuggestion | null = null;
  for (const s of list) {
    if (s.verdict === null) continue;
    if (!best) { best = s; continue; }
    const d = versionNumber(s.criteriaVersion) - versionNumber(best.criteriaVersion);
    if (d > 0 || (d === 0 && s.at > best.at)) best = s;
  }
  return best;
}

/** 審核員自己的決定：通過（含維持通過）、駁回、不受理 */
export type MyDecision = "approve" | "reject" | "drop";
export const comparableOf = (mine: MyDecision): "pass" | "reject" => (mine === "approve" ? "pass" : "reject");
/** null＝AI 交人，沒有一致與否 */
export function agrees(mine: MyDecision, verdict: AiSuggestion["verdict"]): boolean | null {
  if (verdict !== "pass" && verdict !== "reject") return null;
  return comparableOf(mine) === verdict;
}

export type ReasonSide = "both" | "mine" | "ai";
/** 雙方都駁回時逐項比理由：順序照理由清單，清單外的代碼排在最後 */
export function compareReasons(mine: readonly string[], ai: readonly string[]): { code: string; side: ReasonSide }[] {
  const m = new Set(mine), a = new Set(ai);
  const order = [...REVIEW_REASONS, ...[...m, ...a].filter((c) => !(REVIEW_REASONS as readonly string[]).includes(c))];
  const out: { code: string; side: ReasonSide }[] = [];
  for (const code of new Set(order)) {
    if (m.has(code) && a.has(code)) out.push({ code, side: "both" });
    else if (m.has(code)) out.push({ code, side: "mine" });
    else if (a.has(code)) out.push({ code, side: "ai" });
  }
  return out;
}

/**
 * 參考範例進哪個池（與伺服器 arbitrate 同一條規則）：照仲裁後的正確結論。
 * 人對取人工結論（通過→通過池，駁回與不受理→駁回池），AI 對取 AI 的結論；其他兩個結果不能當範例。
 */
export function referencePool(value: Arbitration | null, human: HumanDecision, ai: "pass" | "reject"): "pass" | "reject" | null {
  if (value === "human_right") return human === "approved" ? "pass" : "reject";
  if (value === "ai_right") return ai;
  return null;
}

/** 報表：分母少於這個數的格子顯示「樣本不足」（沿用審核統計的門檻） */
export const MIN_SAMPLE = 10;
export const enough = (n: number | null | undefined) => typeof n === "number" && n >= MIN_SAMPLE;

/** AI 分歧分頁與路由只給管理員（與審核統計同一個判斷；服務端每次也檢查） */
export const isManagerRole = (role: string | null | undefined) => role === "manager" || role === "owner";

// ---- 兩段式決定（盲審→揭曉→定案） ----

/** 揭曉時 AI 那一欄的狀態：讀取中、讀不到、還沒審完、沒有可用的判斷（交人、拒答、駁回卻沒有正式理由）、已判 */
export type AiView = "loading" | "error" | "pending" | "none" | "ready";

/**
 * 定案時伺服器拿來比的那一筆 AI 判斷（與服務端 aiStateOf 同一條規則）：清單照更新時間新到舊，第一筆下了結論的。
 * 揭曉與「用 AI 的」都用這一筆，按鈕寫的結論才會等於實際蓋下去的。只打標記、沒下結論的不算。
 */
export function aiStateOf(list: readonly AiSuggestion[]): ReviewAiState {
  const s = list.find((x) => x.verdict !== null);
  if (!s) return { state: "pending", suggestion: null };
  return { state: s.verdict === "handoff" ? "handoff" : "ready", suggestion: s };
}

/** AI 的結論換成審核員的說法；交人與沒下結論是 null */
export const aiAsHuman = (v: AiSuggestion["verdict"]): "approve" | "reject" | null => (v === "pass" ? "approve" : v === "reject" ? "reject" : null);

/** AI 選的理由裡，作者看得到改法的那些（正式理由代碼）；「用 AI 的」駁回時作者看到的就是這些 */
export const aiReasonCodes = (s: AiSuggestion) => REVIEW_REASONS.filter((c) => s.reasons.includes(c) && isReviewReason(c));

/** 「用 AI 的」能不能選：AI 下了通過，或下了駁回且至少有一個正式理由代碼（伺服器同一條規則，否則 409 ai_choice_unavailable） */
export function aiChoiceUsable(s: AiSuggestion | null): boolean {
  if (!s) return false;
  if (s.verdict === "pass") return true;
  return s.verdict === "reject" && aiReasonCodes(s).length > 0;
}

/** 這個定案會讓卡上架、而盲審判斷是駁回：只有這種情況要跳確認（PM 2026-11-24） */
export const publishesAgainstBlind = (blind: "approve" | "reject", final: "approve" | "reject") => blind === "reject" && final === "approve";

/** 已等幾秒：從盲審送出的時間算；兩邊時鐘可能差一點，不會是負的 */
export const waitedSeconds = (since: number, now: number) => Math.max(0, Math.floor((now - since) / 1000));
