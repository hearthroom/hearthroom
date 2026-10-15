/**
 * 活動數據看板 /review/campaign/stats：路由不被 :id 吃掉；預設挑進行中的活動（沒有再挑已結束），沒有活動是空態；
 * 活動篩選帶參數且寫進網址；五個區塊都渲染；比例一位小數的百分比、時間依長短用小時或天、點數整數；
 * D7／D30 卡片顯示「留下 / 可觀察」，可觀察為 0 顯示 —；點數池區只在有值時出現，可撐天數沒有就說無法估算；
 * 長條寬度是區塊最大值的百分比且帶文字標籤；付費轉換只有一行說明；資料時間與重新整理；讀失敗可重試；
 * 留言統計多了攔截率與近 7 天檢舉。
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createApp, h, type App } from "vue";
import { createPinia } from "pinia";
import { createMemoryHistory, createRouter, RouterView, type Router } from "vue-router";
import { i18n } from "../src/lib/i18n";

const mocks = vi.hoisted(() => ({ commentStats: null as unknown }));
vi.mock("../src/lib/session", () => ({ useSession: () => ({ me: { accountNumId: 7 }, profile: {}, ready: true, accessToken: async () => "synthetic" }) }));
vi.mock("../src/lib/api", async (original) => ({
  ...(await original<object>()),
  fetchReviewMe: async () => ({ reviewer: true, pending: 0, reviews: 0, cases: 0, comments: 0, role: "reviewer" }),
  fetchCommentQueue: async () => ({ total: 0, items: [] }),
  fetchCommentStats: async () => mocks.commentStats,
  fetchKeywords: async () => ({ items: [] }),
}));
import { router as siteRouter } from "../src/router";

const DAY = 86_400_000, HOUR = 3_600_000;
const campaign = (slug: string, title: string, extra: Record<string, unknown> = {}) => ({
  id: `id-${slug}`, slug, title: { "zh-Hant": title }, intro: {}, bannerKey: null, bannerUrl: null, startsAt: Date.now() - 10 * DAY, endsAt: Date.now() + 10 * DAY,
  timezone: "Asia/Taipei", submitDeadline: null, payoutDeadline: null, tiers: {}, extraPlacementAmount: null, flagBurstThreshold: null, evidenceRetentionDays: 30,
  status: "active", version: 1, createdAt: 1, updatedAt: 1, ...extra,
});
const ended = (slug: string, title: string) => campaign(slug, title, { status: "ended", startsAt: Date.now() - 40 * DAY, endsAt: Date.now() - 10 * DAY });

const PLATFORMS = ["qq_group", "tieba", "bahamut", "moments", "video", "forum", "other"] as const;
const effect = (extra: Record<string, unknown> = {}) => ({ visitors: 0, attributed: 0, firstPlay: 0, d7: { eligible: 0, retained: 0 }, d30: { eligible: 0, retained: 0 }, costPerD7: null, costPerD30: null, ...extra });
const stats = (extra: Record<string, unknown> = {}) => ({
  funnel: {
    submitted: 10, needsInfo: 3, resubmitted: 2, approved: 5, rejected: 1, paidContents: 4,
    byTier: { light: { submitted: 4, approved: 2 }, original: { submitted: 3, approved: 2 }, guide: { submitted: 2, approved: 1 }, video: { submitted: 1, approved: 0 } },
    byPlatform: Object.fromEntries(PLATFORMS.map((p, i) => [p, { submitted: i === 0 ? 3 : 1, approved: i === 0 ? 2 : 0 }])),
  },
  review: {
    pending: 2, firstDecisionMedianMs: 5 * HOUR, firstDecisionP90Ms: 72 * HOUR, byActor: { human: 6, ai: 4 },
    rejectReasons: [{ reason: "Screenshot does not show where it was posted", count: 2 }, { reason: "Duplicate", count: 1 }], duplicateRate: 0.125,
  },
  spend: {
    paidTotal: 1200, byTier: { light: 100, original: 600, guide: 500, video: 0 },
    byPlatform: { ...Object.fromEntries(PLATFORMS.map((p) => [p, p === "tieba" ? 900 : 0])), multi: 300 },
    byDay: [{ day: "2026-10-10", points: 400 }, { day: "2026-10-11", points: 800 }],
    pool: { balance: 50000, burn7d: 1200, daysLeft: 291 },
  },
  effect: {
    ...effect({ visitors: 900, attributed: 120, firstPlay: 80, d7: { eligible: 40, retained: 10 }, d30: { eligible: 0, retained: 0 }, costPerD7: 123.456, costPerD30: null }),
    byPlatform: {
      ...Object.fromEntries([...PLATFORMS, "multi", "unreviewed"].map((p) => [p, effect()])),
      tieba: effect({ visitors: 500, attributed: 70, firstPlay: 50, d7: { eligible: 20, retained: 8 }, costPerD7: 99.9 }),
      unreviewed: effect({ visitors: 10, attributed: 3 }),
    },
    topContents: [{ ...effect({ visitors: 300, attributed: 60, firstPlay: 40, d7: { eligible: 10, retained: 5 }, costPerD7: 80.4 }), contentId: "s1", title: "Rainy night bookshop guide", handle: "rainy" }],
  },
  authors: [{ cardId: 12, cardName: "Rainy Bookshop", attributed: 30, firstPlays: 20 }],
  generatedAt: Date.UTC(2026, 9, 15, 6, 30),
  ...extra,
});

type Call = { path: string };
let calls: Call[];
let campaigns: ReturnType<typeof campaign>[];
let statsBody: ReturnType<typeof stats>;
/** 依序消耗的狀態碼；用完回 200 */
let statsStatus: number[];
const statsCalls = () => calls.filter((c) => c.path.startsWith("/v1/moderation/campaign/stats")).map((c) => c.path);

