/** 新文章的網址代號從標題建議：標題裡的 HTML 標籤不算字。 */
import { expect, it } from "vitest";
import { suggestSlug } from "../src/lib/blog";

it("keeps letters and digits, joins the rest with hyphens", () => {
  expect(suggestSlug("Hello, World 2026!")).toBe("hello-world-2026");
});

it("drops HTML tags instead of turning their names into words", () => {
  expect(suggestSlug("Hearthroom 開站公告 <b>測試</b>")).toBe("hearthroom");
  expect(suggestSlug('<span class="x">Launch</span> day')).toBe("launch-day");
});

it("falls back to a dated slug when nothing usable is left", () => {
  expect(suggestSlug("開站公告 <b>測試</b>", new Date("2026-10-15T08:00:00Z"))).toBe("post-20261015");
});
