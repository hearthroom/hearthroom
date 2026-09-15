/**
 * 卡片 App 網域（play.<站台>）的路由：只有 /<roleId>/、登入、回調；沒有語言前綴，語言在 ?lang=；
 * /<roleId> 少了結尾斜線要補上（App 的範圍是 /<roleId>/）。
 */
import { describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ ready: true, me: null as null | { accountNumId: number }, restore: async () => undefined }));
vi.mock("../src/lib/session", () => ({ useSession: () => session }));
vi.mock("../src/lib/track", () => ({ track: () => {}, currentSurface: () => "", setSurface: () => {} }));
vi.mock("../src/lib/site", async (importOriginal) => ({ ...(await importOriginal<typeof import("../src/lib/site")>()), isPlayHost: () => true }));

import { localeOf, router, withLocale } from "../src/router";

describe("card app host", () => {
  it("no locale prefix: /<id> becomes /<id>/ and the locale comes from ?lang", async () => {
    session.me = { accountNumId: 7 };
    await router.push("/r1?lang=ja");
    await router.isReady();
    expect(router.currentRoute.value.path).toBe("/r1/");
    expect(router.currentRoute.value.query.lang).toBe("ja");
    expect(router.currentRoute.value.meta.playApp).toBe(true);
    expect(localeOf(router.currentRoute.value)).toBe("ja");
  });

  it("signed out: goes to /login on this host and remembers the card path", async () => {
    session.me = null;
    await router.push("/r2/?lang=en");
    expect(router.currentRoute.value.path).toBe("/login");
    expect(router.currentRoute.value.query.returnTo).toBe("/r2/?lang=en");
    // 登入頁也要是同一個語言
    expect(router.currentRoute.value.query.lang).toBe("en");
  });

  it("links carry the locale as a query, never a prefix", () => {
    expect(withLocale("/login", "en")).toBe("/login?lang=en");
    expect(withLocale("/login?returnTo=%2Fr1%2F", "ko")).toBe("/login?returnTo=%2Fr1%2F&lang=ko");
  });

  it("unknown ?lang falls back to detection, and the site's pages do not exist here", async () => {
    session.me = { accountNumId: 7 };
    await router.push("/r3/?lang=xx");
    expect(["zh-Hant", "zh-Hans", "en", "ja", "ko"]).toContain(localeOf(router.currentRoute.value));
    await router.push("/cards/abc");
    expect(router.currentRoute.value.meta.playApp).toBeUndefined();
  });
});
