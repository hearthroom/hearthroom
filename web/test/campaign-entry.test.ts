/**
 * 活動的入口：頁尾與帳號選單各一個「活動中心」。首頁的輪播見 board-carousel.test.ts。
 */
import { describe, expect, it } from "vitest";
import { footerGroups } from "../src/lib/footer-nav";
import zhHant from "../src/locales/zh-Hant.json";
import zhHans from "../src/locales/zh-Hans.json";
import en from "../src/locales/en.json";
import ja from "../src/locales/ja.json";
import ko from "../src/locales/ko.json";

describe("頁尾入口", () => {
  const ctx = { repoUrl: "https://github.com/hearthroom/hearthroom", license: "AGPL-3.0", discordInvite: "https://discord.gg/x", showDownloadEntry: true, canInstallSite: true };
  it("社群組有「活動中心」", () => {
    const link = footerGroups(ctx).find((g) => g.id === "community")!.links.find((l) => l.id === "campaign");
    expect(link).toMatchObject({ label: "campaign.hub.title", to: "/campaigns" });
  });
});

describe("新文案五語都有", () => {
  it.each(["campaign.hub.title", "campaign.carousel.cta", "campaign.carousel.slide", "campaign.carousel.prev", "campaign.carousel.next", "campaign.carousel.label"])("%s", (k) => {
    for (const dict of [zhHant, zhHans, en, ja, ko] as Record<string, string>[]) expect(dict[k], k).toBeTruthy();
  });
});
