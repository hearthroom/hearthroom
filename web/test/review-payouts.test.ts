/**
 * 發放分頁 /review/payouts：只有應用管理員（canEdit）看得到分頁，直接打網址的其他人看到一句說明；
 * 打開時在背景對帳一次，完成後重新載入兩個列表，有補記入帳才說；批次發放的確認對話框列出筆數與總點數、
 * 本體的 contentIds 正確、每筆結果顯示在那一列；重試與取消失敗重按沿用 operationId；發放錯誤都有下一步；
 * 處理中且還沒查無時沒有取消。
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createApp, h, nextTick, type App } from "vue";
import { createPinia } from "pinia";
import { createMemoryHistory, createRouter, RouterView, type Router } from "vue-router";
import { i18n, loadLocale } from "../src/lib/i18n";
import { confirmState, settleConfirm } from "../src/lib/confirm";
import { campaignErrorText } from "../src/lib/campaign";

vi.mock("../src/lib/session", () => ({ useSession: () => ({ me: { accountNumId: 7 }, profile: {}, ready: true, accessToken: async () => "synthetic" }) }));
vi.mock("../src/lib/api", async (original) => ({
  ...(await original<object>()),
  fetchReviewMe: async () => reviewMe,
}));
let reviewMe: Record<string, unknown>;
import { router as siteRouter } from "../src/router";

const MIN = 60_000, DAY = 86_400_000;
const campaign = () => ({
  id: "c1", slug: "launch", title: { "zh-Hant": "開業活動" }, intro: {}, bannerKey: null, bannerUrl: null, startsAt: Date.now() - 10 * DAY, endsAt: Date.now() + 10 * DAY,
  timezone: "Asia/Taipei", submitDeadline: Date.now() + 20 * DAY, payoutDeadline: Date.now() + 30 * DAY, tiers: { light: 50, original: 300, guide: 800 },
  extraPlacementAmount: 20, flagBurstThreshold: 5, evidenceRetentionDays: 30, status: "active", version: 1, createdAt: 1, updatedAt: 1,
});
const payable = (id: string, due = 300) => ({ contentId: id, contentTitle: `攻略 ${id}`, campaignSlug: "launch", applicant: { handle: `h${id}` }, target: due + 50, paidTotal: 50, due });
const payout = (id: string, extra: Record<string, unknown> = {}) => ({
  id, contentId: `c-${id}`, amount: 300, targetTotal: 300, status: "pending", error: null, attempts: 1, providerEntryId: null, checkedAbsentAt: null,
  createdAt: Date.now() - 20 * MIN, updatedAt: Date.now() - 20 * MIN, settledAt: null, contentTitle: `攻略 ${id}`, campaignSlug: "launch", applicant: { handle: "rainy" }, ...extra,
});

type Call = { method: string; path: string; body: Record<string, unknown> | null };
type Reply = { status: number; body: unknown } | { network: true };
let calls: Call[];
let canEdit: boolean;
let payableItems: ReturnType<typeof payable>[];
let history: ReturnType<typeof payout>[];
let reconcile: Reply;
let reconcileGate: Promise<void> | null;
let replies: Record<string, Reply[]>;
/** 設了就讓下一次單筆發放等到它放行 */
let payGate: Promise<void> | null;
/** 創作季待發放（CreatorRewardsPanel） */
let creatorDue: { cardId: number; cardName: string; campaignSlug: string; author: { handle: string }; registeredAt: number; amount: number }[];

