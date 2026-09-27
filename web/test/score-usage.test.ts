import { describe, expect, it } from "vitest";
import { byWeek, lastDays, niceMax, spentTotals } from "../src/lib/score-usage";
import type { ScoreDay } from "../src/lib/api";

/** 2026-09-14 是星期一；造 14 天、每天消耗 = 當天號數，方便算 */
const days: ScoreDay[] = Array.from({ length: 14 }, (_, i) => {
  const d = 13 + i; // 09-13（日）… 09-26（六）
  return { date: `2026-09-${String(d).padStart(2, "0")}`, spent: d, earned: i === 0 ? 100 : 0, count: 1 };
});

describe("積分統計的加總", () => {
  it("按日曆週加總，星期一開始；資料開頭不滿一週的那段不算", () => {
    const weeks = byWeek(days);
    expect(weeks.map((w) => [w.start, w.end])).toEqual([["2026-09-14", "2026-09-20"], ["2026-09-21", "2026-09-26"]]);
    expect(weeks[0].spent).toBe(14 + 15 + 16 + 17 + 18 + 19 + 20);
    expect(weeks[1].count).toBe(6);
  });

  it("今天、本週（週一到今天）、最近 30 天", () => {
    // 今天是 09-26（六）：本週是 21..26
    expect(spentTotals(days)).toEqual({ today: 26, week: 21 + 22 + 23 + 24 + 25 + 26, month: days.reduce((s, d) => s + d.spent, 0) });
    expect(spentTotals([])).toEqual({ today: 0, week: 0, month: 0 });
  });

  it("最近幾天一天一根；軸上限取好讀的整數", () => {
    expect(lastDays(days, 7).map((b) => b.start)).toEqual(days.slice(-7).map((d) => d.date));
    expect([niceMax(0), niceMax(7), niceMax(12), niceMax(260), niceMax(1000)]).toEqual([10, 10, 20, 500, 1000]);
  });
});
