/**
 * 從 Android App（TWA）開進來：UA 沒有記號，只有第一頁的 referrer 是 android-app://。
 * 記下之後，TWA 的線路入口仍可用；靜默登入維持原有停用規則。
 */
import { afterEach, expect, it, vi } from "vitest";
import { rememberAndroidAppLaunch } from "@/lib/route-lines";
import { routesAvailable } from "@/lib/routes";
import { silentLoginAllowed } from "@/lib/silent-login";

afterEach(() => { vi.unstubAllGlobals(); sessionStorage.clear(); });

it("keeps route entries inside TWA while retaining the silent-login restriction", () => {
  vi.stubGlobal("location", { hostname: "sukisuki.chat", host: "sukisuki.chat", origin: "https://sukisuki.chat" });
  const ua = "Mozilla/5.0 (Linux; Android 14) Chrome/130";
  rememberAndroidAppLaunch("https://www.google.com/");
  expect(routesAvailable({ hostname: "sukisuki.chat", ua })).toBe(true);
  rememberAndroidAppLaunch("android-app://club.hearthroom.app/");
  expect(sessionStorage.getItem("hearthroom.androidApp")).toBe("1");
  expect(routesAvailable({ hostname: "sukisuki.chat", ua })).toBe(true);
  expect(silentLoginAllowed({ enabled: true, immersive: false, ua })).toBe(false);
});
