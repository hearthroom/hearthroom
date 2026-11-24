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

// 分級下限（管理員更正分級，2026-11-24）：低於下限的選項停用、結果不低於下限、永遠送得出去
it("shows no floor chip or disabled options when the card has no floor", async () => {
  void askRating(null);
  await tick();
  expect($("[data-rating-floor]")).toBeNull();
  await click('[data-topic="violence"]');
  await click("[data-next]");
  expect($("[data-below-floor]")).toBeNull();
  expect($<HTMLInputElement>('[data-option="violence.cartoon"]')?.disabled).toBe(false);
});

it("disables options below the floor and labels them in words", async () => {
  void askRating(null, "PG15");
  await tick();
  expect($("[data-rating-floor]")?.textContent).toBe("分級下限：輔15級");
  await click('[data-topic="violence"]');
  await click("[data-next]");
  const cartoon = $<HTMLInputElement>('[data-option="violence.cartoon"]')!;
  expect(cartoon.disabled).toBe(true);
  expect(cartoon.closest("label")?.getAttribute("aria-disabled")).toBe("true");
  expect(cartoon.closest("label")?.textContent).toContain("低於分級下限");
  expect($<HTMLInputElement>('[data-option="violence.fighting"]')?.disabled).toBe(true);
  expect($<HTMLInputElement>('[data-option="violence.bloody"]')?.disabled).toBe(false);
  // 點停用的選項不會選上，下一步照樣說缺什麼
  cartoon.closest("label")!.click(); await tick();
  expect(cartoon.checked).toBe(false);
  await click("[data-next]");
  expect($("[data-rating-dialog] [role=alert]")?.textContent).toBe(i18n.global.t("rating.missingOption"));
});

it("can always be submitted with an adult floor, even for types whose options are all below it", async () => {
  const result = askRating(null, "R");
  await tick();
  await click('[data-topic="tobacco_alcohol"]');
  await click('[data-topic="drugs"]');
  await click("[data-next]");
  // 菸酒只有輔15級一項：整類低於下限，不列選項、不必作答（UI 稿 v14）
  expect($('[data-option="tobacco_alcohol.shown"]')).toBeNull();
  expect($("[data-topic-na]")?.textContent).toBe("這一類都低於分級下限，不必選擇");
  // 毒品還有限制級那一項可選，沒選就說缺什麼
  await click("[data-next]");
  expect($("[data-rating-dialog] [role=alert]")?.textContent).toBe(i18n.global.t("rating.missingOption"));
  expect($<HTMLInputElement>('[data-option="drugs.mentioned"]')?.disabled).toBe(true);
  await click('[data-option="drugs.use"]');
  await click("[data-next]");
  // 其他影響只剩限制級那一項能選
  const enabled = [...document.querySelectorAll<HTMLInputElement>('input[name="rating-other"]')].filter((x) => !x.disabled).map((x) => x.value);
  expect(enabled).toEqual(["other.under18"]);
  await click('[data-option="other.under18"]');
  await click("[data-next]");
  expect($<HTMLImageElement>("[data-rating-mark] img")?.getAttribute("src")).toBe("/rating/gsrr-R.png");
  expect($("[data-by-floor]")).toBeNull();
  await click("[data-confirm]");
  // 菸酒雖不必選，仍照勾的送出，卡片的情節標籤才不會不見
  expect(await result).toEqual({ version: 1, topics: { tobacco_alcohol: "tobacco_alcohol.shown", drugs: "drugs.use" }, other: "other.under18" });
});

it("passes the next step when every ticked type is entirely below the floor", async () => {
  const result = askRating(null, "R");
  await tick();
  await click('[data-topic="romance"]');
  await click("[data-next]");
  expect($("[data-topic-na]")).not.toBeNull();
  await click("[data-next]");
  await click('[data-option="other.under18"]');
  await click("[data-next]");
  await click("[data-confirm]");
  expect(await result).toEqual({ version: 1, topics: { romance: "romance.dating" }, other: "other.under18" });
});

it("shows the floor as the result when earlier answers rate lower, and still confirms them", async () => {
  const result = askRating({ version: 1, topics: {}, other: "other.none" }, "R");
  await tick();
  expect($<HTMLImageElement>("[data-rating-mark] img")?.getAttribute("src")).toBe("/rating/gsrr-R.png");
  expect($("[data-rating-mark] strong")?.textContent).toBe("限制級");
  expect($("[data-by-floor]")?.textContent).toBe("依分級下限");
  expect($("[data-floor-note]")?.textContent).toBe("你選了「以上皆無」，結果不會低於分級下限。");
  expect($<HTMLButtonElement>("[data-confirm]")?.disabled).toBe(false);
  await click("[data-confirm]");
  // 送的是作者的答案；分級由伺服器套用下限
  expect(await result).toEqual({ version: 1, topics: {}, other: "other.none" });
});

it("result equals the higher of the questionnaire and the floor", async () => {
  void askRating({ version: 1, topics: { sex: "sex.explicit" }, other: "other.none" }, "PG12");
  await tick();
  expect($<HTMLImageElement>("[data-rating-mark] img")?.getAttribute("src")).toBe("/rating/gsrr-R.png");
  expect($("[data-by-floor]")).toBeNull();
  expect($("[data-floor-note]")).toBeNull();
});
