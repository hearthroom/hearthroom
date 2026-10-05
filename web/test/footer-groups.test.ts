/**
 * 頁尾分組：連結一多就要分組，不然整排擠成好幾行、手機上更亂（owner 2026-10-05）。
 *   - 組數與每組連結數有上限，放不下就開新組或做彙整頁；
 *   - 同一件事只給一個入口：「下載 App」與「安裝 App」不會同時出現；
 *   - 授權放在最底下那一條，不跟分組混在一起；
 *   - 每個標籤在五種語言都有字。
 */
import { describe, expect, it } from "vitest";
import { FOOTER_LIMITS, footerGroups, footerLegal, type FooterContext } from "../src/lib/footer-nav";
import zhHant from "../src/locales/zh-Hant.json";
import zhHans from "../src/locales/zh-Hans.json";
import en from "../src/locales/en.json";
import ja from "../src/locales/ja.json";
import ko from "../src/locales/ko.json";

const base: FooterContext = {
  repoUrl: "https://github.com/hearthroom/hearthroom",
  license: "AGPL-3.0",
  discordInvite: "https://discord.gg/example",
  showDownloadEntry: true,
  canInstallSite: true,
};
const ids = (ctx: FooterContext) => footerGroups(ctx).flatMap((g) => g.links.map((l) => l.id));

describe("頁尾分組", () => {
  it("分成創作、App、社群三組", () => {
    expect(footerGroups(base).map((g) => g.id)).toEqual(["create", "app", "community"]);
  });

  it("每種情況都守住組數與每組連結數的上限，也沒有重複的入口", () => {
    for (const showDownloadEntry of [true, false])
      for (const canInstallSite of [true, false])
        for (const discordInvite of [base.discordInvite, null]) {
          const ctx = { ...base, showDownloadEntry, canInstallSite, discordInvite };
          const groups = footerGroups(ctx);
          expect(groups.length).toBeLessThanOrEqual(FOOTER_LIMITS.groups);
          for (const g of groups) {
            expect(g.links.length).toBeGreaterThan(0);
            expect(g.links.length).toBeLessThanOrEqual(FOOTER_LIMITS.linksPerGroup);
          }
          expect(new Set(ids(ctx)).size).toBe(ids(ctx).length);
        }
  });

  it("能下載 App 的裝置只放「下載 App」，安裝按鈕在下載頁上", () => {
    expect(ids(base)).toContain("download");
    expect(ids(base)).not.toContain("install");
  });

  it("裝不了 APK、但瀏覽器能安裝時，頁尾直接放「安裝 App」", () => {
    const got = ids({ ...base, showDownloadEntry: false });
    expect(got).toContain("install");
    expect(got).not.toContain("download");
  });

  it("兩種都不行時 App 那組還有更新紀錄，不會整組消失", () => {
    const app = footerGroups({ ...base, showDownloadEntry: false, canInstallSite: false }).find((g) => g.id === "app");
    expect(app?.links.map((l) => l.id)).toEqual(["updates"]);
  });

  it("沒有 Discord 邀請時社群組照樣在，只少那一個", () => {
    const community = footerGroups({ ...base, discordInvite: null }).find((g) => g.id === "community");
    expect(community?.links.map((l) => l.id)).toEqual(["github", "issues"]);
  });

  it("授權在最底下那一條，不在分組裡", () => {
    expect(footerLegal(base).map((l) => l.id)).toEqual(["license"]);
    expect(ids(base)).not.toContain("license");
  });

  it("所有標籤在五種語言都有翻譯", () => {
    const keys = new Set<string>(["footer.links"]);
    for (const ctx of [base, { ...base, showDownloadEntry: false }]) {
      for (const g of footerGroups(ctx)) { keys.add(g.title); g.links.forEach((l) => keys.add(l.label)); }
      footerLegal(ctx).forEach((l) => keys.add(l.label));
    }
    for (const dict of [zhHant, zhHans, en, ja, ko] as Record<string, string>[])
      for (const k of keys) expect(dict[k], k).toBeTruthy();
  });
});
