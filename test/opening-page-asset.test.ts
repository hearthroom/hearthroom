import { describe, expect, it } from "vitest";
import { canonicalAsset, hasAsset } from "../src/card-transfer-resources";

// 審核快照與跨版本搬運用的作者資產標準形：首屏網頁（AI 風月的「詳細介紹」）要帶著走，
// 審核才看得到每次開新對話都會出現的那段作者 HTML；沒有它的卡，標準形（與它的雜湊）跟以前一樣。
describe("作者資產標準形與首屏網頁", () => {
  const base = { rules: [], mountTrigger: "", mountLayer: "over", pageMode: "sandbox" };

  it("有首屏網頁才帶，風月格式一起帶", () => {
    const asset = canonicalAsset({ ...base, cardFormat: "fengyue", openingPage: "<div>首屏</div>" });
    expect(asset).toMatchObject({ openingPage: "<div>首屏</div>", cardFormat: "fengyue" });
  });

  it("沒有首屏網頁的卡標準形不變", () => {
    expect(canonicalAsset({ ...base, cardFormat: "mmd", openingPage: "" })).toEqual({ rules: [], mountTrigger: "", mountLayer: "over", pageMode: "sandbox" });
  });

  it("只有首屏網頁也算有作者資產", () => {
    expect(hasAsset(canonicalAsset({ rules: [], pageMode: "classic", openingPage: "<p>x</p>" }))).toBe(true);
    expect(hasAsset(canonicalAsset({ rules: [], pageMode: "classic" }))).toBe(false);
  });

  it("開局呈現只在跟格式的預設不同時才帶，既有卡的標準形不變", () => {
    expect(canonicalAsset({ ...base, openingMode: "greeting" })).not.toHaveProperty("openingMode");
    expect(canonicalAsset({ ...base, cardFormat: "fengyue", openingMode: "page" })).not.toHaveProperty("openingMode");
    expect(canonicalAsset({ ...base, openingMode: "page" })).toMatchObject({ openingMode: "page" });
    expect(canonicalAsset({ ...base, cardFormat: "fengyue", openingMode: "greeting" })).toMatchObject({ openingMode: "greeting" });
  });

  it("規則裡 <style> 的寫法只在有的時候才帶，既有卡的標準形不變", () => {
    const asset = canonicalAsset({ ...base, rules: [{ id: "a", name: "a", find: "x", replace: "y", enabled: true, cssDialect: "fengyue" }, { id: "b", name: "b", find: "x", replace: "y", enabled: true }, { id: "c", name: "c", find: "x", replace: "y", enabled: true, cssDialect: "bogus" }] });
    expect(asset.rules[0]).toEqual({ id: "a", name: "a", find: "x", replace: "y", enabled: true, cssDialect: "fengyue" });
    expect(asset.rules[1]).not.toHaveProperty("cssDialect");
    expect(asset.rules[2]).not.toHaveProperty("cssDialect");
  });
});
