/**
 * 審核分頁 /review/campaign：一般審核員看得到分頁；佇列的分段與活動篩選打對參數；三種標示；
 * 決定對話框：通過帶檔位與有效位置、退回補件與不通過要理由（500 字內）、失敗重按沿用 operationId；
 * 版本衝突提示並重新載入；補件截止後沒有「退回補件」；不能審核自己的申請；回應裡的發放狀態；
 * 畫面上只有 handle，沒有成員 id 或收款帳號。
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createApp, h, nextTick, type App } from "vue";
import { createPinia } from "pinia";
import { createMemoryHistory, createRouter, RouterView, type Router } from "vue-router";
import { i18n } from "../src/lib/i18n";

vi.mock("../src/lib/session", () => ({ useSession: () => ({ me: { accountNumId: 7 }, profile: {}, ready: true, accessToken: async () => "synthetic" }) }));
vi.mock("../src/lib/api", async (original) => ({
  ...(await original<object>()),
  fetchReviewMe: async () => ({ reviewer: true, pending: 0, reviews: 0, cases: 0, comments: 0, role: "reviewer" }),
}));
import { router as siteRouter } from "../src/router";

const DAY = 86_400_000;
const flags = (extra: Partial<Record<"duplicateLocation" | "duplicateImage" | "burst", boolean>> = {}) => ({ duplicateLocation: false, duplicateImage: false, burst: false, ...extra });
const campaign = (extra: Record<string, unknown> = {}) => ({
  id: "c1", slug: "launch", title: { "zh-Hant": "開業活動" }, intro: {}, bannerKey: null, bannerUrl: null, startsAt: Date.now() - 10 * DAY, endsAt: Date.now() + 10 * DAY,
  timezone: "Asia/Taipei", submitDeadline: Date.now() + 20 * DAY, payoutDeadline: Date.now() + 30 * DAY, tiers: { light: 50, original: 300, guide: 800 },
  extraPlacementAmount: 20, flagBurstThreshold: 5, evidenceRetentionDays: 30, status: "active", version: 1, createdAt: 1, updatedAt: 1, ...extra,
});
const queueItem = (id: string, extra: Record<string, unknown> = {}) => ({
  id, contentId: `s-${id}`, contentTitle: `雨夜書店攻略 ${id}`, campaignSlug: "launch", applicant: { handle: "rainy" }, platform: "tieba", location: "某某吧",
  url: "https://tieba.example/p/1", publishedAt: Date.UTC(2026, 9, 3), requestedTier: "original", approvedTier: null, reviewStatus: "submitted", version: 3,
  createdAt: Date.UTC(2026, 9, 3, 1), evidenceCount: 2, flags: flags(), ...extra,
});
const placement = (id: string, extra: Record<string, unknown> = {}) => ({
  id, platform: "tieba", location: "某某吧", locationKey: "tieba:某某吧", url: "https://tieba.example/p/1", publishedAt: Date.UTC(2026, 9, 3), note: "置頂了三天",
  requestedTier: "original", approvedTier: null, reviewStatus: "submitted", reviewReason: null, reviewedKind: null, reviewedAt: null, countsAsPlacement: true,
  version: 3, createdAt: Date.UTC(2026, 9, 3, 1), evidence: [{ id: "e1", purged: false }, { id: "e2", purged: true }], flags: flags(),
  duplicates: { location: [], image: [] }, ...extra,
});
const detail = (placements = [placement("p1")]) => ({
  // 伺服器不會回成員 id 與收款帳號；就算多帶了，畫面也不能顯示
  content: { id: "s1", campaignSlug: "launch", title: "雨夜書店攻略", cardId: 12, shareCode: "SHARE1", applicant: { handle: "rainy", memberId: "mem-secret-1" }, recipientAccountNo: 987654, createdAt: 1 },
  placements, payout: { tier: "original", target: 300, due: 300 }, paidTotal: 0, payouts: [], history: [{ id: "s2", title: "另一份分享", createdAt: 2, paidTotal: 50 }],
});

type Call = { method: string; path: string; body: Record<string, unknown> | null };
let calls: Call[];
let campaigns: ReturnType<typeof campaign>[];
let queue: ReturnType<typeof queueItem>[];
let content: ReturnType<typeof detail>;
let decisions: { status: number; body: unknown }[];
/** 設了就讓下一次讀佇列等到它放行 */
let queueGate: Promise<void> | null;
const origCreate = URL.createObjectURL, origRevoke = URL.revokeObjectURL;

