/**
 * 首頁限時公告（2026-11-03 卡片獎勵規則）：每語一張字畫在圖裡的圖，點進說明頁，期間到了自動下架；
 * 沒有那個語言的圖，那個語言就看不到。
 */
import { describe, expect, it } from "vitest";
import { activeAnnouncements, type HomeAnnouncement } from "../src/lib/home-announcements";

const DAY = 86_400_000;
const notice = (over: Partial<HomeAnnouncement> = {}): HomeAnnouncement => ({
  id: "card-rewards", path: "/blog/creators/card-rewards", from: 10 * DAY, until: 40 * DAY,
  posters: { "zh-Hant": { src: "/announcements/card-rewards-zh-Hant.webp", alt: "卡片獎勵規則" } },
  ...over,
});

describe("activeAnnouncements", () => {
  it("shows a notice only between its start and its end", () => {
    expect(activeAnnouncements([notice()], 9 * DAY, "zh-Hant")).toEqual([]);
    expect(activeAnnouncements([notice()], 10 * DAY, "zh-Hant").map((n) => n.id)).toEqual(["card-rewards"]);
    expect(activeAnnouncements([notice()], 40 * DAY - 1, "zh-Hant")).toHaveLength(1);
    expect(activeAnnouncements([notice()], 40 * DAY, "zh-Hant")).toEqual([]);
  });

  it("skips languages that have no image of their own", () => {
    expect(activeAnnouncements([notice()], 20 * DAY, "en")).toEqual([]);
  });

  it("hands back the image, its words for screen readers and where it leads", () => {
    expect(activeAnnouncements([notice()], 20 * DAY, "zh-Hant")).toEqual([
      { id: "card-rewards", path: "/blog/creators/card-rewards", poster: { src: "/announcements/card-rewards-zh-Hant.webp", alt: "卡片獎勵規則" } },
    ]);
  });

  it("stays off until a start date is set", () => {
    expect(activeAnnouncements([notice({ from: null })], 20 * DAY, "zh-Hant")).toEqual([]);
  });
});
