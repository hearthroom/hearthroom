import { PRIMARY_HOST } from "../shared/site-hosts";
import { columnTree, matchesBlogLocale, LOCALES, recentPosts, type Post } from "./blog";
import { blogGroupUrl, blogUrl } from "./blog-head";
import { listCampaigns } from "./campaign";

/**
 * /sitemap.xml（HearthroomBlogEngagement_TechnicalDesign_20261016_V0.1.md §6）：首頁、更新頁、部落格（首頁、分組、欄目、文章）
 * 與公開活動頁。卡片頁數量多、要分頁，另做。網址一律主網域；文章用自己的語言前綴，跟 canonical 一致。
 */
const origin = `https://${PRIMARY_HOST}`;
const prefix = (l: string) => (l === "zh-Hant" ? "" : `/${l}`);
/** 一份 sitemap 的上限是五萬個網址；文章遠少於此，這裡只是防呆 */
const POST_LIMIT = 5000;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const entry = (loc: string, lastmod?: number | null) => `<url><loc>${esc(loc)}</loc>${lastmod ? `<lastmod>${new Date(lastmod).toISOString()}</lastmod>` : ""}</url>`;

export async function sitemapXml(db: D1Database, now: number): Promise<string> {
  const [tree, posts, campaigns] = await Promise.all([columnTree(db, { admin: false }), recentPosts(db, now, POST_LIMIT), listCampaigns(db, { includeDraft: false })]);
  const newest = (keep: (p: Post) => boolean) => Math.max(0, ...posts.filter(keep).map((p) => p.contentUpdatedAt)) || null;
  const out: string[] = [];
  for (const l of LOCALES) {
    out.push(entry(`${origin}${prefix(l) || "/"}`), entry(`${origin}${prefix(l)}/updates`), entry(blogUrl(l), newest(p => matchesBlogLocale(p, l))));
    for (const g of tree) {
      const inGroup = new Set(g.columns.map((c) => c.slug));
      out.push(entry(blogGroupUrl(l, g.slug), newest((p) => matchesBlogLocale(p, l) && inGroup.has(p.columnSlug))));
      for (const c of g.columns) out.push(entry(blogUrl(l, c.slug), newest((p) => matchesBlogLocale(p, l) && p.columnSlug === c.slug)));
    }
  }
  for (const p of posts) out.push(entry(blogUrl(p.locale, p.columnSlug, p.slug), p.contentUpdatedAt));
  for (const c of campaigns) out.push(entry(`${origin}/campaign/${encodeURIComponent(c.slug)}`, c.updatedAt));
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${out.join("")}</urlset>\n`;
}
