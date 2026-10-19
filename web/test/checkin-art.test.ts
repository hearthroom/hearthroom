// 夜版捧箱：白天畫布上的寶箱整疊，變形後要剛好落在夜捧箱的箱子外框上（技術美術量的數字）。
import { describe, expect, it } from "vitest";
import { boxKindOf, CARRY_RATIO, nightBoxTransform } from "../src/lib/checkin-art";

function apply(t: string, x: number, y: number) {
  const m = /translate\(([-\d.]+)%, ([-\d.]+)%\) scale\(([-\d.]+), ([-\d.]+)\)/.exec(t)!;
  const [tx, ty, sx, sy] = m.slice(1).map(Number);
  // 方框寬 CARRY_RATIO、高 1；transform-origin 左上
  return { x: sx * x + (tx / 100) * CARRY_RATIO, y: sy * y + ty / 100 };
}

describe("寶箱圖層", () => {
  it("夜版：白天箱子的左上、右下兩角對到夜箱外框", () => {
    const t = nightBoxTransform();
    const off = (CARRY_RATIO - 0.7) / 2;
    const tl = apply(t, 0.159 * CARRY_RATIO, 0.421);
    const br = apply(t, 0.76 * CARRY_RATIO, 0.741);
    expect(tl.x).toBeCloseTo(off + 0.199 * 0.7, 3);
    expect(tl.y).toBeCloseTo(0.401, 3);
    expect(br.x).toBeCloseTo(off + 0.811 * 0.7, 3);
    expect(br.y).toBeCloseTo(0.705, 3);
  });
  it("每種寶箱對到一組圖", () => {
    expect(["daily", "day3", "day7", "m14", "m28", "daily_all", "weekly_active", "newcomer"].map(boxKindOf))
      .toEqual(["day", "day3", "day7", "milestone", "milestone", "day3", "day7", "milestone"]);
  });
});
