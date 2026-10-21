/**
 * 靜默登入的閘門只在前端：Harbor 1.5 秒內回得來才試、每個網域 7 天最多一次（跳走前就記）、
 * 剛登出與遊玩頁不做、開關預設關。回呼時沒登入成功是安靜地回原頁，不是錯誤、不取消流程。
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { resetManagedAuthForTest } from "@/lib/managed-auth";
import { completeLogin } from "@/lib/oauth";
import {
  SILENT_LOGIN_ENABLED, SILENT_TUNING, markLoggedOut, rememberSilentResult, routeLoginHintVisible, silentLoginAllowed, trySilentLogin,
} from "@/lib/silent-login";

const DAY = 86_400_000;
const UA = "Mozilla/5.0";
const assign = vi.fn();
function at(hostname: string) {
  vi.stubGlobal("location", { hostname, host: hostname, origin: `https://${hostname}`, protocol: "https:", pathname: "/", search: "", hash: "", href: `https://${hostname}/`, assign, replace: vi.fn(), reload: vi.fn() });
}
function server(harbor: "fast" | "hang") {
  const fetch = vi.fn((url: string, init?: RequestInit) => {
    if (url === "/v1/auth/start") return Promise.resolve(Response.json({ url: "https://harbor.example/oauth/authorize?prompt=none" }));
    if (url === "/v1/auth/complete") return Promise.resolve(Response.json({ silent: true, authenticated: false, error: "login_required", returnTo: "/cards/42" }));
    if (url === "/v1/auth/cancel") return Promise.resolve(Response.json({ ok: true }));
    // Harbor 探測
    if (harbor === "fast") return Promise.resolve(new Response(null));
    return new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

beforeEach(() => { resetManagedAuthForTest(true); localStorage.clear(); sessionStorage.clear(); assign.mockReset(); at("sukisuki.chat"); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it("stays off until Harbor supports prompt=none", async () => {
  expect(SILENT_LOGIN_ENABLED).toBe(false);
  const fetch = server("fast");
  expect(await trySilentLogin({ immersive: false, returnTo: "/", locale: "zh-Hant" })).toBe("skipped");
  expect(fetch).not.toHaveBeenCalled();
});

it("never runs on play pages, off the official domains, or right after signing out", () => {
  expect(silentLoginAllowed({ enabled: true, immersive: false, ua: UA })).toBe(true);
  expect(silentLoginAllowed({ enabled: true, immersive: true, ua: UA })).toBe(false);
  expect(silentLoginAllowed({ enabled: true, immersive: false, ua: "Mozilla/5.0 HearthroomApp/1.2.0" })).toBe(false);
  at("localhost");
  expect(silentLoginAllowed({ enabled: true, immersive: false, ua: UA })).toBe(false);
  at("sukisuki.chat");
  const now = Date.now();
  markLoggedOut(now);
  expect(silentLoginAllowed({ enabled: true, immersive: false, ua: UA, now: now + 6 * DAY })).toBe(false);
  expect(silentLoginAllowed({ enabled: true, immersive: false, ua: UA, now: now + SILENT_TUNING.loggedOutDays * DAY + 1 })).toBe(true);
});

it("skips a slow Harbor within 1.5 s and does not count it as an attempt", async () => {
  vi.useFakeTimers();
  const fetch = server("hang");
  const pending = trySilentLogin({ immersive: false, returnTo: "/", locale: "zh-Hant", enabled: true });
  await vi.advanceTimersByTimeAsync(SILENT_TUNING.probeMs);
  expect(await pending).toBe("slow");
  expect(fetch.mock.calls.some(([url]) => url === "/v1/auth/start")).toBe(false);
  expect(assign).not.toHaveBeenCalled();
  expect(silentLoginAllowed({ enabled: true, immersive: false, ua: UA })).toBe(true);
});

it("goes top-level with silent:true when Harbor is fast, at most once a week per domain", async () => {
  const fetch = server("fast");
  expect(await trySilentLogin({ immersive: false, returnTo: "/cards/42", locale: "en", enabled: true })).toBe("started");
  const start = fetch.mock.calls.find(([url]) => url === "/v1/auth/start");
  expect(JSON.parse(String(start?.[1]?.body))).toEqual({ provider: "harbor", silent: true, returnTo: "/cards/42", locale: "en" });
  expect(assign).toHaveBeenCalledWith("https://harbor.example/oauth/authorize?prompt=none");
  expect(await trySilentLogin({ immersive: false, returnTo: "/", locale: "en", enabled: true })).toBe("skipped");
  expect(silentLoginAllowed({ enabled: true, immersive: false, ua: UA, now: Date.now() + SILENT_TUNING.everyDays * DAY + 1 })).toBe(true);
});

it("returns quietly to the page when the silent attempt comes back signed out", async () => {
  const fetch = server("fast");
  await trySilentLogin({ immersive: false, returnTo: "/cards/42", locale: "en", enabled: true });
  const done = await completeLogin(new URLSearchParams("error=login_required&state=s"));
  expect(done).toEqual({ silent: true, authenticated: false, returnTo: "/cards/42" });
  const complete = fetch.mock.calls.find(([url]) => url === "/v1/auth/complete");
  expect(JSON.parse(String(complete?.[1]?.body))).toEqual({ state: "s", error: "login_required" });
  expect(fetch.mock.calls.some(([url]) => url === "/v1/auth/cancel")).toBe(false);
  // Harbor 給過明確答覆：登入頁那行「從其他線路切換」不再顯示
  expect(routeLoginHintVisible({ ua: UA })).toBe(false);
});

it("still treats a declined interactive login as an error", async () => {
  server("fast");
  await expect(completeLogin(new URLSearchParams("error=access_denied&state=s"))).rejects.toThrow("oauth_denied");
});

it("shows the login-page hint on official domains until Harbor has answered", () => {
  expect(routeLoginHintVisible({ ua: UA })).toBe(true);
  expect(routeLoginHintVisible({ ua: "Mozilla/5.0 HearthroomApp/1.2.0" })).toBe(false);
  rememberSilentResult("granted");
  expect(routeLoginHintVisible({ ua: UA })).toBe(false);
  at("localhost");
  localStorage.clear();
  expect(routeLoginHintVisible({ ua: UA })).toBe(false);
});
