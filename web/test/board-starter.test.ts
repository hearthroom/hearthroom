import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createApp, nextTick } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { i18n } from "../src/lib/i18n";
import { tourState } from "../src/lib/coach-tour";
import { guestAdult } from "../src/lib/adult-consent";
import { useSession } from "../src/lib/session";
import type { CommunityCard } from "../src/lib/types";
import * as api from "../src/lib/api";
import BoardPage from "../src/pages/BoardPage.vue";

vi.mock("../src/lib/track", () => ({ track: () => {}, currentSurface: () => "board", setSurface: () => {} }));
vi.mock("../src/components/BoardCarousel.vue", () => ({ default: { template: "<div />" } }));
vi.mock("../src/components/DownloadBanner.vue", () => ({ default: { template: "<div />" } }));
vi.mock("../src/components/UpdateStrip.vue", () => ({ default: { template: "<div />" } }));
vi.mock("../src/lib/api", async original => ({ ...await original<typeof api>(),
  fetchBoard: vi.fn(), fetchCard: vi.fn(), fetchTagCounts: vi.fn(async () => ({ counts: {}, ratings: {} })),
}));
const card = (num: number) => ({ id: String(num), num, name: `Card ${num}`, summary: "", tags: [], zone: "zh", avatarUrl: null, author: { handle: null, name: "Author", avatar: "" }, talkNum: 0, trending: 0 } as CommunityCard);
const deferred = () => { let resolve!: (card: CommunityCard) => void; const promise = new Promise<CommunityCard>(r => { resolve = r; }); return { promise, resolve }; };
let app: ReturnType<typeof createApp>;
let pinia: ReturnType<typeof createPinia>;
let root: HTMLElement;
const flush = async () => { for (let i = 0; i < 8; i++) { await Promise.resolve(); await nextTick(); } };
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  pinia = createPinia(); setActivePinia(pinia); useSession().ready = true;
  Object.assign(guestAdult, { loaded: true, available: true, showNsfw: false });
  tourState.step = "card"; tourState.card = 0;
  vi.mocked(api.fetchBoard).mockResolvedValue({ items: [card(1), card(2)], total: 2, hasNext: false, offset: 0, limit: 24, sort: "hot" });
  vi.mocked(api.fetchCard).mockImplementation(async id => card(Number(id)));
  i18n.global.locale.value = "zh-Hant";
});
afterEach(() => { app?.unmount(); root?.remove(); tourState.step = null; vi.clearAllMocks(); });
async function mount() {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/", component: BoardPage }, { path: "/:pathMatch(.*)*", component: { template: "<div />" } }] });
  await router.push("/");
  root = document.createElement("div"); document.body.append(root);
  app = createApp({ template: "<RouterView />" }).use(pinia).use(router).use(i18n);
  app.mount(root); await flush();
}
const starterLink = () => root.querySelector('[data-tour="starter"] .card__link')?.getAttribute("href");
it("injects the selected starter into the actual board grid only during the tour", async () => {
  await mount();
  expect(starterLink()).toBe("/cards/100216");
  expect(root.querySelector('[data-tour="starter"]')?.parentElement?.classList.contains("grid")).toBe(true);
  tourState.step = "choose"; await flush();
  guestAdult.showNsfw = true; await flush();
  expect(starterLink()).toBe("/cards/100076");
  tourState.step = null; await flush();
  expect(starterLink()).toBeUndefined();
});
it("ignores a late general response after the viewer enables adult content", async () => {
  const general = deferred();
  vi.mocked(api.fetchCard).mockImplementation(async id => id === "100216" ? general.promise : card(Number(id)));
  await mount();
  guestAdult.showNsfw = true; await flush();
  expect(starterLink()).toBe("/cards/100076");
  general.resolve(card(100216)); await flush();
  expect(starterLink()).toBe("/cards/100076");
});
