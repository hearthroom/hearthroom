/**
 * 分享預覽：把卡片／作者的標題、簡介、圖片寫進 HTML 的 <head>。
 *
 * 這是個 SPA，Discord、LINE、X 的抓取器不跑 JS——它們看到的是 index.html 裡那幾行
 * 寫死的 meta，於是每一張卡分享出去長得一模一樣。這裡在邊緣把那幾行換掉；其餘的
 * HTML 原封不動，前端接手之後照常渲染。
 *
 * 只處理 <head> 裡已經存在的標籤與 <html lang>；沒有 SSR、不碰 <body>。
 */

export interface PageMeta {
  /** BCP 47，寫進 <html lang> 與 og:locale */
  lang: string;
  title: string;
  description: string;
  image?: string | null;
  url: string;
  type: "profile" | "website";
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);

/** 簡介壓成一行、截到抓取器會顯示的長度；多的只是浪費位元組 */
export const oneLine = (s: string, max = 200) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

/** 作者頁的一句簡介。Worker 端沒有翻譯檔，這幾個字就地寫；數字用該語言的千分位 */
const AUTHOR_LINE: Record<string, (cards: string, talks: string) => string> = {
  "zh-Hant": (c, t) => `${c} 張作品 · ${t} 次對話`,
  "zh-Hans": (c, t) => `${c} 张作品 · ${t} 次对话`,
  en: (c, t) => `${c} cards · ${t} chats`,
  ja: (c, t) => `作品 ${c} · 会話 ${t}`,
  ko: (c, t) => `작품 ${c} · 대화 ${t}`,
};
export function authorLine(lang: string, cards: number, talks: number): string {
  const fmt = new Intl.NumberFormat(lang);
  return (AUTHOR_LINE[lang] ?? AUTHOR_LINE.en!)(fmt.format(cards), fmt.format(talks));
}

const OG_LOCALE: Record<string, string> = { "zh-Hant": "zh_TW", "zh-Hans": "zh_CN", en: "en_US", ja: "ja_JP", ko: "ko_KR" };

export function renderHead(page: Response, meta: PageMeta): Response {
  const description = oneLine(meta.description);
  const tags = [
    `<link rel="canonical" href="${esc(meta.url)}">`,
    `<meta property="og:type" content="${meta.type}">`,
    `<meta property="og:title" content="${esc(meta.title)}">`,
    `<meta property="og:description" content="${esc(description)}">`,
    `<meta property="og:url" content="${esc(meta.url)}">`,
    `<meta property="og:locale" content="${OG_LOCALE[meta.lang] ?? "en_US"}">`,
    meta.image ? `<meta property="og:image" content="${esc(meta.image)}">` : "",
    `<meta name="twitter:card" content="${meta.image ? "summary_large_image" : "summary"}">`,
    `<meta name="twitter:title" content="${esc(meta.title)}">`,
    `<meta name="twitter:description" content="${esc(description)}">`,
    meta.image ? `<meta name="twitter:image" content="${esc(meta.image)}">` : "",
  ].filter(Boolean).join("");

  return new HTMLRewriter()
    .on("html", { element: (e) => { e.setAttribute("lang", meta.lang); } })
    .on("title", { element: (e) => { e.setInnerContent(meta.title); } })
    .on('meta[name="description"]', { element: (e) => { e.setAttribute("content", description); } })
    .on("head", { element: (e) => { e.append(tags, { html: true }); } })
    .transform(page);
}
