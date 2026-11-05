import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, nextTick, type App } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { i18n } from "../src/lib/i18n";

vi.mock("../src/lib/oauth", () => ({
  restorePersisted: () => null,
  refresh: async () => null,
  persist: () => {},
  revokeSession: async () => {},
  beginLogin: async () => {},
}));
vi.mock("../src/lib/track", () => ({ track: () => {}, currentSurface: () => "card", setSurface: () => {} }));
vi.mock("moonstage/stage", () => ({}));
vi.mock("moonstage/stage.css", () => ({}));
import CardPage from "../src/pages/CardPage.vue";

const ART = "https://assets.harperharbor.com/versions/art-1";
const WIDE = "https://assets.harperharbor.com/versions/wide-1";
const MORE = "https://assets.harperharbor.com/versions/more-1";
const BASE = {
  id: "abc", roleId: "role-abc", num: 100021, zone: "zh", name: "夜行偵探", summary: "音乐关闭，读取学园记录",
  names: { zh: "夜行偵探", en: "", ja: "", ko: "" }, summaries: { zh: "民國背景推理", en: "", ja: "", ko: "" },
  avatarUrl: ART, backgroundUrl: ART, landscapeUrl: WIDE, slug: null, tags: ["推理"],
  author: { handle: "abcdefgh", accountNumId: 7, name: "月光", avatar: "" },
  talkNum: 1200, followNum: 3, trending: 40, registeredAt: 1, syncedAt: 1, provider: "harbor", rating: null,
};
const OTHER = { ...BASE, id: "def", roleId: "role-def", num: 100022, name: "另一張", avatarUrl: MORE, backgroundUrl: MORE, landscapeUrl: null };

let app: App | null = null;
let el: HTMLElement | null = null;
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); await nextTick(); };
afterEach(() => { app?.unmount(); el?.remove(); app = null; el = null; vi.unstubAllGlobals(); });

function fakeFetch(card: Record<string, unknown>, readme: boolean) {
  return (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const json = (body: unknown, status = 200) =>
      Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
    if (url.includes("/open/v1/role/")) return json({ roleReadme: !readme ? "" : "# 学园玩法\n\n读取音乐 [记录](https://example.test/读取) `读取`\n\n```txt\n读取\n```" });
    if (url.includes("/platforms")) return json({ platforms: [] });
    if (url.includes("/comments")) return json({ total: 0, comments: [], isRoleCreator: false });
    if (url.includes("/score")) return json({ average: null, count: 0, mine: null });
    if (/\/v1\/cards\?/.test(url) && url.includes("author=")) return json({ items: [card, OTHER], total: 2, nextOffset: null });
    if (/\/v1\/cards\/[^?/]+(\?|$)/.test(url)) return json(card);
    if (url.endsWith("/v1/me")) return json({ error: "unauthorized" }, 401);
    return json({ error: "not_found" }, 404);
  };
}

async function page(extra: Record<string, unknown> = {}, locale = "", readme = true) {
  vi.stubGlobal("fetch", fakeFetch({ ...BASE, ...extra }, readme));
  el = document.createElement("div"); document.body.appendChild(el);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/:locale(zh-Hans|en|ja|ko)?/cards/:id", component: CardPage }, { path: "/:pathMatch(.*)*", component: { template: "<div />" } }],
  });
  const pinia = createPinia();
  setActivePinia(pinia);
  await router.push(`${locale ? "/" + locale : ""}/cards/role-abc`);
  await router.isReady();
  app = createApp({ template: "<RouterView />" }).use(pinia).use(router).use(i18n);
  app.mount(el);
  await flush();
  return el;
}

describe("卡片內容依介面轉換字形", () => {
  it("卡片頁簡介與介紹轉繁，Markdown URL與程式碼維持原文", async () => {
    const { displayScriptReady } = await import("../src/lib/display-name");
    const root = await page();
    await displayScriptReady(); await flush();
    expect(root.querySelector(".role__tagline")?.textContent).toBe("音樂關閉，讀取學園記錄");
    expect(root.querySelector(".role__tagline")?.getAttribute("title")).toBe("音樂關閉，讀取學園記錄");
    expect(root.querySelector(".readme h3")?.textContent).toBe("學園玩法");
    expect(root.querySelector(".readme p")?.textContent).toContain("讀取音樂 記錄 读取");
    expect(decodeURI(root.querySelector(".readme a")!.getAttribute("href")!)).toBe("https://example.test/读取");
    expect(root.querySelector(".readme pre code")?.textContent).toBe("读取\n");
  }, 15000);
});

it.each(["zh-Hans", "en", "ja", "ko"])("%s 介面保留對應顯示字形，長簡介 fallback 也只改顯示", async (locale) => {
  const { displayScriptReady } = await import("../src/lib/display-name");
  const summary = "音樂關閉，讀取學園記錄".repeat(14);
  const root = await page({ summary }, locale, false);
  await displayScriptReady(); await flush();
  const shown = locale === "zh-Hans" ? "音乐关闭，读取学园记录".repeat(14) : summary;
  expect(root.querySelector(".role__tagline")?.textContent).toBe(shown);
  expect(root.querySelector(".role__text")?.textContent).toBe(shown);
  expect(summary).toBe("音樂關閉，讀取學園記錄".repeat(14));
}, 15000);
