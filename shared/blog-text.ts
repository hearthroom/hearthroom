/** 內文前面的一段純文字：去掉 Markdown 符號，連結與圖片只留文字。 */
export function plainText(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]*>/g, " ")
    .replace(/^[ \t]*(?:#{1,6}|>|[-*+]|\d+\.)[ \t]+/gm, "")
    .replace(/[*_`~|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Identical description text for Worker head and SPA navigation. */
export function blogDescription(p:{shareDescription?:string|null;excerpt:string;bodyMd:string}):string{
 const text=(p.shareDescription||p.excerpt||plainText(p.bodyMd.slice(0,2000))).replace(/\s+/g,' ').trim();
 return text.length>200?`${text.slice(0,199)}…`:text;
}
