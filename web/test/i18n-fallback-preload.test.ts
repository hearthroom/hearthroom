// 回退鏈上的語言包只在背景預載到「已經在手上的那一份」為止：
// 簡體介面的回退鏈是 繁體 → 英文，繁體是原文、打在主程式裡，缺字一定在繁體找得到，
// 英文包永遠用不到，卻每次冷開都多下載 57 KB，還跟卡片資料搶同一段頻寬（100257 實測 2026-10-22）。
import { expect, it } from "vitest";
import { applyLocale, i18n } from "../src/lib/i18n";

it("簡體介面不預載英文包；日文介面照樣預載英文", async () => {
  await applyLocale("zh-Hans");
  await new Promise((r) => setTimeout(r, 50));
  expect(i18n.global.availableLocales).toContain("zh-Hans");
  expect(i18n.global.availableLocales).not.toContain("en");
  await applyLocale("ja");
  await new Promise((r) => setTimeout(r, 50));
  expect(i18n.global.availableLocales).toContain("en");
});
