import { REVIEW_REASONS, isReviewReason } from "../../../shared/review-reasons";
import type { ReviewAiState } from "./api";
import type { AiSuggestion, Arbitration, HumanDecision } from "./review-ai-api";

/** 審核頁的「AI 審卡」區塊、仲裁頁與報表共用的判斷（純函式，元件只排版）。 */

/** 判準版本 v<n> 的數字；比大小用數字，v10 在 v9 之後 */
export const versionNumber = (v: string) => Number(/^v(\d+)$/.exec(v)?.[1] ?? -1);

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

// ---- AI 為主（ui-ai-first.md） ----

/** 「AI 審卡」區塊的狀態：讀取中、讀不到、還沒審完、沒有判斷（交人、拒答）、已判 */
export type AiView = "loading" | "error" | "pending" | "none" | "ready";

/**
 * 定案時伺服器拿來比的那一筆 AI 判斷（與服務端 aiStateOf 同一條規則）：清單照更新時間新到舊，第一筆下了結論的。
 * 「AI 審卡」區塊與「照 AI 定案」都用這一筆，按鈕寫的結論才會等於實際蓋下去的。只打標記、沒下結論的不算。
 */
/** 只看目前判準版本的建議（伺服器給 current）；沒有就是 AI 尚未用目前判準審完。舊伺服器沒給 current 時取最新一筆 */
export function aiStateOf(list: readonly AiSuggestion[], current?: string | null): ReviewAiState {
  const s = list.find((x) => x.verdict !== null && (!current || x.criteriaVersion === current));
  if (!s) return { state: "pending", suggestion: null };
  return { state: s.verdict === "handoff" ? "handoff" : "ready", suggestion: s };
}

/** AI 的結論換成審核員的說法；交人與沒下結論是 null */
export const aiAsHuman = (v: AiSuggestion["verdict"]): "approve" | "reject" | null => (v === "pass" ? "approve" : v === "reject" ? "reject" : null);

/** AI 選的理由裡，作者看得到改法的那些（正式理由代碼）；照 AI 駁回時作者看到的就是這些 */
export const aiReasonCodes = (s: AiSuggestion) => REVIEW_REASONS.filter((c) => s.reasons.includes(c) && isReviewReason(c));
