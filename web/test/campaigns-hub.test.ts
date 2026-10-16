/**
 * 活動中心 /campaigns：公開列表照階段分三個頁籤，加上「我參加的」；頁籤在網址上。
 * 沒指定頁籤時：有進行中的看進行中，沒有就看即將開始，再沒有就看已結束。每張卡整張連到活動頁。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, nextTick, type App } from "vue";
import { createMemoryHistory, createRouter, type Router } from "vue-router";
import { i18n } from "../src/lib/i18n";

vi.mock("../src/lib/track", () => ({ track: () => {}, currentSurface: () => "campaign", setSurface: () => {} }));
const session = vi.hoisted(() => ({ me: null as null | { accountNumId: number }, profile: {}, ready: true, accessToken: async () => "synthetic", restore: async () => undefined }));
vi.mock("../src/lib/session", () => ({ useSession: () => session }));

import CampaignsPage from "../src/pages/CampaignsPage.vue";

const DAY = 86_400_000;
const item = (slug: string, phase: string, extra: Record<string, unknown> = {}) => ({
  slug, title: { "zh-Hant": `活動 ${slug}` }, phase, startsAt: Date.UTC(2026, 9, 1), endsAt: Date.UTC(2026, 10, 1), timezone: "Asia/Taipei", bannerUrl: null, featured: false, ...extra,
});
let list: ReturnType<typeof item>[];
let status: number;

beforeEach(() => {
  i18n.global.locale.value = "zh-Hant" as never;
  status = 200;
  list = [item("now", "open"), item("soon", "upcoming"), item("old", "ended")];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const json = (s: number, b: unknown) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
    if (url === "/v1/campaigns") return status === 200 ? json(200, { items: list }) : json(status, { error: "boom" });
    return json(404, { error: "nope" });
  }));
});
let app: App | null = null, host: HTMLElement, router: Router;
afterEach(() => { app?.unmount(); app = null; host?.remove(); vi.unstubAllGlobals(); });

const settle = async () => { for (let i = 0; i < 8; i++) { await nextTick(); await new Promise((r) => setTimeout(r, 0)); } };
async function mount(path = "/campaigns") {
  router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/campaigns", component: CampaignsPage }, { path: "/:p(.*)*", component: { render: () => null } }] });
  await router.push(path); await router.isReady();
  host = document.body.appendChild(document.createElement("div"));
  app = createApp({ template: "<RouterView />" }).use(router).use(i18n);
  app.mount(host);
  await settle();
}
const cards = () => [...host.querySelectorAll<HTMLAnchorElement>("[data-campaign]")].map((a) => a.dataset.campaign);
const current = () => host.querySelector("[aria-current=page]")?.getAttribute("data-tab");

describe("頁籤", () => {
  it("沒指定時有進行中就看進行中，卡片只放那一段的活動，整張連到活動頁", async () => {
    await mount();
    expect(current()).toBe("open");
    expect(cards()).toEqual(["now"]);
    const a = host.querySelector<HTMLAnchorElement>('[data-campaign="now"]')!;
    expect(a.getAttribute("href")).toBe("/campaign/now");
    expect(a.textContent).toContain("活動 now");
    expect(a.textContent).toContain(i18n.global.t("campaign.phase.open"));
    expect(document.title).toContain(i18n.global.t("campaign.hub.title"));
  });

  it("沒有進行中就看即將開始，再沒有就看已結束", async () => {
    list = [item("soon", "upcoming"), item("old", "ended")];
    await mount();
    expect(current()).toBe("upcoming");
    app!.unmount(); host.remove();
    list = [item("old", "ended")];
    await mount();
    expect(current()).toBe("ended");
    expect(cards()).toEqual(["old"]);
  });

  it("網址指定的頁籤優先；已結束的照結束時間，最近的在前", async () => {
    list = [item("a", "ended", { endsAt: Date.now() - 9 * DAY }), item("b", "ended", { endsAt: Date.now() - DAY }), item("now", "open")];
    await mount("/campaigns?tab=ended");
    expect(current()).toBe("ended");
    expect(cards()).toEqual(["b", "a"]);
  });

  it("進行中與即將開始照開始時間，先開始的在前", async () => {
    list = [item("late", "upcoming", { startsAt: Date.now() + 9 * DAY }), item("early", "upcoming", { startsAt: Date.now() + DAY })];
    await mount("/campaigns?tab=upcoming");
    expect(cards()).toEqual(["early", "late"]);
  });

  it("沒有活動的頁籤只說一句", async () => {
    list = [];
    await mount("/campaigns?tab=upcoming");
    expect(host.querySelector("[data-empty]")!.textContent).toBe(i18n.global.t("campaign.hub.empty.upcoming"));
  });

  it("頁籤是連結，帶著 ?tab=，點了換頁籤", async () => {
    await mount();
    const links = [...host.querySelectorAll<HTMLAnchorElement>("[data-tab]")];
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["open", "upcoming", "ended", "mine"].map((k) => `/campaigns?tab=${k}`));
    links[2]!.click(); await settle();
    expect(router.currentRoute.value.query.tab).toBe("ended");
    expect(cards()).toEqual(["old"]);
  });

  it("「我參加的」：沒登入請他登入，不讀申請", async () => {
    session.me = null;
    await mount("/campaigns?tab=mine");
    expect(current()).toBe("mine");
    expect(host.querySelector("[data-signin-prompt]")!.textContent).toContain(i18n.global.t("campaign.hub.signIn"));
    expect(cards()).toEqual([]);
  });

  it("列表讀不到：說一句、可以重試", async () => {
    status = 500;
    await mount();
    expect(host.querySelector("[role=alert]")!.textContent).toContain(i18n.global.t("campaign.hub.error"));
    status = 200;
    host.querySelector<HTMLButtonElement>("[role=alert] button")!.click(); await settle();
    expect(cards()).toEqual(["now"]);
  });
});
