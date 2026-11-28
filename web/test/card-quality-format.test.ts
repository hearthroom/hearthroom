import { afterEach, expect, it } from "vitest";
import { i18n, loadLocale } from "../src/lib/i18n";
import { qualityCharacters, qualityRate } from "../src/lib/card-quality-format";

const at = (code: string) => { i18n.global.locale.value = code as never; };
afterEach(() => at("zh-Hant"));

it("writes rounded card length in each language without adding a second rounding", async () => {
  const cases: Record<string, string[]> = {
    "zh-Hant": ["不到 1,000 字", "3,000 字", "1.4 萬字", "1 萬字", "11 萬字", "110 萬字"],
    "zh-Hans": ["不到 1,000 字", "3,000 字", "1.4 万字", "1 万字", "11 万字", "110 万字"],
    en: ["under 1,000 chars", "3,000 chars", "14k chars", "10k chars", "110k chars", "1.1M chars"],
    ja: ["1,000字未満", "3,000字", "1.4万字", "1万字", "11万字", "110万字"],
    ko: ["1,000자 미만", "3,000자", "1.4만 자", "1만 자", "11만 자", "110만 자"],
  };
  for (const [code, expected] of Object.entries(cases)) {
    await loadLocale(code);
    at(code);
    expect([0, 3000, 14000, 10000, 110000, 1100000].map(qualityCharacters), code).toEqual(expected);
  }
});

it("writes the server's whole-number retention rate as a percentage", () => {
  expect(qualityRate(82)).toBe("82%");
  expect(qualityRate(0)).toBe("0%");
  expect(qualityRate(100)).toBe("100%");
})

it("writes the short cover date: year only after a year, narrow relative time before", async () => {
  const { relativeTimeShort } = await import("../src/lib/format");
  const day = 86_400_000, old = Date.now() - 420 * day, year = String(new Date(old).getFullYear());
  for (const [code, yearText, months] of [["zh-Hant", `${year}年`, "11 個月前"], ["en", year, "11mo ago"], ["ko", `${year}년`, "11개월 전"]] as const) {
    await loadLocale(code); at(code);
    expect(relativeTimeShort(old), code).toBe(yearText);
    expect(relativeTimeShort(Date.now() - 330 * day), code).toBe(months);
  }
});
