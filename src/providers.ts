import { HttpError } from "./types";
import type { Env } from "./types";

/**
 * 供應商。
 *
 * 本站是社群站，卡片內容、登入、對話都住在供應商那邊，這裡只擁有「誰登記了哪張卡、
 * 審到哪一步、誰蓋了章」。成員、身分、卡片與審核單全部都帶著供應商代號，所以接第二家
 * 是加一列設定，不是改資料表。
 *
 * 兩家的資料完全不混（owner 2026-09-16）：同一個外部數字 ID 在兩家是兩個人，
 * 榜單、搜尋、作者頁也各看各的。
 *
 * 契約分兩級：
 *   基本級：OAuth 登入＋「你是誰」、讀卡片公開資料、內容雜湊 → 能登記、上榜、搜尋
 *   完整級：授權讀整份設定、對話介面 → 能在站內審核與試玩
 *
 * 審核機器人：本站在供應商那邊持有一個服務帳號。作者提交時把卡授權給它，站方審核人員
 * 透過它讀設定。金鑰是 Worker 的 secret（REVIEW_BOT_KEY），公開數字 ID 是一般變數
 * （REVIEW_BOT_ACCOUNT_NUM_ID）。沒有機器人的供應商退回「登記即上榜」——分叉自架的人
 * 不想做審核也能跑。
 */
export type ProviderId = "lunatalk" | "harbor";

export const PROVIDER_IDS: readonly ProviderId[] = ["lunatalk", "harbor"];

export const DEFAULT_PROVIDER: ProviderId = "lunatalk";

/** 這個部署有沒有設定這家：API 位址的環境變數名。第二家起加後綴，第一家維持原名不動。 */
const API_BASE_VAR: Record<ProviderId, keyof ProviderEnv> = {
  lunatalk: "PROVIDER_API_BASE",
  harbor: "PROVIDER_API_BASE_HARBOR",
};

/** 只有 lunatalk 有審核機器人；Harbor 那邊還沒有分享／審核介面。 */
const HAS_REVIEW_BOT: Record<ProviderId, boolean> = { lunatalk: true, harbor: false };

export interface ProviderEnv {
  PROVIDER_API_BASE: string;
  PROVIDER_API_GATEWAYS?: string;
  PROVIDER_API_BASE_HARBOR?: string;
}

/**
 * 這個請求屬於哪一家。呼叫端用 X-Provider 明說；沒帶就是預設那家，已部署的舊客戶端照常。
 *
 * 不認得的值一律擋下，**不退回預設**：退回預設等於拿 A 家的 token 去問 B 家的資料，
 * 而兩家的 token 格式沒有互斥保證，猜錯就是把一個人當成另一個人。
 */
export function parseProvider(header: string | undefined | null): ProviderId {
  const raw = (header ?? "").trim().toLowerCase();
  if (!raw) return DEFAULT_PROVIDER;
  const hit = PROVIDER_IDS.find((id) => id === raw);
  if (!hit) throw new HttpError(400, "unknown provider");
  return hit;
}

/**
 * 依來源國別挑供應商的 API 網址。`PROVIDER_API_GATEWAYS` 是 `CC=網址` 的逗號清單：某些地區連不上
 * 供應商的主網域，那邊的瀏覽器改打對應的閘道。閘道只作用在預設那家——它是為了繞開特定網域的封鎖，
 * 不是通用轉送。沒有對應項、或清單為空，就是主網址。
 */
export function parseGateways(spec: string | undefined): Map<string, string> {
  const out = new Map<string, string>();
  for (const item of (spec ?? "").split(/[,\s]+/)) {
    const eq = item.indexOf("=");
    if (eq <= 0) continue;
    const cc = item.slice(0, eq).trim().toUpperCase();
    const url = item.slice(eq + 1).trim().replace(/\/+$/, "");
    if (cc && /^https?:\/\//.test(url)) out.set(cc, url);
  }
  return out;
}

/** 這家供應商的 API 位址。沒設定就是這個部署沒有這家。 */
export function apiBaseOf(env: ProviderEnv, provider: ProviderId = DEFAULT_PROVIDER, country = ""): string {
  const base = (env[API_BASE_VAR[provider]] ?? "").toString().trim();
  if (!base) throw new HttpError(400, "provider not configured");
  if (provider !== DEFAULT_PROVIDER) return base;
  return parseGateways(env.PROVIDER_API_GATEWAYS).get(country.toUpperCase()) ?? base;
}

/** 這個部署設定了哪幾家。登入頁照這個列按鈕，自架只接一家的人就只看到一顆。 */
export function configuredProviders(env: ProviderEnv): ProviderId[] {
  return PROVIDER_IDS.filter((id) => ((env[API_BASE_VAR[id]] ?? "").toString().trim() !== ""));
}

/** 要求這個請求的供應商已經設定過；沒有就當成不認得的值擋下。 */
export function requireConfigured(env: ProviderEnv, provider: ProviderId): ProviderId {
  apiBaseOf(env, provider);
  return provider;
}

export function providerApiBaseFor(env: ProviderEnv, country: string): string {
  return apiBaseOf(env, DEFAULT_PROVIDER, country);
}

export interface ReviewBot {
  key: string;
  accountNumId: number;
}

/** 這家供應商的審核機器人；沒有就是 null，提交走「登記即上榜」。 */
export function reviewBotOf(env: Env, provider: ProviderId = DEFAULT_PROVIDER): ReviewBot | null {
  if (!HAS_REVIEW_BOT[provider]) return null;
  const key = (env.REVIEW_BOT_KEY ?? "").trim();
  const accountNumId = Number(env.REVIEW_BOT_ACCOUNT_NUM_ID);
  if (!key || !Number.isSafeInteger(accountNumId) || accountNumId <= 0) return null;
  return { key, accountNumId };
}
