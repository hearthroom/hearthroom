/**
 * 開發者文件的目錄：從 Markdown 的 h2／h3 抽出來，標題本身要帶 id 讓目錄跳得過去。
 * id 要穩定（同一份文件每次一樣）、中文標題也要能當錨點、同名標題不能撞。
 */
import { describe, expect, it } from "vitest";
import { renderDoc, slugify } from "../src/lib/markdown-toc";

describe("slugify", () => {
  it("中英數保留、空白變連字號、標點丟掉、大小寫壓平", () => {
    expect(slugify("1. 第 0 級：身分（OAuth）")).toBe("1-第-0-級身分oauth");
    expect(slugify("Hello World!")).toBe("hello-world");
    expect(slugify("2.1 `role/detail` 本站讀的欄位")).toBe("21-roledetail-本站讀的欄位");
  });
});

describe("renderDoc", () => {
  const source = "# 標題\n\n段落\n\n## 一、開始\n\n文字\n\n### 細節\n\n## 一、開始\n\n又來一次";
  it("h2／h3 進目錄、h1 不進；標題元素帶 id；同名標題 id 加序號不撞", () => {
    const { html, toc } = renderDoc(source);
    expect(toc).toEqual([
      { level: 2, id: "一開始", text: "一、開始" },
      { level: 3, id: "細節", text: "細節" },
      { level: 2, id: "一開始-2", text: "一、開始" },
    ]);
    expect(html).toContain('<h2 id="一開始">');
    expect(html).toContain('<h2 id="一開始-2">');
    expect(html).toContain('<h3 id="細節">');
  });
  it("標題裡的行內標記不進目錄：`code` 拿掉反引號、粗體拿掉星號", () => {
    const { toc } = renderDoc("## 2.1 `role/detail` 本站讀的欄位\n\n## 六、玩家人設與 **{{user}}**");
    expect(toc.map((t) => t.text)).toEqual(["2.1 role/detail 本站讀的欄位", "六、玩家人設與 {{user}}"]);
    expect(toc[0].id).toBe("21-roledetail-本站讀的欄位");
  });

  it("不允許內嵌 HTML，連結自動加上", () => {
    const { html } = renderDoc("<b>x</b> https://example.com");
    expect(html).toContain("&lt;b&gt;");
    expect(html).toContain('href="https://example.com"');
  });
});