beforeEach(() => {
  i18n.global.locale.value = "en";
  calls = []; campaigns = [campaign("launch", "Launch campaign")]; statsBody = stats(); statsStatus = []; mocks.commentStats = null;
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    calls.push({ path: url });
    const json = (status: number, b: unknown) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
    if (url === "/v1/moderation/campaigns") return json(200, { items: campaigns, canEdit: true });
    if (url.startsWith("/v1/moderation/campaign/stats")) { const s = statsStatus.shift() ?? 200; return s === 200 ? json(200, statsBody) : json(s, { error: "boom" }); }
    return json(404, { error: "not_found" });
  }));
});
afterEach(() => { app?.unmount(); document.body.innerHTML = ""; vi.unstubAllGlobals(); });

let app: App, host: HTMLElement, router: Router;
async function mount(path: string) {
  host = document.body.appendChild(document.createElement("div"));
  router = createRouter({ history: createMemoryHistory(), routes: siteRouter.options.routes });
  await router.push(path);
  app = createApp({ render: () => h(RouterView) }).use(createPinia()).use(router).use(i18n);
  app.mount(host);
}
const t = (k: string, p?: Record<string, unknown>) => i18n.global.t(k, p ?? {});
const page = () => host.querySelector('[data-page="campaign-stats"]');
const ready = () => vi.waitFor(() => expect(host.querySelector('[data-block="funnel"]')).not.toBeNull());
const text = (sel: string) => host.querySelector(sel)?.textContent?.replace(/\s+/g, " ").trim() ?? "";

it("resolves /review/campaign/stats to the stats page, not the content detail page", async () => {
  await mount("/en/review/campaign/stats");
  await ready();
  expect(page()).not.toBeNull();
  expect(router.currentRoute.value.meta.managementTab).toBe("campaign");
  expect(calls.some((c) => c.path.startsWith("/v1/moderation/campaign/contents/"))).toBe(false);
  expect(host.querySelector('.management-nav a[href="/en/review/campaign"][aria-current="page"]')).not.toBeNull();
});

