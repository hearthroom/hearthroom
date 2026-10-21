import { beforeEach, expect, it, vi, afterEach } from "vitest";
import { captureGa4Source, ga4SignupVia } from "../src/lib/ga4-attribution";
beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());
it("keeps only source category and time for 30 days across tabs", () => {
  captureGa4Source("https://sukisuki.ai/cards/123?ref=ABCD", 1000);
  expect(ga4SignupVia(86400000)).toBe("card_share");
  expect(JSON.stringify(localStorage)).not.toContain("ABCD");
  expect(ga4SignupVia(1000 + 30 * 86400000)).toBe("none");
});
it("updates on another SPA landing and uses the last qualifying click", () => {
  captureGa4Source("https://sukisuki.ai/?ref=ABCD", 1000);
  captureGa4Source("https://sukisuki.ai/?s=ABCDEFGH", 2000);
  captureGa4Source("https://sukisuki.ai/?q=private", 3000);
  expect(ga4SignupVia(4000)).toBe("campaign_share");
});
it("does not persist an analytics source on GPC", () => {
  vi.stubGlobal("navigator", { globalPrivacyControl: true });
  captureGa4Source("https://sukisuki.ai/?ref=ABCD", 1000);
  expect(ga4SignupVia(2000)).toBe("none");
});
