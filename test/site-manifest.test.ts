import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../src/index";
import { SHELL, resetDb } from "./helpers";
import { PRIMARY_HOST } from "../shared/site-hosts";
import { siteName } from "../shared/site-name";

const shell = SHELL.replace("<head>", '<head><link rel="manifest" href="/manifest.webmanifest"><meta name="apple-mobile-web-app-title" content="SukiSuki">');
const assets = { fetch: async () => new Response(shell, { headers: { "content-type": "text/html", etag: '"shell"', "last-modified": "Mon, 01 Sep 2025 00:00:00 GMT", vary: "Cookie" } }) } as unknown as Fetcher;
async function page(path: string, acceptLanguage = "en", host: string = PRIMARY_HOST) {
  const ctx = createExecutionContext();
  const response = await worker.fetch(new Request(`https://${host}${path}`, { headers: { "Accept-Language": acceptLanguage } }), { ...env, ASSETS: assets }, ctx);
  await waitOnExecutionContext(ctx);
  return { response, html: await response.text() };
}
beforeEach(resetDb);

describe("initial site manifest", () => {
  it.each([
    ["", "zh-Hant"], ["/zh-Hans", "zh-Hans"], ["/en", "en"], ["/ja", "ja"], ["/ko", "ko"],
  ])("%s serves the correct manifest before JavaScript, on every HTML path", async (prefix, locale) => {
    const href = locale.startsWith("zh-") ? `/manifest.${locale}.webmanifest` : "/manifest.webmanifest";
    for (const path of ["/", "/search", "/library", "/login", "/me", "/checkin", "/campaigns", "/play/100001", "/cards/missing", "/blog/missing/post", "/download"]) {
      const { html, response } = await page(`${prefix}${path}`, prefix ? "zh-CN" : "zh-TW");
      expect(html, `${prefix}${path}`).toContain(`<link rel="manifest" href="${href}">`);
      expect(html).toContain(`<meta name="apple-mobile-web-app-title" content="${siteName(locale)}">`);
      expect(response.headers.get("etag"), `${prefix}${path}`).toBeNull();
      expect(response.headers.get("last-modified")).toBeNull();
      if (!prefix) expect(response.headers.get("vary")).toContain("Accept-Language");
      expect(response.headers.get("vary")).toContain("Cookie");
    }
  });

  it.each([
    ["zh-CN,zh;q=0.9,en;q=0.8", "zh-Hans"], ["zh-TW,zh;q=0.9", "zh-Hant"],
    ["zh-HK", "zh-Hant"], ["zh-SG", "zh-Hans"], ["en-US,en;q=0.9", "en"],
    ["ja-JP", "ja"], ["ko-KR", "ko"], ["de,zh-CN;q=0.8", "zh-Hans"],
    ["en;q=0.5,zh-TW;q=0.9", "zh-Hant"], ["zh-CN;q=0,en", "en"], ["", "zh-Hant"],
  ])("unprefixed HTML follows the browser's initial preference: %s", async (language, locale) => {
    const href = locale.startsWith("zh-") ? `/manifest.${locale}.webmanifest` : "/manifest.webmanifest";
    const { html } = await page("/search", language);
    expect(html).toContain(`<link rel="manifest" href="${href}">`);
  });

  it("does not rewrite a card-app or non-HTML response", async () => {
    const { html } = await page("/login", "zh-CN", `play.${PRIMARY_HOST}`);
    expect(html).toBe(shell);
    const ctx = createExecutionContext();
    const response = await worker.fetch(new Request(`https://${PRIMARY_HOST}/v1/health`), { ...env, ASSETS: assets }, ctx);
    expect(response.headers.get("content-type")).toContain("application/json");
    await waitOnExecutionContext(ctx);
  });
});
