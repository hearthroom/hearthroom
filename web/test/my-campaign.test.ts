/**
 * 我的分享申請 /me/campaign：依活動分組；「已核准」與「已入帳」分兩欄；五種發放狀態的字；
 * 需要補件的位置可以補充資料，送出的本體只帶改過的欄位與新截圖，失敗重按沿用 operationId；
 * 補件截止後（畫面時間到了或伺服器回 campaign_submit_closed）不能重送；畫面上沒有點數池、餘額、審核人；
 * 活動讀不到時只顯示代號；沒有內容時連到進行中的活動；未登入導去登入。
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createApp, nextTick, type App } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { i18n } from "../src/lib/i18n";

vi.mock("../src/lib/track", () => ({ track: () => {}, currentSurface: () => "mine", setSurface: () => {} }));
const session = vi.hoisted(() => ({ me: null as null | { accountNumId: number }, profile: {}, ready: true, accessToken: async () => "synthetic", restore: async () => undefined }));
vi.mock("../src/lib/session", () => ({ useSession: () => session }));
vi.mock("../src/lib/share-ref", async (original) => ({ ...(await original<typeof import("../src/lib/share-ref")>()), currentReferralCode: async () => null }));

import MyCampaignPage from "../src/pages/MyCampaignPage.vue";

const DAY = 86_400_000;
const detail = (slug: string, extra: Record<string, unknown> = {}) => ({
  slug, title: { "zh-Hant": `活動 ${slug}` }, phase: "open", startsAt: Date.now() - 10 * DAY, endsAt: Date.now() + 10 * DAY, timezone: "Asia/Tokyo",
  bannerUrl: null, intro: {}, submitDeadline: Date.now() + 20 * DAY, payoutDeadline: Date.now() + 30 * DAY,
  tiers: { light: 50, original: 3000, guide: 300 }, extraPlacementAmount: null, ...extra,
});
const placement = (id: string, extra: Record<string, unknown> = {}) => ({
  id, platform: "tieba", location: "某某吧", url: "https://tieba.example/p/1", publishedAt: Date.UTC(2026, 9, 3, 3, 0), requestedTier: "original",
  approvedTier: null, reviewStatus: "submitted", reviewReason: null, evidence: [], createdAt: Date.UTC(2026, 9, 3, 4, 0), ...extra,
});
const content = (id: string, extra: Record<string, unknown> = {}) => ({
  id, campaignSlug: "launch", title: `內容 ${id}`, cardId: null, shareCode: `S${id.toUpperCase()}`, approvedTier: null, approvedAmount: 0, paidTotal: 0,
  payoutState: "none", placements: [placement(`p-${id}`)], ...extra,
});

type Call = { method: string; path: string; body: Record<string, unknown> | null };
let calls: Call[];
let details: Record<string, ReturnType<typeof detail>>;
let list: ReturnType<typeof detail>[];
let contents: ReturnType<typeof content>[];
let putReplies: { status: number; body: unknown }[];
let evSeq: number;
/** 這些活動下一次讀詳情回 500 */
let failOnce: Set<string>;
const origCreate = URL.createObjectURL, origRevoke = URL.revokeObjectURL;

beforeEach(() => {
  i18n.global.locale.value = "zh-Hant";
  calls = []; details = { launch: detail("launch") }; list = []; contents = []; putReplies = []; evSeq = 0; failOnce = new Set();
  session.me = { accountNumId: 7 };
  URL.createObjectURL = vi.fn(() => "blob:mock") as typeof URL.createObjectURL;
  URL.revokeObjectURL = vi.fn();
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    const body = typeof init.body === "string" ? JSON.parse(init.body) : null;
    calls.push({ method, path: url, body });
    const json = (status: number, b: unknown) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
    if (url === "/v1/me/campaign/contents") return json(200, { items: contents });
    if (url === "/v1/campaigns" && method === "GET") return json(200, { items: list });
    const slug = /^\/v1\/campaigns\/([^/]+)$/.exec(url)?.[1];
    if (slug && method === "GET" && failOnce.delete(slug)) return json(500, { error: "boom" });
    if (slug && method === "GET") return details[slug] ? json(200, details[slug]) : json(404, { error: "campaign_not_found" });
    if (url === "/v1/campaign/evidence" && method === "POST") return json(200, { id: `ev-new-${++evSeq}`, sha256: "x", bytes: 1 });
    if (url.startsWith("/v1/campaign/evidence/")) return new Response(new Blob(["img"]), { status: 200 });
    if (url.startsWith("/v1/campaign/placements/") && method === "PUT") {
      const reply = putReplies.shift();
      if (reply) return json(reply.status, reply.body);
      contents = contents.map((c) => ({ ...c, placements: c.placements.map((p) => (url.endsWith(p.id) ? { ...p, reviewStatus: "resubmitted", reviewReason: null } : p)) }));
      return json(200, { placementId: url.split("/").pop(), content: contents[0] });
    }
    return json(404, { error: "nope" });
  }));
  Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn(async () => {}) }, configurable: true });
});
let app: App | null, host: HTMLElement;
afterEach(() => {
  app?.unmount(); app = null; host?.remove(); document.body.innerHTML = "";
  URL.createObjectURL = origCreate; URL.revokeObjectURL = origRevoke;
  vi.unstubAllGlobals();
});

