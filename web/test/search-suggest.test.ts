/**
 * 搜尋框的即時建議：打字停一下就列標籤、原作、卡名；鍵盤走清單、Enter 去那裡；輸入法組字中不問。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, nextTick, type App } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter, type Router } from "vue-router";
import { i18n } from "../src/lib/i18n";

vi.mock("../src/lib/oauth", () => ({ restorePersisted: () => null, refresh: async () => null, persist: () => {}, revokeSession: async () => {}, beginLogin: async () => {} }));
vi.mock("../src/lib/track", () => ({ track: () => {}, currentSurface: () => "board", setSurface: () => {} }));

import SearchSuggest from "../src/components/SearchSuggest.vue";

const calls: string[] = [];
function fakeFetch(input: RequestInfo | URL): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  calls.push(url);
  const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } }));
  if (url.includes("/v1/suggest?")) {
    const q = decodeURIComponent(/[?&]q=([^&]*)/.exec(url)?.[1] ?? "");
    if (!q) return json({ tags: [], fandoms: [], cards: [] });
    return json({ tags: [{ tag: "崩壞", n: 3 }], fandoms: [{ fandom: "崩壞三", n: 2 }], cards: [{ num: 100001, name: "崩壞三 琪亞娜", avatarUrl: null }] });
  }
  return json({ error: "not_found" });
}

let app: App | null = null;
let el: HTMLElement | null = null;
let router: Router;
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); await nextTick(); };
const settle = async () => { await new Promise((r) => setTimeout(r, 260)); await flush(); };

async function mount() {
  el = document.createElement("div");
  document.body.appendChild(el);
  router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/", component: { template: "<div />" } }, { path: "/:pathMatch(.*)*", component: { template: "<div />" } }] });
  const pinia = createPinia();
  setActivePinia(pinia);
  app = createApp({ components: { SearchSuggest }, data: () => ({ q: "" }), template: '<form @submit.prevent="$emit(\'go\')"><SearchSuggest v-model="q" label="search" /></form>' });
  app.use(pinia).use(router).use(i18n);
  await router.push("/");
  await router.isReady();
  app.mount(el);
  await flush();
}
const input = () => document.querySelector<HTMLInputElement>("input[role=combobox]")!;
const options = () => [...document.querySelectorAll<HTMLElement>("[role=option]")].map((o) => o.textContent?.trim());
async function type(value: string) { input().value = value; input().dispatchEvent(new Event("input")); await nextTick(); }
async function press(key: string) { input().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })); await flush(); }

beforeEach(() => { vi.stubGlobal("fetch", fakeFetch); calls.length = 0; setActivePinia(createPinia()); });
afterEach(() => { app?.unmount(); el?.remove(); app = null; el = null; document.body.innerHTML = ""; vi.unstubAllGlobals(); });

describe("搜尋建議", () => {
  it("打字停一下才問，列出「搜尋這個字」加標籤、原作、卡名三組", async () => {
    await mount();
    await type("崩");
    expect(calls.some((c) => c.includes("/v1/suggest"))).toBe(false);
    await settle();
    expect(calls.filter((c) => c.includes("/v1/suggest?")).length).toBe(1);
    expect(input().getAttribute("aria-expanded")).toBe("true");
    expect(options()).toEqual([i18n.global.t("search.suggest.search", { q: "崩" }), "#崩壞3", "崩壞三2", "崩壞三 琪亞娜"]);
    expect([...document.querySelectorAll(".suggest__head")].map((h) => h.textContent)).toEqual([i18n.global.t("search.suggest.tag"), i18n.global.t("search.suggest.fandom"), i18n.global.t("search.suggest.card")]);
  });

  it("鍵盤：往下兩格到原作，Enter 就到原作的搜尋頁；Esc 關掉", async () => {
    await mount();
    await type("崩");
    await settle();
    await press("ArrowDown");
    await press("ArrowDown");
    expect(input().getAttribute("aria-activedescendant")).toMatch(/-2$/);
    await press("Enter");
    expect(router.currentRoute.value.path).toBe("/search");
    expect(router.currentRoute.value.query.fandom).toBe("崩壞三");
    await type("崩壞");
    await settle();
    expect(input().getAttribute("aria-expanded")).toBe("true");
    await press("Escape");
    expect(input().getAttribute("aria-expanded")).toBe("false");
  });

  it("停在第一列時 Enter 交給表單送出，不自己處理；點卡名直接開卡", async () => {
    await mount();
    await type("崩");
    await settle();
    const e = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    input().dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
    await type("崩壞三");
    await settle();
    document.querySelectorAll<HTMLElement>("[role=option]")[3]!.click();
    await flush();
    expect(router.currentRoute.value.path).toBe("/cards/100001");
  });

  it("值從外面換掉（上一頁回來、網址變了）不彈清單，只有人打字才彈", async () => {
    await mount();
    (app!._instance!.proxy as unknown as { q: string }).q = "崩";
    await settle();
    expect(input().value).toBe("崩");
    expect(input().getAttribute("aria-expanded")).toBe("false");
    expect(calls.filter((c) => c.includes("/v1/suggest?")).length).toBe(0);
  });

  it("輸入法組字中不問，組完才問", async () => {
    await mount();
    input().dispatchEvent(new CompositionEvent("compositionstart"));
    await type("b");
    await settle();
    expect(calls.filter((c) => c.includes("/v1/suggest?")).length).toBe(0);
    input().value = "崩";
    input().dispatchEvent(new CompositionEvent("compositionend"));
    await settle();
    expect(calls.filter((c) => c.includes("/v1/suggest?")).length).toBe(1);
  });
});