beforeEach(() => {
  i18n.global.locale.value = "zh-Hant";
  reviewMe = { reviewer: true, pending: 0, reviews: 0, cases: 0, comments: 0, role: "reviewer" };
  calls = []; canEdit = true; payableItems = [payable("s1", 300), payable("s2", 800), payable("s3", 100)]; history = [];
  reconcile = { status: 200, body: { items: [] } }; reconcileGate = null; replies = {}; payGate = null; creatorDue = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    const body = typeof init.body === "string" ? JSON.parse(init.body) : null;
    calls.push({ method, path: url, body });
    const json = (status: number, b: unknown) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
    const next = (key: string) => {
      const r = replies[key]?.shift() ?? { status: 500, body: { error: "boom" } };
      if ("network" in r) throw new TypeError("Failed to fetch");
      return json(r.status, r.body);
    };
    if (url === "/v1/moderation/campaigns") return json(200, { items: [campaign()], canEdit });
    if (url.startsWith("/v1/moderation/card-rewards/due")) return json(200, { total: creatorDue.length, items: creatorDue });
    if (url.startsWith("/v1/moderation/card-rewards/list")) return json(200, { total: 0, items: [] });
    if (url === "/v1/moderation/card-rewards/batch") return next("creatorBatch");
    if (url === "/v1/moderation/campaign-pool") return json(200, { configured: true, enabled: true, usageScope: "all", validityDays: null, maxPayout: 1000, balance: 54321, paidTotal: 0, updatedAt: null });
    if (url.startsWith("/v1/moderation/campaign/payable")) return json(200, { total: payableItems.length, items: payableItems });
    if (url === "/v1/moderation/campaign/payouts/reconcile") { if (reconcileGate) await reconcileGate; return json(reconcile.status, reconcile.body); }
    if (url === "/v1/moderation/campaign/payouts/batch") return next("batch");
    if (url.startsWith("/v1/moderation/campaign/payouts?") || url === "/v1/moderation/campaign/payouts") return json(200, { total: history.length, items: history });
    const m = /^\/v1\/moderation\/campaign\/payouts\/[^/]+\/(retry|cancel|check)$/.exec(url);
    if (m) return next(m[1]!);
    if (/^\/v1\/moderation\/campaign\/contents\/[^/]+\/payout$/.test(url)) { if (payGate) await payGate; return next("pay"); }
    return json(404, { error: "not_found" });
  }));
});
afterEach(() => { settleConfirm(false); app?.unmount(); document.body.innerHTML = ""; vi.unstubAllGlobals(); });

let app: App, host: HTMLElement, router: Router;
async function mount(path: string) {
  host = document.body.appendChild(document.createElement("div"));
  router = createRouter({ history: createMemoryHistory(), routes: siteRouter.options.routes });
  await router.push(path);
  app = createApp({ render: () => h(RouterView) }).use(createPinia()).use(router).use(i18n);
  app.mount(host);
}
const t = (k: string, p?: Record<string, unknown>) => i18n.global.t(k, p ?? {});
const paths = (prefix: string, method = "GET") => calls.filter((c) => c.method === method && c.path.startsWith(prefix));
const row = (sel: string) => host.querySelector<HTMLElement>(sel);
async function button(sel: string) {
  await vi.waitFor(() => expect(host.querySelector(sel)).not.toBeNull());
  return host.querySelector<HTMLButtonElement>(sel)!;
}
function type(el: HTMLTextAreaElement, value: string) { el.value = value; el.dispatchEvent(new Event("input")); }
const dialog = () => document.querySelector<HTMLFormElement>("[role=dialog]");
const checkbox = (id: string) => row(`[data-content="${id}"] input[type=checkbox]`) as HTMLInputElement;
function tick(id: string) { const box = checkbox(id); box.checked = true; box.dispatchEvent(new Event("change")); }
async function confirmYes() { await vi.waitFor(() => expect(confirmState.current).not.toBeNull()); settleConfirm(true); }

it("hides the payout tab from reviewers who cannot pay, AI accounts included, and says so on a direct visit", async () => {
  canEdit = false;
  await mount("/review/payouts");
  await vi.waitFor(() => expect(host.textContent).toContain("只有應用管理員能發放"));
  expect(host.querySelector('.management-nav a[href="/review/payouts"]')).toBeNull();
  expect(host.querySelector('.management-nav a[href="/review/campaign"]')).not.toBeNull();
  expect(paths("/v1/moderation/campaign/payable")).toHaveLength(0);
  expect(paths("/v1/moderation/campaign/payouts", "POST")).toHaveLength(0);
});

it("an app admin who is not a reviewer sees only the blog tab: campaign and payout routes need a reviewer on the server", async () => {
  reviewMe = { reviewer: false, blogWriter: true };
  await mount("/review/blog");
  await vi.waitFor(() => expect(host.querySelector('.management-nav a[href="/review/blog"]')).not.toBeNull());
  await vi.waitFor(() => expect(paths("/v1/moderation/campaigns").length).toBeGreaterThan(0));
  await nextTick();
  expect([...host.querySelectorAll('.management-nav a')].map((a) => a.getAttribute("href"))).toEqual(["/review/blog"]);
});

