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
});
