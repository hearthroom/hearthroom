/**
 * 審核工作台的擴充單（ui.md §3.9 ①）：清單混排卡片與擴充、「擴充」篩選，以及擴充單詳情的動作列狀態。
 * 審核端點全部換成假的；看的是畫面照伺服器的欄位畫對、該擋的有擋住（自己的、未領取、駁回沒寫理由）。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, nextTick, type App } from "vue";
import { createPinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { i18n } from "../src/lib/i18n";
import { confirmState, settleConfirm } from "../src/lib/confirm";

const api = vi.hoisted(() => ({
  fetchReviewQueue: vi.fn(),
  fetchReviewDetail: vi.fn(),
  fetchReviewOriginality: vi.fn(async () => ({ available: false, reason: "no_snapshot" })),
  claimReview: vi.fn(async () => ({ id: "w1", claimedAt: 1, generation: "g1" })),
  releaseReview: vi.fn(async () => undefined),
  stampReview: vi.fn(async () => ({ id: "w1", status: "rejected", cardStatus: "pending", stamps: { approve: 0, required: 1 } })),
  unholdReview: vi.fn(),
  holdReview: vi.fn(),
  withdrawReopen: vi.fn(),
  correctReviewDecision: vi.fn(),
  updateReviewTags: vi.fn(),
  fetchReviewAuthorCards: vi.fn(),
  fetchReviewMe: vi.fn(async () => ({ reviewer: true })),
  ApiError: class ApiError extends Error { constructor(readonly status: number, message: string, readonly code = "") { super(message); } },
}));
vi.mock("../src/lib/api", () => api);
vi.mock("../src/lib/session", () => ({ useSession: () => ({ accessToken: async () => "tok", me: { accountNumId: 7 }, profile: null }) }));
vi.mock("../src/lib/track", () => ({ track: () => {}, currentSurface: () => "review", setSurface: () => {} }));

import ReviewQueuePage from "../src/pages/ReviewQueuePage.vue";
import ReviewDetailPage from "../src/pages/ReviewDetailPage.vue";

const t = (key: string, params?: Record<string, unknown>) => i18n.global.t(key, params ?? {});
let app: App | null = null;
let host: HTMLElement;

afterEach(() => {
  if (confirmState.current) settleConfirm(false);
  app?.unmount();
  app = null;
  host?.remove();
  vi.clearAllMocks();
});

async function mount(component: object, path: string, routePath: string) {
  host = document.createElement("div");
  document.body.appendChild(host);
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: routePath, component }, { path: "/:rest(.*)*", component: { template: "<p>other</p>" } }] });
  await router.push(path);
  app = createApp(component).use(createPinia()).use(router).use(i18n);
  app.mount(host);
  await nextTick();
}

const cardItem = {
  id: "c1", kind: "first", submittedAt: Date.now() - 60_000, subjectKind: "card",
  card: { id: "100001", roleId: "r1", name: "霧港少女", summary: "賣花的女孩", avatarUrl: null, zone: "zh", tags: [] },
  stamps: { approve: 0, required: 1 }, claim: "free", stampedByMe: false, worldbookEntries: 12, regexRules: 3,
};
const wsItem = (over: Record<string, unknown> = {}) => ({
  id: "w1", kind: "re", type: "update", submittedAt: Date.now() - 120_000, subjectKind: "workshop",
  card: { id: "100002", roleId: "r2", name: "燈塔守夜人", summary: "原卡簡介", avatarUrl: null, zone: "zh", tags: [] },
  stamps: { approve: 0, required: 1 }, claim: "free", stampedByMe: false, rating: "R",
  workshop: { id: "ws1", name: "潮汐曆法", summary: "每天的港口都不一樣", coverUrl: null, updateNote: "新增節氣條目", residentChars: 900, loreCount: 22, ruleCount: 2, openingCount: 0, authorName: "夜行" },
  ...over,
});

describe("審核清單：卡片與擴充混排", () => {
  it("卡片列照舊；擴充列有擴充 chip、16:9 縮圖、常駐與內容數量，新版多一行更新說明", async () => {
    api.fetchReviewQueue.mockResolvedValue({ items: [cardItem, wsItem(), wsItem({ id: "w2", type: "first", rating: null, workshop: { ...wsItem().workshop, id: "ws2", name: "雪夜篇", updateNote: null } })], claimTtlMs: 1 });
    await mount(ReviewQueuePage, "/review", "/review");
    await vi.waitFor(() => expect(host.textContent).toContain("潮汐曆法"));

    const card = host.querySelector('[data-review-row="c1"]')!;
    expect(card.getAttribute("data-subject")).toBe("card");
    expect(card.querySelector("[data-ws-chip]")).toBeNull();
    expect(card.querySelector("[data-ws-cover]")).toBeNull();
    expect(card.querySelector("[data-type-chip]")?.textContent?.trim()).toBe(t("review.type.first"));
    expect(card.querySelector("[data-worldbook-chip]")?.textContent?.trim()).toBe(t("review.queue.worldbook", { n: "12" }));
    expect(card.textContent).toContain("霧港少女");

    const ws = host.querySelector('[data-review-row="w1"]')!;
    expect(ws.getAttribute("data-subject")).toBe("workshop");
    expect(ws.querySelector("[data-ws-chip]")?.textContent?.trim()).toBe(t("workshop.review.kind"));
    expect(ws.querySelector("[data-ws-cover] .ext-cover")).toBeTruthy();
    expect(ws.querySelector("[data-ws-for]")?.textContent?.trim()).toBe(t("workshop.detail.forCard", { card: "燈塔守夜人" }));
    expect(ws.querySelector("[data-type-chip]")?.textContent?.trim()).toBe(t("workshop.review.update"));
    expect(ws.querySelector("[data-resident-chip]")?.textContent?.trim()).toBe(t("workshop.manage.row.resident", { chars: "900" }));
    expect(ws.querySelector("[data-worldbook-chip]")?.textContent?.trim()).toBe(t("review.queue.worldbook", { n: "22" }));
    expect(ws.querySelector("[data-regex-chip]")?.textContent?.trim()).toBe(t("review.queue.regex", { n: "2" }));
    expect(ws.querySelector("[data-opening-chip]")).toBeTruthy();
    // 擴充不套字數門檻：沒有字數 chip
    expect(ws.querySelector("[data-length-chip]")).toBeNull();
    expect(ws.querySelector("[data-update-note]")?.textContent?.trim()).toBe(t("workshop.review.updateNote", { note: "新增節氣條目" }));
    // 擴充名取代原卡名；原卡只出現在「為《原卡》」
    expect(ws.querySelector(".row__name")?.textContent).toBe("潮汐曆法");

    const first = host.querySelector('[data-review-row="w2"]')!;
    expect(first.querySelector("[data-type-chip]")?.textContent?.trim()).toBe(t("review.type.first"));
    expect(first.querySelector("[data-update-note]")).toBeNull();
  });

  it("篩選「擴充」只留擴充單（連自己領著的卡片單也收起）；篩到沒有時說沒有待審的擴充", async () => {
    const mineCard = { ...cardItem, id: "c9", claim: "mine", card: { ...cardItem.card, id: "100009", name: "領著的卡" } };
    api.fetchReviewQueue.mockResolvedValue({ items: [cardItem, mineCard, wsItem()], claimTtlMs: 1 });
    await mount(ReviewQueuePage, "/review", "/review");
    await vi.waitFor(() => expect(host.textContent).toContain("潮汐曆法"));
    (host.querySelector('[data-filter="workshop"]') as HTMLButtonElement).click();
    await nextTick();
    expect(host.querySelector('[data-review-row="c1"]')).toBeNull();
    expect(host.querySelector('[data-review-row="c9"]')).toBeNull();
    expect(host.querySelector('[data-review-row="w1"]')).toBeTruthy();
    expect(host.querySelector("[data-ws-empty]")).toBeNull();
    // 「重送」篩選照舊：自己領著的卡仍列著
    (host.querySelector('[data-filter="resubmitted"]') as HTMLButtonElement).click();
    await nextTick();
    expect(host.querySelector('[data-review-row="c9"]')).toBeTruthy();
    (host.querySelector('[data-filter="all"]') as HTMLButtonElement).click();
    await nextTick();
    expect(host.querySelector('[data-review-row="c1"]')).toBeTruthy();
    app!.unmount(); host.remove(); app = null;

    api.fetchReviewQueue.mockResolvedValue({ items: [cardItem], claimTtlMs: 1 });
    await mount(ReviewQueuePage, "/review", "/review");
    await vi.waitFor(() => expect(host.textContent).toContain("霧港少女"));
    (host.querySelector('[data-filter="workshop"]') as HTMLButtonElement).click();
    await nextTick();
    expect(host.querySelector('[data-review-row="c1"]')).toBeNull();
    expect(host.querySelector("[data-ws-empty]")?.textContent).toContain(t("workshop.review.filterEmpty"));
  });
});

describe("審核清單：擴充單領不到", () => {
  it("自己的擴充或還沒驗證年齡（403）：進詳情看原因，不停在清單上", async () => {
    api.fetchReviewQueue.mockResolvedValue({ items: [wsItem()], claimTtlMs: 1 });
    api.claimReview.mockRejectedValueOnce(new api.ApiError(403, "x", "age_verification_required"));
    await mount(ReviewQueuePage, "/review", "/review");
    await vi.waitFor(() => expect(host.textContent).toContain("潮汐曆法"));
    const router = (app as unknown as { config: { globalProperties: { $router: { currentRoute: { value: { fullPath: string } } } } } }).config.globalProperties.$router;
    (host.querySelector('[data-review-row="w1"] .row__main') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe("/review/w1"));
  });
});

const wsDetail = (over: Record<string, unknown> = {}) => ({
  subjectKind: "workshop",
  submission: { id: "w1", status: "pending", submittedAt: Date.now() - 3_600_000, type: "update", rating: null, claimedByMe: false, claim: "free", stampedByMe: false, claimGeneration: "g1", required: 1, stamps: [], ownWorkshop: false, ageVerificationRequired: false, ...over },
  baseCard: { id: "100002", roleId: "r2", name: "燈塔守夜人", rating: null },
  maker: { name: "夜行", handle: null, accountNumId: 9 },
  workshop: {
    id: "ws1", releaseId: "rel1", name: "潮汐曆法", summary: "每天的港口都不一樣", description: "", coverUrl: null, version: "v6", previousVersion: "v5",
    updateNote: "新增 3 條節氣條目", residentChars: 900, residentMax: 1500,
    entries: [{ entryId: "e1", name: "燈塔日記", content: "守塔人每晚都會記下燈塔的亮度。", keywords: ["燈塔"], secondaryKeywords: [], isEnabled: true, isConstant: true }],
    rules: [{ id: "r1", name: "日誌框", find: "<log>", replace: "<div>", enabled: true }],
    openings: [],
  },
});
const actions = () => host.querySelector("[data-ws-actions]");
const buttonTexts = () => [...(actions()?.querySelectorAll("button, a") ?? [])].map((b) => b.textContent?.trim());

describe("審核詳情·擴充單", () => {
  it("未領取時只有領取；領取後重讀，出現審核試玩、駁回、通過", async () => {
    api.fetchReviewDetail.mockResolvedValueOnce(wsDetail()).mockResolvedValue(wsDetail({ claimedByMe: true, claim: "mine" }));
    await mount(ReviewDetailPage, "/review/w1", "/review/:id");
    await vi.waitFor(() => expect(host.querySelector("[data-workshop-review]")).toBeTruthy());
    // 擴充單不自動領取，也不跑卡片的查重
    expect(api.claimReview).not.toHaveBeenCalled();
    expect(api.fetchReviewOriginality).not.toHaveBeenCalled();
    expect(actions()?.textContent).toContain(t("review.claimFirst"));
    expect(buttonTexts()).toEqual([t("review.action.claim")]);
    expect(host.querySelector("[data-update-note]")?.textContent).toContain("新增 3 條節氣條目");
    expect(host.querySelector("[data-type-chip]")?.textContent?.trim()).toBe(t("workshop.review.updateVer", { ver: "v6" }));
    expect(host.textContent).toContain(t("review.stamps", { n: 0, required: 1 }));

    (actions()!.querySelector("[data-ws-claim]") as HTMLButtonElement).click();
    await vi.waitFor(() => expect(actions()?.querySelector("[data-ws-approve]")).toBeTruthy());
    expect(api.claimReview).toHaveBeenCalledWith("w1", "tok");
    expect(buttonTexts()).toEqual([t("review.action.play"), t("review.action.reject"), t("review.action.approve")]);
    // 審核試玩：同卡片的網址，原卡卡號＋審核單 id
    expect(actions()!.querySelector("[data-ws-play]")?.getAttribute("href")).toBe("/play/100002?review=w1");
    expect(actions()!.querySelector("[data-ws-play]")?.getAttribute("target")).toBe("_blank");
  });

  it("自己的擴充：動作列只有說明，沒有領取鈕", async () => {
    api.fetchReviewDetail.mockResolvedValue(wsDetail({ ownWorkshop: true }));
    await mount(ReviewDetailPage, "/review/w1", "/review/:id");
    await vi.waitFor(() => expect(host.querySelector("[data-ws-own]")).toBeTruthy());
    expect(host.querySelector("[data-ws-own]")?.textContent).toBe(t("workshop.review.own"));
    expect(buttonTexts()).toEqual([]);
    expect(host.querySelector("[data-ws-claim]")).toBeNull();
  });

  it("限制級而審核員還沒驗證年齡：說明＋驗證年齡，沒有領取", async () => {
    api.fetchReviewDetail.mockResolvedValue(wsDetail({ rating: "R", ageVerificationRequired: true }));
    await mount(ReviewDetailPage, "/review/w1", "/review/:id");
    await vi.waitFor(() => expect(host.querySelector("[data-ws-age]")).toBeTruthy());
    expect(buttonTexts()).toEqual([t("workshop.review.verifyAge")]);
  });

  it("駁回沒填理由不送；填了才送，理由原文帶給伺服器", async () => {
    api.fetchReviewDetail.mockResolvedValue(wsDetail({ claimedByMe: true, claim: "mine" }));
    await mount(ReviewDetailPage, "/review/w1", "/review/:id");
    await vi.waitFor(() => expect(host.querySelector("[data-ws-reject]")).toBeTruthy());
    (host.querySelector("[data-ws-reject]") as HTMLButtonElement).click();
    await vi.waitFor(() => expect(confirmState.current?.field?.required).toBe(true));
    expect(confirmState.current?.focusCancel).toBe(true);
    settleConfirm(true, "", "   ");
    await nextTick();
    // 空白理由：框還開著，什麼都沒送
    expect(confirmState.current).not.toBeNull();
    expect(api.stampReview).not.toHaveBeenCalled();
    settleConfirm(true, "", "介面讓原卡對白難讀");
    await vi.waitFor(() => expect(api.stampReview).toHaveBeenCalledWith("w1", "tok", { verdict: "reject", note: "介面讓原卡對白難讀", generation: "g1" }));
  });

  it("通過：確認後才送，送出後動作列換成結果", async () => {
    api.fetchReviewDetail.mockResolvedValue(wsDetail({ claimedByMe: true, claim: "mine" }));
    await mount(ReviewDetailPage, "/review/w1", "/review/:id");
    await vi.waitFor(() => expect(host.querySelector("[data-ws-approve]")).toBeTruthy());
    (host.querySelector("[data-ws-approve]") as HTMLButtonElement).click();
    await vi.waitFor(() => expect(confirmState.current?.message).toBe(t("workshop.review.approveBody")));
    expect(api.stampReview).not.toHaveBeenCalled();
    settleConfirm(true);
    await vi.waitFor(() => expect(api.stampReview).toHaveBeenCalledWith("w1", "tok", { verdict: "approve", note: "", generation: "g1" }));
    // 重讀回來的還是舊狀態（例如讀取慢了一步）：畫面也已經換成結果，不再留著通過／駁回
    await vi.waitFor(() => expect(host.querySelector("[data-ws-result]")).toBeTruthy());
    expect(host.querySelector("[data-ws-approve]")).toBeNull();
  });
});
