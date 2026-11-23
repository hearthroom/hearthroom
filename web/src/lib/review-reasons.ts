/**
 * 駁回理由代碼的顯示（審卡 V2）。代碼與分組的唯一來源是 shared/review-reasons.ts；
 * 每個代碼的字在語系檔 review.reasons.<代碼>.{name,summary,fix,example,coachFix,before,after}。
 */
import { REVIEW_REASON_GROUPS, REVIEW_REASONS, isOpeningReason, type ReviewReason, type ReviewReasonGroup } from '../../../shared/review-reasons';

export { REVIEW_REASON_GROUPS, REVIEW_REASONS, isOpeningReason, type ReviewReason, type ReviewReasonGroup };

type T = (key: string, named?: Record<string, unknown>) => string;

export const reasonKey = (code: string, field: 'name' | 'summary' | 'fix' | 'fixCount' | 'example' | 'coachFix' | 'before' | 'after') => `review.reasons.${code}.${field}`;

/** 這個代碼有沒有某一欄（分級、其他沒有範例；有效字數不足、分級、其他沒有輔導版） */
export const hasField = (te: (key: string) => boolean, code: string, field: Parameters<typeof reasonKey>[1]) => te(reasonKey(code, field));

/** 卡片列與通知用的理由名稱：兩項以內全列，超過寫「第一項等 N 項」 */
export function reasonSummary(t: T, codes: readonly string[], separator = '、'): string {
  const known = codes.filter((c) => (REVIEW_REASONS as readonly string[]).includes(c));
  if (!known.length) return '';
  if (known.length <= 2) return known.map((c) => t(reasonKey(c, 'name'))).join(separator);
  return t('reviewV2.author.reasonsMore', { first: t(reasonKey(known[0], 'name')), n: known.length });
}

export const hasOpeningReason = (codes: readonly string[]) => codes.some(isOpeningReason);