const settle = async () => { for (let i = 0; i < 10; i++) { await nextTick(); await new Promise((r) => setTimeout(r, 0)); } };
async function mount() {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/me/campaign", component: { render: () => null } }, { path: "/:p(.*)*", component: { render: () => null } }] });
  await router.push("/me/campaign"); await router.isReady();
  host = document.body.appendChild(document.createElement("div"));
  app = createApp(MyCampaignPage).use(router).use(i18n);
  app.mount(host);
  await settle();
  return host;
}
const t = (k: string, v: Record<string, unknown> = {}) => i18n.global.t(k, v);
const $ = <T extends Element = HTMLElement>(sel: string) => host.querySelector<T>(sel);
const text = (sel: string) => $(sel)?.textContent ?? "";
function type(sel: string, value: string) {
  const el = $<HTMLInputElement>(sel)!;
  el.value = value;
  el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
}
async function click(sel: string) { $<HTMLElement>(sel)!.click(); await settle(); }
async function send() { $<HTMLFormElement>("form[data-resubmit]")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); await settle(); }
async function pick(files: File[]) {
  const input = $<HTMLInputElement>("form[data-resubmit] input[type=file]")!;
  Object.defineProperty(input, "files", { value: files, configurable: true });
  input.dispatchEvent(new Event("change", { bubbles: true }));
  await settle();
}
const puts = () => calls.filter((c) => c.method === "PUT");
const needsInfo = (extra: Record<string, unknown> = {}) =>
  content("c1", { placements: [placement("p1", { reviewStatus: "needs_info", reviewReason: "截圖看不清楚", evidence: [{ id: "ev-old" }], ...extra })] });

it("shows approved and paid out in two separate columns", async () => {
  contents = [content("c1", { approvedTier: "original", approvedAmount: 3000, paidTotal: 0, payoutState: "awaiting" })];
  await mount();
  const approved = text('[data-share-content="c1"] [data-col="approved"]');
  const paid = text('[data-share-content="c1"] [data-col="paid"]');
  expect(approved).toContain(t("campaign.mine.approved"));
  expect(approved).toContain(t("campaign.tier.original"));
  expect(approved).toContain("3,000");
  expect(paid).toContain(t("campaign.mine.paid"));
  expect(paid).toContain(t("campaign.page.points", { n: 0 }));
  expect(paid).toContain("等待發放");
  expect(paid).not.toContain("3,000");
});

it("says 審核中 before anything is approved and has a line for every payout state", async () => {
  const states = ["none", "awaiting", "processing", "queued", "paid"] as const;
  contents = states.map((s, i) => content(`c${i}`, { payoutState: s }));
  await mount();
  expect(text('[data-share-content="c0"] [data-col="approved"]')).toContain("審核中");
  const expected = { none: "—", awaiting: "等待發放", processing: "處理中", queued: "發放排隊中", paid: "已入帳" };
  states.forEach((s, i) => expect(text(`[data-share-content="c${i}"] [data-col="paid"] [data-payout]`)).toBe(expected[s]));
});

it("shows — instead of 審核中 once every place was not approved", async () => {
  contents = [content("c1", { placements: [placement("p1", { reviewStatus: "rejected", reviewReason: "x" }), placement("p2", { reviewStatus: "rejected", reviewReason: "y" })] })];
  await mount();
  const approved = text('[data-share-content="c1"] [data-col="approved"]');
  expect(approved).toContain("—");
  expect(approved).not.toContain("審核中");
});