beforeEach(() => {
  i18n.global.locale.value = "zh-Hant";
  calls = []; campaigns = [campaign(), campaign({ id: "c2", slug: "spring", title: { "zh-Hant": "春季活動" } })]; queue = [queueItem("p1")]; content = detail(); decisions = []; queueGate = null;
  URL.createObjectURL = vi.fn(() => "blob:mock") as typeof URL.createObjectURL;
  URL.revokeObjectURL = vi.fn();
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    const body = typeof init.body === "string" ? JSON.parse(init.body) : null;
    calls.push({ method, path: url, body });
    const json = (status: number, b: unknown) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
    if (url === "/v1/moderation/campaigns") return json(200, { items: campaigns, canEdit: false });
    if (url.startsWith("/v1/moderation/campaign/placements?") || url === "/v1/moderation/campaign/placements") { if (queueGate) await queueGate; return json(200, { total: queue.length, items: queue }); }
    if (url.startsWith("/v1/moderation/campaign/contents/")) return json(200, content);
    if (url.endsWith("/decision")) { const r = decisions.shift() ?? { status: 500, body: { error: "boom" } }; return json(r.status, r.body); }
    if (url.startsWith("/v1/campaign/evidence/")) return new Response(new Blob(["x"]), { status: 200 });
    return json(404, { error: "not_found" });
  }));
});
afterEach(() => { app?.unmount(); document.body.innerHTML = ""; vi.unstubAllGlobals(); URL.createObjectURL = origCreate; URL.revokeObjectURL = origRevoke; });

let app: App, host: HTMLElement, router: Router;
async function mount(path: string) {
  host = document.body.appendChild(document.createElement("div"));
  router = createRouter({ history: createMemoryHistory(), routes: siteRouter.options.routes });
  await router.push(path);
  app = createApp({ render: () => h(RouterView) }).use(createPinia()).use(router).use(i18n);
  app.mount(host);
}
const t = (k: string, p?: Record<string, unknown>) => i18n.global.t(k, p ?? {});
const queueCalls = () => calls.filter((c) => c.path.startsWith("/v1/moderation/campaign/placements") && c.method === "GET").map((c) => c.path);
const detailCalls = () => calls.filter((c) => c.path === "/v1/moderation/campaign/contents/s1");
const decisionCalls = () => calls.filter((c) => c.path.endsWith("/decision"));
const dialog = () => document.querySelector<HTMLFormElement>("[role=dialog]");
async function openDecision(placementId: string, action: string) {
  await vi.waitFor(() => expect(host.querySelector(`[data-placement="${placementId}"] [data-action="${action}"]`)).not.toBeNull());
  host.querySelector<HTMLButtonElement>(`[data-placement="${placementId}"] [data-action="${action}"]`)!.click();
  await vi.waitFor(() => expect(dialog()).not.toBeNull());
  return dialog()!;
}
function type(el: HTMLTextAreaElement | HTMLInputElement, value: string) { el.value = value; el.dispatchEvent(new Event("input")); }

it("shows the share campaign tab to a plain reviewer", async () => {
  await mount("/review/campaign");
  await vi.waitFor(() => expect(host.querySelector('.management-nav a[href="/review/campaign"]')).not.toBeNull());
  const tab = host.querySelector('.management-nav a[href="/review/campaign"]')!;
  expect(tab.textContent).toContain(t("moderation.tab.campaign"));
  expect(tab.getAttribute("aria-current")).toBe("page");
});

