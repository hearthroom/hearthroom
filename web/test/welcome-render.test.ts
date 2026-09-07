/**
 * 卡片頁的開場白照對話頁的方式畫：作者的正則規則先套，再決定走 HTML 還是 markdown。
 */
import { describe, expect, it } from "vitest";
import { hasHtml, isHeavyHtml, renderWelcome } from "../src/lib/welcome-render";
import { buildSrcdoc } from "../src/lib/html-card-frame";

const asset = (rules: unknown[], mountTrigger = "") => ({ rules, mountTrigger, mountLayer: "over", cardFormat: "mmd", variants: null });

describe("開場白渲染", () => {
  it("作者的規則先套：<zzt>導覽</zzt> 這類標記換成版面，未命中的非標準標籤拿掉留內文", () => {
    const rules = [{ id: "t", name: "標題", find: "/<zzt>(.*?)<\\/zzt>/g", replace: '<div class="zzt-title">$1</div>', enabled: true }];
    const out = renderWelcome("<zzt>导览|身份登记</zzt>\n\n什亭之匣进入登记模式。<zzhud>[主角]\n名字=未登记</zzhud>", { charName: "優香", userName: "你", asset: asset(rules) });
    expect(out.html).toContain('<div class="zzt-title">导览|身份登记</div>');
    expect(out.html).not.toContain("<zzhud>");
    expect(out.html).toContain("名字=未登记");
  });

  it("功能欄（整頁美化與工具列）不進卡片頁：那是整頁對話的版面，塞進一個框只會蓋住文字", () => {
    const rules = [{ id: "s", name: "美化", find: "《美1》", replace: "<style>.zzt-title{color:red}</style>", enabled: true }];
    const out = renderWelcome("<b>嗨</b>", { charName: "c", userName: "u", asset: asset(rules, "《美1》《工1》") });
    expect(out.html).not.toContain("《美1》");
    expect(out.html).not.toContain("<style>");
    const doc = buildSrcdoc(out.html, { color: "#fff", font: "system-ui" });
    expect(doc).not.toContain("hc-mount");
    expect(doc).toContain('id="hc-welcome"');
  });

  it("開頭就是區塊 HTML 或 hc-* 元件 → 照 HTML；否則走 markdown（單換行成 <br>、**粗**）", () => {
    expect(isHeavyHtml('<section class="hc-c">x</section>')).toBe(true);
    expect(isHeavyHtml("<hc-tag>x</hc-tag>")).toBe(true);
    expect(isHeavyHtml("嗨 <b>你</b>")).toBe(false);
    const heavy = renderWelcome('<section class="hc-c"><hc-stat label="x" value="1"></hc-stat></section>', { charName: "c", userName: "u", asset: null });
    expect(heavy.html).toBe('<section class="hc-c"><hc-stat label="x" value="1"></hc-stat></section>');
    const light = renderWelcome("第一行 **粗**\n第二行 {{char}} 看著 {{user}}", { charName: "林鏡", userName: "你", asset: null });
    expect(light.html).toBe("");
    const lightHtml = renderWelcome("第一行 **粗**<br>\n第二行 {{char}}", { charName: "林鏡", userName: "你", asset: null });
    expect(lightHtml.html).toContain("<strong>粗</strong>");
    expect(lightHtml.html).toContain("林鏡");
  });

  it("沒有規則、沒有標籤的純文字 → 空字串，呼叫端走純文字氣泡", () => {
    expect(hasHtml("3 < 5")).toBe(false);
    expect(renderWelcome("你好。\n坐吧。", { charName: "c", userName: "u", asset: null }).html).toBe("");
  });
});
