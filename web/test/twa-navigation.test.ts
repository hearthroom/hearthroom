import { afterEach, beforeEach, expect, it, vi } from "vitest";

beforeEach(() => { vi.resetModules(); sessionStorage.clear(); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); sessionStorage.clear(); });
function at(url: string, standalone = true) {
  const parsed = new URL(url);
  vi.stubGlobal("location", { href: parsed.href, origin: parsed.origin, hostname: parsed.hostname, pathname: parsed.pathname, search: parsed.search, hash: parsed.hash });
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (Linux; Android 15) Chrome/124");
  vi.stubGlobal("matchMedia", () => ({ matches: standalone }));
}
it("carries TWA navigation identity to another official origin without losing query or hash", async () => {
  at("https://sukisuki.ai/en/search?q=cat#results");
  sessionStorage.setItem("hearthroom.androidApp", "1");
  const { targetUrl, lineByNumber } = await import("@/lib/routes");
  expect(targetUrl(lineByNumber(3)!)).toBe("https://sukisuki.chat/en/search?q=cat&_hr_app=twa#results");
});
it("recognizes carried TWA identity on a new origin and removes the query marker before routing", async () => {
  at("https://sukisuki.chat/auth/route/complete?_hr_app=twa#code=example");
  const replace = vi.spyOn(history, "replaceState");
  const { rememberAndroidAppLaunch, inAndroidApp } = await import("@/lib/route-lines");
  rememberAndroidAppLaunch("");
  expect(inAndroidApp()).toBe(true);
  expect(sessionStorage.getItem("hearthroom.androidApp")).toBe("1");
  expect(replace.mock.calls.some(call => call[2] === "/auth/route/complete#code=example")).toBe(true);
});
it.each([
  ["https://sukisuki.chat/en?_hr_app=twa", false],
  ["https://play.sukisuki.chat/en?_hr_app=twa", true],
  ["https://sukisuki.chat:8443/en?_hr_app=twa", true],
])("ignores a carried runtime marker outside an Android official standalone view: %s", async (url, standalone) => {
  at(url, standalone);
  const { rememberAndroidAppLaunch, inAndroidApp } = await import("@/lib/route-lines");
  rememberAndroidAppLaunch("");
  expect(inAndroidApp()).toBe(false);
});
