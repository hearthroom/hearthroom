/**
 * 更新說明的形狀，Worker 與前端共用。
 *
 * 內容來自 updates/*.json，建置時由 scripts/updates/build.mjs 驗證後打包進 Worker
 * （src/generated/updates.ts，不入庫）。前端不打包內容，一律向 /v1/updates 讀。
 */
export const UPDATE_LOCALES = ["zh-Hant", "zh-Hans", "en", "ja", "ko"] as const;
export type UpdateLocale = (typeof UPDATE_LOCALES)[number];
export type UpdateText = Record<UpdateLocale, string>;
export type UpdateTier = "highlight" | "feature" | "fix";

/** 打包進 Worker 的一則說明（驗證過、補了預設值）。 */
export interface UpdateEntry {
  id: string;
  tier: UpdateTier;
  audience: "everyone" | "authors";
  try: string | null;
  spotlight: string[];
  /** Hearthkeeper 案件編號（24 位十六進位），上線時通知回報的人 */
  reports: string[];
  announce: number;
  draft: boolean;
  /** 程式碼比說明早上線時（回填），那一天的日期（台北） */
  live: string | null;
  title: UpdateText;
  body: UpdateText | null;
}

/** /v1/updates 回給前端的一則。時間是毫秒。 */
export interface UpdateItem {
  id: string;
  tier: UpdateTier;
  audience: "everyone" | "authors";
  /** 第一次上線的時間 */
  liveAt: number;
  /** 最近一次公告的時間；再公告（announce 加一）時會晚於 liveAt */
  announcedAt: number;
  title: string;
  body: string | null;
  try: string | null;
  spotlight: string[];
}

export interface UpdatesResponse {
  items: UpdateItem[];
  /** 過去 30 天上線的新功能（重點＋新功能）與修正數 */
  stats: { features: number; fixes: number; days: number };
}

/** 會員的已讀狀態。前端算規則，伺服器只負責存與合併。 */
export interface UpdateState {
  /** 這個時間（announcedAt）以前的都算看過 */
  seenThrough: number;
  /** 最近一次關掉或點了首頁提示列的時間 */
  stripClosedAt: number;
  /** 提示列出現過、但沒被理會的天數 */
  stripDays: number;
  /** 最近一次計入 stripDays 的那天（本地日期 YYYY-MM-DD） */
  stripDay: string;
  /** 已經用過、不再掛「新」的入口 */
  spotlights: string[];
}

export function pickUpdateText(text: UpdateText, locale: string): string {
  return (text as Record<string, string>)[locale] ?? text["zh-Hant"];
}
