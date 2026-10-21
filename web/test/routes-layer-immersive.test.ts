/**
 * 直接開在遊玩頁：一個測速請求都不打（owner 2026-10-22：聊天中不打擾）。App 不等路由解析就掛上，
 * 第一次導航完成前 route 是空白起點，以前會被當成一般頁面開始測。回到其他頁才開始看。
 */
import { afterEach, expect, it, vi } from "vitest";
import { createApp, nextTick } from "vue";
import { createPinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { i18n } from "@/lib/i18n";

vi.mock("@/lib/track", () => ({ track: () => {}, currentSurface: () => "", setSurface: () => {} }));
vi.mock("@/lib/pwa", () => ({ isStandalone: () => false }));

afterEach(() => { vi.unstubAllGlobals(); });

it("does not probe on a play page opened directly, and starts once the player leaves", async () => {
  vi.stubGlobal("location", { hostname: "sukisuki.ai", host: "sukisuki.ai", origin: "https://sukisuki.ai", protocol: "https:", pathname: "/play/1", search: "", hash: "", href: "https://sukisuki.ai/play/1" });
  vi.stubGlobal("requestIdleCallback", (cb: () => void) => { setTimeout(cb, 0); return 1; });
  const fetch = vi.fn(async () => new Response("[]"));
  vi.stubGlobal("fetch", fetch);
  const { default: RoutesLayer } = await import("@/components/routes/RoutesLayer.vue");
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: "/play/:id", component: { render: () => null }, meta: { bare: true, preloadStage: true } },
    { path: "/:p(.*)*", component: { render: () => null } },
  ] });
  const el = document.createElement("div");
  // 跟 App 一樣：先掛上，路由之後才解析
  const app = createApp(RoutesLayer).use(createPinia()).use(router).use(i18n);
  app.mount(el);
  await router.push("/play/1");
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
  expect(fetch).not.toHaveBeenCalled();
  await router.push("/");
  await nextTick();
  await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
  app.unmount();
});

it("after the card was dismissed, still measures so the header icon can show, but no card", async () => {
  vi.stubGlobal("location", { hostname: "sukisuki.ai", host: "sukisuki.ai", origin: "https://sukisuki.ai", protocol: "https:", pathname: "/", search: "", hash: "", href: "https://sukisuki.ai/" });
  vi.stubGlobal("requestIdleCallback", (cb: () => void) => { setTimeout(cb, 0); return 1; });
  const { dismissPrompt, headerSignalVisible, routesState } = await import("@/lib/routes");
  dismissPrompt();
  // 目前線路連不上，其他線路正常
  const fetch = vi.fn(async (url: string) => { if (url.startsWith("https://sukisuki.ai/")) throw new TypeError("down"); return new Response(null); });
  vi.stubGlobal("fetch", fetch);
  const { default: RoutesLayer } = await import("@/components/routes/RoutesLayer.vue");
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/:p(.*)*", component: { render: () => null } }] });
  const app = createApp(RoutesLayer).use(createPinia()).use(router).use(i18n);
  app.mount(document.createElement("div"));
  await router.push("/");
  await vi.waitFor(() => expect(routesState.recommended).toBe(2));
  expect(routesState.promptShowing).toBe(false);
  expect(headerSignalVisible()).toBe(true);
  app.unmount();
  localStorage.clear();
});
