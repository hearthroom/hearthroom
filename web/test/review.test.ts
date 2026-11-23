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
        stamps: { approve: 0, required: 1 }, claim: "other", stampedByMe: false, attempt: 2, type: "resubmit",
      },
    ],
    claimTtlMs: 2_700_000,
  })),
  claimReview: vi.fn(async () => ({ id: "s1", claimedAt: Date.now(), generation: "claim-v2" })),
  releaseReview: vi.fn(async () => undefined),
  unholdReview: vi.fn(async () => ({ hold: null })),
  fetchReviewMe: vi.fn(async () => ({ reviewer: true })),
  dropReview: vi.fn(async () => ({ caseId: "k1" })),
  restoreReview: vi.fn(async () => ({ restored: true })),
  markReviewAuthor: vi.fn(),
  fetchReviewGroup: vi.fn(async () => ({ scope: "device", items: [] })),
  dropReviewBatch: vi.fn(),
  restoreReviewBatch: vi.fn(),
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
  it("列出待審的卡：章數、送審類型、可不可領；清單不列作者", () => {
    const text = host.textContent ?? "";
    // 一章即定案：每列不再放「n / 1 人通過」（沒有資訊量）
    expect(text).not.toContain("1 / 2");
    expect(text).not.toContain("0 / 1");
    // 送審類型照伺服器判定；舊版伺服器沒帶 type 的首送照 kind 退回「首次送審」
    const typeOf = (id: string) => host.querySelector(`[data-review-row="${id}"] [data-type-chip]`)?.textContent?.trim();
    expect(typeOf("s1")).toBe(i18n.global.t("review.type.first"));
    expect(typeOf("s2")).toBe(i18n.global.t("review.type.resubmit"));
    expect(text).not.toContain("author");
    const buttons = [...host.querySelectorAll("button")].filter((b) => b.textContent?.trim() === i18n.global.t("review.action.claim"));
    expect(buttons).toHaveLength(1);
    expect(buttons[0]!.disabled).toBe(false);
    // 別人領著的那張：不能領，也不給「查看」（2026-11-02：以前點進去會撞到「請先領取」）
    const taken = host.querySelector('[data-review-row="s2"]')!;
    expect([...taken.querySelectorAll(".row__acts button")].map((b) => [b.textContent?.trim(), b.disabled])).toEqual([[i18n.global.t("review.claim.other"), true]]);
    expect(taken.querySelector("a")).toBeNull();
    // /review 是新卡清單：請求帶 tab=new
    expect(api.fetchReviewQueue).toHaveBeenCalledWith("tok", expect.any(String), "new");
  });

  it("重送的卡標出第幾次送審；首送不標", () => {
    const rows = [...host.querySelectorAll(".row")];
    const attemptOf = (name: string) => rows.find((r) => r.textContent?.includes(name))!.querySelector("[data-attempt]")?.textContent?.trim();
    expect(attemptOf("雨城")).toBe(i18n.global.t("review.attempt", { n: 2 }));
    expect(attemptOf("夜行偵探")).toBeUndefined();
  });

  it("自己領著的卡排在最上面，重送的照樣標第幾次", async () => {
    api.fetchReviewQueue.mockResolvedValueOnce({
      items: [
        { id: "f1", kind: "first", submittedAt: Date.now(), attempt: 1,
          card: { id: "c4", roleId: "r4", name: "別人的首送", summary: "", avatarUrl: null, zone: "zh", tags: [] },
          stamps: { approve: 0, required: 1 }, claim: "free", stampedByMe: false },
        { id: "m1", kind: "re", submittedAt: Date.now(), attempt: 3, type: "resubmit",
          card: { id: "c3", roleId: "r3", name: "我領的重送", summary: "", avatarUrl: null, zone: "zh", tags: [] },
          stamps: { approve: 0, required: 1 }, claim: "mine", stampedByMe: false },
      ],
      claimTtlMs: 2_700_000,
    } as any);
    [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === i18n.global.t("review.refresh"))!.click();
    await vi.waitFor(() => expect(host.textContent).toContain("我領的重送"));
    expect([...host.querySelectorAll("[data-review-row]")].map((r) => r.getAttribute("data-review-row"))).toEqual(["m1", "f1"]);
    expect(host.querySelector('[data-review-row="m1"]')!.classList.contains("row--mine")).toBe(true);
    expect(host.querySelector('[data-review-row="m1"] [data-attempt]')?.textContent?.trim()).toBe(i18n.global.t("review.attempt", { n: 3 }));
    expect(host.querySelector('[data-review-row="f1"] [data-attempt]')).toBeNull();
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

  it("世界書條目與正規表示式規則 chip：0 也標，不知道就不標", async () => {
    app.unmount();
    host.innerHTML = "";
    const base = { kind: "first", submittedAt: Date.now(), stamps: { approve: 0, required: 1 }, claim: "free", stampedByMe: false };
    const card = (id: string) => ({ id, roleId: id, name: `卡${id}`, summary: "", avatarUrl: null, zone: "zh", tags: [] });
    api.fetchReviewQueue.mockResolvedValueOnce({ items: [
      { ...base, id: "a", card: card("a"), worldbookEntries: 1240, regexRules: 0 },
      { ...base, id: "b", card: card("b"), worldbookEntries: null, regexRules: null },
    ], claimTtlMs: 1 } as any);
    app = createApp(ReviewQueuePage).use(createPinia()).use(router).use(i18n);
    app.mount(host);
    await vi.waitFor(() => expect(host.textContent).toContain("卡a"));
    const row = (id: string) => host.querySelector(`[data-review-row="${id}"]`)!;
    expect(row("a").querySelector("[data-worldbook-chip]")?.textContent?.trim()).toBe(i18n.global.t("review.queue.worldbook", { n: "1,240" }));
    expect(row("a").querySelector("[data-regex-chip]")?.textContent?.trim()).toBe(i18n.global.t("review.queue.regex", { n: "0" }));
    expect(row("b").querySelector("[data-worldbook-chip]")).toBeNull();
    expect(row("b").querySelector("[data-regex-chip]")).toBeNull();
  });

  it("冷凍中的卡：標出已冷凍與冷凍人；只能領來看；冷凍人自己能在清單上解凍", async () => {
    app.unmount();
    host.innerHTML = "";
    const base = { kind: "first", submittedAt: Date.now(), stamps: { approve: 0, required: 1 }, claim: "free", stampedByMe: false };
    const card = (id: string) => ({ id, roleId: id, name: `卡${id}`, summary: "", avatarUrl: null, zone: "zh", tags: [] });
    api.fetchReviewQueue.mockResolvedValueOnce({ items: [
      { ...base, id: "mine", card: card("mine"), hold: { holder: "審核人", at: Date.now(), byMe: true, canRelease: true } },
      { ...base, id: "theirs", card: card("theirs"), hold: { holder: "Mika", at: Date.now(), byMe: false, canRelease: false } },
      { ...base, id: "open", card: card("open"), hold: null },
      { ...base, kind: "re", id: "again", card: card("again"), hold: null, reopen: true, type: "reopen", attempt: 3 },
    ], claimTtlMs: 1 } as any);
    app = createApp(ReviewQueuePage).use(createPinia()).use(router).use(i18n);
    app.mount(host);
    await vi.waitFor(() => expect(host.textContent).toContain("卡mine"));
    const row = (id: string) => host.querySelector(`[data-review-row="${id}"]`)!;
    const t = (k: string, p?: Record<string, unknown>) => i18n.global.t(k, p ?? {});
    expect(row("theirs").querySelector("[data-hold-chip]")?.textContent?.trim()).toBe(t("review.hold.chip"));
    expect(row("theirs").querySelector("[data-hold-by]")?.textContent).toContain(t("review.hold.by", { name: "Mika" }));
    expect(row("mine").querySelector("[data-hold-by]")?.textContent).toContain(t("review.hold.byMe"));
    expect(row("open").querySelector("[data-hold-chip]")).toBeNull();
    expect(row("open").querySelector("[data-reopen-chip]")).toBeNull();
    expect(row("theirs").querySelector("button")?.textContent?.trim()).toBe(t("review.action.claimHeld"));
    expect(row("open").querySelector("button")?.textContent?.trim()).toBe(t("review.action.claim"));
    expect(row("theirs").querySelector("[data-unhold]")).toBeNull();
    // 重新審核：已發布的卡被拿回來重審，清單上要分得出來
    expect(row("again").querySelector("[data-reopen-chip]")?.textContent?.trim()).toBe(t("review.reopen.chip"));
    // 重新審核取代類型 chip（不再兩顆並列），也不標第幾次送審
    expect(row("again").querySelectorAll("[data-type-chip]")).toHaveLength(1);
    expect(row("again").querySelector("[data-attempt]")).toBeNull();
    (row("mine").querySelector("[data-unhold]") as HTMLButtonElement).click();
    await vi.waitFor(() => expect(api.unholdReview).toHaveBeenCalledWith("mine", "tok"));
    await vi.waitFor(() => expect(row("mine").querySelector("[data-hold-chip]")).toBeNull());
  });
});

