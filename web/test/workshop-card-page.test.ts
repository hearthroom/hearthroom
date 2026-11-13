/**
 * 卡片頁的「工坊」分頁：要不要出現只看伺服器的 tabVisible；讀不到工坊時卡片頁跟原本一樣（介紹、開始對話都不受影響）。
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createApp, nextTick, type App } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter, type Router } from "vue-router";
import { i18n } from "../src/lib/i18n";

vi.mock("../src/lib/oauth", () => ({ restorePersisted: () => null, refresh: async () => null, persist: () => {}, revokeSession: async () => {}, beginLogin: async () => {} }));
vi.mock("../src/lib/track", () => ({ track: () => {}, currentSurface: () => "card", setSurface: () => {} }));
vi.mock("../src/lib/share-ref", async (original) => ({ ...(await original<object>()), currentReferralCode: async () => null }));
vi.mock("moonstage/stage", () => ({}));
vi.mock("moonstage/stage.css", () => ({}));
import CardPage from "../src/pages/CardPage.vue";

const CARD = {
  id: "abc", roleId: "role-abc", num: 100021, zone: "zh", name: "夜行偵探", summary: "民國背景推理",
  avatarUrl: null, backgroundUrl: null, slug: null, tags: [], author: { handle: "abcdefgh", accountNumId: 7, name: "月光", avatar: "" },
  talkNum: 12, followNum: 3, trending: 0, registeredAt: 1, syncedAt: 1, provider: "harbor", rating: null, status: "approved",
};
const EXT = { id: "w1", cardId: "abc", name: "雪夜篇", summary: "", coverUrl: "", author: { handle: null, name: "霧港" }, joinCount: 12, version: 2, updatedAt: 1763000000000, kinds: ["lore"], rating: "G", adult: false };
let workshop: () => Promise<Response>;
const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
function fakeFetch(input: RequestInfo | URL): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (url.includes("/workshop?")) return workshop();
  if (url.includes("/platforms")) return json({ platforms: [] });
  if (url.includes("/comments")) return json({ total: 0, comments: [], isRoleCreator: false });
  if (url.includes("/versions?")) return json({ items: [], page: 1, hasMore: false });
  if (/\/v1\/cards\/abc(\?|$)/.test(url)) return json(CARD);
  if (url.includes("/v1/cards?")) return json({ items: [], total: 0, hasNext: false, limit: 24, offset: 0, sort: "hot" });
  return json({ error: "not_found" }, 404);
}

let app: App | null = null;
let el: HTMLElement | null = null;
let router: Router;
const flush = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0)); await nextTick(); };
async function mount(path: string) {
  el = document.createElement("div"); document.body.appendChild(el);
  router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/cards/:id", component: CardPage }, { path: "/:pathMatch(.*)*", component: { template: "<div />" } }] });
  const pinia = createPinia(); setActivePinia(pinia);
  await router.push(path); await router.isReady();
  app = createApp({ template: "<RouterView />" }).use(pinia).use(router).use(i18n);
  app.mount(el);
  await flush();
  return el;
}
beforeEach(() => { i18n.global.locale.value = "zh-Hant"; vi.stubGlobal("fetch", fakeFetch); });
afterEach(() => { app?.unmount(); el?.remove(); app = null; el = null; vi.unstubAllGlobals(); });

const page = (over: object = {}) => json({ tabVisible: true, allowNew: true, viewerIsOwner: false, total: 1, page: 1, hasMore: false, items: [EXT], ...over });

it("no tab when the server says the workshop tab is not visible; the intro stays as it was", async () => {
  workshop = () => page({ tabVisible: false, allowNew: false, total: 0, items: [] });
  const root = await mount("/cards/abc");
  expect(root.querySelector("[role=tablist]")).toBeNull();
  expect(root.querySelector(".role__body")).not.toBeNull();
});

it("no tab and no error when the workshop cannot be read", async () => {
  workshop = () => json({ error: "internal" }, 500);
  const root = await mount("/cards/abc");
  expect(root.querySelector("[role=tablist]")).toBeNull();
  expect(root.querySelector(".role__body")).not.toBeNull();
  expect(root.textContent).not.toContain("工坊載入失敗");
});

it("shows 介紹｜工坊 with the count; the tab is in the URL and the intro is the default", async () => {
  workshop = () => page();
  const root = await mount("/cards/abc");
  const tabs = [...root.querySelectorAll("[role=tab]")].map((t) => t.textContent?.replace(/\s+/g, ""));
  expect(tabs).toEqual(["介紹", "工坊1"]);
  expect(root.querySelector(".role__body")).not.toBeNull();
  root.querySelector<HTMLButtonElement>("#card-tab-workshop")!.click();
  await flush();
  expect(router.currentRoute.value.query.tab).toBe("workshop");
  expect(root.querySelector(".role__body")).toBeNull();
  expect(root.textContent).toContain("雪夜篇");
});

it("paused by the author: the tab stays with a notice and no create button", async () => {
  workshop = () => page({ allowNew: false });
  const root = await mount("/cards/abc?tab=workshop");
  expect(root.textContent).toContain("作者已暫停新的擴充");
  expect(root.textContent).not.toContain("建立擴充");
});

it("an open workshop with nothing yet still shows the tab with an empty state that invites the first one", async () => {
  workshop = () => page({ total: 0, items: [] });
  const root = await mount("/cards/abc?tab=workshop");
  expect(root.textContent).toContain("這張卡還沒有擴充");
  expect(root.textContent).toContain("建立第一個擴充");
});
