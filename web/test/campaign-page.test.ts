/**
 * 公開活動頁 /campaign/:slug：規則與金額讀 API、訪客看得到規則並帶回原頁登入、只有進行中＋登入才有申請表；
 * 申請表的本體（時區換算、新內容或既有內容）、連結或截圖至少一個、伺服器的欄位錯誤標在那一格、
 * 失敗重按沿用 operationId；我的分享連結帶推薦碼與分享短碼；進頁只記一次。
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createApp, nextTick, type App } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { i18n } from "../src/lib/i18n";

const tracked = vi.hoisted(() => [] as { event: string; data: Record<string, unknown> }[]);
vi.mock("../src/lib/track", () => ({ track: (event: string, data: Record<string, unknown> = {}) => tracked.push({ event, data }), currentSurface: () => "campaign", setSurface: () => {} }));
const session = vi.hoisted(() => ({ me: null as null | { accountNumId: number }, profile: {}, ready: true, accessToken: async () => "synthetic" }));
vi.mock("../src/lib/session", () => ({ useSession: () => session }));
const ref$ = vi.hoisted(() => ({ code: "MINE2345" as string | null }));
vi.mock("../src/lib/share-ref", async (original) => ({ ...(await original<typeof import("../src/lib/share-ref")>()), currentReferralCode: async () => ref$.code }));

import CampaignPage from "../src/pages/CampaignPage.vue";

const campaign = (extra: Record<string, unknown> = {}) => ({
  slug: "launch", title: { "zh-Hant": "開站分享活動" }, phase: "open", startsAt: Date.UTC(2026, 9, 1), endsAt: Date.UTC(2026, 10, 1), timezone: "Asia/Tokyo",
  bannerUrl: null, intro: { "zh-Hant": "## 歡迎\n\n分享 <b>卡片</b>" }, submitDeadline: Date.UTC(2026, 10, 8), payoutDeadline: Date.UTC(2026, 10, 15),
  tiers: { light: 50, original: 120, guide: 300 }, extraPlacementAmount: 20, ...extra,
});
const content = (id: string, extra: Record<string, unknown> = {}) => ({
  id, campaignSlug: "launch", title: `內容 ${id}`, cardId: null, shareCode: `S${id.toUpperCase()}`, approvedTier: null, approvedAmount: 0, paidTotal: 0,
  payoutState: "none", placements: [], ...extra,
});

type Call = { method: string; path: string; body: Record<string, unknown> | null };
let calls: Call[];
let detail: Record<string, unknown> | null;
let detailStatus: number;
let contents: ReturnType<typeof content>[];
/** 送出申請的回應：依序取，用完回 200。 */
let submitReplies: { status: number; body: unknown }[];

beforeEach(() => {
  i18n.global.locale.value = "zh-Hant";
  tracked.length = 0;
  calls = []; detail = campaign(); detailStatus = 200; contents = []; submitReplies = [];
  session.me = { accountNumId: 7 };
  ref$.code = "MINE2345";
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    const body = typeof init.body === "string" ? JSON.parse(init.body) : null;
    calls.push({ method, path: url, body });
    const json = (status: number, b: unknown) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
    if (url === "/v1/campaigns/launch" && method === "GET") return detail ? json(detailStatus, detailStatus === 200 ? detail : { error: "boom" }) : json(404, { error: "campaign_not_found" });
    if (url.startsWith("/v1/me/campaign/contents")) return json(200, { items: contents });
    if (url === "/v1/campaigns/launch/placements") {
      const reply = submitReplies.shift();
      if (reply) return json(reply.status, reply.body);
      const made = content(`n${calls.length}`, { title: body.content?.title ?? "x" });
      contents = [...contents, made];
      return json(200, { placementId: "p1", content: made });
    }
    return json(404, { error: "nope" });
  }));
  Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn(async () => {}) }, configurable: true });
});
let app: App | null, host: HTMLElement;
afterEach(() => { app?.unmount(); app = null; host?.remove(); document.body.innerHTML = ""; vi.unstubAllGlobals(); });