it("shows the payout tab to an app admin, with the platform summary at the top", async () => {
  await mount("/review/payouts");
  await vi.waitFor(() => expect(host.querySelector('.management-nav a[href="/review/payouts"]')).not.toBeNull());
  const tab = host.querySelector('.management-nav a[href="/review/payouts"]')!;
  expect(tab.textContent).toContain(t("moderation.tab.payouts"));
  expect(tab.getAttribute("aria-current")).toBe("page");
  await vi.waitFor(() => expect(row("[data-pool]")?.textContent).toContain((54321).toLocaleString("zh-Hant")));
  expect(row("[data-pool]")!.textContent).toContain(t("campaign.pool.on"));
  expect(row("[data-pool]")!.textContent).toContain((1000).toLocaleString("zh-Hant"));
});

it("reconciles once in the background on open, then reloads both lists and reports what it recorded", async () => {
  let release!: () => void;
  reconcileGate = new Promise((r) => { release = r; });
  reconcile = { status: 200, body: { items: [{ result: "paid", payout: payout("x1", { status: "paid" }) }, { result: "absent", payout: payout("x2") }, { result: "paid", payout: payout("x3", { status: "paid" }) }] } };
  await mount("/review/payouts");
  // 對帳還沒回來，畫面已經能用
  await vi.waitFor(() => expect(row('[data-content="s1"]')).not.toBeNull());
  expect(paths("/v1/moderation/campaign/payouts/reconcile", "POST")).toHaveLength(1);
  expect(paths("/v1/moderation/campaign/payable")).toHaveLength(1);
  expect(paths("/v1/moderation/campaign/payouts?")).toHaveLength(1);
  release();
  await vi.waitFor(() => expect(host.querySelector("[role=status]")?.textContent).toContain("已補記 2 筆入帳"));
  expect(paths("/v1/moderation/campaign/payable")).toHaveLength(2);
  expect(paths("/v1/moderation/campaign/payouts?")).toHaveLength(2);
  expect(paths("/v1/moderation/campaign/payouts/reconcile", "POST")).toHaveLength(1);
});

it("stays quiet when reconcile finds nothing or fails", async () => {
  reconcile = { status: 500, body: { error: "boom" } };
  await mount("/review/payouts");
  await vi.waitFor(() => expect(paths("/v1/moderation/campaign/payouts/reconcile", "POST")).toHaveLength(1));
  await vi.waitFor(() => expect(row('[data-content="s1"]')).not.toBeNull());
  await new Promise((r) => setTimeout(r, 20));
  expect(host.querySelector("[role=alert]")).toBeNull();
  expect(host.textContent).not.toContain("已補記");
});

it("confirms a batch with the count and total points, sends exactly the selected ids, and shows each result on its row", async () => {
  replies.batch = [{ status: 200, body: { items: [
    { contentId: "s1", payout: payout("y1", { contentId: "s1", status: "paid" }) },
    { contentId: "s2", payout: payout("y2", { contentId: "s2", status: "blocked_insufficient", error: "pool_insufficient" }) },
    { contentId: "s3", error: "share_self_payout" },
  ] } }];
  payableItems = [payable("s3", 100), payable("s1", 300), payable("s2", 800)];
  await mount("/review/payouts");
  await vi.waitFor(() => expect(row('[data-content="s3"]')).not.toBeNull());
  for (const id of ["s1", "s2", "s3"]) { const box = row(`[data-content="${id}"] input[type=checkbox]`) as HTMLInputElement; box.checked = true; box.dispatchEvent(new Event("change")); }
  await nextTick();
  (await button('[data-action="pay-selected"]')).click();
  await vi.waitFor(() => expect(confirmState.current).not.toBeNull());
  expect(confirmState.current!.message).toBe(t("campaign.payouts.confirm", { count: 3, points: (1200).toLocaleString("zh-Hant") }));
  // 發放前列表的狀態：s1、s2 會離開待發放，s3 被拒還在
  payableItems = [payable("s3", 100)];
  settleConfirm(true);
  await vi.waitFor(() => expect(paths("/v1/moderation/campaign/payouts/batch", "POST")).toHaveLength(1));
  expect(paths("/v1/moderation/campaign/payouts/batch", "POST")[0]!.body).toEqual({ contentIds: ["s1", "s2", "s3"], operationId: expect.stringMatching(/^[0-9a-f-]{36}$/) });
  await vi.waitFor(() => expect(row('[data-content="s3"]')?.textContent).toContain("不能發放給自己"));
  expect(row('[data-content="s3"]')!.textContent).toContain("其他管理員");
  expect(row('[data-content="s1"]')?.textContent).toContain(t("campaign.status.paid"));
  expect(row('[data-content="s2"]')?.textContent).toContain(t("campaign.status.blocked_insufficient"));
  expect(paths("/v1/moderation/campaign/payable").length).toBeGreaterThanOrEqual(2);
  // 已經離開待發放的列：指向發放紀錄，不能再勾也不能再發
  expect(row('[data-content="s1"]')!.textContent).toContain(t("campaign.payouts.seeHistory"));
  expect(checkbox("s1").disabled).toBe(true);
  expect((row('[data-content="s1"] [data-action="pay"]') as HTMLButtonElement).disabled).toBe(true);
  expect(row('[data-content="s3"]')!.textContent).not.toContain(t("campaign.payouts.seeHistory"));
});

