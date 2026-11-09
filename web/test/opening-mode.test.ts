import { describe, expect, it } from "vitest";
import { emptyRuleSet, openingModeOf, ruleSetFromAuthorAsset, ruleSetToAuthorAsset } from "../src/lib/regex-rules";
import { makeDraft, missingRequired, playerSpeaksFirst, requiredKeys } from "../src/lib/role-draft";

// 開局呈現（開場白／開場網頁）存在作者資產；必填與「開場白可以留空」都看它（ui.md §2、§3）。
describe("開局呈現", () => {
  it("讀回上游的值；沒讀過時風月卡算開場網頁、其他算開場白", () => {
    expect(ruleSetFromAuthorAsset({ rules: [], openingMode: "page" }).openingMode).toBe("page");
    expect(ruleSetFromAuthorAsset({ rules: [], openingMode: "nonsense" }).openingMode).toBeUndefined();
    expect(openingModeOf({ format: "fengyue" })).toBe("page");
    expect(openingModeOf({ format: "mmd" })).toBe("greeting");
    expect(openingModeOf({ format: "fengyue", openingMode: "greeting" })).toBe("greeting");
  });

  it("選過才送；沒選過不送，上游保留原值", () => {
    expect(ruleSetToAuthorAsset({ ...emptyRuleSet(), openingMode: "page" }, 1)).toMatchObject({ openingMode: "page" });
    expect(ruleSetToAuthorAsset(emptyRuleSet(), 1)).not.toHaveProperty("openingMode");
  });

  it("必填的開局項跟著呈現換：開場白要開場白，開場網頁要至少一個第一句選項", () => {
    // 順序跟導覽一樣：名字 → 角色設定 → 開局
    expect(requiredKeys("greeting")).toEqual(["roleName", "roleDetailDesc", "roleWelcome"]);
    expect(requiredKeys("page")).toEqual(["roleName", "roleDetailDesc", "prologue"]);
    const draft = { ...makeDraft("zh-Hant"), roleName: "卡", roleDetailDesc: "設定" };
    expect(missingRequired(draft, { openingMode: "page" })).toEqual(["prologue"]);
    expect(missingRequired({ ...draft, prologue: [" ", "我推開門。"] }, { openingMode: "page" })).toEqual([]);
    // 開場白的卡只有選項也照樣列缺開場白（舊卡亮紅點，但不擋儲存）
    expect(missingRequired({ ...draft, prologue: ["我推開門。"] }, { openingMode: "greeting" })).toEqual(["roleWelcome"]);
  });

  it("開場白可以留空：開場網頁，或是有選項、首屏網頁的舊卡（跟上游 PATCH /welcome 一致）", () => {
    const draft = makeDraft("zh-Hant");
    expect(playerSpeaksFirst(draft, { openingMode: "page" })).toBe(true);
    expect(playerSpeaksFirst(draft, { openingMode: "greeting" })).toBe(false);
    expect(playerSpeaksFirst({ prologue: ["我推開門。"] }, { openingMode: "greeting" })).toBe(true);
    expect(playerSpeaksFirst(draft, { openingMode: "greeting", openingPage: "<p>x</p>" })).toBe(true);
  });
});
