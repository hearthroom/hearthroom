/**
 * 駁回改判為通過（ui-flip-approve.md v20）：管理員在結果卡填理由、確認三條影響後建改判單；作者已改稿重送就停用；
 * 改判單詳情頂端說明、決定只有通過與撤回改判；清單上的「改判」chip 與副行。
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createApp, nextTick, type App } from "vue";
import { createPinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { i18n } from "../src/lib/i18n";
import { confirmState, settleConfirm } from "../src/lib/confirm";

const api = vi.hoisted(() => ({
  claimReview: vi.fn(async () => ({})), fetchReviewDetail: vi.fn(), fetchReviewQueue: vi.fn(async () => ({ items: [], claimTtlMs: 1 })), fetchReviewOriginality: vi.fn(), fetchReviewDiff: vi.fn(),
  releaseReview: vi.fn(), stampReview: vi.fn(), blindReview: vi.fn(), holdReview: vi.fn(), unholdReview: vi.fn(), withdrawReopen: vi.fn(), correctReviewDecision: vi.fn(), updateReviewTags: vi.fn(),
  fetchReviewAuthorCards: vi.fn(), fetchReviewAuthorActivity: vi.fn(), dropReview: vi.fn(), restoreReview: vi.fn(), markReviewAuthor: vi.fn(), fetchReviewGroup: vi.fn(), dropReviewBatch: vi.fn(), restoreReviewBatch: vi.fn(),
  startReviewFlip: vi.fn(async () => ({ id: "f1", flipOf: "s1", replayed: false })), withdrawReviewFlip: vi.fn(async () => ({ status: "rejected" })),
  fetchReviewDecisions: vi.fn(), fetchReviewMe: vi.fn(async () => ({ reviewer: true })),
  ApiError: class extends Error { constructor(readonly status: number, message: string, readonly code = "") { super(message); } },
}));
vi.mock("../src/lib/api", () => api);
vi.mock("../src/lib/review-ai-api", async (original) => ({ ...await original<object>(), fetchReviewAi: async () => ({ suggestions: [], myFeedback: [] }) }));
vi.mock("../src/lib/session", () => ({ useSession: () => ({ accessToken: async () => "tok", me: { accountNumId: 7 } }) }));
vi.mock("../src/lib/track", () => ({ track: () => {}, currentSurface: () => "review", setSurface: () => {} }));
import DetailPage from "../src/pages/ReviewDetailPage.vue";
import QueuePage from "../src/pages/ReviewQueuePage.vue";
import DecisionsPage from "../src/pages/ReviewDecisionsPage.vue";

const t = (k: string, p?: Record<string, unknown>) => i18n.global.t(k, p ?? {});
const empty = { personaChars: 0, worldbookEntryCount: 0, worldbookEnabledCount: 0, worldbookConstantCount: 0, worldbookChars: 0, worldbookConstantChars: 0, estimatedConstantTokens: 0, estimatedMaxTokens: 0 };
const detail = (submission: Record<string, unknown>) => ({
  submission: { id: "s1", kind: "first", contentHash: "version:v1", submittedAt: 1_700_000_000_000, rating: null, required: 1, claimGeneration: "g1", ...submission },
  card: { id: "100001", roleId: "r1" },
  rejectReasons: submission.status === "rejected" ? ["other"] : [],
  detail: { partial: false, document: { roleName: "夜行偵探", roleDesc: "", roleAvatar: "", roleBackground: "", roleTag: "[]", userName: "", roleDetailDesc: "", roleType: "", roleSex: "", roleSpeech: "", language: "zh-Hant", talkExample: "", roleOutputContract: "" },
    greetings: { welcome: "", alternates: [], prologue: [] }, worldbook: null, worldbookAvailable: false,
    authorAsset: { rules: [], mountTrigger: "", mountLayer: "", pageMode: "classic", status: "", version: 0 },
    hashes: { card: "", welcome: "", worldbook: "", authorAsset: "", content: "version:v1" }, costProfile: empty },
});
const rejectedSubmission = (flipState: Record<string, unknown>) => detail({
  status: "rejected", decidedAt: 1_700_000_100_000, claimedByMe: false, stampedByMe: false, manager: true,
  stamps: [{ verdict: "reject", note: "內容不足以上架", at: 1_700_000_100_000 }],
  flipState: { pendingId: null, approvedId: null, canStart: true, supersededBy: null, ...flipState },
});
const flipSubmission = (mine: boolean) => detail({
  id: "f1", status: "pending", claimedByMe: mine, stampedByMe: false, manager: true, stamps: [],
  flip: { of: "s1", by: "管理員 A", mine, at: Date.now() - 180_000, rejectedAt: 1_700_000_100_000, reasons: ["other"], note: "內容不足以上架", reason: "原審核員看錯世界書" },
  flipState: { pendingId: null, approvedId: null, canStart: false, supersededBy: null },
});

let app: App, el: HTMLElement;
const mount = async (component: object, path: string, routes = [{ path: "/:p(.*)*", component }]) => {
  el = document.createElement("div"); document.body.append(el);
  const router = createRouter({ history: createMemoryHistory(), routes });
  await router.push(path);
  app = createApp(component).use(createPinia()).use(router).use(i18n); app.mount(el);
  return router;
};
const button = (label: string) => [...el.querySelectorAll("button")].filter((b) => b.textContent?.trim() === label).at(-1);
beforeEach(() => { confirmState.current = null; });
afterEach(() => { app.unmount(); el.remove(); vi.clearAllMocks(); });

it("管理員從清單帶 ?flip=1 進來：表單直接展開，理由必填，確認框寫三條影響，建立後給前往審核", async () => {
  api.fetchReviewDetail.mockResolvedValue(rejectedSubmission({}));
  await mount(DetailPage, "/review/s1?flip=1", [{ path: "/review/:id", component: DetailPage }]);
  await vi.waitFor(() => expect(el.querySelector("[data-flip-form]")).toBeTruthy());
  const form = el.querySelector("[data-flip-form]")!;
  expect(form.textContent).toContain(t("review.flipApprove.title"));
  expect(form.textContent).toContain(t("review.flipApprove.reasonHint"));
  expect(form.textContent).toContain("內容不足以上架");
  expect(form.textContent).toContain(t("review.flipApprove.originalReasons"));

  el.querySelector<HTMLButtonElement>("[data-flip-submit]")!.click();
  await vi.waitFor(() => expect(form.textContent).toContain(t("review.flipApprove.reasonRequired")));
  expect(confirmState.current).toBeNull();

  const input = el.querySelector<HTMLTextAreaElement>("#flip-reason")!;
  expect(input.maxLength).toBe(500);
  input.value = "原審核員看錯世界書"; input.dispatchEvent(new Event("input")); await nextTick();
  el.querySelector<HTMLButtonElement>("[data-flip-submit]")!.click();
  await vi.waitFor(() => expect(confirmState.current).toBeTruthy());
  expect(confirmState.current!.title).toBe(t("review.flipApprove.confirmTitle"));
  for (const k of ["effect1", "effect2", "effect3"]) expect(confirmState.current!.message).toContain(t(`review.flipApprove.${k}`));
  expect(confirmState.current!.confirmText).toBe(t("review.flipApprove.confirmSubmit"));
  expect(confirmState.current!.cancelText).toBe(t("review.flipApprove.confirmCancel"));
  api.fetchReviewDetail.mockResolvedValue(rejectedSubmission({ canStart: false, pendingId: "f1" }));
  settleConfirm(true);
  await vi.waitFor(() => expect(el.querySelector("[data-flip-done]")).toBeTruthy());
  expect(api.startReviewFlip).toHaveBeenCalledWith("s1", "tok", { operationId: expect.stringMatching(/^[0-9a-f-]{36}$/), reason: "原審核員看錯世界書" });
  const done = el.querySelector("[data-flip-done]")!;
  expect(done.textContent).toContain(t("review.flipApprove.doneTitle"));
  expect(done.textContent).toContain(t("review.flipApprove.doneBody"));
  expect(done.querySelector("a")?.getAttribute("href")).toBe("/review/f1");
});

it("作者已改稿重送：表單頂端說明並連到最新版，理由欄與按鈕停用", async () => {
  api.fetchReviewDetail.mockResolvedValue(rejectedSubmission({ supersededBy: { id: "s9", submittedAt: 1_700_000_500_000 } }));
  await mount(DetailPage, "/review/s1", [{ path: "/review/:id", component: DetailPage }]);
  await vi.waitFor(() => expect(el.querySelector("[data-flip-entry]")).toBeTruthy());
  el.querySelector<HTMLButtonElement>("[data-flip-entry]")!.click(); await nextTick();
  const warning = el.querySelector("[data-flip-superseded]")!;
  expect(warning.textContent).toContain(t("review.flipApprove.goLatest"));
  expect(warning.querySelector("a")?.getAttribute("href")).toBe("/review/s9");
  expect(el.querySelector<HTMLTextAreaElement>("#flip-reason")!.disabled).toBe(true);
  expect(el.querySelector<HTMLButtonElement>("[data-flip-submit]")!.disabled).toBe(true);
});

it("一般審核員、或已在改判審核中：沒有入口；改判審核中連到改判單", async () => {
  api.fetchReviewDetail.mockResolvedValue(rejectedSubmission({ canStart: false, pendingId: "f1" }));
  await mount(DetailPage, "/review/s1?flip=1", [{ path: "/review/:id", component: DetailPage }]);
  await vi.waitFor(() => expect(el.querySelector("[data-flip-pending]")).toBeTruthy());
  expect(el.querySelector("[data-flip-entry], [data-flip-form]")).toBeNull();
  expect(el.querySelector("[data-flip-pending] a")?.getAttribute("href")).toBe("/review/f1");
});

it("改判單詳情：頂端說明改判單、原駁回與改判理由；決定只有通過與撤回改判，撤回要確認", async () => {
  api.fetchReviewDetail.mockResolvedValue(flipSubmission(true));
  await mount(DetailPage, "/review/f1", [{ path: "/review/:id", component: DetailPage }]);
  await vi.waitFor(() => expect(el.querySelector("[data-flip-notice]")).toBeTruthy());
  const notice = el.querySelector("[data-flip-notice]")!.textContent!;
  expect(notice).toContain(t("review.flipApprove.detailChip"));
  expect(notice).toContain("管理員 A");
  expect(notice).toContain(t("review.flipApprove.detailReason", { reason: "原審核員看錯世界書" }));
  expect(el.querySelector("[data-flip-readonly]")).toBeNull();
  const choices = el.querySelector("[data-decide-choices]")!;
  expect(choices.querySelectorAll("input[type=radio]")).toHaveLength(1);
  expect(choices.textContent).not.toContain(t("reviewV2.decide.reject"));
  expect(choices.textContent).not.toContain(t("reviewV2.decide.drop"));
  expect(el.querySelector("[data-flip-withdraw]")!.textContent).toContain(t("review.flipApprove.withdrawHint"));
  // 改判單不冷凍討論
  expect(el.querySelector(".hold-entry")).toBeNull();

  button(t("review.flipApprove.withdrawAction"))!.click();
  await vi.waitFor(() => expect(confirmState.current).toBeTruthy());
  expect(confirmState.current!.title).toBe(t("review.flipApprove.withdrawConfirmTitle"));
  expect(confirmState.current!.message).toBe(t("review.flipApprove.withdrawConfirmBody"));
  settleConfirm(true);
  await vi.waitFor(() => expect(api.withdrawReviewFlip).toHaveBeenCalledWith("f1", "tok"));
  await vi.waitFor(() => expect(el.textContent).toContain(t("review.flipApprove.withdrawn")));
});

it("別的管理員打開改判單：唯讀說明只有發起人能處理，沒有撤回、沒有領取", async () => {
  api.fetchReviewDetail.mockResolvedValue(flipSubmission(false));
  await mount(DetailPage, "/review/f1", [{ path: "/review/:id", component: DetailPage }]);
  await vi.waitFor(() => expect(el.querySelector("[data-flip-readonly]")).toBeTruthy());
  expect(el.querySelector("[data-flip-readonly]")!.textContent).toContain(t("review.flipApprove.onlyInitiator", { name: "管理員 A" }));
  expect(el.querySelector("[data-flip-withdraw]")).toBeNull();
  expect(button(t("review.action.claim"))).toBeUndefined();
});

it("待審清單：改判單多一顆「改判」chip 與副行；別人只看到有人在看，也沒有不受理選單", async () => {
  api.fetchReviewQueue.mockResolvedValue({
    items: [{ id: "f1", kind: "first", submittedAt: Date.now() - 180_000, type: "first", attempt: 1,
      card: { id: "c1", roleId: "r1", name: "夜行偵探", summary: "", avatarUrl: null, zone: "zh", tags: [] }, stamps: { approve: 0, required: 1 },
      claim: "other", stampedByMe: false, flip: { by: "管理員 A", at: Date.now() - 180_000, rejectedAt: new Date(2026, 10, 20).getTime(), mine: false } }],
    claimTtlMs: 2_700_000,
  } as never);
  await mount(QueuePage, "/review");
  await vi.waitFor(() => expect(el.textContent).toContain("夜行偵探"));
  expect(el.querySelector("[data-flip-chip]")?.textContent).toBe(t("review.flipApprove.chip"));
  const sub = el.querySelector("[data-flip-by]")!.textContent!;
  expect(sub).toContain("管理員 A");
  expect(sub).toContain(new Intl.DateTimeFormat(String(i18n.global.locale.value), { month: "numeric", day: "numeric" }).format(new Date(2026, 10, 20)));
  expect(button(t("review.claim.other"))?.disabled).toBe(true);
  expect(el.querySelector(".row__menu")).toBeNull();
});

it("我處理過的：改判審核中與已改判為通過寫在目前結果；管理員的入口跟「查看」並列，帶 ?flip=1", async () => {
  const row = (id: string, flip: Record<string, unknown>) => ({ id, status: "rejected", kind: "first", verdict: "reject", note: "", at: 2, submittedAt: 1, decidedAt: 2, versionId: "v", card: { id: "1000" + id, name: "卡" + id }, canCorrect: false, flip });
  api.fetchReviewDecisions.mockResolvedValue({ items: [row("1", { pendingId: "f1", approvedId: null, canStart: false }), row("2", { pendingId: null, approvedId: "f2", canStart: false }), row("3", { pendingId: null, approvedId: null, canStart: true })], nextCursor: null });
  await mount(DecisionsPage, "/review/decisions");
  await vi.waitFor(() => expect(el.textContent).toContain("卡3"));
  const rows = [...el.querySelectorAll("li.row")];
  expect(rows[0].textContent).toContain(t("review.history.flipPending"));
  expect(rows[1].textContent).toContain(t("review.history.flippedToApproved"));
  expect(rows[0].querySelector("[data-flip-entry]")).toBeNull();
  const entry = rows[2].querySelector("[data-flip-entry]")!;
  expect(entry.getAttribute("href")).toBe("/review/3?flip=1");
  expect(entry.textContent?.trim()).toBe(t("review.flipApprove.action"));
});

it("五種語言都有改判的字（§0.6 定稿）", async () => {
  const keys = ["review.flipApprove.action", "review.flipApprove.chip", "review.flipApprove.queueSubline", "review.flipApprove.effect3", "review.flipApprove.withdrawConfirmBody", "review.history.flipPending", "review.history.flippedToApproved"];
  for (const locale of ["zh-Hant", "en", "zh-Hans", "ja", "ko"]) {
    const messages = (await import(`../src/locales/${locale}.json`)).default as Record<string, string>;
    for (const k of keys) expect(messages[k], `${locale} ${k}`).toBeTruthy();
  }
});
