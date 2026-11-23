import { REVIEW_REASONS } from "../../../shared/review-reasons";
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
