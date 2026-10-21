/**
 * 登出：這個瀏覽器有經換線帶過去的其他線路時，先問要不要一起登出（預設勾、焦點在「保持登入」）；
 * 沒有就一鍵登出，跟以前一樣。勾了才帶 allRoutes:true，舊的呼叫端仍送 {}。
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { confirmState, settleConfirm } from "@/lib/confirm";
import { i18n } from "@/lib/i18n";
import { logoutWithRoutes } from "@/lib/logout";
import { managedLogout, resetManagedAuthForTest } from "@/lib/managed-auth";
import type { useSession } from "@/lib/session";

vi.mock("@/lib/track", () => ({ track: () => {}, currentSurface: () => "", setSurface: () => {} }));

const fakeSession = (otherLines: string[]) => ({ otherLines, logout: vi.fn(async () => {}) }) as unknown as ReturnType<typeof useSession> & { logout: ReturnType<typeof vi.fn> };

beforeEach(() => { i18n.global.locale.value = "zh-Hant"; confirmState.current = null; });
afterEach(() => { vi.unstubAllGlobals(); });

it("signs out in one tap when no other route is signed in from here", async () => {
  const s = fakeSession([]);
  await logoutWithRoutes(s);
  expect(confirmState.current).toBeNull();
  expect(s.logout).toHaveBeenCalledWith();
});

it("asks first, defaulting to all routes in this browser, and lists them by name and domain", async () => {
  const s = fakeSession(["https://sukisuki.ai", "https://evil.example", "https://sukisuki.pro"]);
  const done = logoutWithRoutes(s);
  await Promise.resolve();
  const c = confirmState.current!;
  expect(c.check).toMatchObject({ label: i18n.global.t("routes.logout.all"), initial: true });
  expect(c.check?.hint).toContain("線路一（sukisuki.ai）、線路四（sukisuki.pro）");
  expect(c.check?.hint).not.toContain("evil");
  expect(c).toMatchObject({ focusCancel: true, cancelText: i18n.global.t("routes.logout.keep") });
  settleConfirm(true, "", "", undefined, true);
  await done;
  expect(s.logout).toHaveBeenCalledWith({ allRoutes: true });
});

it("never lists the route being signed out, and goes back to one tap if nothing else is left", async () => {
  vi.stubGlobal("location", { hostname: "sukisuki.ai", host: "sukisuki.ai", origin: "https://sukisuki.ai" });
  const s = fakeSession(["https://sukisuki.ai"]);
  await logoutWithRoutes(s);
  expect(confirmState.current).toBeNull();
  expect(s.logout).toHaveBeenCalledWith();
});

it("can sign out of just this route, or not at all", async () => {
  const s = fakeSession(["https://sukisuki.ai"]);
  let done = logoutWithRoutes(s);
  await Promise.resolve();
  settleConfirm(true, "", "", undefined, false);
  await done;
  expect(s.logout).toHaveBeenLastCalledWith({ allRoutes: false });
  done = logoutWithRoutes(s);
  await Promise.resolve();
  settleConfirm(false);
  await done;
  expect(s.logout).toHaveBeenCalledTimes(1);
});

it("sends allRoutes only when asked", async () => {
  resetManagedAuthForTest(true);
  const fetch = vi.fn(async () => Response.json({ ok: true }));
  vi.stubGlobal("fetch", fetch);
  await managedLogout();
  await managedLogout({ allRoutes: true });
  expect(fetch.mock.calls.map((c) => JSON.parse(String((c as unknown as [string, RequestInit])[1].body)))).toEqual([{}, { allRoutes: true }]);
});
