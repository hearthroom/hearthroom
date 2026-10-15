/**
 * 文章編輯器工具列：在游標或選取範圍插入 Markdown。純函式，回傳新內容與插入後要選取的範圍，
 * 讓編輯器把游標放回去（例如連結會選起「https://」，直接打網址就蓋掉）。
 */
export type MarkdownAction = "h2" | "h3" | "bold" | "italic" | "link" | "quote" | "ul" | "ol" | "table" | "code" | "image";
export interface Edit { value: string; start: number; end: number }

/** 表格範本：兩欄、表頭與一列空白，用哪一種語言寫都通用 */
export const MARKDOWN_TABLE = "|  |  |\n| --- | --- |\n|  |  |";

const lineStart = (v: string, i: number) => v.lastIndexOf("\n", i - 1) + 1;
const lineEnd = (v: string, i: number) => { const n = v.indexOf("\n", i); return n === -1 ? v.length : n; };

function wrap({ value, start, end }: Edit, before: string, after: string, placeholder: string): Edit {
  const picked = value.slice(start, end) || placeholder;
  return { value: value.slice(0, start) + before + picked + after + value.slice(end), start: start + before.length, end: start + before.length + picked.length };
}

/** 選取範圍碰到的每一行加前綴；同一類的舊前綴先拿掉（標題換級、清單換種類不會疊在一起） */
function prefixLines({ value, start, end }: Edit, prefix: (i: number) => string, strip: RegExp): Edit {
  const from = lineStart(value, start), to = lineEnd(value, end);
  const block = value.slice(from, to).split("\n").map((l, i) => prefix(i) + l.replace(strip, "")).join("\n");
  return { value: value.slice(0, from) + block + value.slice(to), start: from, end: from + block.length };
}

/** 自成一段的區塊：前後各留一個空行（已經有就不重複） */
function block({ value, start, end }: Edit, text: string): Edit {
  const before = value.slice(0, start), after = value.slice(end);
  const lead = !before || before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
  const tail = !after ? "" : after.startsWith("\n\n") ? "" : after.startsWith("\n") ? "\n" : "\n\n";
  const at = before.length + lead.length;
  return { value: before + lead + text + tail + after, start: at, end: at + text.length };
}

const HEADING = /^#{1,6}\s+/, LIST = /^\s*(?:[-*+]|\d+\.)\s+/, QUOTE = /^>\s?/;

export function applyMarkdown(e: Edit, action: Exclude<MarkdownAction, "image">, placeholder = ""): Edit {
  switch (action) {
    case "h2": return prefixLines(e, () => "## ", HEADING);
    case "h3": return prefixLines(e, () => "### ", HEADING);
    case "bold": return wrap(e, "**", "**", placeholder);
    case "italic": return wrap(e, "*", "*", placeholder);
    case "link": {
      const r = wrap(e, "[", "](https://)", placeholder);
      return { value: r.value, start: r.end + 2, end: r.end + 2 + "https://".length };
    }
    case "quote": return prefixLines(e, () => "> ", QUOTE);
    case "ul": return prefixLines(e, () => "- ", LIST);
    case "ol": return prefixLines(e, (i) => `${i + 1}. `, LIST);
    case "table": return block(e, MARKDOWN_TABLE);
    case "code": return e.value.slice(e.start, e.end).includes("\n") ? wrap(e, "```\n", "\n```", placeholder) : wrap(e, "`", "`", placeholder);
  }
}
