import { siteName } from "../shared/site-name";

const LOCALES = ["zh-Hant", "zh-Hans", "en", "ja", "ko"];

/** Match the first-navigation language detection in web/src/lib/i18n.ts. */
function manifestLocale(path: string, acceptLanguage: string): string {
  const prefix = path.match(/^\/(zh-Hans|en|ja|ko)(?:\/|$)/)?.[1];
  if (prefix) return prefix;
  const preferences = acceptLanguage.split(",").map((entry) => {
    const [language, ...parameters] = entry.trim().split(";");
    const weight = parameters.find((value) => /^\s*q=/i.test(value));
    return { language: language!.toLowerCase(), q: weight ? Number(weight.split("=")[1]) : 1 };
  }).filter(({ q }) => Number.isFinite(q) && q > 0 && q <= 1).sort((a, b) => b.q - a.q);
  for (const { language } of preferences) {
    const exact = LOCALES.find((locale) => locale.toLowerCase() === language);
    if (exact) return exact;
    if (language.startsWith("zh")) return /(tw|hk|mo|hant)/.test(language) ? "zh-Hant" : "zh-Hans";
    const base = LOCALES.find((locale) => locale.split("-")[0] === language.split("-")[0]);
    if (base) return base;
  }
  return "zh-Hant";
}

/** Select the installed site's identity before the browser parses its first manifest link. */
export function renderSiteManifest(page: Response, path: string, acceptLanguage: string): Response {
  const locale = manifestLocale(path, acceptLanguage);
  const href = locale.startsWith("zh-") ? `/manifest.${locale}.webmanifest` : "/manifest.webmanifest";
  const response = new HTMLRewriter()
    .on('link[rel="manifest"]', { element: (element) => { element.setAttribute("href", href); } })
    .on('meta[name="apple-mobile-web-app-title"]', { element: (element) => { element.setAttribute("content", siteName(locale)); } })
    .transform(page);
  response.headers.delete("etag");
  response.headers.delete("last-modified");
  if (!/^\/(zh-Hans|en|ja|ko)(?:\/|$)/.test(path) && !response.headers.get("Vary")?.toLowerCase().includes("accept-language")) {
    response.headers.append("Vary", "Accept-Language");
  }
  return response;
}
