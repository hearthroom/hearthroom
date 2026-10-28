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
