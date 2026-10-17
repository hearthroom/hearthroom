import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyLocale, i18n } from "@/lib/i18n";
import { SITE_NAME, siteName } from "../../shared/site-name";
import en from "../src/locales/en.json";
import ja from "../src/locales/ja.json";
import ko from "../src/locales/ko.json";
import zhHans from "../src/locales/zh-Hans.json";
import zhHant from "../src/locales/zh-Hant.json";

// 這兩條講的是 Hearthroom CLI 這個工具，工具名不跟站名走。
const TOOL_NAME_KEYS = new Set(["guide.start.agent.lead", "guide.start.agent.cli"]);

describe("外語介面的站名只從 shared/site-name.ts 來", () => {
  it.each([["en", en], ["ja", ja], ["ko", ko]] as const)("%s 的字串不寫死舊站名", (_code, messages) => {
    const hardcoded = Object.entries(messages as Record<string, string>)
      .filter(([key, text]) => !TOOL_NAME_KEYS.has(key) && text.includes("Hearthroom"))
      .map(([key]) => key);
    expect(hardcoded).toEqual([]);
  });

  it("{site} 在載入時換成該語言的站名", async () => {
    await applyLocale("en");
    expect(i18n.global.t("share.text", { name: "月光" })).toBe(`Found this card on ${siteName("en")}: 月光`);
    await applyLocale("ko");
    expect(i18n.global.t("download.title")).toBe(`${siteName("ko")} 다운로드`);
    await applyLocale("ja");
    expect(i18n.global.t("pwa.install.title")).not.toContain("{site}");
  });

  it.each([["zh-Hant", zhHant], ["zh-Hans", zhHans], ["en", en], ["ja", ja], ["ko", ko]] as const)("%s 載入後沒有一句還留著 {site}", async (code, messages) => {
    await applyLocale(code);
    const left = Object.keys(messages).filter((key) => (i18n.global.getLocaleMessage(code) as Record<string, string>)[key]?.includes("{site}"));
    expect(left).toEqual([]);
  });

  it("讀不到 TS 的靜態檔跟 SITE_NAME 一致", () => {
    const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
    const index = read("../index.html");
    expect(index).toContain(`<meta name="apple-mobile-web-app-title" content="${SITE_NAME}" />`);
    const manifest = JSON.parse(read("../public/manifest.webmanifest"));
    expect([manifest.name, manifest.short_name]).toEqual([SITE_NAME, SITE_NAME]);
    const offline = read("../public/offline.html");
    expect(offline).toContain(`<title>${SITE_NAME}</title>`);
    expect(offline).toContain(`: "${SITE_NAME}"`);
  });
});

describe("中文介面看到的字不變", () => {
  it("{site} 在中文代入綺夢社／绮梦社", async () => {
    await applyLocale("zh-Hant");
    expect(i18n.global.t("mascot.pet.guide.download.hello")).toBe("想把綺夢社裝進手機看這裡。");
    await applyLocale("zh-Hans");
    expect(i18n.global.t("mascot.pet.guide.download.hello")).toBe("想把绮梦社装进手机就看这里。");
  });
});
