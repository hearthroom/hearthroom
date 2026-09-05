import { describe, expect, it } from "vitest";
import { applyLocale, i18n, pageTitle } from "@/lib/i18n";

describe("元件外的翻譯（錯誤訊息、分頁標題都靠它）", () => {
  it("切語言之後 i18n.global.t 會跟著變", async () => {
    await applyLocale("en");
    expect(i18n.global.t("site.tagline")).toBe("Character Board");
    await applyLocale("ja");
    expect(i18n.global.t("site.tagline")).toBe("キャラクターカード ランキング");
  });

  it("pageTitle 跟著語言走", async () => {
    await applyLocale("en");
    expect(pageTitle()).toContain("Character Board");
    await applyLocale("ko");
    expect(pageTitle()).toContain("캐릭터 카드 랭킹");
  });

  it("帶了頁面名稱時直接用它", async () => {
    await applyLocale("en");
    expect(pageTitle("Night Detective")).toBe("Night Detective · Hearthroom");
  });
});
