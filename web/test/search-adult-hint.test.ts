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
    return json({ items: partial ? [{ id: "1", roleId: "r1", zone: "zh", name: "一", summary: "", names: {}, summaries: {}, avatarUrl: null, backgroundUrl: null, slug: null, tags: [], author: { handle: null, accountNumId: 1, name: "a", avatar: "" }, talkNum: 0, followNum: 0, trending: 0, registeredAt: 0, syncedAt: 0, provider: "harbor", rating: null }] : [], total: null, hasNext: false, limit: 24, offset: 0, sort: "relevance", ...(partial ? { partial: true } : {}) }, { "X-Adult-Content": state.showNsfw ? "1" : "0" });
  }
  if (url.includes("/v1/authors?")) return json({ items: [], hasNext: false, limit: 24, offset: 0, sort: "talk" });
  if (url.includes("/v1/fandoms?")) return json({ items: [{ key: "原神", fandom: "原神", n: 3 }, { key: "wd:Q1", fandom: "崩壞三", labels: { "zh-hant": "崩壞三", "zh-hans": "崩坏三", en: "Honkai Impact 3rd" }, n: 1 }], hasNext: false, limit: 24, offset: 0 });
  if (url.includes("/v1/suggest?")) return json({ tags: [], fandoms: [], cards: [] });
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
  return router;
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
  it("原作篩選：網址帶 fandom 就照它讀，上方有可以拿掉的籤；沒有條件時列熱門原作", async () => {
    await mountSearch("/search?fandom=原神");
    expect(cardCalls().some((c) => c.includes("fandom=") && c.includes("%E5%8E%9F%E7%A5%9E"))).toBe(true);
    expect(document.querySelector("[data-fandom-chip]")?.textContent).toContain("原神");
    app?.unmount(); el?.remove(); document.body.innerHTML = "";
    await mountSearch("/search");
    expect([...document.querySelectorAll("[data-fandoms] .tagchip")].map((b) => b.textContent)).toEqual(["原神3", "崩壞三1"]);
  });

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
    expect([...document.querySelectorAll("#search-sort option")].map((o) => (o as HTMLOptionElement).value)).toEqual(["relevance", "hot", "new", "score"]);
  });

  it("評分排序在搜尋的排序選單裡（首頁分頁列不放它，2026-11-03）：選了就照評分讀", async () => {
    await mountSearch("/search?q=霧港&sort=score");
    expect(cardCalls().find((c) => c.includes("q="))).toContain("sort=score");
    expect((document.querySelector("#search-sort") as HTMLSelectElement).value).toBe("score");
    expect(document.querySelector('#search-sort option[value="score"]')?.textContent?.trim()).toBe(i18n.global.t("board.sort.score"));
  });

  it("評分選項五語都有自己的字", async () => {
    for (const lang of ["zh-Hant", "zh-Hans", "en", "ja", "ko"]) {
      const messages = (await import(`../src/locales/${lang}.json`)).default as Record<string, string>;
      expect(messages["board.sort.score"], lang).toMatch(/\S/);
    }
  });

  it("沒有關鍵字也能照評分排：選單是最熱／最新／評分，請求帶 sort=score", async () => {
    await mountSearch("/search?sort=score");
    expect([...document.querySelectorAll("#search-sort option")].map((o) => (o as HTMLOptionElement).value)).toEqual(["hot", "new", "score"]);
    expect(cardCalls().some((c) => c.includes("sort=score"))).toBe(true);
  });

  it("在排序選單選「評分」：網址換成 sort=score，照評分重讀", async () => {
    const router = await mountSearch("/search?q=霧港");
    const select = document.querySelector("#search-sort") as HTMLSelectElement;
    select.value = "score";
    select.dispatchEvent(new Event("change"));
    await flush();
    expect(router.currentRoute.value.query.sort).toBe("score");
    expect(cardCalls().at(-1)).toContain("sort=score");
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