it("asks the queue for the selected segment and campaign, shows the three flags and links each row to its content", async () => {
  queue = [queueItem("p1", { flags: flags({ duplicateLocation: true, duplicateImage: true, burst: true }) })];
  await mount("/review/campaign");
  await vi.waitFor(() => expect(host.querySelector('[data-placement="p1"]')).not.toBeNull());
  expect(queueCalls()[0]).toBe("/v1/moderation/campaign/placements?page=1");
  const row = host.querySelector<HTMLAnchorElement>('[data-placement="p1"]')!;
  expect(row.getAttribute("href")).toBe("/review/campaign/s-p1");
  for (const k of ["duplicateLocation", "duplicateImage", "burst"]) expect(row.textContent).toContain(t(`campaign.flag.${k}`));
  expect(row.textContent).toContain("@rainy");
  expect(row.textContent).toContain(t("campaign.tier.original"));

  [...host.querySelectorAll<HTMLButtonElement>(".seg__item")].find((b) => b.textContent === t("campaign.queue.needsInfo"))!.click();
  await vi.waitFor(() => expect(queueCalls().at(-1)).toBe("/v1/moderation/campaign/placements?status=needs_info&page=1"));
  await vi.waitFor(() => expect(host.querySelector<HTMLSelectElement>("select[data-filter=campaign]")?.options.length).toBe(3));
  const select = host.querySelector<HTMLSelectElement>("select[data-filter=campaign]")!;
  select.value = "spring"; select.dispatchEvent(new Event("change"));
  await vi.waitFor(() => expect(queueCalls().at(-1)).toBe("/v1/moderation/campaign/placements?status=needs_info&campaign=spring&page=1"));
});

it("approves with the chosen tier and placement count, then reports a queued payout", async () => {
  decisions = [{ status: 200, body: { placement: { id: "p1", reviewStatus: "approved", approvedTier: "guide", countsAsPlacement: false, reviewReason: null, reviewedKind: "human", reviewedAt: 1, version: 4 }, payout: { id: "po1", status: "blocked_insufficient" } } }];
  await mount("/review/campaign/s1");
  const box = await openDecision("p1", "approve");
  const tier = box.querySelector<HTMLSelectElement>("select")!;
  expect(tier.value).toBe("original");
  const counts = box.querySelector<HTMLInputElement>("input[type=checkbox]")!;
  expect(counts.checked).toBe(true);
  tier.value = "guide"; tier.dispatchEvent(new Event("change"));
  counts.checked = false; counts.dispatchEvent(new Event("change"));
  await nextTick();
  box.requestSubmit();
  await vi.waitFor(() => expect(decisionCalls()).toHaveLength(1));
  expect(decisionCalls()[0]!.path).toBe("/v1/moderation/campaign/placements/p1/decision");
  expect(decisionCalls()[0]!.body).toEqual({ decision: "approve", tier: "guide", countsAsPlacement: false, expectedVersion: 3, operationId: expect.stringMatching(/^[0-9a-f-]{36}$/) });
  await vi.waitFor(() => expect(host.querySelector("[role=status]")?.textContent).toContain(t("campaign.decide.queued")));
  expect(dialog()).toBeNull();
  await vi.waitFor(() => expect(detailCalls()).toHaveLength(2));
});

