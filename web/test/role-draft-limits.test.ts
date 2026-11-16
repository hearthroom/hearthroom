/** 新卡沒有 validate 回報，預設值必須與 HarperHarbor Provider 的 role/limits.go 一致。 */
import { describe, expect, it } from "vitest";
import { resolveLimits } from "../src/lib/role-draft";
import { fengyueToDraft } from "../src/lib/fengyue";
import { riliToDraft } from "../src/lib/rili";

describe("resolveLimits", () => {
  it.each(["zh-Hant", "zh-Hans", "ja", "ko", ""])("非英文卡 %s 與 Provider 相同", (lang) => {
    expect(resolveLimits(null, lang)).toEqual({ roleName: 60, jailbreak: 2000, roleOutputContract: 4000, roleWelcome: 8000, roleDesc: 500, roleReadme: 20000, roleDetailDesc: 10000 });
  });
  it("英文卡的兩個進階欄位也使用英文預算", () => {
    expect(resolveLimits(null, "en")).toEqual({ roleName: 60, jailbreak: 4000, roleOutputContract: 8000, roleWelcome: 10000, roleDesc: 2500, roleReadme: 40000, roleDetailDesc: 50000 });
  });
  it("遠端契約蓋過預設；新欄位優先於舊別名，缺欄位留預設", () => {
    expect(resolveLimits({ customInstructionsMaxChars: 900, jailbreakMaxChars: 700, roleOutputContractMaxChars: 1800 }, "zh-Hant")).toMatchObject({ jailbreak: 900, roleOutputContract: 1800 });
    expect(resolveLimits({ jailbreakMaxChars: 700 }, "zh-Hant")).toMatchObject({ jailbreak: 700, roleOutputContract: 4000 });
  });
});

describe.each(["fengyue", "rili"])("%s 匯入沿用 Provider 字數上限", (format) => {
  it.each(["zh-Hant", "zh-Hans", "ja", "ko", "en"])("%s 上限內不誤報，超過才提示且不截斷", (language) => {
    const max = language === "en" ? 4000 : 2000;
    const outputMax = max * 2;
    const convert = (custom: string, output: string) => format === "fengyue"
      ? fengyueToDraft({ title: "合成卡", posttxt: custom, pretxt: output }, { language })
      : riliToDraft({ title: "合成卡", prompt: { rearPrompt: custom, headPrompt: output } }, { language });
    for (const n of [501, 550, max]) {
      const result = convert("字".repeat(n), "格".repeat(outputMax));
      expect(result.draft.jailbreak).toHaveLength(n);
      expect(result.draft.roleOutputContract).toHaveLength(outputMax);
      expect(result.dropped.filter(note => note.key.startsWith("import.fengyue.tooLong."))).toEqual([]);
    }
    const over = convert("字".repeat(max + 1), "格".repeat(outputMax + 1));
    expect(over.draft.jailbreak).toHaveLength(max + 1);
    expect(over.draft.roleOutputContract).toHaveLength(outputMax + 1);
    expect(over.dropped).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "import.fengyue.tooLong.custom", params: { n: max + 1, max } }),
      expect.objectContaining({ key: "import.fengyue.tooLong.outputContract", params: { n: outputMax + 1, max: outputMax } }),
    ]));
  });
});