it("reads a campaign again after a failure but keeps a missing one cached, and leaves the time alone without its time zone", async () => {
  failOnce = new Set(["launch"]);
  contents = [needsInfo(), content("c9", { campaignSlug: "gone" })];
  await mount();
  expect($('[data-campaign-group="launch"] h2')!.textContent).toContain("launch");
  expect($('[data-campaign-group="launch"]')!.textContent).not.toContain(t("campaign.field.submitDeadline"));
  await click('[data-placement="p1"] [data-action="resubmit"]');
  // 不知道活動時區就不讓改發布時間，其他欄位照常
  expect($<HTMLInputElement>('[data-field="publishedAt"] input')!.disabled).toBe(true);
  expect($<HTMLInputElement>('[data-field="location"] input')!.disabled).toBe(false);
  type('[data-field="location"] input', "新的吧");
  await send();
  expect(Object.keys(puts()[0]!.body!).sort()).toEqual(["location", "operationId"]);
  // 成功後重新讀：失敗的那個再讀一次，404 的不再讀
  expect(calls.filter((c) => c.path === "/v1/campaigns/launch")).toHaveLength(2);
  expect(calls.filter((c) => c.path === "/v1/campaigns/gone")).toHaveLength(1);
  expect($('[data-campaign-group="launch"] h2')!.textContent).toContain("活動 launch");
});

it("groups contents by campaign and reads each campaign once", async () => {
  details.second = detail("second");
  contents = [content("c1"), content("c2", { campaignSlug: "second" }), content("c3")];
  await mount();
  const groups = [...host.querySelectorAll("[data-campaign-group]")].map((g) => g.getAttribute("data-campaign-group"));
  expect(groups).toEqual(["launch", "second"]);
  expect($('[data-campaign-group="launch"] h2')!.textContent).toContain("活動 launch");
  expect($('[data-campaign-group="launch"]')!.querySelectorAll("[data-share-content]").length).toBe(2);
  expect(calls.filter((c) => c.path === "/v1/campaigns/launch")).toHaveLength(1);
  expect(calls.filter((c) => c.path === "/v1/campaigns/second")).toHaveLength(1);
  // 每份內容有自己的分享連結
  expect($('[data-share-content="c2"] [data-share-link] [data-url]')!.textContent).toContain("/campaign/second?s=SC2");
});

it("lists each place with its status, and the reason only when it needs more info or was not approved", async () => {
  contents = [content("c1", { placements: [
    placement("p1", { reviewStatus: "needs_info", reviewReason: "截圖看不清楚" }),
    placement("p2", { reviewStatus: "rejected", reviewReason: "找不到這則貼文" }),
    placement("p3", { reviewStatus: "approved", approvedTier: "original", reviewReason: "不該出現" }),
  ] })];
  await mount();
  const p1 = $('[data-placement="p1"]')!;
  expect(p1.textContent).toContain(t("campaign.platform.tieba"));
  expect(p1.textContent).toContain("某某吧");
  expect(p1.querySelector("[data-status]")!.textContent).toBe("需要補件");
  expect(p1.querySelector("[data-reason]")!.textContent).toContain("截圖看不清楚");
  expect($('[data-placement="p2"] [data-status]')!.textContent).toBe("未通過");
  expect($('[data-placement="p2"] [data-reason]')!.textContent).toContain("找不到這則貼文");
  expect($('[data-placement="p3"] [data-status]')!.textContent).toBe("已通過");
  expect($('[data-placement="p3"] [data-reason]')).toBeNull();
  expect(host.textContent).not.toContain("不該出現");
  // 發布時間用活動時區：2026-10-03 03:00 UTC = 東京 12:00
  expect(p1.textContent).toContain("12:00");
  // 只有需要補件的有「補充資料」
  expect($('[data-placement="p1"] [data-action="resubmit"]')!.textContent).toBe("補充資料");
  expect($('[data-placement="p2"] [data-action="resubmit"]')).toBeNull();
});

it("prefills the resubmit form and sends only what changed", async () => {
  contents = [needsInfo()];
  await mount();
  await click('[data-placement="p1"] [data-action="resubmit"]');
  const form = $("form[data-resubmit]")!;
  expect($<HTMLInputElement>('[data-field="location"] input')!.value).toBe("某某吧");
  expect($<HTMLInputElement>('[data-field="publishedAt"] input')!.value).toBe("2026-10-03T12:00");
  expect($<HTMLInputElement>('[data-field="url"] input')!.value).toBe("https://tieba.example/p/1");
  expect($<HTMLInputElement>('[data-field="requestedTier"] input[value="original"]')!.checked).toBe(true);
  // 平台不能改
  expect(form.querySelector('[data-field="platform"] select, [data-field="platform"] input')).toBeNull();
  expect(text('[data-field="platform"]')).toContain(t("campaign.platform.tieba"));
  // 已經掛著的截圖畫出來
  expect(form.querySelector('[data-evidence="ev-old"]')).not.toBeNull();
  type('[data-field="publishedAt"] input', "2026-10-20T09:30");
  await send();
  expect(puts()).toHaveLength(1);
  expect(puts()[0]!.path).toBe("/v1/campaign/placements/p1");
  const body = puts()[0]!.body!;
  expect(Object.keys(body).sort()).toEqual(["operationId", "publishedAt"]);
  expect(body.publishedAt).toBe(Date.UTC(2026, 9, 20, 0, 30));
  // 成功：重新讀清單、收起表單
  expect(calls.filter((c) => c.path === "/v1/me/campaign/contents")).toHaveLength(2);
  expect($("form[data-resubmit]")).toBeNull();
  expect($('[data-placement="p1"] [data-status]')!.textContent).toBe("已重送");
});

