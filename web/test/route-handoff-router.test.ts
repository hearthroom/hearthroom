/**
 * 換線路的過場頁把一次性的單號放在 # 後面。第一次進站照瀏覽器語言加前綴的那次轉址
 * 以前只帶 path 與 query，# 一丟，換手就斷在半路。
 */
import { expect, it, vi } from "vitest";
vi.mock("../src/lib/stage-preload", () => ({ preloadStage: async () => {} }));
vi.mock("../src/lib/session", () => ({ useSession: () => ({ restore: async () => {}, me: null }) }));
vi.mock("../src/lib/track", () => ({ track: () => {}, currentSurface: () => "", setSurface: () => {} }));
vi.mock("../src/lib/i18n", () => ({
  LOCALE_CODES: ["zh-Hant", "zh-Hans", "en", "ja", "ko"], SOURCE_LOCALE: "zh-Hant",
  applyLocale: async () => {}, detectLocale: () => "en", pageTitle: () => "Fixture", updateHreflang: () => {},
}));
vi.mock("../src/pages/BoardPage.vue", () => ({ default: { template: "<div />" } }));
vi.mock("../src/pages/RouteHandoffPage.vue", () => ({ default: { template: "<div />" } }));
import { router } from "../src/router";

it("keeps the fragment through the first-visit language redirect", async () => {
  await router.push("/auth/route/complete#code=abc");
  expect(router.currentRoute.value.path).toBe("/en/auth/route/complete");
  expect(router.currentRoute.value.hash).toBe("#code=abc");
  expect(router.currentRoute.value.meta).toMatchObject({ bare: true, handoff: "complete" });
});