describe("審卡 V2 佇列：新卡／更新、不受理、作者標記", () => {
  const t = (k: string, p?: Record<string, unknown>, n?: number) => (n === undefined ? i18n.global.t(k, p ?? {}) : i18n.global.t(k, p ?? {}, n));
  const card = (id: string, name = `卡${id}`) => ({ id, roleId: id, name, summary: "", avatarUrl: null, zone: "zh", tags: [] });
  const item = (id: string, extra: Record<string, unknown> = {}) => ({ id, kind: "first", submittedAt: Date.now(), stamps: { approve: 0, required: 1 }, claim: "free", stampedByMe: false, card: card(id), ...extra });
  async function remountQueue(result: unknown, path = "/review") {
    app.unmount();
    host.innerHTML = "";
    api.fetchReviewQueue.mockResolvedValueOnce(result as any);
    router = createRouter({ history: createMemoryHistory(), routes: [
      { path: "/review", component: ReviewQueuePage },
      { path: "/review/updates", component: ReviewQueuePage, meta: { reviewTab: "updates" } },
      { path: "/:pathMatch(.*)*", component: { template: "<p />" } },
    ] });
    await router.push(path);
    app = createApp({ template: "<router-view />" }).use(createPinia()).use(router).use(i18n);
    app.mount(host);
  }
  const tabText = (id: string) => host.querySelector(`[data-review-tab="${id}"]`)?.textContent?.trim();

  it("/review/updates 讀的是更新那一頁；頁籤跟著標", async () => {
    api.fetchReviewQueue.mockClear();
    await remountQueue({ items: [item("u1", { kind: "re", type: "update" })], claimTtlMs: 1, counts: { new: 4, updates: 1, dropped: 0 } }, "/review/updates");
    await vi.waitFor(() => expect(host.textContent).toContain("卡u1"));
    expect(api.fetchReviewQueue).toHaveBeenCalledTimes(1);
    expect(api.fetchReviewQueue).toHaveBeenCalledWith("tok", expect.any(String), "updates");
    expect(host.querySelector('[data-review-tab="updates"]')?.getAttribute("aria-current")).toBe("page");
    expect(host.querySelector('[data-review-tab="new"]')?.getAttribute("aria-current")).toBeNull();
  });

  it("頁籤：伺服器給了數字就標數字；還不知道只寫名稱，不寫 0", async () => {
    // beforeEach 的清單沒帶 counts
    expect(tabText("new")).toBe(t("reviewV2.tabs.newNoCount"));
    expect(tabText("updates")).toBe(t("reviewV2.tabs.updatesNoCount"));
    expect(tabText("dropped")).toBe(t("reviewV2.tabs.droppedNoCount"));
    expect(tabText("history")).toBe(t("review.history.title"));
    await remountQueue({ items: [item("a")], claimTtlMs: 1, counts: { new: 5, updates: 2, dropped: 0 } });
    await vi.waitFor(() => expect(host.textContent).toContain("卡a"));
    expect(tabText("new")).toBe(t("reviewV2.tabs.new", { n: 5 }));
    expect(tabText("updates")).toBe(t("reviewV2.tabs.updates", { n: 2 }));
    expect(tabText("dropped")).toBe(t("reviewV2.tabs.dropped", { n: 0 }));
    expect(host.querySelector('[data-review-tab="new"]')?.getAttribute("aria-current")).toBe("page");
  });

  it("⋯ 選單不受理：不必領取、不跳確認；提示可以復原，復原後重讀清單", async () => {
    await remountQueue({ items: [item("a", { card: card("a", "夜行偵探") }), item("b")], claimTtlMs: 1, counts: { new: 2, updates: 0, dropped: 0 } });
    await vi.waitFor(() => expect(host.textContent).toContain("夜行偵探"));
    const row = host.querySelector('[data-review-row="a"]')!;
    const trigger = row.querySelector<HTMLButtonElement>("[data-row-menu]")!;
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    trigger.click();
    await vi.waitFor(() => expect(row.querySelector("[data-menu-drop]")).toBeTruthy());
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    row.querySelector<HTMLButtonElement>("[data-menu-drop]")!.click();
    await vi.waitFor(() => expect(api.dropReview).toHaveBeenCalledWith("a", "tok"));
    expect(api.claimReview).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(host.querySelector('[data-review-row="a"]')).toBeNull());
    expect(host.querySelector('[data-review-row="b"]')).toBeTruthy();
    expect(tabText("new")).toBe(t("reviewV2.tabs.new", { n: 1 }));
    expect(tabText("dropped")).toBe(t("reviewV2.tabs.dropped", { n: 1 }));
    const toast = host.querySelector(".action-toast")!;
    expect(toast.textContent).toContain(t("reviewV2.toast.dropped", { card: "夜行偵探" }));
    const undo = toast.querySelector<HTMLButtonElement>("[data-toast-action]")!;
    expect(undo.textContent?.trim()).toBe(t("reviewV2.toast.undo"));
    const reads = api.fetchReviewQueue.mock.calls.length;
    api.fetchReviewQueue.mockResolvedValueOnce({ items: [item("a", { card: card("a", "夜行偵探") }), item("b")], claimTtlMs: 1, counts: { new: 2, updates: 0, dropped: 0 } } as any);
    undo.click();
    await vi.waitFor(() => expect(api.restoreReview).toHaveBeenCalledWith("a", "tok"));
    await vi.waitFor(() => expect(host.querySelector(".action-toast")?.textContent).toContain(t("reviewV2.toast.restored", { card: "夜行偵探" })));
    await vi.waitFor(() => expect(host.querySelector('[data-review-row="a"]')).toBeTruthy());
    expect(api.fetchReviewQueue.mock.calls.length).toBe(reads + 1);
  });

  it("別人領著、冷凍中的卡不能不受理，選項寫原因；重新審核單沒有 ⋯", async () => {
    await remountQueue({ items: [
      item("taken", { claim: "other" }),
      item("held", { hold: { holder: "Mika", at: Date.now(), byMe: false, canRelease: false } }),
      item("again", { kind: "re", reopen: true, type: "reopen" }),
    ], claimTtlMs: 1 });
    await vi.waitFor(() => expect(host.textContent).toContain("卡taken"));
    const open = async (id: string) => {
      const row = host.querySelector(`[data-review-row="${id}"]`)!;
      row.querySelector<HTMLButtonElement>("[data-row-menu]")!.click();
      return vi.waitFor(() => { const b = row.querySelector<HTMLButtonElement>("[data-menu-drop]"); expect(b).toBeTruthy(); return b!; });
    };
    const taken = await open("taken");
    expect(taken.disabled).toBe(true);
    expect(taken.textContent).toContain(t("reviewV2.menu.claimedByOther"));
    const held = await open("held");
    expect(held.disabled).toBe(true);
    expect(held.textContent).toContain(t("reviewV2.menu.held"));
    expect(host.querySelector('[data-review-row="again"] [data-row-menu]')).toBeNull();
    expect(api.dropReview).not.toHaveBeenCalled();
  });

  it("作者標記只標分類與計數，不帶作者身分；快速審與不受理後重送也標出來", async () => {
    await remountQueue({ items: [
      item("n", { authorMark: { tier: "new", manualTier: false, batchSuspected: true, deviceAccounts: 3 }, afterDrop: true,
        author: { name: "月光作者", handle: "moonwriter", accountNumId: 98765 }, authorName: "月光作者", accountNumId: 98765 }),
      item("top", { authorMark: { tier: "top", manualTier: false, batchSuspected: false, deviceAccounts: null }, fast: true }),
      item("g", { authorMark: { tier: "general", manualTier: false, batchSuspected: false, deviceAccounts: null } }),
    ], claimTtlMs: 1 });
    await vi.waitFor(() => expect(host.textContent).toContain("卡n"));
    const row = (id: string) => host.querySelector(`[data-review-row="${id}"]`)!;
    expect(row("n").querySelector("[data-author-mark]")?.textContent?.trim()).toBe(t("reviewV2.mark.tier.new"));
    const batch = row("n").querySelector("[data-batch-flag]")!.textContent!;
    expect(batch).toContain(t("reviewV2.mark.batch"));
    expect(batch).toContain(t("reviewV2.mark.deviceAccounts", { n: 3 }, 3));
    expect(row("n").querySelector("[data-after-drop]")?.textContent?.trim()).toBe(t("reviewV2.queue.afterDrop"));
    expect(row("n").querySelector("[data-fast-chip]")).toBeNull();
    expect(row("top").querySelector("[data-author-mark]")?.textContent?.trim()).toBe(t("reviewV2.mark.tier.top"));
    expect(row("top").querySelector("[data-fast-chip]")?.textContent?.trim()).toBe(t("reviewV2.fast.chip"));
    expect(row("top").querySelector("[data-batch-flag]")).toBeNull();
    // 一般作者不標
    expect(row("g").querySelector("[data-author-mark]")).toBeNull();
    // 清單上沒有作者身分：名稱、代號、帳號都不出現
    const html = host.innerHTML;
    expect(html).not.toContain("月光作者");
    expect(html).not.toContain("moonwriter");
    expect(html).not.toContain("98765");
  });

  it("更新列帶改動摘要：有改的才寫；還沒算好不寫；沒有基準或讀不到寫無法比較", async () => {
    const sum = (o: Record<string, unknown> = {}) => ({ changedFields: ["setting", "opening"], setting: { charsAdded: 86, charsRemoved: 0 }, opening: { changed: true, charsBefore: 1, charsAfter: 2 },
      worldbook: { added: 0, removed: 0, modified: 0 }, rules: { added: 0, removed: 0, modified: 0 }, tags: { added: 0, removed: 0 }, totalChanged: 90, unchanged: false, ...o });
    await remountQueue({ items: [
      item("done", { kind: "re", type: "update", diff: { state: "done", summary: sum() } }),
      item("name", { kind: "re", type: "update", diff: { state: "done", summary: sum({ changedFields: ["name"], setting: { charsAdded: 0, charsRemoved: 0 }, opening: { changed: false, charsBefore: 1, charsAfter: 1 }, totalChanged: 4 }) } }),
      item("same", { kind: "re", type: "update", diff: { state: "done", summary: sum({ changedFields: [], setting: { charsAdded: 0, charsRemoved: 0 }, opening: { changed: false, charsBefore: 1, charsAfter: 1 }, totalChanged: 0, unchanged: true }) } }),
      item("pending", { kind: "re", type: "update", diff: { state: "pending", summary: null } }),
      item("nobase", { kind: "re", type: "resubmit", diff: { state: "no_base", summary: null } }),
      item("lost", { kind: "re", type: "update", diff: { state: "unreadable", summary: null } }),
      item("old", { kind: "re", type: "reopen", reopen: true, diff: null }),
    ], claimTtlMs: 1, counts: { new: 0, updates: 7, dropped: 0 } }, "/review/updates");
    await vi.waitFor(() => expect(host.textContent).toContain("卡done"));
    const line = (id: string) => host.querySelector(`[data-review-row="${id}"] [data-diff-summary]`)?.textContent?.trim();
    expect(line("done")).toBe(`${t("reviewV2.diff.chip.setting", { a: "86", d: "0" })} · ${t("reviewV2.diff.chip.opening")}`);
    expect(line("name")).toBe(t("reviewV2.diff.total", { n: "4" }, 4));
    expect(line("same")).toBe(t("reviewV2.diff.queue.unchanged"));
    expect(line("pending")).toBeUndefined();
    expect(line("nobase")).toBe(t("reviewV2.diff.queue.uncomparable"));
    expect(line("lost")).toBe(t("reviewV2.diff.queue.uncomparable"));
    expect(line("old")).toBeUndefined();
  });

  it("管理員收到疑似大量送審的提示；沒有就不顯示", async () => {
    expect(host.querySelector("[data-batch-banner]")).toBeNull();
    await remountQueue({ items: [item("a")], claimTtlMs: 1, batchGroups: [{ scope: "device", anchorId: "a", count: 3 }, { scope: "device", anchorId: "z", count: 2 }] });
    await vi.waitFor(() => expect(host.querySelector("[data-batch-banner]")).toBeTruthy());
    const banner = host.querySelector("[data-batch-banner]")!;
    expect(banner.textContent).toContain(t("reviewV2.batch.banner", { groups: 2, n: 5 }));
    expect(banner.querySelector("button")?.textContent?.trim()).toBe(t("reviewV2.batch.view"));
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
