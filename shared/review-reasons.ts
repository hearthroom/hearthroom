/**
 * 駁回理由代碼（審卡 V2，da.md「打回理由與標籤」）。審核頁、作者結果頁、通知、統計共用同一份清單；
 * 每個代碼的名稱、一句話、怎麼改、短例在語系檔 review.reasons.<代碼>.*。
 *
 * 語意改了就加新代碼、把舊的移到 RETIRED（歷史單照樣顯示），不要改既有代碼的意思。
 */
export const REVIEW_REASON_VERSION = 1;

export const REVIEW_REASON_GROUPS = {
  opening: ['opening.no_reply_hook', 'opening.no_focused_event', 'opening.exposition_only', 'opening.too_short'],
  setting: ['content.min_length', 'character.setting_thin'],
  rating: ['rating.mismatch'],
  other: ['other'],
} as const;

export type ReviewReasonGroup = keyof typeof REVIEW_REASON_GROUPS;
export type ReviewReason = (typeof REVIEW_REASON_GROUPS)[ReviewReasonGroup][number];

export const REVIEW_REASONS: readonly ReviewReason[] = Object.values(REVIEW_REASON_GROUPS).flat();
/** 停用的代碼：不能再選，歷史單照樣顯示 */
export const RETIRED_REVIEW_REASONS: readonly string[] = [];

export const isReviewReason = (v: unknown): v is ReviewReason => typeof v === 'string' && (REVIEW_REASONS as readonly string[]).includes(v);
export const isOpeningReason = (code: string) => code.startsWith('opening.');

/** 舊的五個預寫理由對應到的代碼（舊頁面、舊說明文字的對照） */
export const LEGACY_REASON_CODES: Record<string, ReviewReason> = {
  length: 'content.min_length',
  setting: 'character.setting_thin',
  opening: 'opening.too_short',
  rating: 'rating.mismatch',
  other: 'other',
};

/** 存在單上的理由（JSON 陣列字串）讀回來：去重、只留認得的代碼（含停用的），順序照清單。 */
export function parseReviewReasons(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    const known = new Set<string>([...REVIEW_REASONS, ...RETIRED_REVIEW_REASONS]);
    const picked = new Set(list.filter((v): v is string => typeof v === 'string' && known.has(v)));
    return [...REVIEW_REASONS, ...RETIRED_REVIEW_REASONS].filter((c) => picked.has(c));
  } catch {
    return [];
  }
}