const settle = async () => { for (let i = 0; i < 8; i++) { await nextTick(); await new Promise((r) => setTimeout(r, 0)); } };
async function mount(path = "/campaign/launch") {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/campaign/:slug", component: { render: () => null } }, { path: "/:p(.*)*", component: { render: () => null } }] });
  await router.push(path); await router.isReady();
  host = document.body.appendChild(document.createElement("div"));
  app = createApp(CampaignPage).use(router).use(i18n);
  app.mount(host);
  await settle();
  return host;
}
const t = (k: string, v: Record<string, unknown> = {}) => i18n.global.t(k, v);
const $ = <T extends Element = HTMLElement>(sel: string) => host.querySelector<T>(sel);
function type(sel: string, value: string) {
  const el = $<HTMLInputElement>(sel)!;
  el.value = value;
  el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
}
const check = (sel: string) => { $<HTMLInputElement>(sel)!.click(); };
async function submit() { $<HTMLFormElement>("form[data-apply]")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); await settle(); }
function fillNew() {
  type('[data-field="title"] input', "我的攻略");
  check('[data-field="requestedTier"] input[value="guide"]');
  type('[data-field="platform"] select', "tieba");
  type('[data-field="location"] input', "某某吧");
  type('[data-field="publishedAt"] input', "2026-10-20T09:30");
  type('[data-field="url"] input', "https://tieba.example/p/1");
}
const posts = () => calls.filter((c) => c.method === "POST" && c.path === "/v1/campaigns/launch/placements");

it("shows the form to a signed-in visitor while the campaign is open", async () => {
  await mount();
  expect($("h1")!.textContent).toContain("開站分享活動");
  expect($("[data-phase]")!.textContent).toBe(t("campaign.phase.open"));
  expect($("form[data-apply]")).not.toBeNull();
  // 介紹不吃 HTML
  expect($(".campaign__intro")!.innerHTML).not.toContain("<b>");
  expect($(".campaign__intro h2")!.textContent).toBe("歡迎");
});

it("lets a guest read the rules and sign in back to this page with ?s= kept", async () => {
  session.me = null;
  await mount("/campaign/launch?s=AB12");
  expect($("form[data-apply]")).toBeNull();
  expect(host.textContent).toContain(t("campaign.page.rules"));
  expect(host.textContent).toContain(t("campaign.page.signIn"));
  expect($("[data-signin]")!.getAttribute("href")).toBe(`/login?returnTo=${encodeURIComponent("/campaign/launch?s=AB12")}`);
  expect(calls.some((c) => c.path.startsWith("/v1/me/"))).toBe(false);
});

it("hides the form before the campaign starts and after it ends", async () => {
  detail = campaign({ phase: "upcoming" });
  await mount();
  expect($("form[data-apply]")).toBeNull();
  expect(host.textContent).toContain(t("campaign.page.notOpen.upcoming"));
  expect($("[data-mine]")).not.toBeNull();
  app!.unmount(); app = null; host.remove();
  detail = campaign({ phase: "ended" });
  await mount();
  expect($("form[data-apply]")).toBeNull();
  expect(host.textContent).toContain(t("campaign.page.notOpen.ended"));
});

it("reads every amount from the API and only offers tiers that have one", async () => {
  await mount();
  const rules = $("[data-rules]")!.textContent!;
  expect(rules).toContain("50");
  expect(rules).toContain("300");
  expect(rules).toContain(t("campaign.page.extra", { n: 20 }));
  expect(rules).toContain(t("campaign.page.highest"));
  expect(rules).not.toContain(t("campaign.tier.video"));
  expect($('[data-field="requestedTier"] input[value="video"]')).toBeNull();
  expect($('[data-field="requestedTier"]')!.textContent).toContain(t("campaign.page.points", { n: 300 }));
  app!.unmount(); app = null; host.remove();
  detail = campaign({ tiers: { light: 77 }, extraPlacementAmount: null });
  await mount();
  expect($("[data-rules]")!.textContent).toContain("77");
  expect($("[data-rules]")!.textContent).not.toContain(t("campaign.page.extra", { n: 20 }));
  expect(host.querySelectorAll('[data-field="requestedTier"] input').length).toBe(1);
});

it("submits a new share with publishedAt read in the campaign's time zone", async () => {
  await mount();
  expect($('[data-field="publishedAt"]')!.textContent).toContain("日本");
  fillNew();
  type('[data-field="cardId"] input', "12");
  type('[data-field="note"] textarea', "置頂了");
  await submit();
  expect(posts()).toHaveLength(1);
  const body = posts()[0]!.body!;
  expect(body).toMatchObject({
    content: { title: "我的攻略", cardId: 12 }, platform: "tieba", location: "某某吧", requestedTier: "guide",
    publishedAt: Date.UTC(2026, 9, 20, 0, 30), url: "https://tieba.example/p/1", note: "置頂了",
  });
  expect(body.contentId).toBeUndefined();
  expect(typeof body.operationId).toBe("string");
  // 成功：清空、說一聲、清單更新、記一次
  expect(host.textContent).toContain(t("campaign.apply.done"));
  expect($<HTMLInputElement>('[data-field="title"] input')!.value).toBe("");
  expect(host.querySelectorAll("[data-share-link]").length).toBe(1);
  expect(tracked.filter((e) => e.event === "campaign_apply")).toEqual([{ event: "campaign_apply", data: { subject: "launch" } }]);
});

