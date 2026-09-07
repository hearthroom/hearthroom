import type { Env } from "./types";

/**
 * 供應商。
 *
 * 本站是社群站，主站是它的 SaaS 供應商——登入、卡片內容、對話都住在供應商那邊，這裡
 * 只擁有「誰登記了哪張卡、審到哪一步、誰蓋了章」。現在只有一家（lunatalk），但成員、
 * 身分、卡片與審核單全部都帶著供應商代號，接第二家時是加一列設定，不是改資料表。
 *
 * 契約分兩級：
 *   基本級：OAuth 登入＋「你是誰」、讀卡片公開資料、內容雜湊 → 能登記、上榜、搜尋
 *   完整級：授權讀整份設定、對話介面 → 能在站內審核與試玩
 *
 * 審核機器人：本站在供應商那邊持有一個服務帳號。作者提交時把卡授權給它，站方審核人員
 * 透過它讀設定。金鑰是 Worker 的 secret（REVIEW_BOT_KEY），公開數字 ID 是一般變數
 * （REVIEW_BOT_ACCOUNT_NUM_ID）。兩個都沒配時本站退回「登記即上榜」——分叉自架的人
 * 不想做審核也能跑。
 */
export type ProviderId = "lunatalk";

export const DEFAULT_PROVIDER: ProviderId = "lunatalk";

export interface ReviewBot {
  key: string;
  accountNumId: number;
}

/** 這家供應商的審核機器人；沒配就是 null，提交走「登記即上榜」。 */
export function reviewBotOf(env: Env, provider: ProviderId = DEFAULT_PROVIDER): ReviewBot | null {
  if (provider !== "lunatalk") return null;
  const key = (env.REVIEW_BOT_KEY ?? "").trim();
  const accountNumId = Number(env.REVIEW_BOT_ACCOUNT_NUM_ID);
  if (!key || !Number.isSafeInteger(accountNumId) || accountNumId <= 0) return null;
  return { key, accountNumId };
}
