/**
 * 首頁看板輪播：第一張是蘇綺（插槽），後面接推薦到首頁、進行中或即將開始的活動（進行中在前，最多三個）。
 * 沒有推薦的活動就只有蘇綺，沒有任何輪播的外框與控制；每 7 秒換一張，滑鼠停在上面暫停，系統要求減少動態就不自己換。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, nextTick, type App } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { i18n } from "../src/lib/i18n";
import { featuredCampaigns, type CampaignSummary } from "../src/lib/campaign";
import BoardCarousel from "../src/components/BoardCarousel.vue";
import boardSource from "../src/pages/BoardPage.vue?raw";

const tracked: Array<[string, Record<string, unknown>]> = [];
vi.mock("../src/lib/track", () => ({ track: (e: string, d: Record<string, unknown>) => tracked.push([e, d]), currentSurface: () => "board", setSurface: () => {} }));

const DAY = 86_400_000;
const item = (slug: string, over: Partial<CampaignSummary> = {}): CampaignSummary => ({
  slug, title: { "zh-Hant": `活動 ${slug}` }, phase: "open", startsAt: Date.UTC(2026, 9, 1), endsAt: Date.UTC(2026, 10, 1), timezone: "Asia/Taipei", bannerUrl: null, featured: true, ...over,
});

describe("featuredCampaigns", () => {
  it("只挑推薦到首頁、進行中或即將開始的；進行中在前，再照開始時間；最多三個", () => {
    const list = [
      item("soon", { phase: "upcoming", startsAt: 5 * DAY }),
      item("plain", { featured: false }),
      item("old", { phase: "ended" }),
      item("now-late", { startsAt: 2 * DAY }),
      item("sooner", { phase: "upcoming", startsAt: 3 * DAY }),
      item("now-early", { startsAt: DAY }),
    ];
    expect(featuredCampaigns(list).map((c) => c.slug)).toEqual(["now-early", "now-late", "sooner"]);
    expect(featuredCampaigns(list, 9).map((c) => c.slug)).toEqual(["now-early", "now-late", "sooner", "soon"]);
  });
});

let list: CampaignSummary[];
let app: App | null = null, host: HTMLElement;
const settle = async () => { for (let i = 0; i < 8; i++) { await nextTick(); await new Promise((r) => setTimeout(r, 0)); } };

beforeEach(() => {
  i18n.global.locale.value = "zh-Hant" as never;
  tracked.length = 0;
  list = [item("upcoming-one", { phase: "upcoming", bannerUrl: "https://img.example/b.png" }), item("open-one")];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(JSON.stringify(url === "/v1/campaigns" ? { items: list } : {}), { status: url === "/v1/campaigns" ? 200 : 404, headers: { "Content-Type": "application/json" } })));
});
afterEach(() => { vi.useRealTimers(); app?.unmount(); app = null; host?.remove(); vi.unstubAllGlobals(); });

async function mount(props = "hero campaigns") {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/:p(.*)*", component: { render: () => null } }] });
  await router.push("/"); await router.isReady();
  host = document.body.appendChild(document.createElement("div"));
  const [hero, campaigns] = [props.includes("hero"), props.includes("campaigns")];
  app = createApp({ components: { BoardCarousel }, data: () => ({ hero, campaigns }), template: `<BoardCarousel :hero="hero" :campaigns="campaigns"><aside class="hero-x">蘇綺</aside></BoardCarousel>` });
  app.use(router).use(i18n).mount(host);
  await settle();
}
const $ = <T extends Element = HTMLElement>(sel: string) => host.querySelector<T>(sel);
const slides = () => [...host.querySelectorAll<HTMLElement>(".carousel__slide")].filter((s) => s.style.display !== "none");
const shown = () => slides().findIndex((s) => s.classList.contains("carousel__slide--on"));
const dot = (n: number) => host.querySelectorAll<HTMLButtonElement>("[data-dot]")[n]!;

describe("首頁輪播", () => {
  it("沒有推薦的活動：只有蘇綺，沒有輪播的外框、圓點與左右鍵", async () => {
    list = [item("a", { featured: false }), item("b", { phase: "ended" })];
    await mount();
    expect($(".hero-x")!.textContent).toBe("蘇綺");
    expect($(".carousel--on")).toBeNull();
    expect($("[role=region]")).toBeNull();
    expect($("[data-dot], [data-prev], [data-next]")).toBeNull();
    expect($(".carousel__slide")!.getAttribute("aria-hidden")).toBeNull();
  });

  it("讀不到活動列表也只有蘇綺", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));
    await mount();
    expect($(".carousel--on")).toBeNull();
    expect($(".hero-x")).not.toBeNull();
  });

  it("蘇綺在第一張，進行中的活動排在即將開始的前面；整張連到活動頁", async () => {
    await mount();
    expect($("[role=region]")!.getAttribute("aria-roledescription")).toBe("carousel");
    expect(slides()).toHaveLength(3);
    expect(slides()[0]!.querySelector(".hero-x")).not.toBeNull();
    expect(slides().slice(1).map((s) => s.dataset.slide)).toEqual(["open-one", "upcoming-one"]);
    expect($<HTMLAnchorElement>('[data-slide="open-one"] a')!.getAttribute("href")).toBe("/campaign/open-one");
    expect($('[data-slide="open-one"]')!.textContent).toContain(i18n.global.t("campaign.carousel.cta"));
    expect($<HTMLImageElement>('[data-slide="upcoming-one"] img')!.getAttribute("src")).toBe("https://img.example/b.png");
  });

  it("沒在畫面上的張讀屏跳過、Tab 走不進去；圓點說第幾張", async () => {
    await mount();
    expect(shown()).toBe(0);
    expect(slides()[0]!.getAttribute("aria-hidden")).toBeNull();
    expect(slides()[1]!.getAttribute("aria-hidden")).toBe("true");
    expect(slides()[1]!.hasAttribute("inert")).toBe(true);
    expect(dot(1).getAttribute("aria-label")).toBe(i18n.global.t("campaign.carousel.slide", { n: 2, m: 3 }));
    dot(2).click(); await nextTick();
    expect(shown()).toBe(2);
    expect(dot(2).getAttribute("aria-current")).toBe("true");
    expect(slides()[0]!.getAttribute("aria-hidden")).toBe("true");
    $<HTMLButtonElement>("[data-next]")!.click(); await nextTick();
    expect(shown()).toBe(0);
    $<HTMLButtonElement>("[data-prev]")!.click(); await nextTick();
    expect(shown()).toBe(2);
  });

  it("最多三個活動", async () => {
    list = ["a", "b", "c", "d"].map((s) => item(s));
    await mount();
    expect(slides()).toHaveLength(4);
    expect(host.querySelectorAll("[data-dot]")).toHaveLength(4);
  });

  it("點活動記一次，subject 是活動 slug", async () => {
    await mount();
    $<HTMLAnchorElement>('[data-slide="open-one"] a')!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(tracked).toEqual([["cta", { detail: "carousel", subject: "open-one" }]]);
  });

  it("沒有蘇綺時只放活動；不給放活動（翻到後面幾頁）時什麼都不加", async () => {
    await mount("campaigns");
    expect(slides().map((s) => s.dataset.slide)).toEqual(["open-one", "upcoming-one"]);
    expect($(".carousel--bare")).not.toBeNull();
    app!.unmount(); host.remove();
    await mount("hero");
    expect($(".carousel--on")).toBeNull();
  });

  it("每 7 秒換一張；滑鼠停在上面時不換", async () => {
    await mount();
    vi.useFakeTimers();
    dot(1).click(); await nextTick();
    dot(0).click(); await nextTick();
    vi.advanceTimersByTime(6999); await nextTick();
    expect(shown()).toBe(0);
    vi.advanceTimersByTime(1); await nextTick();
    expect(shown()).toBe(1);
    $(".carousel")!.dispatchEvent(new MouseEvent("mouseenter")); await nextTick();
    vi.advanceTimersByTime(20_000); await nextTick();
    expect(shown()).toBe(1);
    $(".carousel")!.dispatchEvent(new MouseEvent("mouseleave")); await nextTick();
    vi.advanceTimersByTime(7000); await nextTick();
    expect(shown()).toBe(2);
  });

  it("系統要求減少動態：不自己換", async () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduce"), media: q, addEventListener() {}, removeEventListener() {} }));
    await mount();
    vi.useFakeTimers();
    dot(1).click(); await nextTick();
    vi.advanceTimersByTime(30_000); await nextTick();
    expect(shown()).toBe(1);
  });

  it("手指碰過就不再自己換", async () => {
    await mount();
    vi.useFakeTimers();
    $(".carousel")!.dispatchEvent(new TouchEvent("touchstart", { touches: [] }));
    dot(1).click(); await nextTick();
    vi.advanceTimersByTime(30_000); await nextTick();
    expect(shown()).toBe(1);
  });
});

describe("首頁", () => {
  it("輪播包著蘇綺，舊的活動橫幅拿掉了", () => {
    const at = (s: string) => boardSource.indexOf(s);
    expect(at("<BoardCarousel")).toBeGreaterThan(-1);
    expect(at("<BoardCarousel")).toBeLessThan(at("<MascotWelcome />"));
    expect(at("<MascotHome")).toBeLessThan(at("</BoardCarousel>"));
    expect(boardSource).not.toContain("CampaignBanner");
  });
});
