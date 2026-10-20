import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { siteName } from "../../shared/site-name";

vi.mock("../src/lib/stage-preload", () => ({ preloadStage: async () => {} }));
vi.mock("../src/lib/session", () => ({ useSession: () => ({ restore: async () => {}, me: null }) }));
vi.mock("../src/lib/track", () => ({ track: () => {}, currentSurface: () => "", setSurface: () => {} }));
vi.mock("../src/pages/BoardPage.vue", () => ({ default: { template: "<div />" } }));
vi.mock("../src/pages/SearchPage.vue", () => ({ default: { template: "<div />" } }));
import { router } from "../src/router";
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("localized site installation identity (decision C)", () => {
  it.each(["zh-Hant", "zh-Hans", "en", "ja", "ko"])("%s retains the existing brand and App id", (locale) => {
    const href = locale.startsWith("zh-") ? `/manifest.${locale}.webmanifest` : "/manifest.webmanifest";
    const actual = JSON.parse(read(`../public${href}`));
    expect([actual.id, actual.scope, actual.name, actual.short_name]).toEqual(["/", "/", siteName(locale), siteName(locale)]);
  });

  it("routing never replaces the manifest selected in the initial HTML", async () => {
    document.head.innerHTML = '<link rel="manifest" href="/manifest.zh-Hans.webmanifest">';
    for (const prefix of ["/en", "/ja", "/ko", "", "/zh-Hans"]) {
      await router.push(`${prefix}/search`);
      expect(document.head.querySelector('link[rel="manifest"]')?.getAttribute("href")).toBe("/manifest.zh-Hans.webmanifest");
    }
  });
});
