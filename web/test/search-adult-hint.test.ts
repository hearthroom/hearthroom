/**
 * 搜尋頁：有關鍵字時預設按相關度讀；成人內容關著的成員結果少時提一句（訪客不提）。
 * 真的 session store、真的 api 客戶端、假的 fetch。
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
vi.mock("../src/lib/track", () => ({ track: () => {}, currentSurface: () => "search", setSurface: () => {} }));
vi.mock("moonstage/stage", () => ({}));
vi.mock("moonstage/stage.css", () => ({}));

import SearchPage from "../src/pages/SearchPage.vue";
import { useSession } from "../src/lib/session";

const state = { showNsfw: false, ageVerified: true, adultConsent: true };
const calls: string[] = [];

function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  calls.push(`${init?.method ?? "GET"} ${url}`);
  const json = (body: unknown, headers: Record<string, string> = {}) =>
    Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json", ...headers } }));
  if (url.includes("/open/v1/me")) return json({ accountNumId: 7, nickName: "月光", avatar: "" });
  if (url.endsWith("/v1/me")) return json({ handle: "abcdefgh", memberSince: 0, reviewer: false, identities: [], hiddenTags: [], ...state });
  if (url.includes("/v1/cards?")) {
    const partial = url.includes("partial");
    return json({ items: partial ? [{ id: "1", roleId: "r1", zone: "zh", name: "一", summary: "", names: {}, summaries: {}, avatarUrl: null, backgroundUrl: null, slug: null, tags: [], author: { handle: null, accountNumId: 1, name: "a", avatar: "" }, talkNum: 0, followNum: 0, trending: 0, registeredAt: 0, syncedAt: 0, provider: "harbor", nsfw: false }] : [], total: null, hasNext: false, limit: 24, offset: 0, sort: "relevance", ...(partial ? { partial: true } : {}) }, { "X-Adult-Content": state.showNsfw ? "1" : "0" });
  }
  if (url.includes("/v1/authors?")) return json({ items: [], hasNext: false, limit: 24, offset: 0, sort: "talk" });
  if (url.includes("/v1/tags?")) return json({ items: [], hasNext: false, limit: 24, offset: 0 });
  return json({ error: "not_found" });
}

let app: App | null = null;
let el: HTMLElement | null = null;
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); await nextTick(); };

async function mountSearch(path: string) {
  el = document.createElement("div");
  document.body.appendChild(el);
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/search", component: SearchPage }, { path: "/:pathMatch(.*)*", component: { template: "<div />" } }] });
  const pinia = createPinia();
  setActivePinia(pinia);
  await useSession().restore();
  app = createApp({ template: "<RouterView />" });
  app.use(pinia).use(router).use(i18n);
  await router.push(path);
  await router.isReady();
  app.mount(el);
  await flush();
}

const hint = () => document.querySelector(".search__adult");
const cardCalls = () => calls.filter((c) => c.includes("/v1/cards?"));

beforeEach(() => {
  vi.stubGlobal("fetch", fakeFetch);
  calls.length = 0;
  signedIn = true; state.showNsfw = false;
  setActivePinia(createPinia());
});
afterEach(() => { app?.unmount(); el?.remove(); app = null; el = null; document.body.innerHTML = ""; vi.unstubAllGlobals(); });

describe("搜尋頁", () => {
  it("貼進來的是點數兌換碼：不搜，告訴他去錢包兌換", async () => {
    await mountSearch("/search?q=HH-LH77-63RY-XB2V-D4TN-JUTX-ATKC-TJSU-HIO2");
    expect(cardCalls().some((c) => c.includes("q="))).toBe(false);
    const notice = document.querySelector(".search__voucher");
    expect(notice?.textContent).toContain(i18n.global.t("search.voucher"));
    expect(notice?.querySelector("a")?.getAttribute("href")).toContain("console.harperharbor.com");
  });

  it("只符合一部分的結果上方說清楚", async () => {
    await mountSearch("/search?q=partial");
    expect(document.querySelector(".search__partial")?.textContent).toContain(i18n.global.t("search.partial"));
  });

  it("有關鍵字就按相關度讀，排序列也多一個「最相關」", async () => {
    await mountSearch("/search?q=霧港");
    expect(cardCalls().find((c) => c.includes("q="))).toContain("sort=relevance");
    expect([...document.querySelectorAll("#search-sort option")].map((o) => (o as HTMLOptionElement).value)).toEqual(["relevance", "hot", "new"]);
  });

  it("成人內容關著的成員：結果是空的就說一句，連到設定", async () => {
    await mountSearch("/search?q=霧港");
    expect(hint()?.textContent).toContain(i18n.global.t("search.adultHidden"));
    expect(hint()?.querySelector("a")?.getAttribute("href")).toContain("/settings");
  });

  it("開著的成員不提；訪客也不提", async () => {
    state.showNsfw = true;
    await mountSearch("/search?q=霧港");
    expect(hint()).toBeNull();
    app?.unmount(); el?.remove(); document.body.innerHTML = "";
    signedIn = false; state.showNsfw = false;
    await mountSearch("/search?q=霧港");
    expect(hint()).toBeNull();
  });
});
