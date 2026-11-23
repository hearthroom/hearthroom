import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, h, type App } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { i18n } from "../src/lib/i18n";
import MyCardTile from "../src/components/MyCardTile.vue";

// 重新審核（審核員 2026-11-08）：作者只看到卡正在重審、照常公開；看不到理由與發起人
let app: App | null = null;
afterEach(() => { app?.unmount(); app = null; document.body.innerHTML = ""; });

let router = createRouter({ history: createMemoryHistory(), routes: [] });
async function mount(card: Record<string, unknown>) {
  const el = document.createElement("div");
  document.body.append(el);
  router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/:p(.*)*", component: { render: () => null } }] });
  await router.push("/mine");
  app = createApp({ render: () => h(MyCardTile, { card: card as never, busy: false }) }).use(router).use(i18n);
  app.mount(el);
  return el;
}
const base = { roleId: "r1", num: 100855, name: "雨夜書店", summary: "", avatarUrl: null, zone: "zh", talkNum: 0, visibility: "", registered: true, status: "approved", note: "", rating: null };

it("a published card under re-review shows the re-review badge and that it stays public", async () => {
  const el = await mount({ ...base, reReview: true });
  expect(el.textContent).toContain(i18n.global.t("mine.badge.reReview"));
  expect(el.querySelector("[data-re-review]")?.textContent).toContain(i18n.global.t("mine.note.reReview"));
  expect(el.textContent).not.toContain(i18n.global.t("mine.badge.listed"));
});

it("without a re-review the card reads as published", async () => {
  const el = await mount(base);
  expect(el.textContent).toContain(i18n.global.t("mine.badge.listed"));
  expect(el.querySelector("[data-re-review]")).toBeNull();
});

// 作品分享開著（正式站目前是開的）：卡片狀態改由 workVisibility 顯示，重新審核中照樣要出現
const shared = { access: "public", effectiveAccess: "public", review: "approved", update: "none", everPublic: true, revisionState: "unchanged", restorable: false, draftChanged: false, restriction: "none", syncState: "complete" };
it("with work sharing on, a card under re-review still shows the badge and note", async () => {
  const el = await mount({ ...base, reReview: true, workVisibility: shared });
  // 主標照舊是公開範圍；重審是另外一個琥珀標（跟「更新審核中」同一種）
  expect(el.querySelector(".card__status--access")?.textContent).toContain(i18n.global.t("visibility.short.public"));
  const badge = el.querySelector("[data-re-review-badge]");
  expect(badge?.textContent?.trim()).toBe(i18n.global.t("mine.badge.reReview"));
  expect(badge?.classList.contains("card__status--wait")).toBe(true);
  expect(el.querySelector("[data-re-review]")?.textContent).toContain(i18n.global.t("mine.note.reReview"));
});
it("with work sharing on, a suspended card shows the suspension first", async () => {
  const el = await mount({ ...base, reReview: true, workVisibility: { ...shared, restriction: "suspended" } });
  expect(el.textContent).toContain(i18n.global.t("visibility.badge.suspended"));
});
it("with work sharing on and no re-review, the old per-status notes stay hidden", async () => {
  const el = await mount({ ...base, updateStatus: "pending", workVisibility: { ...shared, update: "pending" } });
  expect(el.textContent).not.toContain(i18n.global.t("workspace.updatePending"));
  expect(el.querySelector("[data-re-review]")).toBeNull();
});
it("shows the unread comment count linking to #comments only when newComments > 0", async () => {
  const none = await mount(base);
  expect(none.querySelector("[data-new-comments]")).toBeNull();
  const withComments = await mount({ ...base, newComments: 3 });
  const link = withComments.querySelector<HTMLAnchorElement>("[data-new-comments]");
  expect(link).not.toBeNull();
  expect(link?.getAttribute("href")).toBe("/cards/100855#comments");
  expect(link?.textContent?.trim()).toBe("3 則新評論");
});

