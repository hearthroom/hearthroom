/**
 * 社群審核的前端：API 送出的請求形狀，以及審核佇列頁「領取」那條路。
 * 上游與本站 API 全部換成假的；看的是請求對不對、畫面有沒有照狀態畫。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, nextTick, type App } from "vue";
import { createPinia } from "pinia";
import { createMemoryHistory, createRouter, type Router } from "vue-router";
import { i18n } from "../src/lib/i18n";

const api = vi.hoisted(() => ({
  fetchReviewQueue: vi.fn(async () => ({
    items: [
      {
        id: "s1", kind: "first", submittedAt: Date.now() - 60_000,
        card: { id: "c1", roleId: "r1", name: "夜行偵探", summary: "推理", avatarUrl: null, zone: "zh", tags: [] },
        stamps: { approve: 1, required: 2 }, claim: "free", stampedByMe: false,
      },
      {
        id: "s2", kind: "re", submittedAt: Date.now() - 120_000,
        card: { id: "c2", roleId: "r2", name: "雨城", summary: "", avatarUrl: null, zone: "zh", tags: [] },
        stamps: { approve: 0, required: 1 }, claim: "other", stampedByMe: false,
      },
    ],
    claimTtlMs: 2_700_000,
  })),
  claimReview: vi.fn(async () => ({ id: "s1", claimedAt: Date.now() })),
  releaseReview: vi.fn(async () => undefined),
  fetchReviewMe: vi.fn(async () => ({ reviewer: true })),
  ApiError: class ApiError extends Error { constructor(readonly status: number, message: string, readonly code = "") { super(message); } },
}));
vi.mock("../src/lib/api", () => api);
vi.mock("../src/lib/session", () => ({
  useSession: () => ({ accessToken: async () => "tok", me: { accountNumId: 7, nickName: "審核人", avatar: "" } }),
}));
vi.mock("../src/lib/track", () => ({ track: () => {}, currentSurface: () => "review", setSurface: () => {} }));

import ReviewQueuePage from "../src/pages/ReviewQueuePage.vue";

let app: App;
let router: Router;
let host: HTMLElement;

beforeEach(async () => {
  host = document.createElement("div");
  document.body.appendChild(host);
  router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/:pathMatch(.*)*", component: ReviewQueuePage }] });
  await router.push("/review");
  app = createApp(ReviewQueuePage).use(createPinia()).use(router).use(i18n);
  app.mount(host);
  await nextTick();
  await vi.waitFor(() => expect(host.textContent).toContain("夜行偵探"));
});
afterEach(() => {
  app.unmount();
  host.remove();
  vi.clearAllMocks();
});

describe("審核佇列頁", () => {
  it("列出待審的卡：章數、初審／重審、可不可領；不顯示作者", () => {
    const text = host.textContent ?? "";
    expect(text).toContain("1 / 2");
    expect(text).toContain("0 / 1");
    expect(text).toContain(i18n.global.t("review.kind.re"));
    expect(text).not.toContain("author");
    const buttons = [...host.querySelectorAll("button")].filter((b) => b.textContent?.trim() === i18n.global.t("review.action.claim"));
    expect(buttons).toHaveLength(2);
    // 別人領著的那張不能領
    expect(buttons[1]!.disabled).toBe(true);
    expect(buttons[0]!.disabled).toBe(false);
  });

  it("領取：打 claim，畫面改成「放回」", async () => {
    const claimBtn = [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === i18n.global.t("review.action.claim") && !b.disabled)!;
    claimBtn.click();
    await vi.waitFor(() => expect(api.claimReview).toHaveBeenCalledWith("s1", "tok"));
    await vi.waitFor(() => expect(host.textContent).toContain(i18n.global.t("review.action.release")));
  });
});