it("drops the old amounts from a row that left To pay after a definite payout, in single and batch pay", async () => {
  replies.pay = [{ status: 200, body: payout("y1", { contentId: "s1", status: "paid" }) }];
  replies.batch = [{ status: 200, body: { items: [{ contentId: "s2", payout: payout("y2", { contentId: "s2", status: "paid" }) }] } }];
  await mount("/review/payouts");
  await vi.waitFor(() => expect(row('[data-content="s1"] dl')?.textContent).toContain((350).toLocaleString("zh-Hant")));
  (await button('[data-content="s1"] [data-action="pay"]')).click();
  payableItems = [payable("s2", 800), payable("s3", 100)];
  await confirmYes();
  await vi.waitFor(() => expect(row('[data-content="s1"]')?.textContent).toContain(t("campaign.payouts.seeHistory")));
  expect(row('[data-content="s1"]')!.textContent).toContain(t("campaign.status.paid"));
  expect(row('[data-content="s1"] dl')).toBeNull();
  expect(row('[data-content="s3"] dl')).not.toBeNull();
  tick("s2");
  await nextTick();
  (await button('[data-action="pay-selected"]')).click();
  payableItems = [payable("s3", 100)];
  await confirmYes();
  await vi.waitFor(() => expect(row('[data-content="s2"]')?.textContent).toContain(t("campaign.payouts.seeHistory")));
  expect(row('[data-content="s2"] dl')).toBeNull();
});

it("shows a batch item that failed with internal_error as uncertain, not as a definite failure", async () => {
  replies.batch = [{ status: 200, body: { items: [
    { contentId: "s1", error: "internal_error" },
    { contentId: "s2", error: "share_self_payout" },
  ] } }];
  await mount("/review/payouts");
  await vi.waitFor(() => expect(row('[data-content="s2"]')).not.toBeNull());
  tick("s1"); tick("s2");
  await nextTick();
  (await button('[data-action="pay-selected"]')).click();
  await confirmYes();
  await vi.waitFor(() => expect(row('[data-content="s2"]')?.textContent).toContain("不能發放給自己"));
  expect(row('[data-content="s1"]')!.textContent).toContain(t("campaign.payouts.uncertain"));
  expect(row('[data-content="s1"] .rpo-result--bad')).toBeNull();
  expect(row('[data-content="s2"] .rpo-result--bad')).not.toBeNull();
});