it("uses a short cover badge and retains the full visibility explanation when authority is unavailable", async () => {
  const el = await mount({
    ...base,
    workVisibility: { ...shared, syncState: "unavailable", effectiveAccess: "unavailable" },
  });
  expect(el.querySelector(".card__status--access")?.textContent?.trim()).toBe(i18n.global.t("workspace.unknown"));
  expect(el.querySelector(".card__note")?.textContent).toContain(i18n.global.t("visibility.operation.unknown"));
  expect(el.querySelector(".card__title .sr-only")?.textContent).toContain(i18n.global.t("visibility.operation.unknown"));
});

// 點卡片進詳情要留在站內（換頁不重載）：整頁跳過去的話，按返回會把「我的卡片」整頁重開、位置也丟了（玩家 2026-11-21）
it("opening a card from my cards stays inside the app", async () => {
  const el = await mount({ ...base, newComments: 2 });
  for (const selector of [".card__link", ".card__art", "[data-new-comments]"]) {
    await router.push("/mine");
    const link = el.querySelector<HTMLAnchorElement>(selector)!;
    const click = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    link.dispatchEvent(click);
    expect(click.defaultPrevented, selector).toBe(true);
    await new Promise(r => setTimeout(r));
    expect(router.currentRoute.value.path, selector).toBe("/cards/100855");
  }
});

// 審卡 V2：駁回帶理由代碼時，卡片列說是哪幾項並連到結果頁；沒有代碼的舊駁回照舊顯示審核說明
const rejected = { ...shared, access: "private", effectiveAccess: "owner", review: "rejected", everPublic: false, actions: [] };
it("a rejection with reason codes names the reasons and links to the result page", async () => {
  const el = await mount({ ...base, status: "rejected", workVisibility: { ...rejected, reviewReasons: ["opening.too_short", "character.setting_thin"], reviewId: "s1" } });
  expect(el.querySelector(".card__note")?.textContent).toBe("未通過審核：開場太短、設定太少");
  const link = el.querySelector<HTMLAnchorElement>("[data-review-fix]");
  expect(link?.textContent?.trim()).toBe(i18n.global.t("reviewV2.author.viewFix"));
  expect(link?.getAttribute("href")).toBe("/mine/reviews/s1");
});
it("more than two reasons are summarised as the first one and a count", async () => {
  const el = await mount({ ...base, status: "rejected", workVisibility: { ...rejected, reviewReasons: ["opening.too_short", "opening.no_reply_hook", "other"], reviewId: "s1" } });
  expect(el.querySelector(".card__note")?.textContent).toBe("未通過審核：開場太短等 3 項");
});
it("a rejected update with reasons says the public version is still playable", async () => {
  const el = await mount({ ...base, workVisibility: { ...shared, update: "rejected", actions: [], reviewReasons: ["rating.mismatch"], reviewId: "s2" } });
  expect(el.querySelector(".card__note")?.textContent).toBe(i18n.global.t("reviewV2.author.mineLineUpdate", { reasons: "分級不符" }));
  expect(el.querySelector("[data-review-fix]")?.getAttribute("href")).toBe("/mine/reviews/s2");
});
it("an old rejection without reason codes keeps the reviewer note and has no result link", async () => {
  const el = await mount({ ...base, status: "rejected", workVisibility: { ...rejected, reviewNote: "開場太短", reviewReasons: [] } });
  expect(el.querySelector(".card__note")?.textContent).toBe(i18n.global.t("visibility.state.rejected", { note: "開場太短" }));
  expect(el.querySelector("[data-review-fix]")).toBeNull();
});
it("a suspension outranks the rejection reasons", async () => {
  const el = await mount({ ...base, status: "rejected", workVisibility: { ...rejected, restriction: "suspended", reviewReasons: ["other"], reviewId: "s1" } });
  expect(el.querySelector(".card__note")?.textContent).not.toContain(i18n.global.t("review.reasons.other.name"));
  expect(el.querySelector("[data-review-fix]")).toBeNull();
});
it("unknown reason codes fall back to the old wording without a result link", async () => {
  const el = await mount({ ...base, status: "rejected", workVisibility: { ...rejected, reviewNote: "", reviewReasons: ["no.such_code"], reviewId: "s1" } });
  expect(el.querySelector(".card__note")?.textContent).toBe(i18n.global.t("visibility.state.rejected", { note: "" }));
  expect(el.querySelector("[data-review-fix]")).toBeNull();
});

