/**
 * 從 Android App（TWA）開進來：UA 沒有記號，只有第一頁的 referrer 是 android-app://。
 * 記下之後，這個分頁裡線路入口與靜默登入都不出現（App 有自己的線路畫面）。
 */
import { afterEach, expect, it, vi } from "vitest";
import { rememberAndroidAppLaunch } from "@/lib/route-lines";
import { routesAvailable } from "@/lib/routes";
import { silentLoginAllowed } from "@/lib/silent-login";

afterEach(() => { vi.unstubAllGlobals(); sessionStorage.clear(); });

it("hides every route entry inside the Android app's TWA", () => {
  vi.stubGlobal("location", { hostname: "sukisuki.chat", host: "sukisuki.chat", origin: "https://sukisuki.chat" });
  const ua = "Mozilla/5.0 (Linux; Android 14) Chrome/130";
  rememberAndroidAppLaunch("https://www.google.com/");
  expect(routesAvailable({ hostname: "sukisuki.chat", ua })).toBe(true);
  rememberAndroidAppLaunch("android-app://club.hearthroom.app/");
  expect(sessionStorage.getItem("hearthroom.androidApp")).toBe("1");
  expect(routesAvailable({ hostname: "sukisuki.chat", ua })).toBe(false);
  expect(silentLoginAllowed({ enabled: true, immersive: false, ua })).toBe(false);
});
