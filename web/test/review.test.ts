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
        stamps: { approve: 0, required: 1 }, claim: "other", stampedByMe: false, attempt: 2,
      },
    ],
    claimTtlMs: 2_700_000,
  })),
  claimReview: vi.fn(async () => ({ id: "s1", claimedAt: Date.now(), generation: "claim-v2" })),
  releaseReview: vi.fn(async () => undefined),
  fetchReviewMe: vi.fn(async () => ({ reviewer: true })),
  ApiError: class ApiError extends Error { constructor(readonly status: number, message: string, readonly code = "") { super(message); } },
}));
vi.mock("../src/lib/api", () => api);
vi.mock("../src/lib/session", () => ({
  useSession: () => ({ displayName:"社區暱稱",avatarUrl:"", accessToken: async () => "tok", me: { accountNumId: 7, nickName: "審核人", avatar: "" } }),
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
    expect(buttons).toHaveLength(1);
    expect(buttons[0]!.disabled).toBe(false);
    // 別人領著的那張：不能領，也不給「查看」（2026-11-02：以前點進去會撞到「請先領取」）
    const taken = host.querySelector('[data-review-row="s2"]')!;
    expect([...taken.querySelectorAll("button")].map((b) => [b.textContent?.trim(), b.disabled])).toEqual([[i18n.global.t("review.claim.other"), true]]);
    expect(taken.querySelector("a")).toBeNull();
  });

  it("重送的卡標出第幾次送審；首送不標；可以只看重送", async () => {
    const rows = [...host.querySelectorAll(".row")];
    const attemptOf = (name: string) => rows.find((r) => r.textContent?.includes(name))!.querySelector("[data-attempt]")?.textContent?.trim();
    expect(attemptOf("雨城")).toBe(i18n.global.t("review.attempt", { n: 2 }));
    expect(attemptOf("夜行偵探")).toBeUndefined();
    [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === i18n.global.t("review.filter.resubmitted"))!.click();
    await nextTick();
    expect(host.textContent).toContain("雨城");
    expect(host.textContent).not.toContain("夜行偵探");
    [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === i18n.global.t("review.filter.all"))!.click();
    await nextTick();
    expect(host.textContent).toContain("夜行偵探");
  });

  it("只看重送時，自己領著的首送卡仍然留著；沒有別的重送卡時說明沒有", async () => {
    api.fetchReviewQueue.mockResolvedValueOnce({
      items: [
        { id: "m1", kind: "first", submittedAt: Date.now(), attempt: 1,
          card: { id: "c3", roleId: "r3", name: "我領的首送", summary: "", avatarUrl: null, zone: "zh", tags: [] },
          stamps: { approve: 0, required: 1 }, claim: "mine", stampedByMe: false },
        { id: "f1", kind: "first", submittedAt: Date.now(), attempt: 1,
          card: { id: "c4", roleId: "r4", name: "別人的首送", summary: "", avatarUrl: null, zone: "zh", tags: [] },
          stamps: { approve: 0, required: 1 }, claim: "free", stampedByMe: false },
      ],
      claimTtlMs: 2_700_000,
    } as any);
    [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === i18n.global.t("review.refresh"))!.click();
    await vi.waitFor(() => expect(host.textContent).toContain("我領的首送"));
    [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === i18n.global.t("review.filter.resubmitted"))!.click();
    await nextTick();
    expect(host.textContent).toContain("我領的首送");
    expect(host.textContent).not.toContain("別人的首送");
    expect(host.textContent).toContain(i18n.global.t("review.filter.empty"));
  });

  it("佇列讀取失敗：只說讀不到，不說佇列是空的；重新整理成功後清單回來", async () => {
    app.unmount();
    host.innerHTML = "";
    api.fetchReviewQueue.mockRejectedValueOnce(new api.ApiError(500, "服務暫時無法回應，請稍後再試"));
    app = createApp(ReviewQueuePage).use(createPinia()).use(router).use(i18n);
    app.mount(host);
    await vi.waitFor(() => expect(host.textContent).toContain("服務暫時無法回應"));
    expect(host.textContent).not.toContain(i18n.global.t("review.empty"));
    [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === i18n.global.t("review.refresh"))!.click();
    await vi.waitFor(() => expect(host.textContent).toContain("夜行偵探"));
    expect(host.textContent).not.toContain("服務暫時無法回應");
  });

  it("領取並開始審：送出中整排按鈕都不能按，領到才進詳情", async () => {
    let finish!: (v: { id: string; claimedAt: number; generation: string }) => void;
    api.claimReview.mockImplementationOnce(() => new Promise((r) => { finish = r; }));
    const claimBtn = [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === i18n.global.t("review.action.claim"))!;
    claimBtn.click();
    await vi.waitFor(() => expect(claimBtn.textContent?.trim()).toBe(i18n.global.t("review.action.claiming")));
    expect(claimBtn.disabled).toBe(true);
    expect(router.currentRoute.value.path).toBe("/review");
    finish({ id: "s1", claimedAt: Date.now(), generation: "claim-v2" });
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe("/review/s1"));
    expect(api.claimReview).toHaveBeenCalledTimes(1);
  });

  it("被別人先領走：留在清單，那一列改成有人在看並說明", async () => {
    api.claimReview.mockRejectedValueOnce(new api.ApiError(409, "x", "claimed by another reviewer"));
    [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === i18n.global.t("review.action.claim"))!.click();
    await vi.waitFor(() => expect(host.querySelector('[data-review-row="s1"]')?.textContent).toContain(i18n.global.t("review.claim.taken")));
    expect(router.currentRoute.value.path).toBe("/review");
  });

  it("沒領成（其他錯誤）：留在清單說明，按鈕可以再按", async () => {
    api.claimReview.mockRejectedValueOnce(new api.ApiError(500, "x"));
    const claimBtn = [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === i18n.global.t("review.action.claim"))!;
    claimBtn.click();
    await vi.waitFor(() => expect(host.querySelector('[data-review-row="s1"]')?.textContent).toContain(i18n.global.t("review.claim.failed")));
    expect(claimBtn.disabled).toBe(false);
    expect(router.currentRoute.value.path).toBe("/review");
  });

  it("我領著的卡：繼續審進詳情；放回使用該次認領的 generation", async () => {
    app.unmount();
    host.innerHTML = "";
    api.fetchReviewQueue.mockResolvedValueOnce({ items: [{
      id: "s3", kind: "first", submittedAt: Date.now(), card: { id: "c3", roleId: "r3", name: "海港", summary: "", avatarUrl: null, zone: "zh", tags: [] },
      stamps: { approve: 0, required: 1 }, claim: "mine", stampedByMe: false, claimGeneration: "claim-v3",
    }], claimTtlMs: 1 } as any);
    app = createApp(ReviewQueuePage).use(createPinia()).use(router).use(i18n);
    app.mount(host);
    await vi.waitFor(() => expect(host.textContent).toContain("海港"));
    const row = host.querySelector('[data-review-row="s3"]')!;
    expect(row.querySelector("a")?.textContent?.trim()).toBe(i18n.global.t("review.action.continue"));
    [...row.querySelectorAll("button")].find((b) => b.textContent?.trim() === i18n.global.t("review.action.release"))!.click();
    await vi.waitFor(() => expect(api.releaseReview).toHaveBeenCalledWith("s3", "tok", "claim-v3"));
  });

  it("字數 chip：未達標標出差額，達標只標字數，算不出來不標", async () => {
    app.unmount();
    host.innerHTML = "";
    const base = { kind: "first", submittedAt: Date.now(), stamps: { approve: 0, required: 1 }, claim: "free", stampedByMe: false };
    const card = (id: string) => ({ id, roleId: id, name: `卡${id}`, summary: "", avatarUrl: null, zone: "zh", tags: [] });
    api.fetchReviewQueue.mockResolvedValueOnce({ items: [
      { ...base, id: "a", card: card("a"), reviewLength: { total: 3000, required: 3001, remaining: 1, eligible: false } },
      { ...base, id: "b", card: card("b"), reviewLength: { total: 4120, required: 3001, remaining: 0, eligible: true } },
      { ...base, id: "c", card: card("c"), reviewLength: null },
    ], claimTtlMs: 1 } as any);
    app = createApp(ReviewQueuePage).use(createPinia()).use(router).use(i18n);
    app.mount(host);
    await vi.waitFor(() => expect(host.textContent).toContain("卡a"));
    const chip = (id: string) => host.querySelector(`[data-review-row="${id}"] [data-length-chip]`);
    expect(chip("a")?.textContent?.trim()).toBe(i18n.global.t("review.queue.length.short", { total: "3,000", gap: "1" }));
    expect(chip("a")?.classList.contains("chip--short")).toBe(true);
    expect(chip("b")?.textContent?.trim()).toBe(i18n.global.t("review.queue.length.ok", { total: "4,120" }));
    expect(chip("c")).toBeNull();
  });
});