it("adds to an existing content with contentId and no title fields", async () => {
  contents = [content("c1"), content("c2")];
  await mount();
  check('input[name="kind"][value="existing"]');
  await settle();
  expect($('[data-field="title"]')).toBeNull();
  expect($('[data-field="cardId"]')).toBeNull();
  type('[data-field="content"] select', "c2");
  check('[data-field="requestedTier"] input[value="light"]');
  type('[data-field="platform"] select', "qq_group");
  type('[data-field="location"] input', "同好群");
  type('[data-field="url"] input', "https://example.com/x");
  await submit();
  const body = posts()[0]!.body!;
  expect(body.contentId).toBe("c2");
  expect(body.content).toBeUndefined();
});

it("blocks a submit that has neither a link nor a screenshot, and a link that is not http(s)", async () => {
  await mount();
  fillNew();
  type('[data-field="url"] input', "");
  await submit();
  expect(posts()).toHaveLength(0);
  expect($('[data-field="evidence"] [role="alert"]')!.textContent).toBe(t("campaign.apply.needProof"));
  type('[data-field="url"] input', "javascript:alert(1)");
  await submit();
  expect(posts()).toHaveLength(0);
  expect($('[data-field="url"] [role="alert"]')!.textContent).toBe(t("campaign.apply.badUrl"));
});

it("puts a share_invalid field error next to that field", async () => {
  submitReplies = [{ status: 400, body: { error: "share_invalid", field: "url" } }];
  await mount();
  fillNew();
  await submit();
  const err = $('[data-field="url"] [role="alert"]')!;
  expect(err.textContent).toContain(t("campaign.share.field.url"));
  expect($('[data-field="url"] input')!.getAttribute("aria-invalid")).toBe("true");
  expect($("[data-form-error]")).toBeNull();
});

it("shows other errors for the whole form and reuses the operationId when pressed again", async () => {
  submitReplies = [{ status: 429, body: { error: "campaign_rate_limited" } }];
  await mount();
  fillNew();
  await submit();
  expect($("[data-form-error]")!.textContent).toBe(t("campaign.error.campaign_rate_limited"));
  await submit();
  expect(posts()).toHaveLength(2);
  expect(posts()[1]!.body!.operationId).toBe(posts()[0]!.body!.operationId);
  expect(host.textContent).toContain(t("campaign.apply.done"));
});

it("builds share links with the referral code and share code, and only s= without a referral code", async () => {
  contents = [content("c1")];
  await mount();
  const link = $("[data-share-link] [data-url]")!.textContent!.trim();
  const page = `${location.origin}/campaign/launch`;
  expect(link).toBe(`${page}?ref=MINE2345&s=SC1`);
  $<HTMLButtonElement>('[data-share-link] [data-action="copy"]')!.click();
  await settle();
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith(link);
  expect($('[data-share-link] [data-action="copy"]')!.textContent).toBe(t("campaign.share.copied"));
  expect(tracked.filter((e) => e.event === "campaign_share")).toEqual([{ event: "campaign_share", data: { subject: "launch" } }]);
  app!.unmount(); app = null; host.remove();
  ref$.code = null;
  await mount();
  expect($("[data-share-link] [data-url]")!.textContent!.trim()).toBe(`${page}?s=SC1`);
});

it("says what the share link list is for before the first share", async () => {
  await mount();
  expect($("[data-share-links]")!.textContent).toContain(t("campaign.share.empty"));
});

it("swallows a clipboard failure", async () => {
  contents = [content("c1")];
  Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn(async () => { throw new Error("denied"); }) }, configurable: true });
  await mount();
  $<HTMLButtonElement>('[data-share-link] [data-action="copy"]')!.click();
  await settle();
  expect($('[data-share-link] [data-action="copy"]')!.textContent).toBe(t("campaign.share.copy"));
});

it("records campaign_view once per load, with the slug as subject, and not on retry failures or refreshes", async () => {
  detailStatus = 500;
  await mount();
  expect(tracked.filter((e) => e.event === "campaign_view")).toHaveLength(0);
  detailStatus = 200;
  $<HTMLButtonElement>('[data-action="retry"]')!.click();
  await settle();
  fillNew();
  await submit();
  expect(tracked.filter((e) => e.event === "campaign_view")).toEqual([{ event: "campaign_view", data: { subject: "launch" } }]);
});

it("shows the 404 page for a missing campaign", async () => {
  detail = null;
  await mount();
  expect(host.textContent).toContain(t("notFound.title"));
});