it("treats a pay with an unknown outcome as possibly sent: neutral text, same operation id, never batched", async () => {
  replies.pay = [{ network: true }, { status: 200, body: payout("y1", { contentId: "s1", status: "pending", error: "provider_timeout" }) }];
  await mount("/review/payouts");
  (await button('[data-content="s1"] [data-action="pay"]')).click();
  // 其實已經送到了：重新載入時 s1 不在待發放裡
  payableItems = [payable("s2", 800), payable("s3", 100)];
  await confirmYes();
  await vi.waitFor(() => expect(row('[data-content="s1"]')?.textContent).toContain(t("campaign.payouts.uncertain")));
  expect(row('[data-content="s1"] .rpo-result--bad')).toBeNull();
  expect(row('[data-content="s1"]')!.textContent).not.toContain("Failed to fetch");
  expect(row('[data-content="s1"]')!.textContent).toContain(t("campaign.payouts.seeHistory"));
  expect(checkbox("s1").disabled).toBe(true);
  // 單筆重按沿用同一個 operationId，服務端認得出是同一次
  const again = row('[data-content="s1"] [data-action="pay"]') as HTMLButtonElement;
  expect(again.disabled).toBe(false);
  again.click();
  await confirmYes();
  await vi.waitFor(() => expect(paths("/v1/moderation/campaign/contents/s1/payout", "POST")).toHaveLength(2));
  const [a, b] = paths("/v1/moderation/campaign/contents/s1/payout", "POST").map((c) => c.body!.operationId);
  expect(b).toBe(a);
  // 回來是處理中：指向查詢結果，不是紅字的碼
  await vi.waitFor(() => expect(row('[data-content="s1"]')?.textContent).toContain(t("campaign.payouts.pendingNote")));
  expect(row('[data-content="s1"] .rpo-result--bad')).toBeNull();
});

it("keeps a row whose single pay failed uncertainly out of any batch, even while it is still listed", async () => {
  replies.pay = [{ network: true }];
  await mount("/review/payouts");
  (await button('[data-content="s1"] [data-action="pay"]')).click();
  await confirmYes();
  await vi.waitFor(() => expect(row('[data-content="s1"]')?.textContent).toContain(t("campaign.payouts.uncertain")));
  await vi.waitFor(() => expect(paths("/v1/moderation/campaign/payable").length).toBeGreaterThanOrEqual(3));
  expect(checkbox("s1").disabled).toBe(true);
  expect(row('[data-content="s1"]')!.textContent).not.toContain(t("campaign.payouts.seeHistory"));
});

it("retries a batch whose outcome is unknown with the same operation id", async () => {
  replies.batch = [{ network: true }, { status: 200, body: { items: [{ contentId: "s1", payout: payout("y1", { contentId: "s1", status: "paid" }) }, { contentId: "s2", payout: payout("y2", { contentId: "s2", status: "paid" }) }] } }];
  await mount("/review/payouts");
  await vi.waitFor(() => expect(row('[data-content="s2"]')).not.toBeNull());
  tick("s1"); tick("s2"); await nextTick();
  (await button('[data-action="pay-selected"]')).click();
  await confirmYes();
  await vi.waitFor(() => expect(host.querySelector("[data-batch-note]")?.textContent).toContain(t("campaign.payouts.uncertain")));
  expect(host.querySelector("[data-batch-note]")!.classList.contains("notice--error")).toBe(false);
  await vi.waitFor(() => expect((row('[data-action="pay-selected"]') as HTMLButtonElement).disabled).toBe(false));
  row('[data-action="pay-selected"]')!.click();
  await confirmYes();
  await vi.waitFor(() => expect(paths("/v1/moderation/campaign/payouts/batch", "POST")).toHaveLength(2));
  const [a, b] = paths("/v1/moderation/campaign/payouts/batch", "POST").map((c) => c.body!);
  expect(b!.operationId).toBe(a!.operationId);
  expect(b!.contentIds).toEqual(["s1", "s2"]);
});

it("leaves a row out of the batch while its single pay is in flight", async () => {
  let release!: () => void;
  payGate = new Promise((r) => { release = r; });
  replies.pay = [{ status: 200, body: payout("y1", { contentId: "s1", status: "paid" }) }];
  await mount("/review/payouts");
  await vi.waitFor(() => expect(row('[data-content="s2"]')).not.toBeNull());
  tick("s1"); tick("s2"); await nextTick();
  (await button('[data-content="s1"] [data-action="pay"]')).click();
  await confirmYes();
  await vi.waitFor(() => expect(paths("/v1/moderation/campaign/contents/s1/payout", "POST")).toHaveLength(1));
  await vi.waitFor(() => expect(checkbox("s1").disabled).toBe(true));
  row('[data-action="pay-selected"]')!.click();
  await vi.waitFor(() => expect(confirmState.current).not.toBeNull());
  expect(confirmState.current!.message).toBe(t("campaign.payouts.confirm", { count: 1, points: (800).toLocaleString("zh-Hant") }));
  settleConfirm(false);
  release();
});

