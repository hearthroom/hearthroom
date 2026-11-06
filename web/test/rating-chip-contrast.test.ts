/**
 * 分級小標（RatingMark 的 chip）：底色是官方標識色，字色由我們選。每一級的字都要過 4.5:1（DESIGN.md §7）。
 * 退件 2026-11-06 play-info-panel PI10-01：普遍級白字綠底只有 2.73:1。
 */
import { describe, expect, it } from "vitest";
import { RATINGS } from "../../shared/content-rating";
import { RATING_CHIP_COLORS } from "../src/lib/rating";

const luminance = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a: string, b: string) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

describe("rating chip colors", () => {
  it("keeps the official mark color and gives every rating readable text", () => {
    expect(RATING_CHIP_COLORS.G.bg).toBe("#59b031");
    for (const rating of RATINGS) {
      const { bg, fg } = RATING_CHIP_COLORS[rating];
      expect(contrast(bg, fg), rating).toBeGreaterThanOrEqual(4.5);
    }
  });
});
