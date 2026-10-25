import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { beforeEach, expect, it } from "vitest";
import worker from "../src/index";
import { adjacentPosts, LOCALES, publicPost, publicPosts, relatedPosts, saveColumn, savePost, setPostState, type PostCard } from "../src/blog";
import { sitemapXml } from "../src/sitemap";
import { blogFeed } from "../src/blog-head";
import { makeReviewer, resetDb } from "./helpers";

let memberId: string, columnId: string;
const actor = () => ({ memberId, kind: "human" as const });
const op = () => crypto.randomUUID();
async function publish(slug: string, locale: typeof LOCALES[number], at = 100, pinned = false) {
  const p = await savePost(env.DB, { columnId, slug, locale, title: slug, excerpt: "", bodyMd: "body" }, actor(), op(), 1);
  await setPostState(env.DB, p.id, { status: "published", publishAt: at }, actor(), op(), at);
  if (pinned) await setPostState(env.DB, p.id, { pinned: true }, actor(), op(), at);
  return p.id;
}
async function api(path: string) {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request(`https://c.test${path}`), env, ctx);
  await waitOnExecutionContext(ctx);
  expect(res.status).toBe(200);
  return await res.json() as { total: number; pinned: PostCard[]; items: PostCard[]; adjacent: {prev: PostCard | null; next: PostCard | null}; related: PostCard[] };
}
beforeEach(async () => {
  await resetDb();
  memberId = await makeReviewer(50001);
  const group = await saveColumn(env.DB, { slug: "official", name: { "zh-Hant": "官方" }, description: {}, sort: 0, enabled: true }, actor(), op(), 1);
  columnId = (await saveColumn(env.DB, { slug: "news", parentId: group.id, name: { "zh-Hant": "官方" }, description: {}, sort: 0, enabled: true }, actor(), op(), 1)).id;
});
it("filters all public list scopes and pinned posts before count, pagination and limits", async () => {
  await publish("old-announcement", "zh-Hant", 50, true);
  for (const l of LOCALES) await publish(`guide-${l.toLowerCase()}`, l, 100, true);
  for (const locale of LOCALES) {
    for (const scope of ["", "&column=news", "&group=official"]) {
      const data = await api(`/v1/blog/posts?locale=${locale}${scope}`);
      const slugs = [...data.pinned, ...data.items].map(p => p.slug).sort();
      expect(slugs).toEqual([`guide-${locale.toLowerCase()}`, ...(/^zh-/.test(locale) ? ["old-announcement"] : [])].sort());
    }
  }
  for (let i = 0; i < 15; i++) await publish(`entry-${i}-en`, "en", 200 + i);
  const first = await api("/v1/blog/posts?locale=en&page=1");
  const second = await api("/v1/blog/posts?locale=en&page=2");
  expect(first.total).toBe(15);
  expect(first.items).toHaveLength(12);
  expect(second.items).toHaveLength(3);
  expect(new Set([...first.items, ...second.items].map(p => p.id)).size).toBe(15);
  expect((await api("/v1/blog/posts?locale=invalid")).pinned.map(p => p.slug)).toContain("guide-zh-hant");
});
it("keeps Chinese legacy fallback in both directions but excludes suffixed translations", async () => {
  await publish("old-hans", "zh-Hans");
  await publish("version-zh-hans", "zh-Hans");
  expect((await publicPosts(env.DB, { locale: "zh-Hant", page: 1, now: 300 })).items.map(p => p.slug)).toEqual(["old-hans"]);
});
it("uses viewer locale for adjacent and related posts, including a legacy article", async () => {
  await publish("older-zh-hans", "zh-Hans", 90);
  await publish("wrong-en", "en", 95);
  await publish("legacy", "zh-Hant", 100);
  await publish("newer-zh-hans", "zh-Hans", 110);
  await publish("wrong-ja", "ja", 105);
  const data = await api("/v1/blog/posts/news/legacy?locale=zh-Hans");
  expect(data.adjacent.prev?.slug).toBe("older-zh-hans");
  expect(data.adjacent.next?.slug).toBe("newer-zh-hans");
  expect(data.related.map(p => p.slug).sort()).toEqual(["newer-zh-hans", "older-zh-hans"]);
  const p = (await publicPost(env.DB, "news", "legacy", 200))!;
  expect((await adjacentPosts(env.DB, p, 200)).prev).toBeNull();
  expect(await relatedPosts(env.DB, p, 200)).toEqual([]);
});
it("filters each Atom feed before the twenty-entry limit", async () => {
  await publish("guide-zh-hans", "zh-Hans", 50);
  await publish("legacy", "zh-Hant", 51);
  for (let i = 0; i < 22; i++) await publish(`entry-${i}-en`, "en", 100 + i);
  const feed = await blogFeed(env, "zh-Hans", 200);
  expect(feed).toContain("guide-zh-hans");
  expect(feed).toContain("legacy");
  expect(feed).not.toContain("entry-21-en");
});

it("dates localized sitemap indexes only from matching posts while keeping each article canonical", async () => {
  await publish("legacy", "zh-Hant", 100);
  await publish("guide-en", "en", 500);
  const xml = await sitemapXml(env.DB, 1000);
  const entry = (path: string) => xml.match(new RegExp(`<url><loc>https://[^<]+${path}</loc>(.*?)</url>`))?.[1];
  expect(entry("/zh-Hans/blog/news")).toContain(new Date(100).toISOString());
  expect(entry("/en/blog/news")).toContain(new Date(500).toISOString());
  expect(entry("/ja/blog/news")).toBe("");
  expect(xml).toContain("/en/blog/news/guide-en</loc>");
  expect(xml).not.toContain("/ja/blog/news/guide-en</loc>");
});
