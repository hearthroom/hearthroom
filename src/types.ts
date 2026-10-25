/**
 * 綁定型別由 `npm run types`（wrangler types）從 wrangler.toml 產生，不要手寫。
 *
 * 兩處放寬：埋點的資料集綁定是可選的（分叉的人多半不會配，那時 env.EVENTS 就是 undefined，
 * 型別上就逼呼叫端判空，而不是等執行期炸），開關是任意字串（產生器把它縮成了字面值 "true"）。
 */
export type Env = Omit<Cloudflare.Env, "EVENTS" | "VISIT_LIMIT" | "AUTH_ROUTE_LIMIT" | "AUTH_SILENT_ENABLED" | "ANALYTICS_ENABLED" | "GA4_ENABLED" | "REVIEW_ENABLED" | "PUSH_VAPID_PUBLIC_KEY" | "PUSH_VAPID_SUBJECT"> & {
  QA_BROWSER_CONTEXT_KEY?: string;
 QA_ACCOUNT_CONTROL_KEY?: string;
  HARBOR_TEST_ACCOUNTS_ENABLED?: string;
  DRAFT_TRANSFER_CONTROL_SECRET?: string;
  /** Worker secret, shared only with Harbor's runtime env; independent of Console. */
  HARBOR_HEARTHROOM_PROXY_SECRET?: string;
  DRAFT_TRANSFER_CONTROL_SCOPE?: string;
  DRAFT_TRANSFER_CONTROL_CARD_NUM?: string;
  AUTH_ENABLED?: string;
  /** Enable only after Harbor prompt=none has deployed and passed live readback. */
  AUTH_SILENT_ENABLED?: string;
  AUTH_ROUTE_LIMIT?: RateLimit;
  AUTH_ALLOWED_ORIGINS?: string;
  /** Add explicit serving origins without replacing the existing encrypted allowlist. */
  AUTH_ADDITIONAL_ORIGINS?: string;
  AUTH_KEYRING?: string;
  AUTH_METRICS_SECRET?: string;
  COMMUNITY_ENABLED?: string;
  COMMUNITY_GUILD_ID?: string;
  COMMUNITY_SITE_URL?: string;
  COMMUNITY_INVITE_URL?: string;
  COMMUNITY_BRIDGE_KEY?: string;
  COMMUNITY_XP_CHANNELS?: string;
  DISCORD_CLIENT_ID?: string;
  DISCORD_CLIENT_SECRET?: string;
  /** Web Push (VAPID): public key and subject are plain vars, the private key is a secret; unset = feature off. */
  PUSH_VAPID_PUBLIC_KEY?: string;
  PUSH_VAPID_PRIVATE_KEY?: string;
  PUSH_VAPID_SUBJECT?: string;
  EVENTS?: AnalyticsEngineDataset;
  /** 分享碼訪客計數的限流（wrangler.toml [[ratelimits]]）；沒綁就不限。 */
  VISIT_LIMIT?: RateLimit;
  /** Hearthroom → Harbor issuer credential. */
  HOSTING_SERVICE_KEY?: string;
  /** Author controls remain off until the complete visibility release is approved. */
  WORK_SHARING_ENABLED?: string;
  /** 卡片分享情境（?share=）的平台總開關："true" 才轉送給卡片；其他值一律關（卡片拿到 null、分享鈕照常）。 */
  SHARE_CONTEXT_ENABLED?: string;
  /** Hearthroom 在 Harbor 的固定 OAuth 客戶端（公開識別，非密鑰）；設了就不再動態註冊。 */
  HARBOR_CLIENT_ID?: string;
  /** 應用獎勵上報用的機密客戶端（client_credentials，只有 rewards.report）；沒設就不送，事件留在待送清單 */
  HARBOR_REWARDS_CLIENT_ID?: string;
  HARBOR_REWARDS_CLIENT_SECRET?: string;
  /** 分享連結訪客雜湊的鑰匙（每週由它衍生一把）；沒設就用 isolate 內的隨機鑰匙 */
  SHARE_VISITOR_SECRET?: string;
  ANALYTICS_ENABLED?: string;
  /** GA4 is off until its resource settings and privacy notice are approved. */
  GA4_ENABLED?: string;
  /** 社群審核開關："true" 才審；其餘退回「登記即上榜」，見 src/providers.ts。 */
  REVIEW_ENABLED?: string;
  /** 成人卡「加到主畫面」鑰匙的簽章密鑰（`wrangler secret put SHORTCUT_SECRET`）。沒設就不發鑰匙，見 src/shortcut.ts。 */
  SHORTCUT_SECRET?: string;
};

export class HttpError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 410 | 429 | 502 | 503,
    message: string,
    readonly detail?: import("./sync-error").SyncDetail,
    /** 跟 error 並列放進回應本體的欄位（例如禁言的到期時間）。 */
    readonly extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}

/** 一張卡自帶四個語言版本。缺的語言回退到 zh。 */
export type Localized = { zh: string; en: string; ja: string; ko: string };

export const pickLocale = (v: Localized, lang: string): string => {
  const key = lang.startsWith("en") ? "en" : lang.startsWith("ja") ? "ja" : lang.startsWith("ko") ? "ko" : "zh";
  return v[key] || v.zh;
};