it("uses English plural forms", async () => {
  await loadLocale("en");
  i18n.global.locale.value = "en";
  history = [payout("q1", { status: "blocked_insufficient", attempts: 1 })];
  await mount("/en/review/payouts?view=history");
  await vi.waitFor(() => expect(row('[data-payout="q1"]')?.textContent).toContain("Sent once"));
  i18n.global.locale.value = "en";
  expect(i18n.global.t("campaign.payouts.confirm", { count: 1, points: "300" }, 1)).toBe("Pay 1 reward, 300 credits in total?");
  expect(i18n.global.t("campaign.payouts.reconciled", { count: 1 }, 1)).toContain("1 payment ");
});

it("caps the selection at 20", async () => {
  payableItems = Array.from({ length: 21 }, (_, i) => payable(`s${i + 1}`, 10));
  await mount("/review/payouts");
  await vi.waitFor(() => expect(row('[data-content="s21"]')).not.toBeNull());
  for (let i = 1; i <= 20; i++) { const box = row(`[data-content="s${i}"] input[type=checkbox]`) as HTMLInputElement; box.checked = true; box.dispatchEvent(new Event("change")); }
  await nextTick();
  expect((row('[data-content="s21"] input[type=checkbox]') as HTMLInputElement).disabled).toBe(true);
  expect((row('[data-content="s20"] input[type=checkbox]') as HTMLInputElement).disabled).toBe(false);
});

it("pays one content with requestPayout after confirming", async () => {
  replies.pay = [{ status: 200, body: payout("y1", { contentId: "s1", status: "paid" }) }];
  await mount("/review/payouts");
  (await button('[data-content="s1"] [data-action="pay"]')).click();
  await vi.waitFor(() => expect(confirmState.current).not.toBeNull());
  expect(confirmState.current!.message).toBe(t("campaign.payouts.confirm", { count: 1, points: (300).toLocaleString("zh-Hant") }));
  settleConfirm(true);
  await vi.waitFor(() => expect(paths("/v1/moderation/campaign/contents/s1/payout", "POST")).toHaveLength(1));
  expect(paths("/v1/moderation/campaign/contents/s1/payout", "POST")[0]!.body).toEqual({ operationId: expect.stringMatching(/^[0-9a-f-]{36}$/) });
  await vi.waitFor(() => expect(row('[data-content="s1"]')?.textContent).toContain(t("campaign.status.paid")));
});

it("offers the right actions per payout status", async () => {
  history = [
    payout("q1", { status: "blocked_insufficient", error: "pool_insufficient" }),
    payout("p-fresh", { status: "pending", createdAt: Date.now() - 2 * MIN, checkedAbsentAt: Date.now() }),
    payout("p-unchecked", { status: "pending", createdAt: Date.now() - 30 * MIN, checkedAbsentAt: null }),
    payout("p-absent", { status: "pending", createdAt: Date.now() - 30 * MIN, checkedAbsentAt: Date.now() - MIN }),
    payout("f1", { status: "failed", error: "provider_refused" }),
    payout("d1", { status: "paid" }),
    payout("x1", { status: "cancelled" }),
  ];
  await mount("/review/payouts?view=history");
  await vi.waitFor(() => expect(row('[data-payout="x1"]')).not.toBeNull());
  const actions = (id: string) => [...row(`[data-payout="${id}"]`)!.querySelectorAll("[data-action]")].map((b) => b.getAttribute("data-action"));
  expect(actions("q1")).toEqual(["retry", "cancel"]);
  expect(actions("p-fresh")).toEqual(["check"]);
  expect(actions("p-unchecked")).toEqual(["check"]);
  expect(actions("p-absent")).toEqual(["check", "cancel"]);
  expect(actions("f1")).toEqual([]);
  expect(actions("d1")).toEqual([]);
  expect(actions("x1")).toEqual([]);
  expect(row('[data-payout="q1"]')!.textContent).toContain("點數池不足，補足後重試");
  // Provider 的碼用通用文案講，不只丟出碼本身
  expect(row('[data-payout="f1"]')!.textContent).toContain(campaignErrorText("provider_refused"));
  expect(campaignErrorText("provider_refused")).not.toBe("provider_refused");
});

