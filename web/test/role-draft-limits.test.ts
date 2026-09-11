/**
 * 欄位上限的預設表要跟上游語區表一致：新卡問不到上游，畫面上的數字只能靠這張表。
 * 曾經寫成一個數（額外指示 4000），存成卡後上游回 500，作者看到的上限前後對不上。
 */
import { describe, expect, it } from "vitest";
import { resolveLimits } from "../src/lib/role-draft";

describe("resolveLimits", () => {
  it("中文卡：額外指示 500、回覆格式 2000、開場白 8000（跟上游一樣）", () => {
    for (const lang of ["zh-Hant", "zh-Hans"]) {
      expect(resolveLimits(null, lang)).toMatchObject({ jailbreak: 500, roleOutputContract: 2000, roleWelcome: 8000, roleDesc: 500, roleDetailDesc: 10000 });
    }
  });
  it("日韓：額外指示 1500，其餘同中文", () => {
    expect(resolveLimits(null, "ja")).toMatchObject({ jailbreak: 1500, roleDesc: 500, roleWelcome: 8000 });
  });
  it("英文卡預算大得多", () => {
    expect(resolveLimits(null, "en")).toMatchObject({ jailbreak: 1500, roleDesc: 2500, roleDetailDesc: 50000, roleWelcome: 10000, roleOutputContract: 2000 });
  });
  it("上游回來的值蓋過預設；沒回的欄位留預設", () => {
    expect(resolveLimits({ jailbreakMaxChars: 700 }, "zh-Hant")).toMatchObject({ jailbreak: 700, roleOutputContract: 2000 });
  });
});
