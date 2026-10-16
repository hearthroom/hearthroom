import { expect, it } from "vitest";
import { allColumns, groupOfColumn, homePost, type BlogGroup, type PostCard } from "../src/lib/blog";

const col = (id: string, slug: string, parentId: string | null) => ({ id, slug, name: { "zh-Hant": slug }, description: {}, sort: 0, enabled: true, parentId });
const groups: BlogGroup[] = [
  { ...col("g1", "official", null), columns: [col("c1", "news", "g1"), col("c2", "events", "g1")] },
  { ...col("g2", "creators", null), columns: [col("c3", "guides", "g2")] },
];

it("flattens the columns of every group in order", () => {
  expect(allColumns(groups).map((c) => c.slug)).toEqual(["news", "events", "guides"]);
});

it("finds the group a column belongs to by the column's slug", () => {
  expect(groupOfColumn(groups, "guides")?.slug).toBe("creators");
  expect(groupOfColumn(groups, "nope")).toBeUndefined();
});

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 16);
const card = (slug: string, daysAgo: number, campaign: string | null = null): PostCard => ({
  id: slug, columnSlug: "news", slug, title: slug, excerpt: "", coverUrl: null, locale: "zh-Hant", firstPublishedAt: NOW - daysAgo * DAY, pinned: true,
  readMinutes: 1, commentCount: 0, campaign: campaign ? { slug: campaign, title: {}, phase: "open", startsAt: null, endsAt: null, timezone: null } : null,
} as PostCard);

it("the home carousel takes the newest pinned post from the last 30 days whose campaign is not already shown", () => {
  expect(homePost([], [], NOW)).toBeNull();
  expect(homePost([card("old", 31)], [], NOW)).toBeNull();
  expect(homePost([card("season", 1, "share-season")], ["share-season"], NOW)).toBeNull();
  expect(homePost([card("a", 10), card("b", 2), card("season", 1, "share-season")], ["share-season"], NOW)!.slug).toBe("b");
  expect(homePost([card("season", 1, "share-season")], [], NOW)!.slug).toBe("season");
});
