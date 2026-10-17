/**
 * 創作季（發卡獎勵活動）頁：共用活動頁的頁頭，中段是規則卡、我的進度、怎麼參加、條款。
 * 數字讀活動設定；期間用活動時區、結束日是最後一天；主按鈕依登入、額度、階段換；
 * 我的進度的四種狀態（審核中、已通過、已入帳、未通過）；送審畫面的入口只在進行中出現；分享季頁連到創作季。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, nextTick, type App } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { i18n } from "../src/lib/i18n";

vi.mock("../src/lib/track", () => ({ track: () => {}, currentSurface: () => "campaign", setSurface: () => {} }));
const session = vi.hoisted(() => ({ me: null as null | { accountNumId: number }, profile: {}, ready: true, accessToken: async () => "synthetic" }));
vi.mock("../src/lib/session", () => ({ useSession: () => session }));

import CampaignPage from "../src/pages/CampaignPage.vue";
import CreatorSeasonEntry from "../src/components/CreatorSeasonEntry.vue";

const DAY = 86_400_000;
// 台北 10-17 00:00 到 11-01 00:00
const START = Date.UTC(2026, 9, 16, 16), END = Date.UTC(2026, 9, 31, 16);
const NOW = Date.UTC(2026, 9, 27, 4); // 台北 10-27 中午：還有 4 天多

const creator = (extra: Record<string, unknown> = {}) => ({
  kind: "card_reward", slug: "creator-season", title: { "zh-Hant": "綺夢社創作季" }, phase: "open", startsAt: START, endsAt: END, timezone: "Asia/Taipei",
  bannerUrl: null, featured: true, featuredRank: 2, payoutDeadline: null, reward: 10000, weeklyLimit: 6, normalWeeklyLimit: 3, ...extra,
});
const share = () => ({
  kind: "share", slug: "share-season", title: { "zh-Hant": "綺夢分享季" }, phase: "open", startsAt: START, endsAt: END + 16 * DAY, timezone: "Asia/Taipei", bannerUrl: null, featured: true, featuredRank: 1,
  intro: {}, submitDeadline: null, payoutDeadline: null, tiers: { light: 500 }, extraPlacementAmount: null,
});
const item = (cardId: number, review: string, reward: unknown = null) => ({ cardId, name: `卡 ${cardId}`, avatarUrl: null, submittedAt: START + cardId * 3_600_000, review, reward });
const quota = (used: number, extra: Record<string, unknown> = {}) => ({ limit: 6, used, weekStart: Date.UTC(2026, 9, 26), weekEnd: Date.UTC(2026, 10, 2), packRemaining: 0, ...extra });

let detail: Record<string, unknown>;
let progress: Record<string, unknown>;
let list: Record<string, unknown>[];
let calls: string[];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  i18n.global.locale.value = "zh-Hant";
  session.me = null;
  detail = creator();
  list = [share(), creator()];
  progress = { quota: quota(2), approvedCount: 0, pendingCount: 0, creditsPaid: 0, items: [] };
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    calls.push(url);
    const json = (status: number, b: unknown) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
    if (url === "/v1/campaigns") return json(200, { items: list });
    if (url === "/v1/campaigns/creator-season") return json(200, detail);
    if (url === "/v1/campaigns/share-season") return json(200, share());
    if (url === "/v1/card-rewards/creator-season/me") return json(200, progress);
    if (url.startsWith("/v1/me/campaign/contents")) return json(200, { items: [] });
    return json(404, { error: "nope" });
  }));
});
let app: App | null, host: HTMLElement;
afterEach(() => { app?.unmount(); app = null; host?.remove(); document.body.innerHTML = ""; vi.unstubAllGlobals(); vi.useRealTimers(); });

const settle = async () => { for (let i = 0; i < 8; i++) { await nextTick(); await new Promise((r) => setTimeout(r, 0)); } };
async function mount(component: Parameters<typeof createApp>[0], path = "/campaign/creator-season") {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/campaign/:slug", component: { render: () => null } }, { path: "/:p(.*)*", component: { render: () => null } }] });
  await router.push(path); await router.isReady();
  host = document.body.appendChild(document.createElement("div"));
  app = createApp(component).use(router).use(i18n);
  app.mount(host);
  await settle();
}
const t = (k: string, v: Record<string, unknown> = {}) => i18n.global.t(k, v);
const $ = <T extends Element = HTMLElement>(sel: string) => host.querySelector<T>(sel);
const text = (sel: string) => $(sel)?.textContent?.replace(/\s+/g, " ").trim() ?? "";
const links = () => [...host.querySelectorAll<HTMLAnchorElement>("[data-cta] a")].map((a) => [a.textContent!.trim(), a.getAttribute("href")]);

describe("頁頭與規則卡", () => {
  it("訪客：副標、蘇綺的導言帶站名、還有幾天、期間的結束日是最後一天；大數字讀活動設定；請他登入後回到這頁", async () => {
    await mount(CampaignPage);
    expect(text("h1")).toBe("綺夢社創作季");
    expect(text("[data-phase]")).toBe(t("creator.status.open", { days: 5 }));
    expect(text("[data-period]")).toBe("10月17日 – 10月31日（台北時間）");
    expect(host.textContent).toContain(t("creator.subtitle", { credits: "10,000" }));
    expect(host.textContent).toContain("綺夢社才剛開張");
    expect(text(".creator__big")).toBe("10,000 積分");
    expect(text("[data-rules]")).toContain("每週能送審 6 張（平常 3 張）");
    expect(text("[data-rules]")).toContain("一週 6 張全過審＝60,000 積分");
    expect(links()).toEqual([[t("creator.cta.signIn"), expect.stringContaining("/login")]]);
    expect($("[data-progress]")).toBeNull();
    expect(host.querySelectorAll("[data-notes] li")).toHaveLength(5);
    expect(text("[data-notes]")).toContain("10月31日 23:59（台北時間）");
  });

  it("最後 24 小時顯示今天截止；結束後主按鈕到我的卡片，蘇綺說截止前送審的照樣入帳", async () => {
    vi.setSystemTime(END - 3_600_000);
    await mount(CampaignPage);
    expect(text("[data-phase]")).toBe(t("creator.status.lastDay"));
    app!.unmount(); host.remove();
    detail = creator({ phase: "ended" });
    vi.setSystemTime(END + DAY);
    await mount(CampaignPage);
    expect(text("[data-phase]")).toBe(t("creator.status.ended"));
    expect(links()).toEqual([[t("creator.cta.ended"), "/mine"]]);
    expect(text("[data-cta]")).toContain(t("creator.say.ended", { end: "10月31日" }));
  });

  it("登入、額度還有：寫一張新卡與從我的卡片送審；額度用完：一行狀態，主按鈕換成從我的卡片送審", async () => {
    session.me = { accountNumId: 7 };
    await mount(CampaignPage);
    expect(links()).toEqual([[t("creator.cta.write"), "/create"], [t("creator.cta.fromMine"), "/mine"]]);
    app!.unmount(); host.remove();
    progress = { ...progress, quota: quota(6) };
    await mount(CampaignPage);
    expect($("[data-quota-full]")!.textContent).toContain("本週額度已用完");
    expect(links()).toEqual([[t("creator.cta.fromMine"), "/mine"], [t("creator.cta.write"), "/create"]]);
  });
});

describe("我的進度", () => {
  it("三格數字；列表的四種狀態，已入帳帶金額；整列連到那張卡的編輯器；多於 5 張先收起來", async () => {
    session.me = { accountNumId: 7 };
    progress = {
      quota: quota(3), approvedCount: 4, pendingCount: 1, creditsPaid: 20000,
      items: [item(7, "approved", { status: "paid", amount: 10000 }), item(6, "approved"), item(5, "pending"), item(4, "rejected"), item(3, "approved", { status: "paid", amount: 10000 }), item(2, "approved")],
    };
    await mount(CampaignPage);
    expect(text('[data-cell="week"]')).toContain("3/6");
    expect(text('[data-cell="approved"]')).toContain("4 張");
    expect(text('[data-cell="approved"]')).toContain("審核中 1 張");
    expect(text('[data-cell="paid"]')).toContain("20,000");
    const rows = () => [...host.querySelectorAll<HTMLAnchorElement>("[data-card]")];
    expect(rows()).toHaveLength(5);
    expect(rows().map((r) => r.querySelector("[data-status]")!.textContent)).toEqual(["已入帳", "已通過", "審核中", "未通過", "已入帳"]);
    expect(rows()[0]!.textContent).toContain("+10,000");
    expect(rows()[1]!.textContent).not.toContain("+");
    expect(rows()[0]!.getAttribute("href")).toBe("/cards/7/edit");
    host.querySelector<HTMLButtonElement>(".creator__all")!.click(); await settle();
    expect(rows()).toHaveLength(6);
  });

  it("這期還沒送審：蘇綺的空狀態與寫一張新卡，規則卡底下的姿勢收起來", async () => {
    session.me = { accountNumId: 7 };
    await mount(CampaignPage);
    expect($("[data-empty]")!.textContent).toContain(t("creator.say.empty"));
    expect($("[data-rules] img")).toBeNull();
  });
});

describe("入口", () => {
  const Entry = (where: "mine" | "editor") => defineComponent({ render: () => h(CreatorSeasonEntry, { where }) });

  it("我的卡片與編輯器：進行中才出現，整行連到活動頁，字讀活動設定", async () => {
    await mount(Entry("mine"), "/mine");
    expect(text("[data-creator-entry]")).toContain(t("mine.campaign.publishReward", { end: "10月31日", credits: "10,000", limit: 6 }));
    expect($<HTMLAnchorElement>("[data-creator-entry]")!.getAttribute("href")).toBe("/campaign/creator-season");
    app!.unmount(); host.remove();
    await mount(Entry("editor"), "/create");
    expect(text("[data-creator-entry]")).toBe(t("editor.publish.reward", { end: "10月31日", credits: "10,000" }));
  });

  it("活動已結束或還沒開始：不出現", async () => {
    list = [share(), creator({ phase: "ended" })];
    await mount(Entry("mine"), "/mine");
    expect($("[data-creator-entry]")).toBeNull();
  });

  it("分享季頁在條款上方連到進行中的創作季", async () => {
    await mount(CampaignPage, "/campaign/share-season");
    const link = $<HTMLAnchorElement>("[data-creator-link]")!;
    expect(link.getAttribute("href")).toBe("/campaign/creator-season");
    expect(link.textContent).toContain(t("campaign.page.creatorLink", { credits: "10,000" }));
  });
});
