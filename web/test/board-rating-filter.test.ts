/**
 * 分級選單（2026-10-11）：放在「N 張」那一行的右邊，不多佔一行。語義是「最高到這一級」——
 * 想看安全內容的人要的是「不超過 X」。數字是累計的；沒標分級的舊卡只算進「輔15級以下」。
 * 限制級不在選單裡（由頁首的成人內容開關管）。
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createApp, nextTick, type App } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter, type Router } from "vue-router";
import { i18n } from "../src/lib/i18n";
import BoardPage from "../src/pages/BoardPage.vue";
import * as api from "../src/lib/api";

vi.mock("../src/lib/api", async (original) => ({ ...await original<typeof api>(),
  fetchBoard: vi.fn(async () => ({ items: [], total: 0, hasNext: false, limit: 24, offset: 0, sort: "hot" })),
  fetchTagCounts: vi.fn(async () => ({ counts: {}, ratings: { G: 0, P: 0, PG12: 2, PG15: 1, R: 5, none: 3 } })),
}));
vi.mock("../src/lib/track", () => ({ track: () => {}, currentSurface: () => "board", setSurface: () => {} }));
vi.mock("moonstage/stage", () => ({}));
vi.mock("moonstage/stage.css", () => ({}));

let app: App | undefined; let root: HTMLElement; let router: Router;
const settle = async () => { for (let i = 0; i < 8; i++) { await new Promise((r) => setTimeout(r, 0)); await nextTick(); } };
async function mount(path: string) {
  router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/", component: BoardPage }, { path: "/:pathMatch(.*)*", component: { template: "<div />" } }] });
  await router.push(path); await router.isReady();
  root = document.createElement("div"); document.body.appendChild(root);
  setActivePinia(createPinia());
  app = createApp({ template: "<router-view />" }).use(createPinia()).use(i18n).use(router);
  app.mount(root); await settle();
}
const select = () => root.querySelector<HTMLSelectElement>(".rating-filter select")!;
const option = (value: string) => [...select().options].find((o) => o.value === value)!;

beforeEach(() => {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, onchange: null, dispatchEvent: () => false }));
});
afterEach(() => { app?.unmount(); root?.remove(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

it("選項是「最高到這一級」，數字累計；輔15級以下含沒標分級的；沒有限制級；0 張的選不了", async () => {
  await mount("/");
  expect([...select().options].map((o) => o.value)).toEqual(["", "G", "P", "PG12", "PG15"]);
  expect(select().value).toBe("");
  expect(option("PG12").textContent).toContain("(2)");
  expect(option("PG15").textContent).toContain("(6)");
  expect(option("G").disabled).toBe(true);
  expect(option("PG12").disabled).toBe(false);
});

it("選了就進網址，榜單與數量都照這一級讀", async () => {
  await mount("/");
  select().value = "PG12";
  select().dispatchEvent(new Event("change"));
  await settle();
  expect(router.currentRoute.value.query.rating).toBe("PG12");
  expect(vi.mocked(api.fetchBoard)).toHaveBeenLastCalledWith(expect.objectContaining({ rating: "PG12" }));
  expect(vi.mocked(api.fetchTagCounts)).toHaveBeenLastCalledWith(expect.objectContaining({ rating: "PG12" }));
  expect(select().value).toBe("PG12");
});
