/**
 * 冷開首頁（2026-09-26 實測）：頁面程式碼要等語言包到了才開始下載，一串接一串多等約 0.6 s。
 * 現在導航一開始就把這一頁的程式碼跟語言包一起抓。
 */
import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ locale: null as null | (() => void), searchRequested: false }));
vi.mock("../src/lib/stage-preload", () => ({ preloadStage: async () => {} }));
vi.mock("../src/lib/session", () => ({ useSession: () => ({ restore: async () => {}, me: null }) }));
vi.mock("../src/lib/track", () => ({ track: () => {}, currentSurface: () => "", setSurface: () => {} }));
vi.mock("../src/lib/i18n", () => ({
  LOCALE_CODES: ["zh-Hant", "zh-Hans", "en", "ja", "ko"], SOURCE_LOCALE: "zh-Hant",
  applyLocale: () => new Promise<void>((r) => { mocks.locale = r; }),
  detectLocale: () => "zh-Hant", pageTitle: () => "Fixture", updateHreflang: () => {},
}));
// 首頁已經打包進主程式；拿另一個照樣按需載入的頁（搜尋）來驗
vi.mock("../src/pages/BoardPage.vue", () => ({ default: { template: "<div />" } }));
vi.mock("../src/pages/SearchPage.vue", () => { mocks.searchRequested = true; return { default: { template: "<div />" } }; });
import { router } from "../src/router";

it("頁面的程式碼在語言包還沒到時就開始下載", async () => {
  const navigation = router.push("/search");
  for (let i = 0; i < 40; i++) await Promise.resolve();
  expect(mocks.locale, "語言包還在路上").not.toBeNull();
  await vi.waitFor(() => expect(mocks.searchRequested).toBe(true));
  mocks.locale!();
  await navigation;
  expect(router.currentRoute.value.path).toBe("/search");
});