// 送審超過七天沒有結果：提示可以先取消送審；取消走公開範圍彈層裡既有的取消送審
describe("long-pending review", () => {
  const DAY = 86_400_000, NOW = Date.UTC(2026, 10, 23, 12);
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW); });
  afterEach(() => { vi.useRealTimers(); });
  const pending = (since: number, over: Record<string, unknown> = {}) => ({ ...shared, access: "private", effectiveAccess: "owner", review: "pending", everPublic: false, actions: ["cancel_review"], reviewSince: since, ...over });
  async function mountTile(card: Record<string, unknown>, visibilityEnabled = true) {
    const el = document.createElement("div");
    document.body.append(el);
    const toggle = vi.fn();
    router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/:p(.*)*", component: { render: () => null } }] });
    await router.push("/mine");
    app = createApp({ render: () => h(MyCardTile, { card: card as never, busy: false, visibilityEnabled, onToggle: toggle }) }).use(router).use(i18n);
    app.mount(el);
    return { el, toggle };
  }
  it("says nothing before seven days", async () => {
    const { el } = await mountTile({ ...base, status: "pending", workVisibility: pending(NOW - 6 * DAY) });
    expect(el.querySelector("[data-wait-long]")).toBeNull();
    expect(el.querySelector("[data-cancel-review]")).toBeNull();
  });
  it("exactly seven days is not yet long", async () => {
    const { el } = await mountTile({ ...base, status: "pending", workVisibility: pending(NOW - 7 * DAY) });
    expect(el.querySelector("[data-wait-long]")).toBeNull();
  });
  it("after seven days shows both lines and a cancel action that opens the visibility dialog", async () => {
    const { el, toggle } = await mountTile({ ...base, status: "pending", workVisibility: pending(NOW - 7 * DAY - 1) });
    expect(el.querySelector("[data-wait-long]")?.textContent).toBe(i18n.global.t("reviewV2.author.waitLong", { n: 7 }));
    expect(el.querySelector("[data-wait-hint]")?.textContent).toBe(i18n.global.t("reviewV2.author.waitHint"));
    const cancel = el.querySelector<HTMLButtonElement>("[data-cancel-review]")!;
    expect(cancel.textContent?.trim()).toBe(i18n.global.t("visibility.action.cancelReview"));
    cancel.click();
    expect(toggle).toHaveBeenCalledTimes(1);
  });
  it("a long-pending update gets the same lines under the update note", async () => {
    const { el } = await mountTile({ ...base, workVisibility: pending(NOW - 10 * DAY, { access: "public", effectiveAccess: "public", review: "approved", update: "pending", everPublic: true }) });
    expect(el.querySelector(".card__note")?.textContent).toBe(i18n.global.t("visibility.state.updatePending"));
    expect(el.querySelector("[data-wait-long]")).not.toBeNull();
    expect(el.querySelector("[data-cancel-review]")).not.toBeNull();
  });
  it("without the cancel action or work sharing the lines stay but there is no button", async () => {
    const noAction = await mountTile({ ...base, status: "pending", workVisibility: pending(NOW - 8 * DAY, { actions: [] }) });
    expect(noAction.el.querySelector("[data-wait-long]")).not.toBeNull();
    expect(noAction.el.querySelector("[data-cancel-review]")).toBeNull();
    app?.unmount(); app = null; document.body.innerHTML = "";
    const sharingOff = await mountTile({ ...base, status: "pending", workVisibility: pending(NOW - 8 * DAY) }, false);
    expect(sharingOff.el.querySelector("[data-wait-long]")).not.toBeNull();
    expect(sharingOff.el.querySelector("[data-cancel-review]")).toBeNull();
  });
});
