import { describe, expect, it } from "vitest";
import { titleLayout } from "../src/lib/title-layout";

/**
 * 作者的標題有三種：排過版的（裝飾符號、花體字、字母拉開、中英兩段）要置中、在作者留的空格換行；
 * 沒排過版的長名字照一般靠左、塞滿兩行。後兩個例子是線上卡片的真實標題。
 */
describe("titleLayout", () => {
  it.each([
    ["꧁⟆崩坏✦星穹铁道⟅꧂ 𝓗𝓸𝓷𝓴𝓪𝓲: 𝓢𝓽𝓪𝓻 𝓡𝓪𝓲𝓵 ｜2.9"],
    ["❖┆原神✦提瓦特┆❖ 𝕲𝖊𝖓𝖘𝖍𝖎𝖓 𝕴𝖒𝖕𝖆𝖈𝖙"],
    ["19弾丸论破•催眠学园01 D A N G A N R O N P A"],
    ["弹丸论破 Danganronpa"],
    ["明日方舟 Arknights: Endfield"],
    ["✧ Luna ✧"],
    ["第一行\n第二行"],
  ])("排過版的標題置中：%s", (name) => {
    expect(titleLayout(name).designed).toBe(true);
  });

  it.each([
    ["区区小姨，随意拿捏。（有点偏日常了感觉，想做什么都可以。）"],
    ["酒馆测试-碧蓝档案-作者鹿初"],
    ["萬族創世錄"],
    ["The Knight Who Forgot the Name of the Lost Kingdom"],
    ["小姨😊今天也很可愛"],
    ["AI助手"],
    ["小美｜日常"],
    ["我的女友 Alice"],
    ["契约×恋人～番外"],
  ])("沒排過版的標題照常靠左：%s", (name) => {
    expect(titleLayout(name).designed).toBe(false);
  });

  it("去掉頭尾空白：可變寬的欄位裡，邊緣空白對不齊任何東西，只會看起來像少了一個字", () => {
    expect(titleLayout("  ✦ 星穹 ✦ \n").text).toBe("✦ 星穹 ✦");
    expect(titleLayout(" 萬族創世錄 ").text).toBe("萬族創世錄");
  });

  it("字母拉開的那段不在字母間斷行", () => {
    expect(titleLayout("19弾丸论破•催眠学园01 D A N G A N R O N P A").text).toBe("19弾丸论破•催眠学园01 D\u00A0A\u00A0N\u00A0G\u00A0A\u00A0N\u00A0R\u00A0O\u00A0N\u00A0P\u00A0A");
  });

  it("估計最寬一段不比實際窄：實際量到 ꧁⟆崩坏✦星穹铁道⟅꧂ 約 11.1 字寬、19弾丸论破•催眠学园01 約 10.6", () => {
    expect(titleLayout("꧁⟆崩坏✦星穹铁道⟅꧂ 𝓗𝓸𝓷𝓴𝓪𝓲: 𝓢𝓽𝓪𝓻 𝓡𝓪𝓲𝓵 ｜2.9").widestEm).toBeGreaterThanOrEqual(11.1);
    expect(titleLayout("19弾丸论破•催眠学园01 D A N G A N R O N P A").widestEm).toBeGreaterThanOrEqual(10.6);
    expect(titleLayout("萬族創世錄").widestEm).toBe(0);
  });
});