it("filters the history by status", async () => {
  await mount("/review/payouts?view=history");
  await vi.waitFor(() => expect(host.querySelector("select[data-filter=status]")).not.toBeNull());
  const select = host.querySelector<HTMLSelectElement>("select[data-filter=status]")!;
  select.value = "pending"; select.dispatchEvent(new Event("change"));
  await vi.waitFor(() => expect(paths("/v1/moderation/campaign/payouts?").at(-1)!.path).toBe("/v1/moderation/campaign/payouts?status=pending&page=1"));
});

it("reuses the retry operation id after a failure and drops it after success", async () => {
  history = [payout("q1", { status: "blocked_insufficient", error: "pool_insufficient" })];
  replies.retry = [{ status: 500, body: { error: "boom" } }, { status: 200, body: payout("q1", { status: "blocked_insufficient", error: "pool_insufficient" }) }, { status: 409, body: { error: "share_payout_stale" } }];
  await mount("/review/payouts?view=history");
  (await button('[data-payout="q1"] [data-action="retry"]')).click();
  await vi.waitFor(() => expect(paths("/v1/moderation/campaign/payouts/q1/retry", "POST")).toHaveLength(1));
  await vi.waitFor(() => expect((row('[data-payout="q1"] [data-action="retry"]') as HTMLButtonElement).disabled).toBe(false));
  (await button('[data-payout="q1"] [data-action="retry"]')).click();
  await vi.waitFor(() => expect(paths("/v1/moderation/campaign/payouts/q1/retry", "POST")).toHaveLength(2));
  await vi.waitFor(() => expect((row('[data-payout="q1"] [data-action="retry"]') as HTMLButtonElement).disabled).toBe(false));
  (await button('[data-payout="q1"] [data-action="retry"]')).click();
  await vi.waitFor(() => expect(paths("/v1/moderation/campaign/payouts/q1/retry", "POST")).toHaveLength(3));
  const [a, b, c] = paths("/v1/moderation/campaign/payouts/q1/retry", "POST").map((x) => x.body!.operationId);
  expect(b).toBe(a);
  expect(c).not.toBe(a);
  await vi.waitFor(() => expect(row('[data-payout="q1"]')?.textContent).toContain("檔位或金額改過了，請取消後重新發放"));
});

it("needs a reason of at most 500 characters to cancel, and a failed retry reuses the operation id", async () => {
  history = [payout("q1", { status: "blocked_insufficient", error: "pool_insufficient" })];
  replies.cancel = [{ status: 500, body: { error: "boom" } }, { status: 200, body: payout("q1", { status: "cancelled" }) }];
  await mount("/review/payouts?view=history");
  (await button('[data-payout="q1"] [data-action="cancel"]')).click();
  await vi.waitFor(() => expect(dialog()).not.toBeNull());
  const box = dialog()!;
  const submit = box.querySelector<HTMLButtonElement>("button[type=submit]")!;
  expect(submit.disabled).toBe(true);
  const reason = box.querySelector("textarea")!;
  type(reason, "   "); await nextTick();
  expect(submit.disabled).toBe(true);
  type(reason, "😀".repeat(501)); await nextTick();
  expect(submit.disabled).toBe(true);
  type(reason, "😀".repeat(500)); await nextTick();
  expect(submit.disabled).toBe(false);
  type(reason, "  檔位調整，重新發放  "); await nextTick();
  box.requestSubmit();
  await vi.waitFor(() => expect(box.querySelector("[role=alert]")).not.toBeNull());
  box.requestSubmit();
  await vi.waitFor(() => expect(paths("/v1/moderation/campaign/payouts/q1/cancel", "POST")).toHaveLength(2));
  const [first, second] = paths("/v1/moderation/campaign/payouts/q1/cancel", "POST");
  expect(first!.body).toEqual({ reason: "檔位調整，重新發放", operationId: expect.stringMatching(/^[0-9a-f-]{36}$/) });
  expect(second!.body!.operationId).toBe(first!.body!.operationId);
  await vi.waitFor(() => expect(dialog()).toBeNull());
});

