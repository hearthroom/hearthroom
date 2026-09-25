/**
 * 首頁榜單上的 R18 開關，整條路走一遍：真的 session store、真的 api 客戶端、假的 fetch。
 *   - 訪客看不到開關；
 *   - 沒驗過年齡：點下去先要出生日期，這時候什麼都不送；驗過才打開，榜單帶 ?nsfw=1 與 token 重讀；
 *   - 驗過了：點一下就關，榜單不帶 nsfw 重讀。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, nextTick, type App } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { i18n } from "../src/lib/i18n";

let signedIn = true;
vi.mock("../src/lib/oauth", () => ({
  restorePersisted: () => (signedIn ? { accessToken: "tok", refreshToken: "r", expiresAt: Date.now() + 3_600_000 } : null),
  refresh: async () => null,
  persist: () => {},
  revokeSession: async () => {},
  beginLogin: async () => {},
}));
vi.mock("../src/lib/track", () => ({ track: () => {}, currentSurface: () => "board", setSurface: () => {} }));
vi.mock("moonstage/stage", () => ({}));
vi.mock("moonstage/stage.css", () => ({}));

import BoardPage from "../src/pages/BoardPage.vue";
import { useSession } from "../src/lib/session";

const state = { showNsfw: false, ageVerified: false };
const calls: string[] = [];
const bodies: Record<string, unknown>[] = [];

function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  const auth = new Headers(init?.headers).get("Authorization");
  calls.push(`${init?.method ?? "GET"} ${url}${auth ? " [auth]" : ""}`);
  const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
  if (url.includes("/open/v1/me")) return json({ accountNumId: 7, nickName: "月光", avatar: "" });
  if (url.endsWith("/v1/me")) return json({ handle: "abcdefgh", memberSince: 0, reviewer: false, identities: [], hiddenTags: [], ...state });
  if (url.includes("/v1/me/settings")) {
    const body = JSON.parse(String(init?.body)) as { showNsfw: boolean; birthdate?: string };
    bodies.push(body);
    if (body.birthdate) state.ageVerified = true;
    state.showNsfw = body.showNsfw;
    return json({ showNsfw: state.showNsfw, ageVerified: state.ageVerified, hiddenTags: [] });
  }
  if (url.includes("/v1/board") || url.includes("/v1/cards?")) return json({ items: [], total: 0, hasNext: false, limit: 20, offset: 0, sort: "day" });
  return json({ error: "not_found" }, 404);
}

let app: App | null = null;
let el: HTMLElement | null = null;
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); await nextTick(); };
const boardCalls = () => calls.filter((c) => c.startsWith("GET") && (c.includes("/v1/board") || c.includes("/v1/cards?")));

async function mountBoard() {
  el = document.createElement("div");
  document.body.appendChild(el);
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/", component: BoardPage }, { path: "/:pathMatch(.*)*", component: { template: "<div />" } }] });
  const pinia = createPinia();
  setActivePinia(pinia);
  const session = useSession();
  await session.restore();
  app = createApp({ template: "<RouterView />" });
  app.use(pinia).use(router).use(i18n);
  await router.push("/");
  await router.isReady();
  app.mount(el);
  await flush();
  return session;
}

const toggle = () => document.querySelector<HTMLButtonElement>("button.r18");

beforeEach(() => {
  vi.stubGlobal("fetch", fakeFetch);
  calls.length = 0; bodies.length = 0;
  signedIn = true; state.showNsfw = false; state.ageVerified = false;
  setActivePinia(createPinia());
});
afterEach(() => { app?.unmount(); el?.remove(); app = null; el = null; document.body.innerHTML = ""; vi.unstubAllGlobals(); });

describe("首頁 R18 開關", () => {
  it("訪客看不到開關", async () => {
    signedIn = false;
    await mountBoard();
    expect(boardCalls().length).toBeGreaterThan(0);
    expect(toggle()).toBeNull();
  });

  it("沒驗過年齡：先要出生日期，確認後才打開，榜單帶 nsfw 重讀", async () => {
    const session = await mountBoard();
    expect(toggle()?.getAttribute("aria-checked")).toBe("false");

    toggle()!.click();
    await flush();
    expect(bodies).toHaveLength(0);
    const input = document.querySelector<HTMLInputElement>('.dlg input[type="date"]');
    expect(input).not.toBeNull();

    input!.value = "1990-01-01";
    input!.dispatchEvent(new Event("input"));
    await nextTick();
    const before = boardCalls().length;
    document.querySelector<HTMLFormElement>("form.dlg")!.dispatchEvent(new Event("submit", { cancelable: true }));
    await flush();

    expect(bodies).toEqual([{ showNsfw: true, birthdate: "1990-01-01" }]);
    expect(session.profile?.showNsfw).toBe(true);
    expect(document.querySelector(".dlg")).toBeNull();
    expect(toggle()?.getAttribute("aria-checked")).toBe("true");
    const after = boardCalls().slice(before);
    expect(after.some((c) => c.includes("nsfw=1") && c.endsWith("[auth]"))).toBe(true);
  });

  it("取消年齡確認：什麼都不送，開關維持關閉", async () => {
    await mountBoard();
    toggle()!.click();
    await flush();
    [...document.querySelectorAll<HTMLButtonElement>(".dlg button")].find((b) => b.type === "button")!.click();
    await flush();
    expect(bodies).toHaveLength(0);
    expect(document.querySelector(".dlg")).toBeNull();
    expect(toggle()?.getAttribute("aria-checked")).toBe("false");
  });

  it("驗過且開著：點一下就關，不再問年齡，榜單不帶 nsfw 重讀", async () => {
    state.showNsfw = true; state.ageVerified = true;
    await mountBoard();
    expect(toggle()?.getAttribute("aria-checked")).toBe("true");
    const before = boardCalls().length;
    toggle()!.click();
    await flush();
    expect(document.querySelector(".dlg")).toBeNull();
    expect(bodies).toEqual([{ showNsfw: false }]);
    expect(toggle()?.getAttribute("aria-checked")).toBe("false");
    const after = boardCalls().slice(before);
    expect(after.length).toBeGreaterThan(0);
    expect(after.every((c) => !c.includes("nsfw=1"))).toBe(true);
  });

  it("驗過但關著：點一下直接打開，不再問年齡", async () => {
    state.ageVerified = true;
    await mountBoard();
    toggle()!.click();
    await flush();
    expect(document.querySelector(".dlg")).toBeNull();
    expect(bodies).toEqual([{ showNsfw: true }]);
  });
});
