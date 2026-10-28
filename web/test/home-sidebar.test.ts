import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createApp, nextTick, type App } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { i18n } from "../src/lib/i18n";
import { useSession } from "../src/lib/session";
import HomeSidebar from "../src/components/HomeSidebar.vue";
import * as api from "../src/lib/api";
import * as rewards from "../src/lib/rewards";
import * as campaigns from "../src/lib/campaign";
import * as updates from "../src/lib/updates";
import * as blog from "../src/lib/blog";
vi.mock("../src/lib/track", () => ({ track: () => {}, currentSurface: () => "board", setSurface: () => {} }));
vi.mock("../src/lib/api", async original => ({ ...await original<typeof api>(), fetchWallet: vi.fn() }));
vi.mock("../src/lib/rewards", async original => ({ ...await original<typeof rewards>(), fetchPanel: vi.fn() }));
vi.mock("../src/lib/campaign", async original => ({ ...await original<typeof campaigns>(), fetchPublicCampaigns: vi.fn() }));
vi.mock("../src/lib/updates", async original => ({ ...await original<typeof updates>(), fetchUpdates: vi.fn() }));
vi.mock("../src/lib/blog", async original => ({ ...await original<typeof blog>(), fetchPosts: vi.fn() }));
const settle = async () => { for (let i = 0; i < 8; i++) { await Promise.resolve(); await nextTick(); } };
let app: App, root: HTMLElement;
async function mount(member = false) {
  const pinia = createPinia(); setActivePinia(pinia);
  const session = useSession();
  if (member) { session.me = { accountNumId: 7 } as never; vi.spyOn(session, "accessToken").mockResolvedValue("token"); }
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/:pathMatch(.*)*", component: { template: "<div />" } }] });
  await router.push("/"); await router.isReady();
  root = document.createElement("div"); document.body.append(root);
  app = createApp(HomeSidebar).use(pinia).use(router).use(i18n); app.mount(root); await settle();
}
beforeEach(() => {
  vi.stubGlobal("fetch", async () => new Response("{}", { headers: { "Content-Type": "application/json" } }));
  vi.mocked(campaigns.fetchPublicCampaigns).mockResolvedValue({ items: [] });
  vi.mocked(updates.fetchUpdates).mockResolvedValue({ items: [], stats: { features: 0, fixes: 0, days: 30 } });
  vi.mocked(blog.fetchPosts).mockResolvedValue({ items: [], pinned: [], total: 0 });
  vi.mocked(api.fetchWallet).mockResolvedValue({ score: 0, tempScore: 0 } as never);
  vi.mocked(rewards.fetchPanel).mockResolvedValue({ checkin: { todayClaimed: false } } as never);
});
afterEach(() => { app?.unmount(); root?.remove(); vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllGlobals(); });
it("keeps campaigns first, chooses only running campaigns, and preserves real destinations", async () => {
  vi.mocked(campaigns.fetchPublicCampaigns).mockResolvedValue({ items: [
    { slug: "future", title: { "zh-Hant": "未開始" }, phase: "upcoming", featured: true },
    { slug: "running", title: { "zh-Hant": "進行中作品季" }, phase: "open", kind: "card_reward" },
  ] as never });
  await mount();
  expect(root.querySelector("section")?.textContent).toContain(i18n.global.t("home.eventsTitle"));
  expect(root.querySelector('a[href="/campaign/running"]')?.textContent).toBe("進行中作品季");
  expect(root.textContent).not.toContain("未開始");
  expect(root.querySelector("[data-sidebar-member]")).toBeNull();
});
it("separates errors from truly empty sources and retries only the failed block", async () => {
  vi.mocked(campaigns.fetchPublicCampaigns).mockRejectedValueOnce(new Error("offline"));
  await mount();
  expect(root.textContent).toContain(i18n.global.t("home.activityError"));
  expect(root.textContent).not.toContain(i18n.global.t("home.noEvents"));
  root.querySelector<HTMLButtonElement>('[data-sidebar-campaigns] button')!.click(); await settle();
  expect(root.textContent).toContain(i18n.global.t("home.noEvents"));
  expect(updates.fetchUpdates).toHaveBeenCalledTimes(1);
});
it("does not duplicate check-in or wallet, and places updates before creation", async () => {
 await mount(true);
 expect(root.querySelector('[data-sidebar-member]')).toBeNull();expect(root.querySelector('a[href="/checkin"]')).toBeNull();
 expect(rewards.fetchPanel).not.toHaveBeenCalled();expect(api.fetchWallet).not.toHaveBeenCalled();
 expect([...root.querySelectorAll('section')].map(el=>el.hasAttribute('data-sidebar-latest'))).toEqual([false,true,false]);
 expect(root.querySelector('[data-sidebar-latest] a[href="/updates"]')?.textContent).toBe(i18n.global.t('home.allUpdates'));
});
it("falls back to a published blog only after updates successfully return empty", async () => {
  vi.mocked(blog.fetchPosts).mockResolvedValue({ total: 1, pinned: [], items: [{ title: "公開新文章", columnSlug: "news", slug: "hello", locale: "zh-Hant", firstPublishedAt: 123 }] as never });
  await mount();
  expect(root.querySelector('a[href="/blog/news/hello"]')?.textContent).toBe("公開新文章");
});

it("keeps anonymous creation available with a secondary action", async () => {
  await mount();
  const create = root.querySelector('a[href="/create"]');
  expect(create?.classList.contains("btn")).toBe(true);
  expect(create?.classList.contains("btn--primary")).toBe(false);
});

it("keeps member creation primary without a duplicate check-in block",async()=>{
 await mount(true);expect(root.querySelector('a[href="/create"]')?.classList.contains('btn--primary')).toBe(true);
 expect(root.querySelector('a[href="/checkin"]')).toBeNull();
});

it("keeps the pinned rail in place in the scroll event, before the next animation frame", async () => {
  const frames = new Map<number, FrameRequestCallback>(); let frameId = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.stubGlobal("scrollY", 0);
  await mount();
  const host = root.querySelector<HTMLElement>(".home-sidebar-host")!;
  const rail = root.querySelector<HTMLElement>(".home-sidebar")!;
  Object.defineProperty(host, "offsetHeight", { configurable: true, value: 5000 });
  Object.defineProperty(rail, "offsetHeight", { configurable: true, value: 300 });
  vi.spyOn(host, "getBoundingClientRect").mockImplementation(() => ({ top: 500 - scrollY }) as DOMRect);
  const flush = () => { const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn(0)); };
  flush();
  vi.stubGlobal("scrollY", 800);
  window.dispatchEvent(new Event("scroll")); flush();
  const before = rail.style.transform;
  vi.stubGlobal("scrollY", 720);
  window.dispatchEvent(new Event("scroll"));
  expect(rail.style.transform, "scroll compensation must be applied before the next paint").not.toBe(before);
  expect(Number(rail.style.transform.match(/[-\d.]+/)?.[0]) - 220).toBe(84);
});
