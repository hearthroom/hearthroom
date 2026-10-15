/** 工具列的每一顆鍵：在游標或選取範圍插入 Markdown，回傳新的內容與要選取的範圍。 */
import { expect, it } from "vitest";
import { applyMarkdown, MARKDOWN_TABLE } from "../src/lib/markdown-edit";

const at = (value: string, start: number, end = start) => ({ value, start, end });

it("bold and italic wrap the selection and keep it selected", () => {
  expect(applyMarkdown(at("say hi now", 4, 6), "bold")).toEqual({ value: "say **hi** now", start: 6, end: 8 });
  expect(applyMarkdown(at("say hi now", 4, 6), "italic")).toEqual({ value: "say *hi* now", start: 5, end: 7 });
});

it("with nothing selected, wraps the placeholder and selects it", () => {
  expect(applyMarkdown(at("ab", 1), "bold", "text")).toEqual({ value: "a**text**b", start: 3, end: 7 });
});

it("link wraps the text and selects the address so it can be typed over", () => {
  const r = applyMarkdown(at("see docs", 4, 8), "link");
  expect(r.value).toBe("see [docs](https://)");
  expect(r.value.slice(r.start, r.end)).toBe("https://");
});

it("headings replace an existing heading marker instead of stacking", () => {
  expect(applyMarkdown(at("# Title", 3), "h2").value).toBe("## Title");
  expect(applyMarkdown(at("## Title", 3), "h3").value).toBe("### Title");
});

it("lists and quotes prefix every selected line; numbered lists count from 1", () => {
  expect(applyMarkdown(at("a\nb\nc", 0, 5), "ul").value).toBe("- a\n- b\n- c");
  expect(applyMarkdown(at("- a\n- b", 0, 7), "ol").value).toBe("1. a\n2. b");
  expect(applyMarkdown(at("x\ny", 2), "quote").value).toBe("x\n> y");
});

it("code is inline for one line and a fenced block across lines", () => {
  expect(applyMarkdown(at("run npm", 4, 7), "code").value).toBe("run `npm`");
  expect(applyMarkdown(at("a\nb", 0, 3), "code").value).toBe("```\na\nb\n```");
});

it("table goes in as its own block with blank lines around it", () => {
  const r = applyMarkdown(at("intro\nmore", 5), "table");
  expect(r.value).toBe(`intro\n\n${MARKDOWN_TABLE}\n\nmore`);
  expect(r.value.slice(r.start, r.end)).toBe(MARKDOWN_TABLE);
});
