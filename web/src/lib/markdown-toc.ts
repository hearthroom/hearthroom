/**
 * 文件頁的 Markdown 渲染：標題帶 id、抽出 h2／h3 當目錄。
 *
 * 為什麼自己寫而不裝 markdown-it-anchor：要的只有「id 穩定、中文能當錨點、同名不撞」三件事，
 * 十幾行就夠；多一個依賴要多維護一份它的 slug 規則。文件不允許內嵌 HTML（html: false）。
 */
import MarkdownIt from "markdown-it";

export interface TocItem {
  level: 2 | 3;
  id: string;
  text: string;
}

/** 中英數保留（含 CJK）、空白變連字號、其餘標點丟掉、大小寫壓平。 */
export function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}-]+/gu, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
}

const md = new MarkdownIt({ html: false, linkify: true });

export function renderDoc(source: string): { html: string; toc: TocItem[] } {
  const toc: TocItem[] = [];
  const seen = new Map<string, number>();
  const tokens = md.parse(source, {});
  for (let i = 0; i < tokens.length; i++) {
    const open = tokens[i];
    if (open.type !== "heading_open") continue;
    const level = Number(open.tag.slice(1));
    const text = tokens[i + 1]?.content ?? "";
    const base = slugify(text) || "section";
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    const id = n === 1 ? base : `${base}-${n}`;
    open.attrSet("id", id);
    if (level === 2 || level === 3) toc.push({ level, id, text });
  }
  return { html: md.renderer.render(tokens, md.options, {}), toc };
}
