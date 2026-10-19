// 新手七日的入口等首次導覽走完再出來；首次導覽根本不會出現的（沒有入門卡的語言、
// 超過新用戶天數才換新裝置），就不必等，不然永遠看不到新手七日（QA ⚠️15）。
import { beforeEach, expect, it } from "vitest";
import { finishTour, firstTourPending, NEW_MEMBER_DAYS } from "../src/lib/onboarding";

const now = Date.UTC(2026, 9, 19);
beforeEach(() => localStorage.clear());

it("waits for the first tour where one will run", () => {
  expect(firstTourPending("zh-Hant", now - 86_400_000, now)).toBe(true);
  finishTour();
  expect(firstTourPending("zh-Hant", now - 86_400_000, now)).toBe(false);
});

it("does not wait in languages without a starter card", () => {
  for (const l of ["en", "ja", "ko"]) expect(firstTourPending(l, now - 86_400_000, now)).toBe(false);
});

it("does not wait for members past the first-tour window", () => {
  expect(firstTourPending("zh-Hant", now - (NEW_MEMBER_DAYS + 1) * 86_400_000, now)).toBe(false);
  expect(firstTourPending("zh-Hant", undefined, now)).toBe(false);
});
