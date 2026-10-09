/**
 * 卡片語言：建立時整份跟著建卡送；之後只有繁體與簡體可以互換，改了才進 document patch。
 */
import { describe, expect, it } from "vitest";
import { documentPatch, makeDraft, scriptChoices } from "../src/lib/role-draft";

describe("card language", () => {
  it("改了繁簡才送 language；沒改、新卡都不送", () => {
    const original = makeDraft("zh-Hant");
    const draft = makeDraft("zh-Hant");
    expect(documentPatch(draft, original)).not.toHaveProperty("language");
    draft.language = "zh-Hans";
    expect(documentPatch(draft, original)).toMatchObject({ language: "zh-Hans" });
    expect(documentPatch(makeDraft("zh-Hans"), null)).not.toHaveProperty("language");
  });

  it("已建立的卡：中文卡只給繁簡兩個選項，其他語言不給選", () => {
    expect(scriptChoices("zh-Hant").map((l) => l.value)).toEqual(["zh-Hant", "zh-Hans"]);
    expect(scriptChoices("zh-Hans").map((l) => l.value)).toEqual(["zh-Hant", "zh-Hans"]);
    expect(scriptChoices("en")).toEqual([]);
    expect(scriptChoices("")).toEqual([]);
  });
});
