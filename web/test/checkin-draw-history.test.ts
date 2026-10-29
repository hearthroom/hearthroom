// 最近開箱的到期欄（任務 2026-10-29-expiring-credits-not-spent-first）：照這批積分實際用了多少寫，
// 不憑日期就說「已到期」——用完的寫已用完，到期還有剩的寫剩多少，其餘只寫有效日期。
import { afterEach, expect, it } from "vitest";
import { createApp, nextTick } from "vue";
import { applyLocale, i18n } from "../src/lib/i18n";
import { monthDayTime, whole } from "../src/lib/format";
import DrawHistory from "../src/components/checkin/DrawHistory.vue";
import type { DrawRecord } from "../src/lib/rewards";

const now = Date.parse("2026-10-29T10:00:00Z");
const past = "2026-10-27T04:00:00Z";
const future = "2026-11-02T04:00:00Z";
const draw = (over: Partial<DrawRecord>): DrawRecord => ({ at: "2026-10-20T01:00:00Z", rewardKind: "checkin", chest: "daily", tier: 1, credits: 240, status: "granted", ...over });
const list: DrawRecord[] = [
  draw({ expiresAt: past, unusedCredits: 0 }),
  draw({ expiresAt: past, unusedCredits: 1500 }),
  draw({ expiresAt: past, unusedCredits: 240 }),
  draw({ expiresAt: future, unusedCredits: 90 }),
  draw({ expiresAt: future, unusedCredits: 0 }),
  draw({ expiresAt: past }),
];

let app: ReturnType<typeof createApp> | undefined;
afterEach(() => app?.unmount());

it.each(["zh-Hant", "zh-Hans", "en", "ja", "ko"] as const)("%s：已用完、到期有剩、有效至，依實際剩餘決定；沒有剩餘資料時只寫日期", async (locale) => {
  await applyLocale(locale);
  const t = i18n.global.t;
  app = createApp(DrawHistory, { list, plan: null, more: false, loading: false, error: "", now }).use(i18n);
  const root = document.createElement("div");
  app.mount(root);
  root.querySelector<HTMLButtonElement>(".hist__head button")?.click();
  await nextTick();
  const rows = [...root.querySelectorAll(".hist__row")];
  expect(rows.map((r) => r.querySelector(".hist__exp")?.textContent)).toEqual([
    t("checkin.history.usedUp"),
    t("checkin.history.expiredLeft", { n: whole(1500) }),
    t("checkin.history.expiredLeft", { n: whole(240) }),
    t("checkin.history.validUntil", { datetime: monthDayTime(future) }),
    t("checkin.history.usedUp"),
    t("checkin.history.validUntil", { datetime: monthDayTime(past) }),
  ]);
  // 不能再用的（用完、到期）才變灰；只知道日期的那筆不灰，不暗示它沒被用
  expect(rows.map((r) => r.classList.contains("hist__row--off"))).toEqual([true, true, true, false, true, false]);
  expect(root.textContent).not.toMatch(/checkin\.history\./);
});
