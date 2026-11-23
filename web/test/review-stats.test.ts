/**
 * 審核統計 /review/stats（審卡 V2，管理員）：路由不被 :id 吃掉、分頁只給管理員；載入骨架、空狀態（附起算日）、
 * 讀取失敗可重新載入、伺服器抑制的格子顯示「樣本不足」、沒記錄的顯示「量不到」；期間寫進網址；CSV 帶憑證下載。
 *
 * 字串還在文案草稿（由主線併進語系檔），這裡只把斷言用到的幾條併進測試用的 i18n。
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createApp, h, type App } from "vue";
import { createPinia } from "pinia";
import { createMemoryHistory, createRouter, RouterView, type Router } from "vue-router";
import { i18n } from "../src/lib/i18n";

const mocks = vi.hoisted(() => ({ role: "manager" as string }));
vi.mock("../src/lib/session", () => ({ useSession: () => ({ me: { accountNumId: 7 }, profile: {}, ready: true, accessToken: async () => "synthetic" }) }));
vi.mock("../src/lib/api", async (original) => ({
  ...(await original<object>()),
  fetchReviewMe: async () => ({ reviewer: true, pending: 0, reviews: 0, cases: 0, comments: 0, role: mocks.role }),
}));
import { router as siteRouter } from "../src/router";

const EN = {
  "moderation.tab.reviewStats": "Review stats",
  "reviewStats.suppressed": "Not enough samples",
  "reviewStats.unmeasured": "Not measurable",
  "reviewStats.empty.title": "Nothing to count yet",
  "reviewStats.empty.body": "Counting starts on {date}. Earlier reviews have no reason categories and won't be filled in.",
  "reviewStats.loadFailed": "Couldn't load",
  "reviewStats.reload": "Reload",
  "reviewStats.tile.firstPassNote": "Each card counts once, at its first decision: {a} approved, {b} rejected",
  "reviewStats.tile.oldest": "Oldest {n} days",
  "reviewStats.cards": "{n} cards",
  "reviewStats.tile.waitNote": "Half of cards are handled within {m}, nine in ten within {p}",
  "reviewStats.sample": "Sample: {n} cards",
  "reviewStats.specVersion": "Spec version {v}",
  "reviewStats.dataAsOf": "Data as of {date}",
};

const DAY = 86_400_000, HOUR = 3_600_000;
const ok = (n: number, values: Record<string, number | null>, denominator?: number) => ({ status: "ok", n, values, ...(denominator === undefined ? {} : { denominator }) });
const SUP = { status: "suppressed" } as const;
const UNM = { status: "unmeasured" } as const;
const stats = (extra: Record<string, unknown> = {}) => ({
  specVersion: 1, generatedAt: Date.UTC(2026, 11, 30, 4), weeks: 4,
  window: { start: Date.UTC(2026, 10, 30), end: Date.UTC(2026, 11, 28), effectiveStart: Date.UTC(2026, 10, 30), weekStarts: [] },
  matured: { resubmit: Date.UTC(2026, 11, 14), dropOutcome: Date.UTC(2026, 11, 21) },
  baseline: { start: Date.UTC(2026, 9, 26), end: Date.UTC(2026, 10, 23, 6, 27), weekStarts: [] },
  v2StartedAt: Date.UTC(2026, 10, 23, 6, 27), v2Recorded: true, empty: false, thresholds: { rows: 10, authors: 5 },
  cells: {
    decisions: { all: ok(40, { approved: 30, rejected: 10, rate: 0.75 }) },
    stock: { pending: ok(12, { count: 12, oldestDays: 3 }), dropped: SUP },
    waits: { first_decision: ok(40, { medianMs: 5 * HOUR, p90Ms: 3 * DAY }), first_action: SUP },
    reasons: { coverage: ok(10, { coded: 10, rejects: 10, rate: 1 }), "opening.no_reply_hook": ok(10, { count: 10, share: 1 }, 10), "opening.too_short": SUP },
    opening: { lt100: ok(12, { approved: 8, rejected: 4, rejectRate: 1 / 3 }), "300_599": SUP, ge1200: ok(0, { approved: 0, rejected: 0, rejectRate: null }) },
    marks: { "v1:rate": UNM },
    "baseline.decisions": { all: ok(50, { approved: 45, rejected: 5, rate: 0.9 }) },
    "baseline.waits": { first_decision: SUP },
    "baseline.reasons": { all: UNM },
    "baseline.stamps": { approve: ok(45, { count: 45 }), reject: ok(10, { count: 10 }) },
  },
  ...extra,
});

let calls: string[];
let body: ReturnType<typeof stats>;
/** 依序消耗的狀態碼；用完回 200。pause 有值時第一個請求等它放行 */
let statuses: number[];
let pause: Promise<void> | null;
const statsCalls = () => calls.filter((u) => u.startsWith("/v1/review/stats"));

