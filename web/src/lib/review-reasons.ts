/**
 * 駁回理由代碼的顯示（審卡 V2）。代碼與分組的唯一來源是 shared/review-reasons.ts；
 * 每個代碼的字在語系檔 review.reasons.<代碼>.{name,summary,fix,example,coachFix,before,after}。
 * 個別代碼多出來的欄：afterChoices（輔導版第二個改後，配 afterLabel／afterChoicesLabel 兩個小標）、
 * options.*（「給選項的三種做法」，範例之後的一塊）。有沒有都看語系檔，不寫死代碼。
 */
import { REVIEW_REASON_GROUPS, REVIEW_REASONS, isOpeningReason, type ReviewReason, type ReviewReasonGroup } from '../../../shared/review-reasons';

export { REVIEW_REASON_GROUPS, REVIEW_REASONS, isOpeningReason, type ReviewReason, type ReviewReasonGroup };

type T = (key: string, named?: Record<string, unknown>) => string;

export const reasonKey = (code: string, field: 'name' | 'summary' | 'fix' | 'fixCount' | 'example' | 'coachFix' | 'before' | 'after' | 'afterLabel' | 'afterChoices' | 'afterChoicesLabel') => `review.reasons.${code}.${field}`;

/** 「給選項的三種做法」的三項，照這個順序畫；tag 的範例是作者要照打的標記，用等寬區塊顯示 */
export const REASON_OPTION_WAYS = ['field', 'text', 'tag'] as const;
export type ReasonOptionWay = (typeof REASON_OPTION_WAYS)[number];
export const reasonOptionKey = (code: string, part: 'title' | `${ReasonOptionWay}.${'name' | 'desc' | 'example'}`) => `review.reasons.${code}.options.${part}`;
export const hasOptions = (te: (key: string) => boolean, code: string) => te(reasonOptionKey(code, 'title'));

/** 這個代碼有沒有某一欄（分級、其他沒有範例；有效字數不足、分級、其他沒有輔導版） */
export const hasField = (te: (key: string) => boolean, code: string, field: Parameters<typeof reasonKey>[1]) => te(reasonKey(code, field));

/**
 * 婉拒（owner 2026-11-24）：勾了就送出，作者收到固定的溫和回覆。審核員端的選項名（「短期大量送審、內容雷同」）不給作者看：
 * 作者端只寫回覆正文（兩項都勾時合成一段 bothFix），清單與通知的理由摘要只寫「婉拒」（shortChip）。
 */
export const isDeclineReason = (code: string) => code.startsWith('decline.');
export const declineCodes = (codes: readonly string[]) => codes.filter(isDeclineReason);
/** 作者會收到的婉拒回覆：一項用那一項的正文，兩項合成一段；沒勾婉拒是空字串 */
export function declineReply(t: T, codes: readonly string[]): string {
  const picked = declineCodes(codes);
  if (!picked.length) return '';
  return picked.length > 1 ? t('review.reasons.decline.bothFix') : t(reasonKey(picked[0], 'fix'));
}

/** 卡片列與通知用的理由名稱：兩項以內全列，超過寫「第一項等 N 項」。婉拒不論勾幾項都只算一項「婉拒」 */
export function reasonSummary(t: T, codes: readonly string[], separator = '、'): string {
  const known = codes.filter((c) => (REVIEW_REASONS as readonly string[]).includes(c));
  const names = [...(known.some(isDeclineReason) ? [t('review.reasons.decline.shortChip')] : []), ...known.filter((c) => !isDeclineReason(c)).map((c) => t(reasonKey(c, 'name')))];
  if (!names.length) return '';
  if (names.length <= 2) return names.join(separator);
  return t('reviewV2.author.reasonsMore', { first: names[0], n: names.length });
}

export const hasOpeningReason = (codes: readonly string[]) => codes.some(isOpeningReason);
