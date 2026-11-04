/** Server-calculated publication eligibility; independent of token/cost estimates. */
export interface ReviewLength {
  persona: number;
  constantWorldbook: number;
  total: number;
  required: number;
  remaining: number;
  eligible: boolean;
  /** Informational only; never part of total or eligibility. */
  welcome: number;
}
export const REVIEW_REQUIRED_CHARACTERS = 3001;

/** 佇列與蓋章只需要合計：達標與否一律由這裡依現行門檻算，不存結果。 */
export interface ReviewLengthStatus { total: number; required: number; remaining: number; eligible: boolean }
export function reviewLengthStatus(total: number): ReviewLengthStatus {
  return { total, required: REVIEW_REQUIRED_CHARACTERS, remaining: Math.max(0, REVIEW_REQUIRED_CHARACTERS - total), eligible: total >= REVIEW_REQUIRED_CHARACTERS };
}

