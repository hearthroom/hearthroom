import { PRIMARY_HOST } from "../shared/site-hosts";
import { siteName } from "../shared/site-name";
import { LOCALES, columnTree, publicPost, recentPosts, type Column, type Locale, type Post } from "./blog";
import { oneLine, siteOgImage, type PageMeta } from "./head";
import type { Env } from "./types";

/**
 * 部落格頁面的 <head> 與 Atom。頁面與文章的內容由前端畫；這裡只給不跑 JS 的抓取器看。
 * 文章的 canonical 用文章自己的語言前綴，不跟著訪客的介面語言變。
 */
const origin = `https://${PRIMARY_HOST}`;
const prefix = (locale: string) => (locale === "zh-Hant" ? "" : `/${locale}`);
export const blogUrl = (locale: string, column?: string, slug?: string) =>
  `${origin}${prefix(locale)}/blog${column ? `/${encodeURIComponent(column)}` : ""}${slug ? `/${encodeURIComponent(slug)}` : ""}`;

const BLOG_WORD: Record<Locale, string> = { "zh-Hant": "部落格", "zh-Hans": "博客", en: "Blog", ja: "ブログ", ko: "블로그" };
const BLOG_DESCRIPTION: Record<Locale, string> = {
  "zh-Hant": "綺夢社官方部落格：新功能介紹、活動消息與創作心得。",
  "zh-Hans": "绮梦社官方博客：新功能介绍、活动消息与创作心得。",
  en: "The official Hearthroom blog: new features, event news, and tips for making cards.",
  ja: "Hearthroom 公式ブログ：新機能の紹介、イベントのお知らせ、制作のヒント。",
  ko: "Hearthroom 공식 블로그: 새 기능 소개, 이벤트 소식, 카드 제작 팁.",
};
const asLocale = (lang: string): Locale => (LOCALES as readonly string[]).includes(lang) ? (lang as Locale) : "en";
const pick = (text: Partial<Record<Locale, string>>, lang: Locale) => text[lang] || text["zh-Hant"] || text.en || Object.values(text).find(Boolean) || "";

export const blogGroupUrl = (locale: string, group: string) => `${origin}${prefix(locale)}/blog/g/${encodeURIComponent(group)}`;

/**
 * /blog、/blog/<欄目>、/blog/g/<分組>。只認公開樹裡看得到的分組與欄目（停用的、或把分組 slug 當欄目用的都是 null，
 * 呼叫端回 404＋noindex）；停用欄目或分組裡的單篇仍可開，那由 postMeta 管。
 */
export async function blogIndexMeta(db: D1Database, lang: string, target: { column?: string; group?: string }, url: string): Promise<PageMeta | null> {
  const l = asLocale(lang);
  const base = { lang: l, url, type: "website" as const, image: siteOgImage("default", l), imageSize: { width: 1200, height: 630 } };
  if (!target.column && !target.group) return { ...base, title: `${BLOG_WORD[l]} · ${siteName(l)}`, description: BLOG_DESCRIPTION[l] };
  const tree = await columnTree(db, { admin: false });
  const found: Column | undefined = target.group ? tree.find((g) => g.slug === target.group) : tree.flatMap((g) => g.columns).find((c) => c.slug === target.column);
  if (!found) return null;
  return { ...base, title: `${pick(found.name, l) || found.slug} · ${siteName(l)}`, description: pick(found.description, l) || BLOG_DESCRIPTION[l] };
}

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

const absolute = (u: string | null) => (u ? `${origin}${u}` : null);

/** 公開文章的 head；未公開或不存在是 null（呼叫端回殼＋noindex＋404）。 */
export async function postMeta(db: D1Database, column: string, slug: string, now: number): Promise<PageMeta | null> {
  const post: Post | null = await publicPost(db, column, slug, now);
  if (!post) return null;
  const title = post.shareTitle || post.title;
  const image = absolute(post.shareCoverUrl) ?? absolute(post.coverUrl);
  const url = blogUrl(post.locale, post.columnSlug, post.slug);
  const published = new Date(post.firstPublishedAt ?? post.publishAt ?? post.createdAt).toISOString();
  const modified = new Date(post.contentUpdatedAt).toISOString();
  return {
    lang: post.locale, title, url, type: "article",
    description: post.shareDescription || post.excerpt || oneLine(plainText(post.bodyMd.slice(0, 2000))),
    image: image ?? siteOgImage("default", post.locale),
    ...(image ? {} : { imageSize: { width: 1200, height: 630 } }),
    article: {
      published, modified,
      jsonLd: {
        "@context": "https://schema.org", "@type": "Article", headline: title, datePublished: published, dateModified: modified,
        image: [image ?? siteOgImage("default", post.locale)], author: { "@type": "Organization", name: siteName(post.locale) },
        mainEntityOfPage: url,
      },
    },
  };
}

// ---- Atom ------------------------------------------------------------------------

const FEED_LIMIT = 20;
// XML 1.0 不允許的控制字元與 U+FFFE／U+FFFF 留在標題裡會讓整份 feed 解析失敗，先拿掉。
// eslint-disable-next-line no-control-regex
const xml = (s: string) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[ch]!);

export async function blogFeed(env: Env, lang: string, now: number): Promise<string> {
  const l = asLocale(lang);
  const posts = await recentPosts(env.DB, now, FEED_LIMIT);
  const self = `${origin}${prefix(l)}/blog.atom`;
  const updated = new Date(Math.max(0, ...posts.map((p) => p.contentUpdatedAt)) || now).toISOString();
  const entries = posts.map((p) => {
    const link = blogUrl(p.locale, p.columnSlug, p.slug);
    return `<entry xml:lang="${p.locale}"><id>${xml(link)}</id><title>${xml(p.title)}</title><link href="${xml(link)}"/><published>${new Date(p.firstPublishedAt ?? p.createdAt).toISOString()}</published><updated>${new Date(p.contentUpdatedAt).toISOString()}</updated><summary>${xml(p.excerpt)}</summary></entry>`;
  });
  return `<?xml version="1.0" encoding="utf-8"?>\n<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="${l}"><id>${xml(self)}</id><title>${xml(`${siteName(l)} · ${BLOG_WORD[l]}`)}</title><link rel="self" href="${xml(self)}"/><link href="${xml(blogUrl(l))}"/><updated>${updated}</updated>${entries.join("")}</feed>\n`;
}
