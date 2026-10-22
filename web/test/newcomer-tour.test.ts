import { expect, it } from "vitest";
import { NEWCOMER_TOUR, awayMode } from "../src/lib/newcomer-tour";

it("day 2 points to the always-available conversation library, outside the carousel", () => {
  expect(NEWCOMER_TOUR[2][0].target).toBe('[data-tour="library"]');
});

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

// PM 2026-10-19（QA ⚠️17）：第 1 天的目標是聊滿回合，導覽停在標籤就斷了；第三步帶到卡片頁框「開始聊」
it("day 1 ends on the card page's play button", () => {
  expect(NEWCOMER_TOUR[1].map((s) => s.id)).toEqual(["1.board", "1.tags", "1.play"]);
  const play = NEWCOMER_TOUR[1][2];
  expect(play.target).toBe('[data-tour="card-play"]');
  // 桌機泡泡落在按鈕下方時，不蓋到緊接在下面的分級那一行（PM 2026-10-19）
  expect(play.clear).toBe('[data-tour="card-grade"]');
  expect(awayMode(play, "home")).toBe("card");
  expect(awayMode(play, "card")).toBeNull();
});

