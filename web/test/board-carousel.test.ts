/**
 * 首頁看板輪播：推薦到首頁、進行中或即將開始的活動在前（照排序值，最多三個），蘇綺（插槽）固定最後。
 * 沒有推薦的活動就只有蘇綺，沒有任何輪播的外框與控制；每 7 秒換一張，滑鼠停在上面暫停（剩下的時間保留），
 * 手指碰過 10 秒後恢復，系統要求減少動態就不自己換。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, nextTick, type App } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { i18n } from "../src/lib/i18n";
import { featuredCampaigns, formatShortPeriod, type CampaignSummary } from "../src/lib/campaign";
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

  it("有排序值的照排序值排在前面（分享季 → 創作季），沒有的照原本規則排在後面", () => {
    const list = [
      item("plain-early", { startsAt: 0 }),
      item("creator", { featuredRank: 2, startsAt: 3 * DAY }),
      item("share", { featuredRank: 1, startsAt: 4 * DAY }),
    ];
    expect(featuredCampaigns(list).map((c) => c.slug)).toEqual(["share", "creator", "plain-early"]);
  });
});

describe("formatShortPeriod", () => {
  // 分享季：台北 10-17 00:00 到 11-17 00:00；創作季：10-17 00:00 到 11-01 00:00
  const share = { startsAt: Date.UTC(2026, 9, 16, 16), endsAt: Date.UTC(2026, 10, 16, 16), timezone: "Asia/Taipei" };
  const creator = { startsAt: Date.UTC(2026, 9, 16, 16), endsAt: Date.UTC(2026, 9, 31, 16), timezone: "Asia/Taipei" };
  it("只到月日，結束日是最後一天，不帶年份、時間與時區名稱", () => {
    const zh = formatShortPeriod(share, "zh-Hant");
    expect(zh).toMatch(/10\/17/);
    expect(zh).toMatch(/11\/16/);
    expect(zh).not.toMatch(/2026|11\/17|:|台北/);
    expect(formatShortPeriod(creator, "en")).toMatch(/10\/17.*10\/31/);
    expect(formatShortPeriod(creator, "ja")).not.toMatch(/11/);
  });
  it("只有開始或只有結束：只顯示那一天", () => {
    expect(formatShortPeriod({ ...creator, endsAt: null }, "zh-Hant")).toBe("10/17");
    expect(formatShortPeriod({ ...creator, startsAt: null }, "zh-Hant")).toBe("10/31");
  });
});

let list: CampaignSummary[];
let mountedRouter: ReturnType<typeof createRouter>;
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
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/:locale(en|ja|ko|zh-Hans)/:p(.*)*", component: { render: () => null } }, { path: "/:p(.*)*", component: { render: () => null } }] });
  mountedRouter = router;
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
  it("shows only the exact-language poster with accessible copy, then falls back to the original banner", async () => {
    list = [item("poster", { bannerUrl: "https://img.example/original.webp", posterUrls: { "zh-Hant": { url: "https://img.example/poster.webp", alt: "邀請朋友，分享拿積分" } } })];
    await mount();
    const card = $('[data-slide="poster"] .carousel__card')!;
    expect(card.classList.contains("carousel__card--poster")).toBe(true);
    expect(card.querySelector("img")?.getAttribute("src")).toBe("https://img.example/poster.webp");
    expect(card.querySelector("img")?.getAttribute("alt")).toBe("邀請朋友，分享拿積分");
    expect(card.querySelector(".carousel__body")).toBeNull();
    i18n.global.locale.value = "en";
    await mountedRouter.push("/en/");
    await nextTick();
    expect(card.classList.contains("carousel__card--poster")).toBe(false);
    expect(card.querySelector("img")?.getAttribute("src")).toBe("https://img.example/original.webp");
    expect(card.querySelector(".carousel__body")).not.toBeNull();
  });

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

  it("活動在前、蘇綺固定最後，進行中的活動排在即將開始的前面；整張連到活動頁", async () => {
    await mount();
    expect($("[role=region]")!.getAttribute("aria-roledescription")).toBe("carousel");
    expect(slides()).toHaveLength(3);
    expect(slides()[2]!.querySelector(".hero-x")).not.toBeNull();
    expect(slides().slice(0, 2).map((s) => s.dataset.slide)).toEqual(["open-one", "upcoming-one"]);
    expect($<HTMLAnchorElement>('[data-slide="open-one"] a')!.getAttribute("href")).toBe("/campaign/open-one");
    expect($('[data-slide="open-one"]')!.textContent).toContain(i18n.global.t("campaign.carousel.cta"));
    expect($<HTMLImageElement>('[data-slide="upcoming-one"] img')!.getAttribute("src")).toBe("https://img.example/b.png");
  });

  it("有活動時先停在第一個活動，蘇綺排在輪換的最後（owner 2026-10-17：活動比歡迎卡重要）", async () => {
    await mount();
    expect(shown()).toBe(0);
    expect(slides()[0]!.getAttribute("aria-hidden")).toBeNull();
    expect(slides()[2]!.getAttribute("aria-hidden")).toBe("true");
  });

  it("輪播上的期間只到月日（手機不截斷）；品牌名與活動名各自不換行", async () => {
    list = [item("creator", { title: { ja: "SukiSuki 創作シーズン" }, startsAt: Date.UTC(2026, 9, 16, 16), endsAt: Date.UTC(2026, 9, 31, 16) })];
    i18n.global.locale.value = "ja" as never;
    await mount();
    const slide = $('[data-slide="creator"]')!;
    expect([...slide.querySelectorAll(".carousel__part")].map((e) => e.textContent)).toEqual(["SukiSuki", "創作シーズン"]);
    expect(slide.querySelector(".carousel__title")!.textContent).toBe("SukiSuki 創作シーズン");
    expect(slide.querySelector(".carousel__period")!.textContent).not.toMatch(/2026|:|台湾|11/);
  });

  it("沒在畫面上的張讀屏跳過、Tab 走不進去；圓點說第幾張", async () => {
    await mount();
    dot(0).click(); await nextTick();
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

  it("每 7 秒換一張；滑鼠停在上面時不換，移開後接著剩下的時間（不重新計 7 秒）", async () => {
    await mount();
    vi.useFakeTimers();
    dot(1).click(); await nextTick();
    dot(0).click(); await nextTick();
    vi.advanceTimersByTime(6999); await nextTick();
    expect(shown()).toBe(0);
    vi.advanceTimersByTime(1); await nextTick();
    expect(shown()).toBe(1);
    vi.advanceTimersByTime(3000); await nextTick();
    $(".carousel")!.dispatchEvent(new MouseEvent("mouseenter")); await nextTick();
    expect($(".carousel__dots--paused")).not.toBeNull();
    vi.advanceTimersByTime(20_000); await nextTick();
    expect(shown()).toBe(1);
    $(".carousel")!.dispatchEvent(new MouseEvent("mouseleave")); await nextTick();
    vi.advanceTimersByTime(3999); await nextTick();
    expect(shown()).toBe(1);
    vi.advanceTimersByTime(1); await nextTick();
    expect(shown()).toBe(2);
  });

  it("進度條：看過的填滿、現在這段在填、後面的空著", async () => {
    await mount();
    dot(1).click(); await nextTick();
    const dots = [...host.querySelectorAll<HTMLElement>("[data-dot]")];
    expect(dots.map((d) => (d.classList.contains("carousel__dot--seen") ? "seen" : d.classList.contains("carousel__dot--on") ? "on" : "-"))).toEqual(["seen", "on", "-"]);
    expect($(".carousel__dots--auto")).not.toBeNull();
  });

  it("系統要求減少動態：不自己換，進度條不跑", async () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduce"), media: q, addEventListener() {}, removeEventListener() {} }));
    await mount();
    vi.useFakeTimers();
    dot(1).click(); await nextTick();
    vi.advanceTimersByTime(30_000); await nextTick();
    expect(shown()).toBe(1);
    expect($(".carousel__dots--auto")).toBeNull();
  });

  it("手指碰過先停，最後一次碰到之後 10 秒恢復自己換", async () => {
    await mount();
    vi.useFakeTimers();
    $(".carousel")!.dispatchEvent(new TouchEvent("touchstart", { touches: [] }));
    dot(1).click(); await nextTick();
    vi.advanceTimersByTime(9999); await nextTick();
    expect(shown()).toBe(1);
    $(".carousel")!.dispatchEvent(new TouchEvent("touchend", { changedTouches: [] }));
    vi.advanceTimersByTime(9999); await nextTick();
    expect(shown()).toBe(1);
    vi.advanceTimersByTime(1); await nextTick();
    vi.advanceTimersByTime(7000); await nextTick();
    expect(shown()).toBe(2);
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

describe("blog post slide", () => {
  const post = (over: Record<string, unknown> = {}) => ({
    id: "p1", columnSlug: "news", slug: "hello", title: "開站了", excerpt: "", coverUrl: null, locale: "zh-Hant", firstPublishedAt: Date.now() - 86_400_000,
    pinned: true, readMinutes: 1, commentCount: 0, campaign: null, ...over,
  });
  const columns = { items: [{ id: "g1", slug: "official", name: { "zh-Hant": "官方消息" }, description: {}, sort: 0, enabled: true, parentId: null,
    columns: [{ id: "c1", slug: "news", name: { "zh-Hant": "公告" }, description: {}, sort: 0, enabled: true, parentId: "g1" }] }] };
  const serve = (pinned: unknown[]) => vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const path = url.split("?")[0];
    const body = path === "/v1/campaigns" ? { items: list } : path === "/v1/blog/posts" ? { total: 0, pinned, items: [] } : path === "/v1/blog/columns" ? columns : null;
    return new Response(JSON.stringify(body ?? {}), { status: body ? 200 : 404, headers: { "Content-Type": "application/json" } });
  }));

  it("adds one slide for a fresh pinned post, after the campaigns and before Suki, linking to the post", async () => {
    serve([post()]);
    await mount();
    const slide = $('[data-slide="post:hello"]')!;
    expect(slide).not.toBeNull();
    expect(slides().at(-2)).toBe(slide);
    expect(slides().at(-1)!.querySelector(".hero-x")).not.toBeNull();
    expect(slide.querySelector("a")!.getAttribute("href")).toBe("/blog/news/hello");
    expect(slide.textContent).toContain("公告");
    expect(slide.textContent).toContain("開站了");
    slide.querySelector("a")!.click();
    expect(tracked).toContainEqual(["cta", { detail: "carousel", subject: "post:hello" }]);
  });

  it("shows the post alone when there are no featured campaigns", async () => {
    list = [];
    serve([post()]);
    await mount();
    expect($(".carousel--on")).not.toBeNull();
    expect(slides()).toHaveLength(2);
  });

  it("leaves the carousel as it was when no post qualifies", async () => {
    serve([post({ firstPublishedAt: Date.now() - 31 * 86_400_000 })]);
    await mount();
    expect($('[data-slide^="post:"]')).toBeNull();
    expect(slides()).toHaveLength(3);
  });
});
