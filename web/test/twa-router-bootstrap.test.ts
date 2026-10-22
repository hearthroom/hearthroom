import { afterEach, expect, it, vi } from "vitest";
import type { Window as HappyWindow } from "happy-dom";

vi.mock("../src/lib/stage-preload", () => ({ preloadStage: async () => {} }));
vi.mock("../src/lib/session", () => ({ useSession: () => ({ restore: async () => {}, me: null }) }));
vi.mock("../src/lib/track", () => ({ track: () => {}, currentSurface: () => "", setSurface: () => {} }));

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); sessionStorage.clear(); });
it("clears carried runtime metadata before Vue Router captures its initial history location", async () => {
  (window as unknown as HappyWindow).happyDOM.setURL("https://sukisuki.chat/en/auth/route/complete?_hr_app=twa#code=fixture");
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (Linux; Android 15) Chrome/124");
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener() {} }));
  const { router } = await import("../src/router");
  expect(router.options.history.location).toBe("/en/auth/route/complete#code=fixture");
  expect(sessionStorage.getItem("hearthroom.androidApp")).toBe("1");
  expect(location.search).toBe("");
  router.options.history.destroy();
});