/**
 * 窄螢幕把頁首那排導覽整排藏起來，帳號選單是手機上唯一的路——「審核」入口在這裡也要有一份，
 * 而且只給審核人看。
 */
import AccountMenu from "../src/components/AccountMenu.vue";

async function mountMenu(): Promise<{ el: HTMLElement; unmount: () => void }> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const r = createRouter({ history: createMemoryHistory(), routes: [{ path: "/:pathMatch(.*)*", component: { template: "<div />" } }] });
  await r.push("/");
  const a = createApp(AccountMenu).use(createPinia()).use(r).use(i18n);
  a.mount(el);
  await nextTick();
  el.querySelector<HTMLButtonElement>("button.acct__btn")!.click();
  await nextTick();
  return { el, unmount: () => { a.unmount(); el.remove(); } };
}

describe("帳號選單", () => {
  it("審核人看得到「審核」入口", async () => {
    const { el, unmount } = await mountMenu();
    // 假登入者的暱稱「審核人」本身就含「審核」兩字，看文字會誤判，看連結才準
    await vi.waitFor(() => expect(el.querySelector('a[href*="/review"]')).not.toBeNull());
    expect(el.querySelector('a[href*="/review"]')!.textContent?.trim()).toBe(i18n.global.t("nav.review"));
    unmount();
  });

  it("不是審核人就沒有那一項", async () => {
    api.fetchReviewMe.mockResolvedValueOnce({ reviewer: false });
    const { el, unmount } = await mountMenu();
    await vi.waitFor(() => expect(api.fetchReviewMe).toHaveBeenCalled());
    await nextTick();
    expect(el.querySelector('a[href*="/mine"]')).not.toBeNull();
    expect(el.querySelector('a[href*="/review"]')).toBeNull();
    unmount();
  });
});

describe("對話示例的入庫格式", () => {
  it("上游存的是 JSON 字串，審核頁拆成一輪一輪；解不開就回空讓頁面原樣呈現", async () => {
    const { readTalkExample } = await import("../src/lib/role-draft");
    expect(readTalkExample('[{"roleType":"user","content":"你好"},{"roleType":"ai","content":"嗯。"}]')).toEqual([
      { roleType: "user", content: "你好" },
      { roleType: "ai", content: "嗯。" },
    ]);
    expect(readTalkExample("not json")).toEqual([]);
    expect(readTalkExample("")).toEqual([]);
  });
});

describe("標籤的入庫格式", () => {
  it("上游存的是物件陣列的 JSON 字串：拆出文字；純文字才按逗號切", async () => {
    const { readTags } = await import("../src/lib/role-draft");
    expect(readTags('[{"icon":"","text":"SAO","type":2},{"icon":"","text":"刀剑神域","type":2}]')).toEqual(["SAO", "刀剑神域"]);
    expect(readTags([{ text: "a" }, "b", { tagName: "c" }])).toEqual(["a", "b", "c"]);
    expect(readTags("推理, 民國")).toEqual(["推理", "民國"]);
    expect(readTags("")).toEqual([]);
  });
});
