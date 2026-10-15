/**
 * 分享活動的入口：首頁橫幅（有進行中活動才出現、可關閉、換一檔活動又會出現）、頁尾與帳號選單各一個連結。
 * 橫幅在首頁掛載時匿名取一次活動列表；資料回來之前什麼都不畫，不佔位。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, nextTick, type App } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { i18n } from "../src/lib/i18n";
import { footerGroups } from "../src/lib/footer-nav";
import CampaignBanner from "../src/components/CampaignBanner.vue";
import boardSource from "../src/pages/BoardPage.vue?raw";
import zhHant from "../src/locales/zh-Hant.json";
import zhHans from "../src/locales/zh-Hans.json";
import en from "../src/locales/en.json";
import ja from "../src/locales/ja.json";
import ko from "../src/locales/ko.json";

const tracked: Array<[string, Record<string, unknown>]> = [];
vi.mock("../src/lib/track", () => ({ track: (e: string, d: Record<string, unknown>) => tracked.push([e, d]), currentSurface: () => "board", setSurface: () => {} }));

const item = (over: Record<string, unknown> = {}) => ({
  slug: "launch", title: { "zh-Hant": "開站分享活動" }, phase: "open", startsAt: Date.UTC(2026, 9, 16), endsAt: Date.UTC(2026, 10, 16), timezone: "Asia/Taipei", bannerUrl: null, ...over,
});
let list: unknown = { items: [item()] };
let calls = 0;
let app: App | undefined; let el: HTMLElement | undefined;
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); await nextTick(); };

async function mount() {
  i18n.global.locale.value = "zh-Hant" as never;
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/:p(.*)*", component: { template: "<div/>" } }] });
  await router.push("/"); await router.isReady();
  el = document.createElement("div"); document.body.append(el);
  app = createApp(CampaignBanner).use(router).use(i18n); app.mount(el);
  await flush();
  return el;
}

beforeEach(() => {
  list = { items: [item()] }; calls = 0; tracked.length = 0;
  vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (!url.endsWith("/campaigns")) return Promise.resolve(new Response("{}", { status: 404 }));
    calls++;
    return Promise.resolve(new Response(JSON.stringify(list), { status: 200, headers: { "Content-Type": "application/json" } }));
  });
});
afterEach(() => { app?.unmount(); el?.remove(); app = undefined; el = undefined; vi.unstubAllGlobals(); vi.restoreAllMocks(); localStorage.clear(); });

describe("首頁活動橫幅", () => {
  it("有進行中的活動：文字卡有名稱、期間與「了解活動」，整張連到活動頁", async () => {
    const root = await mount();
    const banner = root.querySelector(".campaign-banner")!;
    expect(banner.textContent).toContain("開站分享活動");
    expect(banner.textContent).toContain(i18n.global.t("campaign.banner.cta"));
    expect(banner.querySelector("img")).toBeNull();
    expect(banner.querySelector("a")?.getAttribute("href")).toBe("/campaign/launch");
    expect(calls).toBe(1);
  });

  it("有橫幅圖：顯示圖，活動名稱當替代文字", async () => {
    list = { items: [item({ bannerUrl: "https://img.example/b.png" })] };
    const img = (await mount()).querySelector<HTMLImageElement>(".campaign-banner img")!;
    expect(img.getAttribute("src")).toBe("https://img.example/b.png");
    expect(img.getAttribute("alt")).toBe("開站分享活動");
  });

  it("只取第一個進行中的：前面還沒開始、已結束的跳過", async () => {
    list = { items: [item({ slug: "soon", phase: "upcoming" }), item({ slug: "old", phase: "ended" }), item({ slug: "now" }), item({ slug: "later" })] };
    expect((await mount()).querySelector("a")?.getAttribute("href")).toBe("/campaign/now");
  });

  it("沒有進行中的活動、或讀不到：什麼都不畫", async () => {
    list = { items: [item({ phase: "upcoming" }), item({ slug: "old", phase: "ended" })] };
    expect((await mount()).querySelector(".campaign-banner")).toBeNull();
    app?.unmount(); el?.remove();
    vi.stubGlobal("fetch", () => Promise.resolve(new Response("{}", { status: 500 })));
    expect((await mount()).innerHTML).not.toContain("campaign-banner");
  });

  it("資料回來之前不佔位", async () => {
    vi.stubGlobal("fetch", () => new Promise(() => {}));
    expect((await mount()).querySelector(".campaign-banner, .ghost")).toBeNull();
  });

  it("按關閉：收起來，重新載入同一檔不再出現；換一檔活動會再出現", async () => {
    const root = await mount();
    const close = root.querySelector<HTMLButtonElement>("button.campaign-banner__close")!;
    expect(close.getAttribute("aria-label")).toBe(i18n.global.t("campaign.banner.dismiss"));
    close.click(); await nextTick();
    expect(root.querySelector(".campaign-banner")).toBeNull();
    expect(localStorage.getItem("hearthroom.campaignBanner.dismissed.launch")).not.toBeNull();
    app?.unmount(); el?.remove();
    expect((await mount()).querySelector(".campaign-banner")).toBeNull();
    app?.unmount(); el?.remove();
    list = { items: [item({ slug: "spring" })] };
    expect((await mount()).querySelector("a")?.getAttribute("href")).toBe("/campaign/spring");
  });

  it("localStorage 讀寫都丟錯也照樣顯示、照樣能關", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("denied"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("denied"); });
    const root = await mount();
    expect(root.querySelector(".campaign-banner")).not.toBeNull();
    root.querySelector<HTMLButtonElement>("button.campaign-banner__close")!.click(); await nextTick();
    expect(root.querySelector(".campaign-banner")).toBeNull();
  });

  it("點橫幅記一次點擊，subject 是活動 slug", async () => {
    const root = await mount();
    root.querySelector<HTMLAnchorElement>("a")!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(tracked).toEqual([["cta", { detail: "clicked", subject: "launch" }]]);
  });

  it("首頁把它放在下載橫幅與更新提示列之間", () => {
    const at = (s: string) => boardSource.indexOf(`<${s} />`);
    expect(at("DownloadBanner")).toBeGreaterThan(-1);
    expect(at("DownloadBanner")).toBeLessThan(at("CampaignBanner"));
    expect(at("CampaignBanner")).toBeLessThan(at("UpdateStrip"));
  });
});

describe("頁尾入口", () => {
  const ctx = { repoUrl: "https://github.com/hearthroom/hearthroom", license: "AGPL-3.0", discordInvite: "https://discord.gg/x", showDownloadEntry: true, canInstallSite: true };
  it("社群組有「分享活動」，連到我的分享申請", () => {
    const link = footerGroups(ctx).find((g) => g.id === "community")!.links.find((l) => l.id === "campaign");
    expect(link).toMatchObject({ label: "campaign.nav", to: "/me/campaign" });
  });
});

describe("新文案五語都有", () => {
  it.each(["campaign.nav", "campaign.banner.cta", "campaign.banner.dismiss"])("%s", (k) => {
    for (const dict of [zhHant, zhHans, en, ja, ko] as Record<string, string>[]) expect(dict[k], k).toBeTruthy();
  });
});