it("picks the open campaign by default, then an ended one, and shows an empty state with no campaigns", async () => {
  campaigns = [ended("old", "Old campaign"), campaign("launch", "Launch campaign")];
  await mount("/en/review/campaign/stats");
  await ready();
  expect(statsCalls()).toEqual(["/v1/moderation/campaign/stats?campaign=launch"]);
  expect(host.querySelector<HTMLSelectElement>("select[data-filter=campaign]")!.value).toBe("launch");
  app.unmount(); document.body.innerHTML = ""; calls = [];

  campaigns = [campaign("draft", "Draft one", { status: "draft", startsAt: null, endsAt: null }), ended("old", "Old campaign")];
  await mount("/en/review/campaign/stats");
  await ready();
  expect(statsCalls()).toEqual(["/v1/moderation/campaign/stats?campaign=old"]);
  app.unmount(); document.body.innerHTML = ""; calls = [];

  campaigns = [];
  await mount("/en/review/campaign/stats");
  await vi.waitFor(() => expect(host.querySelector("[data-empty]")).not.toBeNull());
  expect(statsCalls()).toEqual([]);
  expect(host.querySelector('[data-block="funnel"]')).toBeNull();
});

it("follows ?campaign and writes the choice from the filter into the URL", async () => {
  campaigns = [campaign("launch", "Launch campaign"), ended("spring", "Spring campaign")];
  await mount("/en/review/campaign/stats?campaign=spring");
  await ready();
  expect(statsCalls()).toEqual(["/v1/moderation/campaign/stats?campaign=spring"]);
  await vi.waitFor(() => expect(host.querySelector<HTMLSelectElement>("select[data-filter=campaign]")!.options.length).toBe(2));
  const select = host.querySelector<HTMLSelectElement>("select[data-filter=campaign]")!;
  select.value = "launch"; select.dispatchEvent(new Event("change"));
  await vi.waitFor(() => expect(statsCalls().at(-1)).toBe("/v1/moderation/campaign/stats?campaign=launch"));
  expect(router.currentRoute.value.query.campaign).toBe("launch");
});

it("renders the five blocks with formatted numbers", async () => {
  await mount("/en/review/campaign/stats");
  await ready();
  for (const b of ["funnel", "review", "spend", "effect", "authors"]) expect(host.querySelector(`[data-block="${b}"]`), b).not.toBeNull();
  // 比例：百分比一位小數
  expect(text('[data-stat="duplicateRate"]')).toContain("12.5%");
  // 時間：48 小時內用小時，之後用天
  expect(text('[data-stat="median"]')).toContain("5 hours");
  expect(text('[data-stat="p90"]')).toContain("3 days");
  // 點數：整數、千分位依語系
  expect(text('[data-stat="paidTotal"]')).toContain("1,200");
  expect(text('[data-block="review"]')).toContain("Screenshot does not show where it was posted");
  expect(text('[data-block="authors"]')).toContain("Rainy Bookshop");
  expect(text('[data-block="effect"]')).toContain("Rainy night bookshop guide");
  expect(text('[data-block="effect"]')).toContain("@rainy");
  // 近 7 天的審核佇列大小
  expect(text('[data-stat="pending"]')).toBe(`${t("campaign.stats.review.pending")}2`);
});

it("formats the same numbers for the page locale", async () => {
  i18n.global.locale.value = "zh-Hant";
  await mount("/review/campaign/stats");
  await ready();
  expect(text('[data-stat="median"]')).toContain("5 小時");
  expect(text('[data-stat="p90"]')).toContain("3 天");
  expect(text('[data-stat="duplicateRate"]')).toContain("12.5%");
});

