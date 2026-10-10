// 分級作者自評問卷（owner 2026-10-10）：先複選會出現哪些內容，再逐類選最接近且不低於的一項，最後問其他影響。
import { afterEach, beforeEach, expect, it } from "vitest";
import { createApp, nextTick, type App } from "vue";
import { i18n } from "../src/lib/i18n";
import RatingDialog from "../src/components/RatingDialog.vue";
import { askRating, ratingState } from "../src/lib/rating";

let app: App; let root: HTMLElement;
const tick = async () => { for (let i = 0; i < 5; i++) await nextTick(); };
const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel);
const click = async (sel: string) => { $<HTMLElement>(sel)!.click(); await tick(); };
beforeEach(() => { ratingState.current = null; root = document.createElement("div"); document.body.append(root); app = createApp(RatingDialog).use(i18n); app.mount(root); });
afterEach(() => { app.unmount(); root.remove(); document.body.innerHTML = ""; });

it("walks through the types the author ticked and returns the answers with the computed rating shown", async () => {
  const result = askRating(null);
  await tick();
  // 什麼都沒勾就按下一步：說清楚缺什麼
  await click("[data-next]");
  expect($("[data-rating-dialog] [role=alert]")?.textContent).toBe(i18n.global.t("rating.missingPick"));
  await click('[data-topic="violence"]');
  await click('[data-topic="romance"]');
  await click("[data-next]");
  // 只有一個選項的戀愛交友勾了就選好；暴力還沒選，下一步會說缺什麼
  expect($<HTMLInputElement>('[data-option="romance.dating"]')?.checked).toBe(true);
  await click("[data-next]");
  expect($("[data-rating-dialog] [role=alert]")?.textContent).toBe(i18n.global.t("rating.missingOption"));
  await click('[data-option="violence.bloody"]');
  await click("[data-next]");
  await click('[data-option="other.none"]');
  await click("[data-next]");
  expect($<HTMLImageElement>("[data-rating-mark] img")?.getAttribute("src")).toBe("/rating/gsrr-PG15.png");
  expect($("[data-rating-mark]")?.textContent).toContain("暴力");
  await click("[data-confirm]");
  expect(await result).toEqual({ version: 1, topics: { violence: "violence.bloody", romance: "romance.dating" }, other: "other.none" });
  expect($("[data-rating-dialog]")).toBeNull();
});

it("skips the detail step when the author says none of these apply", async () => {
  const result = askRating(null);
  await tick();
  await click('[data-topic="none"]');
  await click("[data-next]");
  await click('[data-option="other.none"]');
  await click("[data-next]");
  expect($<HTMLImageElement>("[data-rating-mark] img")?.getAttribute("src")).toBe("/rating/gsrr-G.png");
  await click("[data-confirm]");
  expect(await result).toEqual({ version: 1, topics: {}, other: "other.none" });
});

it("opens on the result when earlier answers exist, and closing returns nothing", async () => {
  const result = askRating({ version: 1, topics: { sex: "sex.explicit" }, other: "other.none" });
  await tick();
  expect($<HTMLImageElement>("[data-rating-mark] img")?.getAttribute("src")).toBe("/rating/gsrr-R.png");
  await click("[data-cancel], [data-back]");
  // 結果頁的左鍵是修改答案：回到第一題，原本的勾選還在
  expect($<HTMLInputElement>('[data-topic="sex"]')?.checked).toBe(true);
  await click("[data-cancel]");
  expect(await result).toBeNull();
});

it("ignores answers from an older questionnaire and starts over", async () => {
  void askRating({ version: 0, topics: {}, other: "other.none" } as never);
  await tick();
  expect($('[data-topic="none"]')).not.toBeNull();
  expect($("[data-rating-mark]")).toBeNull();
});
