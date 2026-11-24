/**
 * 駁回理由代碼（審卡 V2，da.md「打回理由與標籤」）。審核頁、作者結果頁、通知、統計共用同一份清單；
 * 每個代碼的名稱、一句話、怎麼改、短例在語系檔 review.reasons.<代碼>.*。
 *
 * 語意改了就加新代碼、把舊的移到 RETIRED（歷史單照樣顯示），不要改既有代碼的意思。
 */
/** 2：owner 2026-11-23 追加「開場白讀起來像未修改的 AI 生成文字」「設定直接搬運現成文本」
 *  3：owner 2026-11-24 追加「婉拒」兩項（短期大量送審內容雷同、不太符合平台公開要求）：勾了就送出，作者收到固定的溫和說明 */
export const REVIEW_REASON_VERSION = 3;

export const REVIEW_REASON_GROUPS = {
  opening: ['opening.no_reply_hook', 'opening.no_focused_event', 'opening.exposition_only', 'opening.too_short', 'opening.unedited_generated'],
  setting: ['content.min_length', 'character.setting_thin', 'character.copied_verbatim'],
  rating: ['rating.mismatch'],
  decline: ['decline.burst_similar', 'decline.not_ready'],
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

/**
 * 審核標記（owner 2026-11-23）：審核員對這張卡的判斷，只給審核與數據用，作者看不到；任何決定（通過、駁回、不受理）都能標。
 * 跟駁回理由分開：理由告訴作者怎麼改，標記記審核員的懷疑，餵作者側寫。字在語系檔 reviewV2.marks.<代碼>。
 */
export const REVIEW_DECISION_MARKS = ['suspect_ai_text', 'suspect_copied'] as const;
export type ReviewDecisionMark = (typeof REVIEW_DECISION_MARKS)[number];
export function normalizeDecisionMarks(raw: unknown): ReviewDecisionMark[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.some((m) => !(REVIEW_DECISION_MARKS as readonly unknown[]).includes(m))) throw new Error('review_mark_invalid');
  const set = new Set(raw);
  return REVIEW_DECISION_MARKS.filter((m) => set.has(m));
}
