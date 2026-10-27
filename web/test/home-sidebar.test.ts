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
it("displays a real zero balance and known check-in state, with navigation rather than a claim", async () => {
  await mount(true);
  expect(root.querySelector('[data-sidebar-balance]')?.textContent).toContain("0");
  expect(root.textContent).toContain(i18n.global.t("home.pending"));
  expect(root.querySelector('a[href="/checkin"]')?.textContent).toContain(i18n.global.t("home.checkinAction"));
});
it("never labels a missing panel as claimed or pending, and discards old-account responses", async () => {
  let resolve!: (value: never) => void;
  vi.mocked(rewards.fetchPanel).mockImplementationOnce(() => new Promise(r => { resolve = r; })).mockRejectedValueOnce(new Error("offline"));
  await mount(true);
  expect(root.textContent).not.toContain(i18n.global.t("home.pending"));
  useSession().me = { accountNumId: 8 } as never; await settle();
  resolve({ checkin: { todayClaimed: true } } as never); await settle();
  expect(root.textContent).toContain(i18n.global.t("home.checkinError"));
  expect(root.textContent).not.toContain(i18n.global.t("home.claimed"));
});
it("falls back to a published blog only after updates successfully return empty", async () => {
  vi.mocked(blog.fetchPosts).mockResolvedValue({ total: 1, pinned: [], items: [{ title: "公開新文章", columnSlug: "news", slug: "hello", locale: "zh-Hant", firstPublishedAt: 123 }] as never });
  await mount();
  expect(root.querySelector('a[href="/blog/news/hello"]')?.textContent).toBe("公開新文章");
});

it("omits disabled check-in while keeping the member balance", async () => {
  vi.mocked(rewards.fetchPanel).mockRejectedValueOnce(new rewards.RewardsError(404, "disabled", "rewards_disabled"));
  await mount(true);
  expect(root.querySelector('a[href="/checkin"]')).toBeNull();
  expect(root.textContent).not.toContain(i18n.global.t("home.checkinError"));
  expect(root.querySelector('[data-sidebar-balance]')?.textContent).toContain("0");
});
