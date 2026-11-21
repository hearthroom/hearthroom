import { afterEach, expect, it } from "vitest";
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
