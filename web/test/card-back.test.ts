/** 卡片頁返回鈕：回到進卡前那一頁，切分頁推的歷史一起退；直接開連結進來的交給連結去首頁。 */
import { expect, it } from "vitest";
import { readEntry, stepsBack } from "../src/lib/card-back";

it("goes back one step when the card was opened from a list", () => {
  expect(stepsBack(readEntry({ position: 4, back: "/search?q=x" }), readEntry({ position: 4, back: "/search?q=x" }))).toBe(1);
});
it("also undoes the history the card page pushed for its own tabs", () => {
  const entry = readEntry({ position: 4, back: "/" });
  expect(stepsBack(entry, readEntry({ position: 6, back: "/cards/1?tab=workshop" }))).toBe(3);
});
it("has no step back when the card was opened directly", () => {
  expect(stepsBack(readEntry({ position: 0, back: null }), readEntry({ position: 0, back: null }))).toBeNull();
  expect(stepsBack(readEntry(null), readEntry({ position: 2, back: "/" }))).toBeNull();
});
it("does not guess when the history went behind the entry", () => {
  expect(stepsBack(readEntry({ position: 4, back: "/" }), readEntry({ position: 3, back: "/" }))).toBeNull();
});