it("clears the link with url: null and sends new screenshots", async () => {
  contents = [needsInfo()];
  await mount();
  await click('[data-placement="p1"] [data-action="resubmit"]');
  type('[data-field="location"] input', "新的吧");
  type('[data-field="url"] input', "");
  await pick([new File(["x"], "a.png", { type: "image/png" })]);
  await send();
  expect(puts()[0]!.body).toEqual({ operationId: expect.any(String), location: "新的吧", url: null, evidenceIds: ["ev-new-1"] });
});

it("reuses the operationId when a failed resubmit is pressed again", async () => {
  contents = [needsInfo()];
  putReplies = [{ status: 429, body: { error: "campaign_rate_limited" } }];
  await mount();
  await click('[data-placement="p1"] [data-action="resubmit"]');
  type('[data-field="location"] input', "新的吧");
  await send();
  expect(text("[data-form-error]")).toBe(t("campaign.error.campaign_rate_limited"));
  expect($("form[data-resubmit]")).not.toBeNull();
  await send();
  expect(puts()).toHaveLength(2);
  expect(puts()[1]!.body!.operationId).toBe(puts()[0]!.body!.operationId);
  expect($("form[data-resubmit]")).toBeNull();
});

it("cannot resubmit once the time to add details has passed", async () => {
  details.launch = detail("launch", { submitDeadline: Date.now() - 1000 });
  contents = [needsInfo()];
  await mount();
  expect($('[data-placement="p1"] [data-action="resubmit"]')).toBeNull();
  expect(text('[data-placement="p1"] [data-closed]')).toBe("補件時間已過");
});

it("shows the same line and closes the form when the server says the time has passed", async () => {
  contents = [needsInfo()];
  putReplies = [{ status: 409, body: { error: "campaign_submit_closed" } }];
  await mount();
  await click('[data-placement="p1"] [data-action="resubmit"]');
  type('[data-field="location"] input', "新的吧");
  await send();
  expect($("form[data-resubmit]")).toBeNull();
  expect($('[data-placement="p1"] [data-action="resubmit"]')).toBeNull();
  expect(text('[data-placement="p1"] [data-closed]')).toBe("補件時間已過");
});

it("shows only the slug for a campaign that cannot be read, with no deadline", async () => {
  contents = [content("c9", { campaignSlug: "gone", placements: [placement("p1", { reviewStatus: "needs_info", reviewReason: "截圖看不清楚" })] })];
  await mount();
  const group = $('[data-campaign-group="gone"]')!;
  expect(group.querySelector("h2")!.textContent).toContain("gone");
  expect(group.textContent).not.toContain(t("campaign.field.submitDeadline"));
  expect(group.querySelector("[data-closed]")).toBeNull();
  // 截止時間不知道就讓他補，伺服器會把關
  expect(group.querySelector('[data-action="resubmit"]')).not.toBeNull();
});

it("never shows the pool, a balance or who reviewed it", async () => {
  contents = [content("c1", { approvedTier: "original", approvedAmount: 3000, paidTotal: 3000, payoutState: "paid" }), { ...needsInfo(), id: "c2" }];
  await mount();
  const all = host.textContent!;
  for (const word of ["點數池", "餘額", "審核人", "審核員", t("campaign.pool.balance"), t("campaign.pool.title")]) expect(all).not.toContain(word);
});

it("links to the first open campaign when there is nothing yet, and shows only the line when none is open", async () => {
  list = [detail("old", { phase: "ended" }), detail("launch"), detail("later")];
  await mount();
  expect(host.textContent).toContain("還沒有提交過分享");
  const link = $<HTMLAnchorElement>("[data-join]")!;
  expect(link.getAttribute("href")).toBe("/campaign/launch");
  expect(link.textContent).toContain("活動 launch");
  app!.unmount(); app = null; host.remove();
  list = [detail("old", { phase: "ended" })];
  await mount();
  expect(host.textContent).toContain("還沒有提交過分享");
  expect($("[data-join]")).toBeNull();
});

it("sends a signed-out visitor to sign in and back", async () => {
  session.me = null;
  const { router } = await import("../src/router");
  await router.push("/"); await router.isReady();
  await router.push("/me/campaign");
  expect(router.currentRoute.value.path).toBe("/login");
  expect(router.currentRoute.value.query.returnTo).toBe("/me/campaign");
});
