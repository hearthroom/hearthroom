/**
 * 路由守衛：沒登入的人進需要登入的頁，會被送到本站的登入頁，而且要記得他原本要去哪。
 * 物件位置的 query 得分開給——塞在 path 裡的查詢字串 vue-router 會丟掉，登入後就只會回首頁。
 */
import { describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ ready: true, me: null as null | { accountNumId: number }, restore: async () => undefined }));
vi.mock("../src/lib/session", () => ({ useSession: () => session }));
vi.mock("../src/lib/track", () => ({ track: () => {}, currentSurface: () => "", setSurface: () => {} }));

import { router } from "../src/router";

describe("需要登入的頁", () => {
  it("沒登入：轉到 /login 並帶上 returnTo", async () => {
    session.me = null;
    // 第一次導航會照瀏覽器語言轉一次前綴（測試環境是 en），所以先踩一次首頁把它消耗掉
    await router.push("/");
    await router.isReady();
    await router.push("/mine");
    expect(router.currentRoute.value.path).toBe("/login");
    expect(router.currentRoute.value.query.returnTo).toBe("/mine");
  });

  it("帶語言前綴與查詢字串也一樣", async () => {
    session.me = null;
    await router.push("/en/play/r1?x=1");
    expect(router.currentRoute.value.path).toBe("/en/login");
    expect(router.currentRoute.value.query.returnTo).toBe("/en/play/r1?x=1");
  });

  it("登入了就放行", async () => {
    session.me = { accountNumId: 7 };
    await router.push("/mine");
    expect(router.currentRoute.value.path).toBe("/mine");
  });
});
