import { describe, expect, it } from "vitest";
import { renderReadme } from "../src/lib/card-readme";

describe("卡片介紹的 Markdown", () => {
  it("內嵌 HTML 原樣當字顯示，不變成標籤", () => {
    const html = renderReadme('<script>alert(1)</script>\n\n<img src="https://x.test/a.png" onerror="alert(1)">');
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;");
  });

  it("圖片只收 https；收下的圖延遲載入、不帶來源", () => {
    const html = renderReadme("![a](https://cdn.test/a.png) ![b](http://cdn.test/b.png) ![c](data:image/png;base64,AAAA)");
    expect(html.match(/<img /g)).toHaveLength(1);
    expect(html).toContain('src="https://cdn.test/a.png"');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('referrerpolicy="no-referrer"');
  });

  it("javascript: 連結不成為連結；一般連結開新分頁、不替外站加權", () => {
    expect(renderReadme("[x](javascript:alert(1))")).not.toContain("<a ");
    const html = renderReadme("[站](https://example.com)");
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer nofollow ugc"');
  });

  it("標題往下降兩級，表格包一層可以橫捲的框", () => {
    const html = renderReadme("# 大標\n\n## 小標\n\n| a | b |\n|---|---|\n| 1 | 2 |");
    expect(html).toContain("<h3>大標</h3>");
    expect(html).toContain("<h4>小標</h4>");
    expect(html).toContain('<div class="readme__table"><table>');
  });
});