it("shows the three headline numbers, with whole-point cost", async () => {
  await mount("/en/review/campaign/stats");
  await ready();
  expect(text('[data-stat="attributed"]')).toContain("120");
  expect(text('[data-stat="d7Rate"]')).toContain("25.0%");
  expect(text('[data-stat="costPerD7"]')).toContain("123");
  expect(text('[data-stat="costPerD7"]')).not.toContain("123.");
});

it("labels the cost as provisional, splits the visitor sentence into separate counts and names the row-header column", async () => {
  await mount("/en/review/campaign/stats");
  await ready();
  expect(text('[data-stat="costPerD7"]')).toContain(t("campaign.stats.effect.d7CostNote"));
  expect(text('[data-retention="d30"]')).toContain(t("campaign.stats.effect.d30CostNote"));
  expect(text("[data-visitors]")).toBe(t("campaign.stats.effect.visitors", { visitors: "900", attributed: "120", firstPlay: "80" }));
  const heads = [...host.querySelectorAll("thead tr > th:first-child")];
  expect(heads.length).toBeGreaterThan(0);
  for (const th of heads) {
    if (th.textContent?.trim() === t("campaign.stats.authors.card")) continue;
    expect(th.classList.contains("sr-only") || th.querySelector(".sr-only")).toBeTruthy();
    expect(th.textContent?.trim()).toBe(t("campaign.stats.rowHeader"));
  }
});

it("shows retained / eligible for D7 and D30 and a dash when nobody is eligible", async () => {
  await mount("/en/review/campaign/stats");
  await ready();
  const d7 = text('[data-retention="d7"]');
  expect(d7).toContain("10 / 40");
  expect(d7).toContain(t("campaign.stats.effect.d7Note"));
  const d30 = text('[data-retention="d30"]');
  expect(d30).toContain("0 / 0");
  expect(d30).toContain(t("campaign.stats.effect.d30Note"));
  expect(d30).toContain("—");
  expect(d30).not.toContain("0.0%");
  expect(d30).not.toContain("0%");
  // D30 沒有人留下：每留存一人成本是 —
  expect(text('[data-cost="d30"]')).toContain("—");
});

it("shows a dash instead of a percentage and a cost when D7 has no eligible people", async () => {
  statsBody = stats({ effect: { ...stats().effect, d7: { eligible: 0, retained: 0 }, costPerD7: null } });
  await mount("/en/review/campaign/stats");
  await ready();
  expect(text('[data-stat="d7Rate"]')).toContain("—");
  expect(text('[data-stat="d7Rate"]')).not.toContain("%");
  expect(text('[data-stat="costPerD7"]')).toContain("—");
});

it("shows the pool block only when the pool has a value", async () => {
  await mount("/en/review/campaign/stats");
  await ready();
  const pool = text('[data-block="pool"]');
  expect(pool).toContain("50,000");
  expect(pool).toContain("1,200");
  expect(pool).toContain("291");
  app.unmount(); document.body.innerHTML = "";

  const s = stats(); s.spend.pool = { balance: 50000, burn7d: 0, daysLeft: null as unknown as number };
  statsBody = s;
  await mount("/en/review/campaign/stats");
  await ready();
  expect(text('[data-block="pool"]')).toContain(t("campaign.stats.spend.daysUnknown"));
  app.unmount(); document.body.innerHTML = "";

  const n = stats(); (n.spend as { pool: unknown }).pool = null;
  statsBody = n;
  await mount("/en/review/campaign/stats");
  await ready();
  expect(host.querySelector('[data-block="pool"]')).toBeNull();
  expect(host.textContent).not.toContain("50,000");
});

