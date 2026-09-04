/** 綁定型別由 `npm run types`（wrangler types）從 wrangler.toml 產生，不要手寫。 */
export type Env = Cloudflare.Env;

export class HttpError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 502,
    message: string,
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
