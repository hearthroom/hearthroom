import { describe, expect, it } from "vitest";
import { hasAdultStarter, starterFor } from "../src/lib/onboarding";

describe("configured onboarding cards", () => {
  it.each(["zh-Hant", "zh-Hans"])("%s follows the viewer's R18 choice", (locale) => {
    expect(starterFor(locale, false)).toBe(100216);
    expect(starterFor(locale, true)).toBe(100076);
    expect(hasAdultStarter(locale)).toBe(true);
  });

  it.each(["en", "ja", "ko"])("%s keeps onboarding disabled until cards are configured", (locale) => {
    expect(starterFor(locale, false)).toBeNull();
    expect(starterFor(locale, true)).toBeNull();
    expect(hasAdultStarter(locale)).toBe(false);
  });
});