it("checks a pending payout and reloads", async () => {
  history = [payout("p1", { status: "pending" })];
  replies.check = [{ status: 200, body: { result: "absent", payout: payout("p1", { checkedAbsentAt: Date.now() }) } }];
  await mount("/review/payouts?view=history");
  await vi.waitFor(() => expect(paths("/v1/moderation/campaign/payouts?").length).toBeGreaterThanOrEqual(2));
  const before = paths("/v1/moderation/campaign/payouts?").length;
  (await button('[data-payout="p1"] [data-action="check"]')).click();
  await vi.waitFor(() => expect(paths("/v1/moderation/campaign/payouts/p1/check", "POST")).toHaveLength(1));
  await vi.waitFor(() => expect(row('[data-payout="p1"]')?.textContent).toContain(t("campaign.payouts.absent")));
  expect(paths("/v1/moderation/campaign/payouts?").length).toBeGreaterThan(before);
});

it.each([
  ["share_payout_stale", "檔位或金額改過了，請取消後重新發放"],
  ["share_payout_in_progress", "這份內容已有一筆發放在處理"],
  ["share_payout_not_cancellable", "這筆可能已經送出，請先查詢結果"],
  ["share_nothing_due", "已經沒有應發的點數"],
  ["campaign_payout_closed", "已過發獎截止"],
  ["share_self_payout", "不能發放給自己"],
  ["pool_insufficient", "點數池不足，補足後重試"],
])("every payout error has a next step: %s", async (code, text) => {
  i18n.global.locale.value = "zh-Hant";
  expect(campaignErrorText(code)).toContain(text);
  for (const locale of ["zh-Hans", "en", "ja", "ko"]) {
    await loadLocale(locale);
    i18n.global.locale.value = locale as typeof i18n.global.locale.value;
    expect(i18n.global.te(`campaign.error.${code}`, locale)).toBe(true);
    expect(campaignErrorText(code)).not.toContain(text);
    expect(campaignErrorText(code)).not.toBe(code);
    expect(campaignErrorText(code)).not.toContain("(");
  }
});

it("創作季待發放：列出該補發的卡，確認筆數與總積分後一次發這一頁，每筆結果留在那一列", async () => {
  creatorDue = [
    { cardId: 101, cardName: "夜行偵探", campaignSlug: "creator-season", author: { handle: "aaaaaaaa" }, registeredAt: Date.UTC(2026, 9, 17), amount: 10000 },
    { cardId: 102, cardName: "雨天書店", campaignSlug: "creator-season", author: { handle: "bbbbbbbb" }, registeredAt: Date.UTC(2026, 9, 17), amount: 10000 },
  ];
  replies.creatorBatch = [{ status: 200, body: { items: [
    { cardId: 101, reward: { id: "r1", cardId: 101, amount: 10000, status: "paid", error: null, attempts: 1, createdAt: 1, settledAt: 2 } },
    { cardId: 102, error: "card_reward_self" },
  ] } }];
  await mount("/review/payouts");
  await vi.waitFor(() => expect(host.querySelector('[data-due="101"]')).not.toBeNull());
  expect(host.querySelector("[data-creator-rewards]")!.textContent).toContain("夜行偵探");
  host.querySelector<HTMLButtonElement>("[data-pay-page]")!.click();
  await vi.waitFor(() => expect(confirmState.current).not.toBeNull());
  expect(confirmState.current!.message).toBe(i18n.global.t("review.creator.confirm", { count: 2, points: "20,000" }));
  settleConfirm(true);
  await vi.waitFor(() => expect(paths("/v1/moderation/card-rewards/batch", "POST")).toHaveLength(1));
  expect(calls.find((c) => c.path === "/v1/moderation/card-rewards/batch")!.body).toMatchObject({ cardIds: [101, 102], operationId: expect.any(String) });
  // 已入帳的會離開清單：先留一行總結；失敗的代碼轉成看得懂的話
  await vi.waitFor(() => expect(host.querySelector("[data-batch-done]")!.textContent).toBe(i18n.global.t("review.creator.done", { paid: 1, queued: 0, failed: 1 })));
  expect(host.querySelector('[data-due="102"]')!.textContent).toContain(i18n.global.t("review.creator.error.card_reward_self"));
});