beforeEach(() => {
  i18n.global.locale.value = "en";
  i18n.global.mergeLocaleMessage("en", EN);
  calls = []; body = stats(); statuses = []; pause = null; mocks.role = "manager";
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    calls.push(url);
    const json = (status: number, b: unknown) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
    if (url.startsWith("/v1/review/stats/export")) return new Response("utc_week,section,dimension,value,denominator\n", { status: 200, headers: { "Content-Type": "text/csv", "Content-Disposition": 'attachment; filename="review-stats-2026-12-28.csv"' } });
    if (url.startsWith("/v1/review/stats")) {
      if (pause) { const p = pause; pause = null; await p; }
      const s = statuses.shift() ?? 200;
      return s === 200 ? json(200, body) : json(s, { error: "boom" });
    }
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
const text = (sel: string) => host.querySelector(sel)?.textContent?.replace(/\s+/g, " ").trim() ?? "";
const ready = () => vi.waitFor(() => expect(host.querySelector('[data-block="tiles"]')).not.toBeNull());

it("resolves /review/stats to the stats page and shows the tab only to managers and owners", async () => {
  await mount("/en/review/stats");
  await ready();
  expect(router.currentRoute.value.meta.managementTab).toBe("reviewStats");
  expect(statsCalls()).toEqual(["/v1/review/stats?weeks=4"]);
  await vi.waitFor(() => expect(host.querySelector('.management-nav a[href="/en/review/stats"][aria-current="page"]')).not.toBeNull());
  app.unmount(); document.body.innerHTML = "";

  mocks.role = "reviewer";
  await mount("/en/review/settings");
  await vi.waitFor(() => expect(host.querySelector(".management-nav a")).not.toBeNull());
  await new Promise((r) => setTimeout(r, 0));
  expect(host.querySelector('.management-nav a[href="/en/review/stats"]')).toBeNull();
});

it("shows a skeleton while loading, then the four headline numbers with their denominators", async () => {
  let release!: () => void;
  pause = new Promise<void>((r) => { release = r; });
  await mount("/en/review/stats");
  await vi.waitFor(() => expect(host.querySelector('[data-skeleton][aria-busy="true"]')).not.toBeNull());
  expect(host.querySelector('[data-block="tiles"]')).toBeNull();
  release();
  await ready();
  expect(host.querySelector("[data-skeleton]")).toBeNull();
  expect(text('[data-tile="firstPass"]')).toContain("75.0%");
  expect(text('[data-tile="firstPass"]')).toContain(t("reviewStats.tile.firstPassNote", { a: "30", b: "10" }));
  expect(text('[data-tile="pending"]')).toContain(t("reviewStats.tile.oldest", { n: "3" }));
  expect(text('[data-tile="wait"]')).toContain("5 hours");
  expect(text('[data-tile="wait"]')).toContain(t("reviewStats.tile.waitNote", { m: "5 hours", p: "3 days" }));
  expect(text('[data-tile="wait"]')).toContain(t("reviewStats.sample", { n: "40" }));
  expect(text("[data-spec]")).toBe(t("reviewStats.specVersion", { v: 1 }));
  expect(text("[data-as-of]")).toMatch(/^Data as of .*2026/);
});

it("shows suppressed cells as not enough samples and unrecorded ones as not measurable, never as numbers", async () => {
  await mount("/en/review/stats");
  await ready();
  const SAMPLES = t("reviewStats.suppressed"), UNMEASURED = t("reviewStats.unmeasured");
  expect(host.querySelector('[data-tile="dropped"]')!.getAttribute("data-status")).toBe("suppressed");
  expect(text('[data-tile="dropped"] dd')).toBe(SAMPLES);
  expect(text('[data-row="waits.first_action"]')).toContain(SAMPLES);
  expect(text('[data-row="opening.300_599"]')).toContain(SAMPLES);
  // 真的 0：顯示 0 與 —，不是樣本不足
  expect(text('[data-row="opening.ge1200"]')).toContain("0");
  expect(text('[data-row="opening.ge1200"]')).toContain("—");
  expect(text('[data-row="opening.ge1200"]')).not.toContain(SAMPLES);
  // 長條：抑制的理由帶文字，不靠長度或顏色
  expect(host.querySelector('[data-bar="reasons.opening.too_short"]')!.getAttribute("aria-label")).toContain(SAMPLES);
  expect(host.querySelector<HTMLElement>('[data-bar="reasons.opening.too_short"] i')!.style.width).toBe("0%");
  expect(text('[data-row="marks.v1"]')).toContain(UNMEASURED);
  expect(text('[data-baseline="reasons"]')).toContain(UNMEASURED);
  expect(text('[data-baseline="wait"]')).toContain(SAMPLES);
});

it("shows the empty state with the start date and keeps the stock numbers and the pre-V2 baseline", async () => {
  body = stats({ empty: true });
  await mount("/en/review/stats");
  await vi.waitFor(() => expect(host.querySelector("[data-empty]")).not.toBeNull());
  const date = new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(body.v2StartedAt);
  expect(text("[data-empty]")).toContain(t("reviewStats.empty.title"));
  expect(text("[data-empty]")).toContain(t("reviewStats.empty.body", { date }));
  expect([...host.querySelectorAll("[data-tile]")].map((el) => el.getAttribute("data-tile"))).toEqual(["pending", "dropped"]);
  expect(host.querySelector('[data-block="reasons"]')).toBeNull();
  expect(host.querySelector('[data-block="baseline"]')).not.toBeNull();
});

it("offers reload after a failed load and recovers", async () => {
  statuses = [500];
  await mount("/en/review/stats");
  await vi.waitFor(() => expect(host.querySelector("[data-error]")).not.toBeNull());
  expect(text("[data-error]")).toContain(t("reviewStats.loadFailed"));
  host.querySelector<HTMLButtonElement>('[data-action="reload"]')!.click();
  await ready();
  expect(host.querySelector("[data-error]")).toBeNull();
  expect(statsCalls()).toHaveLength(2);
});

it("puts the chosen period in the URL and downloads the CSV with the sign-in token", async () => {
  const created = vi.fn(() => "blob:stats");
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: created, revokeObjectURL: vi.fn() }));
  await mount("/en/review/stats");
  await ready();
  const select = host.querySelector<HTMLSelectElement>("select[data-filter=weeks]")!;
  select.value = "8"; select.dispatchEvent(new Event("change"));
  await vi.waitFor(() => expect(statsCalls().at(-1)).toBe("/v1/review/stats?weeks=8"));
  expect(router.currentRoute.value.query.weeks).toBe("8");
  await ready();
  host.querySelector<HTMLButtonElement>('[data-action="export"]')!.click();
  await vi.waitFor(() => expect(created).toHaveBeenCalled());
  const exportCall = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls.find(([u]) => u.startsWith("/v1/review/stats/export"))!;
  expect(exportCall[0]).toBe("/v1/review/stats/export?weeks=8");
  expect((exportCall[1].headers as Record<string, string>).Authorization).toBe("Bearer synthetic");
});