it("draws bars as a percentage of the block maximum and labels each one with text", async () => {
  await mount("/en/review/campaign/stats");
  await ready();
  const bars = [...host.querySelectorAll<HTMLElement>('[data-block="funnel"] [data-bar]')];
  expect(bars.length).toBeGreaterThanOrEqual(6);
  const submitted = host.querySelector<HTMLElement>('[data-bar="funnel.submitted"]')!;
  expect(submitted.querySelector<HTMLElement>("i")!.style.width).toBe("100%");
  const approved = host.querySelector<HTMLElement>('[data-bar="funnel.approved"]')!;
  expect(approved.querySelector<HTMLElement>("i")!.style.width).toBe("50%");
  for (const bar of bars) {
    expect(bar.getAttribute("role")).toBe("img");
    expect(bar.getAttribute("aria-label")).toMatch(/\S.*\d/);
  }
  expect(approved.getAttribute("aria-label")).toBe(`${t("campaign.stats.funnel.approved")}: 5`);
  // 全 0 的區塊不產生 NaN 寬度
  const zero = stats(); zero.spend.byTier = { light: 0, original: 0, guide: 0, video: 0 };
  statsBody = zero;
  app.unmount(); document.body.innerHTML = "";
  await mount("/en/review/campaign/stats");
  await ready();
  for (const i of host.querySelectorAll<HTMLElement>('[data-bar^="spend.tier."] i')) expect(i.style.width).toBe("0%");
});

it("tells the reader why payment conversion is missing, in one line", async () => {
  await mount("/en/review/campaign/stats");
  await ready();
  expect(text('[data-block="effect"]')).toContain(t("campaign.stats.effect.conversionNote"));
  expect(host.querySelectorAll("[data-conversion-note]")).toHaveLength(1);
});

it("shows the data time and reloads on refresh", async () => {
  await mount("/en/review/campaign/stats");
  await ready();
  const when = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(Date.UTC(2026, 9, 15, 6, 30));
  expect(text("[data-generated-at]")).toContain(t("campaign.stats.generatedAt"));
  expect(text("[data-generated-at]")).toContain(when);
  expect(statsCalls()).toHaveLength(1);
  host.querySelector<HTMLButtonElement>("[data-action=refresh]")!.click();
  await vi.waitFor(() => expect(statsCalls()).toHaveLength(2));
});

it("shows a retry when the stats cannot be read", async () => {
  statsStatus = [500];
  await mount("/en/review/campaign/stats");
  await vi.waitFor(() => expect(host.querySelector(".notice--error")).not.toBeNull());
  expect(host.querySelector('[data-block="funnel"]')).toBeNull();
  host.querySelector<HTMLButtonElement>(".notice--error button")!.click();
  await ready();
  expect(host.querySelector(".notice--error")).toBeNull();
});

it("adds the hold rate and the 7-day reports to the comment stats", async () => {
  mocks.commentStats = { held: 4, openReports: 1, removed7d: 2, medianHandleMs7d: 30 * 60_000, holdReasons7d: {}, holdRate7d: 0.125, reports7d: 9 };
  await mount("/en/review/comments");
  await vi.waitFor(() => expect(host.querySelector(".cmod-stats")).not.toBeNull());
  const stat = text(".cmod-stats");
  expect(stat).toContain(`${t("moderation.comments.stats.holdRate")}12.5%`);
  expect(stat).toContain(`${t("moderation.comments.stats.reports7d")}9`);
  app.unmount(); document.body.innerHTML = "";

  mocks.commentStats = { held: 0, openReports: 0, removed7d: 0, medianHandleMs7d: null, holdReasons7d: {}, holdRate7d: null, reports7d: 0 };
  await mount("/en/review/comments");
  await vi.waitFor(() => expect(host.querySelector(".cmod-stats")).not.toBeNull());
  expect(text(".cmod-stats")).toContain(`${t("moderation.comments.stats.holdRate")}—`);
  expect(text(".cmod-stats")).toContain(`${t("moderation.comments.stats.reports7d")}0`);
});

it("links to the stats from the campaign queue", async () => {
  await mount("/en/review/campaign");
  await vi.waitFor(() => expect(host.querySelector("a[data-link=stats]")).not.toBeNull());
  expect(host.querySelector("a[data-link=stats]")!.getAttribute("href")).toBe("/en/review/campaign/stats");
});
