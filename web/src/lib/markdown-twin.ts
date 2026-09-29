import { SOURCE_LOCALE } from "./i18n";

/**
 * 文件頁的 Markdown 孿生檔：同一條路徑加 .md，語言跟著前綴走（web/build/llms-docs.ts 建置時產出）。
 * 這裡只列有孿生檔的頁；測試會對照建置產出的路徑清單，加頁要兩邊一起加。
 */
export const MARKDOWN_TWIN_PAGES: readonly string[] = ["guide", "developers"];

/**
 * 在 <head> 放一個 <link rel="alternate" type="text/markdown">，讓讀 HTML 的 agent 找得到原文。
 * 跟 hreflang 一樣每次導航重算：換頁就換連結，沒有孿生檔的頁就拿掉。
 */
export function updateMarkdownTwin(barePath: string, locale: string): void {
  document.head.querySelectorAll("link[data-md-twin]").forEach((el) => el.remove());
  const page = barePath.replace(/^\//, "").replace(/\/$/, "");
  if (!MARKDOWN_TWIN_PAGES.includes(page)) return;
  const link = document.createElement("link");
  link.rel = "alternate";
  link.type = "text/markdown";
  link.href = new URL(`${locale === SOURCE_LOCALE ? "" : `/${locale}`}/${page}.md`, location.origin).toString();
  link.dataset.mdTwin = "1";
  document.head.appendChild(link);
}
