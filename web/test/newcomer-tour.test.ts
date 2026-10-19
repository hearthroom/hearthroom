import { expect, it } from "vitest";
import { NEWCOMER_TOUR, awayMode } from "../src/lib/newcomer-tour";

// ui.md §15.8：導覽框不到真的元素時，泡泡怎麼講
it("sends card-page days to a card when the person is elsewhere", () => {
  const [score] = NEWCOMER_TOUR[4];
  expect(awayMode(score, "home")).toBe("card");
  expect(awayMode(score, null)).toBe("card");
  expect(awayMode(score, "card")).toBeNull();
  expect(awayMode(NEWCOMER_TOUR[6][0], "wallet")).toBe("card");
});

it("explains the canvas settings in words, wherever day 5 is opened", () => {
  expect(NEWCOMER_TOUR[5]).toHaveLength(1);
  expect(NEWCOMER_TOUR[5][0].id).toBe("5.canvas");
  expect(awayMode(NEWCOMER_TOUR[5][0], "play")).toBe("canvas");
  expect(awayMode(NEWCOMER_TOUR[5][0], "home")).toBe("canvas");
});

it("frames the real element on pages the tour can reach", () => {
  expect(awayMode(NEWCOMER_TOUR[1][0], "home")).toBeNull();
  expect(awayMode(NEWCOMER_TOUR[7][0], "card")).toBeNull();
});
