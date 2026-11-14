import { expect, it } from "vitest";
import { revealInScroller } from "../src/lib/scroll-reveal";

// happy-dom 不排版：直接給列與那一格的位置（390 手機上分頁列 16→374，作用中的分頁右緣 413，跟驗收量到的一樣）
function fake(box: { left: number; right: number }, tab: { left: number; right: number }, scrollWidth = 700) {
  const scroller = { scrollLeft: 0, scrollWidth, clientWidth: box.right - box.left, getBoundingClientRect: () => ({ ...box, width: box.right - box.left }) } as unknown as HTMLElement;
  const item = { getBoundingClientRect: () => ({ ...tab, width: tab.right - tab.left }) } as unknown as HTMLElement;
  return { scroller, item };
}

it("scrolls a tab that is only partly cut off at the right edge into the middle", () => {
  const { scroller, item } = fake({ left: 16, right: 374 }, { left: 300, right: 413 });
  revealInScroller(scroller, item);
  expect(scroller.scrollLeft).toBeGreaterThan(0);
  const box = scroller.getBoundingClientRect(), shifted = { left: 300 - scroller.scrollLeft, right: 413 - scroller.scrollLeft };
  expect(shifted.left).toBeGreaterThanOrEqual(box.left);
  expect(shifted.right).toBeLessThanOrEqual(box.right);
});

it("also scrolls a tab cut off at the left edge, and leaves a fully visible one alone", () => {
  const left = fake({ left: 16, right: 374 }, { left: -20, right: 60 });
  left.scroller.scrollLeft = 200;
  revealInScroller(left.scroller, left.item);
  expect(left.scroller.scrollLeft).toBeLessThan(200);
  const inside = fake({ left: 16, right: 374 }, { left: 100, right: 200 });
  revealInScroller(inside.scroller, inside.item);
  expect(inside.scroller.scrollLeft).toBe(0);
});

it("does nothing when the row does not overflow", () => {
  const { scroller, item } = fake({ left: 16, right: 374 }, { left: 300, right: 413 }, 358);
  revealInScroller(scroller, item);
  expect(scroller.scrollLeft).toBe(0);
});
