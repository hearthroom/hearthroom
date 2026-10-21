/**
 * 換線過場頁：單號讀到就從網址拿掉再送出；原站發碼後往目的站走、順手帶上「從哪來、回哪頁」；
 * 目的站兌換成功後先照新登入恢復再回原頁、出一次「已切換」；失敗停在原地給選擇，不自動重試。
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createApp, nextTick } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { i18n } from "@/lib/i18n";
import { resetManagedAuthForTest } from "@/lib/managed-auth";
import { routesState } from "@/lib/routes";

const session = vi.hoisted(() => ({ restore: vi.fn(async () => {}), retryRestore: vi.fn(async () => {}), me: null }));
vi.mock("@/lib/session", () => ({ useSession: () => session }));
vi.mock("@/lib/track", () => ({ track: () => {}, currentSurface: () => "", setSurface: () => {} }));

const replace = vi.fn();
function at(hostname: string, pathname: string, hash: string) {
  vi.stubGlobal("location", { hostname, host: hostname, origin: `https://${hostname}`, protocol: "https:", pathname, search: "", hash, href: `https://${hostname}${pathname}${hash}`, assign: vi.fn(), replace, reload: vi.fn() });
}

async function mount(path: string, handoff: "issue" | "complete") {
  const { default: Page } = await import("@/pages/RouteHandoffPage.vue");
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: "/auth/route/:step", component: Page, meta: { bare: true, handoff } },
    { path: "/:pathMatch(.*)*", component: { render: () => null } },
  ] });
  await router.push(path);
  await router.isReady();
  const el = document.createElement("div");
  document.body.appendChild(el);
  const app = createApp({ template: "<RouterView />" }).use(createPinia()).use(router).use(i18n);
  app.mount(el);
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
  await nextTick();
  return { el, router, unmount: () => { app.unmount(); el.remove(); } };
}

beforeEach(() => {
  resetManagedAuthForTest(true);
  setActivePinia(createPinia());
  sessionStorage.clear(); localStorage.clear();
  replace.mockReset(); session.restore.mockClear(); session.retryRestore.mockClear();
  routesState.arrived = 0; routesState.arrivedSignedOut = false;
  i18n.global.locale.value = "zh-Hant";
});
afterEach(() => { vi.unstubAllGlobals(); });

it("destination: redeems, restores the new sign-in, then returns to the page with an arrival note", async () => {
  at("sukisuki.chat", "/auth/route/complete", "#code=abc&from=1&to=L2NhcmRzLzQy");
  const replaceState = vi.spyOn(history, "replaceState");
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    expect(url).toBe("/v1/auth/route-redeem");
    expect(JSON.parse(String(init?.body))).toEqual({ code: "abc" });
    // 送出之前網址上的碼已經拿掉
    expect(replaceState.mock.calls.some((c) => c[2] === "/auth/route/complete")).toBe(true);
    return Response.json({ ok: true, returnTo: "/cards/42?tab=a" });
  });
  vi.stubGlobal("fetch", fetch);
  const { router, unmount } = await mount("/auth/route/complete#code=abc&from=1&to=L2NhcmRzLzQy", "complete");
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(session.retryRestore).toHaveBeenCalled();
  expect(router.currentRoute.value.fullPath).toBe("/cards/42?tab=a");
  expect(routesState.arrived).toBe(3);
  unmount();
});

it("destination: a refused code stays put with sign-in, back, and continue choices", async () => {
  at("sukisuki.chat", "/auth/route/complete", "#code=abc&from=1&to=L2NhcmRzLzQy");
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "auth_route_invalid" }, { status: 400 })));
  const { el, router, unmount } = await mount("/auth/route/complete#code=abc&from=1&to=L2NhcmRzLzQy", "complete");
  expect(el.textContent).toContain(i18n.global.t("routes.handoff.completeFailTitle"));
  const buttons = [...el.querySelectorAll("button")];
  expect(buttons.map((b) => b.textContent?.trim())).toEqual([
    i18n.global.t("nav.login"), i18n.global.t("routes.handoff.backTo", { line: "線路一" }), i18n.global.t("routes.handoff.enter"),
  ]);
  buttons[1]!.click();
  expect(replace).toHaveBeenCalledWith("https://sukisuki.ai/cards/42");
  buttons[2]!.click();
  await nextTick(); await new Promise((r) => setTimeout(r, 0));
  expect(routesState.arrivedSignedOut).toBe(true);
  expect(router.currentRoute.value.fullPath).toBe("/cards/42");
  unmount();
});

it("source: issues the code and heads to the destination, carrying where it came from", async () => {
  at("sukisuki.ai", "/auth/route/issue", "#request=req");
  localStorage.setItem("hearthroom.routes.pending", JSON.stringify({ target: 3, returnTo: "/en/cards/42", at: Date.now() }));
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    expect(url).toBe("/v1/auth/route-issue");
    expect(JSON.parse(String(init?.body))).toEqual({ request: "req" });
    return Response.json({ url: "https://sukisuki.chat/auth/route/complete#code=xyz" });
  });
  vi.stubGlobal("fetch", fetch);
  const { unmount } = await mount("/auth/route/issue#request=req", "issue");
  expect(replace).toHaveBeenCalledWith("https://sukisuki.chat/auth/route/complete#code=xyz&from=1&to=L2VuL2NhcmRzLzQy");
  expect(localStorage.getItem("hearthroom.routes.pending")).toBeNull();
  unmount();
});

it("destination: a slow redeem that succeeds after 'continue' still restores the sign-in", async () => {
  at("sukisuki.chat", "/auth/route/complete", "#code=abc&from=1&to=L3NlYXJjaD9xPWEmc29ydD1ob3Q");
  let finish!: (r: Response) => void;
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((r) => { finish = r; })));
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const view = mount("/auth/route/complete#code=abc&from=1&to=L3NlYXJjaD9xPWEmc29ydD1ob3Q", "complete");
  await vi.advanceTimersByTimeAsync(9000);
  const { el, router, unmount } = await view;
  const skip = [...el.querySelectorAll("button")].find((b) => b.textContent?.trim() === i18n.global.t("routes.handoff.skipLogin"))!;
  skip.click();
  await vi.advanceTimersByTimeAsync(10);
  expect(routesState.arrivedSignedOut).toBe(true);
  // 查詢字串裡的 & 經過 # 也沒被切斷
  expect(router.currentRoute.value.fullPath).toBe("/search?q=a&sort=hot");
  finish(Response.json({ ok: true, returnTo: "/search?q=a&sort=hot" }));
  await vi.advanceTimersByTimeAsync(10);
  expect(session.retryRestore).toHaveBeenCalled();
  expect(routesState.arrivedSignedOut).toBe(false);
  vi.useRealTimers();
  unmount();
});

it("source: a failure offers a fresh handoff, switching without sign-in, or staying", async () => {
  at("sukisuki.ai", "/auth/route/issue", "#request=req");
  localStorage.setItem("hearthroom.routes.pending", JSON.stringify({ target: 3, returnTo: "/cards/42", at: Date.now() }));
  const fetch = vi.fn(async (url: string) => {
    if (url === "/v1/auth/route-issue") return Response.json({ error: "auth_route_invalid" }, { status: 400 });
    if (url === "/v1/auth/route-start") return Response.json({ url: "https://sukisuki.chat/auth/route/prepare?request=new" });
    return new Response(null); // 目標線路預檢
  });
  vi.stubGlobal("fetch", fetch);
  const { el, unmount } = await mount("/auth/route/issue#request=req", "issue");
  expect(el.textContent).toContain(i18n.global.t("routes.handoff.issueFailTitle"));
  const [retry, without] = [...el.querySelectorAll("button")];
  without!.click();
  expect(replace).toHaveBeenLastCalledWith("https://sukisuki.chat/cards/42");
  retry!.click();
  await vi.waitFor(() => expect(replace).toHaveBeenLastCalledWith("https://sukisuki.chat/auth/route/prepare?request=new"));
  // 重試是整條重來，不是重送同一張單
  expect(fetch.mock.calls.filter(([url]) => url === "/v1/auth/route-issue")).toHaveLength(1);
  unmount();
});
