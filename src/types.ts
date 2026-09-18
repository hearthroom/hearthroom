/**
 * 綁定型別由 `npm run types`（wrangler types）從 wrangler.toml 產生，不要手寫。
 *
 * 兩處放寬：埋點的資料集綁定是可選的（分叉的人多半不會配，那時 env.EVENTS 就是 undefined，
 * 型別上就逼呼叫端判空，而不是等執行期炸），開關是任意字串（產生器把它縮成了字面值 "true"）。
 */
export type Env = Omit<Cloudflare.Env, "EVENTS" | "ANALYTICS_ENABLED" | "REVIEW_ENABLED"> & {
  EVENTS?: AnalyticsEngineDataset;
  ANALYTICS_ENABLED?: string;
  /** 社群審核開關："true" 才審；其餘退回「登記即上榜」，見 src/providers.ts。 */
  REVIEW_ENABLED?: string;
  /** 成人卡「加到主畫面」鑰匙的簽章密鑰（`wrangler secret put SHORTCUT_SECRET`）。沒設就不發鑰匙，見 src/shortcut.ts。 */
  SHORTCUT_SECRET?: string;
};

export class HttpError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 429 | 502 | 503,
    message: string,
    readonly detail?: import("./sync-error").SyncDetail,
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
