/**
 * 卡片介紹（作者用 Markdown 寫的 README，owner 2026-10-11）。
 *
 * 這是作者寫給訪客看的公開頁面，不是 AI 生成的 HTML 卡（那條功能刻意執行作者的 script，見
 * .claude/rules/ai-generated-html-trust-model.md）。這裡只收 Markdown：
 *   - 不收內嵌 HTML（html: false），標籤原樣當字顯示；
 *   - 圖片只收 https，其他來源的圖不畫（http 會被瀏覽器擋成混合內容，data: 可以塞很大一包）；
 *   - 連結開新分頁，不帶來源、不替外站加權（nofollow ugc）；
 *   - 標題往下降兩級：頁面的 h1 是卡名，介紹裡的 # 不能跟它搶。
 */
import MarkdownIt from "markdown-it";

const md = new MarkdownIt({ html: false, linkify: true, breaks: true });

const defaultImage = md.renderer.rules.image!;
md.renderer.rules.image = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  const src = token.attrGet("src") ?? "";
  if (!/^https:\/\//i.test(src)) return "";
  token.attrSet("loading", "lazy");
  token.attrSet("decoding", "async");
  token.attrSet("referrerpolicy", "no-referrer");
  return defaultImage(tokens, idx, options, env, self);
};

md.renderer.rules.link_open = (tokens, idx, options, _env, self) => {
  const token = tokens[idx];
  token.attrSet("target", "_blank");
  token.attrSet("rel", "noopener noreferrer nofollow ugc");
  return self.renderToken(tokens, idx, options);
};

// # → h3、## → h4，最深到 h6
md.core.ruler.push("readme_heading_shift", (state) => {
  for (const token of state.tokens) {
    if (token.type !== "heading_open" && token.type !== "heading_close") continue;
    token.tag = `h${Math.min(6, Number(token.tag.slice(1)) + 2)}`;
  }
});

// 表格包一層可以橫捲的框：窄螢幕上不把整頁撐寬
md.renderer.rules.table_open = () => '<div class="readme__table"><table>';
md.renderer.rules.table_close = () => "</table></div>";

export function renderReadme(source: string): string {
  return md.render(source);
}
