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

  it("必填的開局項跟著呈現換：開場白要開場白，開場網頁要至少一個第一句選項；且必含一個預設分類", () => {
    // 順序跟表單一樣：名字 → 分類與玩法 → 角色設定 → 開局
    expect(requiredKeys("greeting")).toEqual(["roleName", "roleBackground", "presetTag", "roleDetailDesc", "roleWelcome"]);
    expect(requiredKeys("page")).toEqual(["roleName", "roleBackground", "presetTag", "roleDetailDesc", "prologue"]);
    const draft = { ...makeDraft("zh-Hant"), roleName: "卡", roleBackground: "https://images.test/cover.png", roleTag: ["角色扮演"], roleDetailDesc: "設定" };
    expect(missingRequired(draft, { openingMode: "page" })).toEqual(["prologue"]);
    expect(missingRequired({ ...draft, prologue: [" ", "我推開門。"] }, { openingMode: "page" })).toEqual([]);
    // 自訂標籤或網址 key 不算預設分類；五語顯示名任一命中（含第 10 個之後）即算
    expect(missingRequired({ ...draft, roleTag: ["自訂標籤", "roleplay"], prologue: ["我推開門。"] }, { openingMode: "page" })).toEqual(["presetTag"]);
    expect(missingRequired({ ...draft, roleTag: [...Array.from({ length: 11 }, (_, i) => `自訂${i}`), "Roleplay"], prologue: ["我推開門。"] }, { openingMode: "page" })).toEqual([]);
    // 舊卡的開場選項也滿足至少一種開場。
    expect(missingRequired({ ...draft, prologue: ["我推開門。"] }, { openingMode: "greeting" })).toEqual([]);
  });

  it("開場白可以留空：開場網頁，或是有選項、首屏網頁的舊卡（跟上游 PATCH /welcome 一致）", () => {
    const draft = makeDraft("zh-Hant");
    expect(playerSpeaksFirst(draft, { openingMode: "page" })).toBe(true);
    expect(playerSpeaksFirst(draft, { openingMode: "greeting" })).toBe(false);
    expect(playerSpeaksFirst({ prologue: ["我推開門。"] }, { openingMode: "greeting" })).toBe(true);
    expect(playerSpeaksFirst(draft, { openingMode: "greeting", openingPage: "<p>x</p>" })).toBe(true);
  });
});
