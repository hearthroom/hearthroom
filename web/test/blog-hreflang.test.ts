import { afterEach, expect, it } from "vitest";
import { updateHreflang } from "../src/lib/i18n";
afterEach(() => document.head.querySelectorAll('link[data-hreflang]').forEach(e => e.remove()));
it("keeps five-language list alternates but clears them for single-language articles", () => {
  for (const path of ["/blog", "/blog/news", "/blog/g/official"]) {
    updateHreflang(path);
    expect(document.head.querySelectorAll('link[data-hreflang]')).toHaveLength(6);
    updateHreflang("/blog/news/guide-en");
    expect(document.head.querySelectorAll('link[data-hreflang]')).toHaveLength(0);
  }
  updateHreflang("/guide");
  expect(document.head.querySelectorAll('link[data-hreflang]')).toHaveLength(6);
});