it("needs a reason of at most 500 characters to send back for more info, and a failed retry reuses the operation id", async () => {
  decisions = [{ status: 500, body: { error: "boom" } }, { status: 200, body: { placement: { id: "p1", reviewStatus: "needs_info", approvedTier: null, countsAsPlacement: true, reviewReason: "請補截圖", reviewedKind: "human", reviewedAt: 1, version: 4 }, payout: null } }];
  await mount("/review/campaign/s1");
  const box = await openDecision("p1", "needs_info");
  const submit = box.querySelector<HTMLButtonElement>("button[type=submit]")!;
  expect(submit.disabled).toBe(true);
  const reason = box.querySelector("textarea")!;
  type(reason, "   "); await nextTick();
  expect(submit.disabled).toBe(true);
  // 500 個字以內才送得出去；emoji 這種兩個 UTF-16 單位的字也算一個
  type(reason, "😀".repeat(501)); await nextTick();
  expect(submit.disabled).toBe(true);
  type(reason, "😀".repeat(500)); await nextTick();
  expect(submit.disabled).toBe(false);
  type(reason, "請補截圖"); await nextTick();
  box.requestSubmit();
  await vi.waitFor(() => expect(box.querySelector("[role=alert]")).not.toBeNull());
  box.requestSubmit();
  await vi.waitFor(() => expect(decisionCalls()).toHaveLength(2));
  const [first, second] = decisionCalls();
  expect(first!.body).toEqual({ decision: "needs_info", reason: "請補截圖", expectedVersion: 3, operationId: expect.stringMatching(/^[0-9a-f-]{36}$/) });
  expect(second!.body!.operationId).toBe(first!.body!.operationId);
  await vi.waitFor(() => expect(dialog()).toBeNull());
});

it("when another reviewer decided first, says so and reloads instead of overwriting", async () => {
  decisions = [{ status: 409, body: { error: "share_version_conflict", version: 4 } }];
  await mount("/review/campaign/s1");
  const box = await openDecision("p1", "reject");
  type(box.querySelector("textarea")!, "截圖看不到分享"); await nextTick();
  box.requestSubmit();
  await vi.waitFor(() => expect(host.querySelector("[role=alert]")?.textContent).toContain(t("campaign.error.share_version_conflict")));
  expect(decisionCalls()[0]!.body).toMatchObject({ decision: "reject", reason: "截圖看不到分享", expectedVersion: 3 });
  expect(dialog()).toBeNull();
  await vi.waitFor(() => expect(detailCalls()).toHaveLength(2));
});

it("has no send-back option once the campaign's resubmission deadline has passed", async () => {
  campaigns = [campaign({ submitDeadline: Date.now() - 1000 })];
  await mount("/review/campaign/s1");
  await vi.waitFor(() => expect(host.querySelector('[data-placement="p1"] [data-action="approve"]')).not.toBeNull());
  await vi.waitFor(() => expect(calls.some((c) => c.path === "/v1/moderation/campaigns")).toBe(true));
  await nextTick();
  expect(host.querySelector('[data-placement="p1"] [data-action="needs_info"]')).toBeNull();
  expect(host.querySelector('[data-placement="p1"] [data-action="reject"]')).not.toBeNull();
});

it("tells a reviewer they cannot review their own submission", async () => {
  decisions = [{ status: 403, body: { error: "share_self_review" } }];
  await mount("/review/campaign/s1");
  const box = await openDecision("p1", "approve");
  box.requestSubmit();
  await vi.waitFor(() => expect(box.querySelector("[role=alert]")?.textContent).toBe(t("campaign.error.share_self_review")));
  expect(dialog()).not.toBeNull();
});

it("lets an approved placement change its tier in the same dialog, approve only", async () => {
  content = detail([placement("p1", { reviewStatus: "approved", approvedTier: "guide", countsAsPlacement: false })]);
  decisions = [{ status: 200, body: { placement: { id: "p1", reviewStatus: "approved", approvedTier: "light", countsAsPlacement: false, reviewReason: null, reviewedKind: "human", reviewedAt: 1, version: 4 }, payout: null } }];
  await mount("/review/campaign/s1");
  await vi.waitFor(() => expect(host.querySelector('[data-placement="p1"] [data-action="regrade"]')).not.toBeNull());
  for (const a of ["approve", "needs_info", "reject"]) expect(host.querySelector(`[data-placement="p1"] [data-action="${a}"]`)).toBeNull();
  const box = await openDecision("p1", "regrade");
  expect(box.querySelector("textarea")).toBeNull();
  const tier = box.querySelector<HTMLSelectElement>("select")!;
  expect(tier.value).toBe("guide");
  expect(box.querySelector<HTMLInputElement>("input[type=checkbox]")!.checked).toBe(false);
  tier.value = "light"; tier.dispatchEvent(new Event("change")); await nextTick();
  box.requestSubmit();
  await vi.waitFor(() => expect(decisionCalls()).toHaveLength(1));
  expect(decisionCalls()[0]!.body).toMatchObject({ decision: "approve", tier: "light", countsAsPlacement: false, expectedVersion: 3 });
  await vi.waitFor(() => expect(dialog()).toBeNull());
  expect(host.querySelector("[role=status]")?.textContent).not.toContain(t("campaign.decide.paid"));
});

