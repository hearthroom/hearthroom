/**
 * 本站的身分層：登入頁與「我的」頁。
 *
 * 登入先到本站的頁面選供應商（現在只有一家），不直接跳去供應商；
 * 「我的」頁顯示的是本站的成員 ID（公開 handle）與連結的供應商帳號，不是供應商那邊的資料。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, nextTick, type App } from "vue";
import { createPinia } from "pinia";
import { createMemoryHistory, createRouter, type Router } from "vue-router";
import { i18n } from "../src/lib/i18n";

const session = vi.hoisted(() => ({
  ready: true,
  me: { accountNumId: 7, nickName: "月光", avatar: "" } as { accountNumId: number; nickName: string; avatar: string } | null,
  profile: {
    handle: "kxxoxfyb",
    memberSince: Date.UTC(2026, 8, 1),
    reviewer: false,
    identities: [{ provider: "lunatalk", externalId: 7, linkedAt: Date.UTC(2026, 8, 1) }],
  } as { handle: string; memberSince: number; reviewer: boolean; identities: { provider: string; externalId: number; linkedAt: number }[] } | null,
  login: vi.fn(async () => undefined),
  logout: vi.fn(async () => undefined),
  accessToken: async () => "tok",
}));
vi.mock("../src/lib/session", () => ({ useSession: () => session }));
vi.mock("../src/lib/review", () => ({ useReviewer: () => ({ reviewer: false }) }));
vi.mock("../src/lib/track", () => ({ track: () => {}, currentSurface: () => "me", setSurface: () => {} }));

import LoginPage from "../src/pages/LoginPage.vue";
import MePage from "../src/pages/MePage.vue";

let app: App | null = null;
let el: HTMLElement | null = null;

async function mount(component: unknown, path: string): Promise<{ el: HTMLElement; router: Router }> {
  el = document.createElement("div");
  document.body.appendChild(el);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/login", component: component as never },
      { path: "/me", component: component as never },
      { path: "/:pathMatch(.*)*", component: { template: "<div />" } },
    ],
  });
  await router.push(path);
  await router.isReady();
  app = createApp({ template: "<RouterView />" }).use(createPinia()).use(router).use(i18n);
  app.mount(el);
  await nextTick();
  await new Promise((r) => setTimeout(r, 0));
  await nextTick();
  return { el, router };
}
afterEach(() => { app?.unmount(); el?.remove(); app = null; el = null; session.login.mockClear(); });

describe("登入頁", () => {
  it("沒登入：一顆「使用 LunaTalk 帳號繼續」按鈕，還有「更多登入方式準備中」；按下才開始向供應商授權", async () => {
    session.me = null;
    const { el } = await mount(LoginPage, "/login?returnTo=%2Fplay%2Fr1");
    const btn = el.querySelector<HTMLButtonElement>("button.login__provider")!;
    expect(btn).not.toBeNull();
    expect(btn.textContent?.trim()).toBe(i18n.global.t("login.continueWith", { provider: "LunaTalk" }));
    expect(el.textContent).toContain(i18n.global.t("login.moreComing"));
    expect(session.login).not.toHaveBeenCalled();
    btn.click();
    expect(session.login).toHaveBeenCalledWith("/play/r1");
  });

  it("returnTo 是外站就回首頁", async () => {
    session.me = null;
    const { el } = await mount(LoginPage, "/login?returnTo=https%3A%2F%2Fevil.example%2F");
    el.querySelector<HTMLButtonElement>("button.login__provider")!.click();
    expect(session.login).toHaveBeenCalledWith("/");
  });

  it("已登入的人來到登入頁：直接送去 returnTo", async () => {
    session.me = { accountNumId: 7, nickName: "月光", avatar: "" };
    const { router } = await mount(LoginPage, "/login?returnTo=%2Fmine");
    expect(router.currentRoute.value.path).toBe("/mine");
    expect(session.login).not.toHaveBeenCalled();
  });
});

describe("「我的」頁", () => {
  it("顯示本站成員 ID 與連結的供應商帳號；入口連到我的卡片與公開作者頁", async () => {
    session.me = { accountNumId: 7, nickName: "月光", avatar: "" };
    const { el } = await mount(MePage, "/me");
    expect(el.querySelector(".me__handle")?.textContent).toBe("kxxoxfyb");
    expect(el.textContent).toContain("LunaTalk");
    expect(el.textContent).toContain("ID 7");
    expect(el.querySelector('a[href*="/authors/kxxoxfyb"]')).not.toBeNull();
    expect(el.querySelector('a[href*="/mine"]')).not.toBeNull();
    expect(el.querySelector('a[href*="/settings"]')).not.toBeNull();
  });

  it("「重新授權」才會再向供應商走一次 OAuth", async () => {
    session.me = { accountNumId: 7, nickName: "月光", avatar: "" };
    const { el } = await mount(MePage, "/me");
    const btn = [...el.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === i18n.global.t("me.reauthorize"))!;
    btn.click();
    expect(session.login).toHaveBeenCalledWith("/me");
  });
});
