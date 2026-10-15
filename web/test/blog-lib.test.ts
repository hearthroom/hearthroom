import { expect, it } from "vitest";
import { allColumns, groupOfColumn, type BlogGroup } from "../src/lib/blog";

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