it("shows the applicant only by handle, opens links safely and links a duplicate screenshot to the other content", async () => {
  content = detail([placement("p1", { flags: flags({ duplicateImage: true }), duplicates: { location: [], image: [{ contentId: "s9", handle: "copycat" }] } })]);
  await mount("/review/campaign/s1");
  await vi.waitFor(() => expect(host.querySelector('[data-placement="p1"]')).not.toBeNull());
  expect(host.querySelector('a[href="/review/members/rainy"]')?.textContent).toContain("@rainy");
  const external = host.querySelector<HTMLAnchorElement>('[data-placement="p1"] a[href="https://tieba.example/p/1"]')!;
  expect(external.target).toBe("_blank");
  expect(external.rel).toBe("noopener noreferrer");
  expect(host.querySelector<HTMLAnchorElement>('[data-placement="p1"] a[href="/review/campaign/s9"]')?.textContent).toContain("@copycat");
  expect(host.querySelector('a[href="/review/campaign/s2"]')?.textContent).toContain("另一份分享");
  await vi.waitFor(() => expect(host.querySelector('[data-evidence="e1"][data-state="ready"]')).not.toBeNull());
  expect(host.querySelector('[data-evidence="e2"][data-state="purged"]')).not.toBeNull();
  expect(host.innerHTML).not.toContain("mem-secret-1");
  expect(host.innerHTML).not.toContain("987654");
});

it("shows a link that is not http or https as plain text instead of a live link", async () => {
  content = detail([placement("p1", { url: "javascript:alert(1)" })]);
  await mount("/review/campaign/s1");
  await vi.waitFor(() => expect(host.querySelector('[data-placement="p1"]')).not.toBeNull());
  expect(host.querySelector('a[href^="javascript"]')).toBeNull();
  expect(host.querySelector('[data-placement="p1"]')!.textContent).toContain("javascript:alert(1)");
});

it("when the placement was already decided, closes the dialog, says so and reloads", async () => {
  decisions = [{ status: 409, body: { error: "share_already_decided" } }];
  await mount("/review/campaign/s1");
  const box = await openDecision("p1", "approve");
  box.requestSubmit();
  await vi.waitFor(() => expect(host.querySelector("[role=alert]")?.textContent).toContain(t("campaign.error.share_already_decided")));
  expect(dialog()).toBeNull();
  await vi.waitFor(() => expect(detailCalls()).toHaveLength(2));
});

it("reads an out-of-range page as the first page, and clears old rows while another segment loads", async () => {
  await mount("/review/campaign?page=1e400");
  await vi.waitFor(() => expect(host.querySelector('[data-placement="p1"]')).not.toBeNull());
  expect(queueCalls()[0]).toBe("/v1/moderation/campaign/placements?page=1");
  let release!: () => void;
  queueGate = new Promise((r) => { release = r; });
  [...host.querySelectorAll<HTMLButtonElement>(".seg__item")].find((b) => b.textContent === t("campaign.queue.approved"))!.click();
  await vi.waitFor(() => expect(queueCalls().at(-1)).toBe("/v1/moderation/campaign/placements?status=approved&page=1"));
  expect(host.querySelector('[data-placement="p1"]')).toBeNull();
  release();
  await vi.waitFor(() => expect(host.querySelector('[data-placement="p1"]')).not.toBeNull());
});

it("encodes the applicant handle in the member link", async () => {
  content = detail();
  content.content.applicant.handle = "a/b";
  await mount("/review/campaign/s1");
  await vi.waitFor(() => expect(host.querySelector('a[href="/review/members/a%2Fb"]')).not.toBeNull());
});
