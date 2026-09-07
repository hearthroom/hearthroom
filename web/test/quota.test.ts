import { describe, expect, it } from "vitest";
import { daysUntilReset, remaining, weekRange } from "../src/lib/quota";

const mon = Date.UTC(2026, 8, 7); // 2026-09-07 週一
const q = { limit: 3, used: 1, weekStart: mon, weekEnd: mon + 7 * 86400000 };

describe("每週額度的顯示", () => {
  it("起訖日：週一到週日，用讀者的語言格式", () => {
    expect(weekRange(q, "en")).toEqual({ start: "9/7", end: "9/13" });
    expect(weekRange(q, "zh-Hant")).toEqual({ start: "9/7", end: "9/13" });
  });
  it("剩幾天往上取整，最少 1", () => {
    expect(daysUntilReset(q, mon)).toBe(7);
    expect(daysUntilReset(q, mon + 6 * 86400000 + 3600000)).toBe(1);
    expect(daysUntilReset(q, mon + 7 * 86400000 - 1)).toBe(1);
  });
  it("剩餘張數不會是負的", () => {
    expect(remaining(q)).toBe(2);
    expect(remaining({ limit: 3, used: 5 })).toBe(0);
  });
});
