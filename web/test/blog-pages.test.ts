/**
 * 官方部落格的列表與文章頁：第一篇置頂做大圖、其餘是卡片網格；文章頁照文件頁的方式渲染
 * Markdown（不吃 HTML、標題抽目錄），預覽模式有提示，進頁與讀到文末各記一次。
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, nextTick, type App } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { dateOnly } from "../src/lib/format";
import { i18n } from "../src/lib/i18n";

const tracked = vi.hoisted(() => [] as { event: string; data: Record<string, unknown> }[]);
vi.mock("../src/lib/track", () => ({ track: (event: string, data: Record<string, unknown> = {}) => tracked.push({ event, data }), currentSurface: () => "blog", setSurface: () => {} }));
vi.mock("../src/components/CommentPanel.vue", () => ({
  default: defineComponent({ props: ["target"], render() { return h("div", { class: "cmt-stub", "data-post": (this as { target?: { postId: string } }).target?.postId }); } }),
}));

import BlogListPage from "../src/pages/BlogListPage.vue";
import BlogPostPage from "../src/pages/BlogPostPage.vue";

const card = (id: string, extra: Record<string, unknown> = {}) => ({
  id, columnSlug: "news", slug: `post-${id}`, title: `標題 ${id}`, excerpt: `摘要 ${id}`, coverUrl: null, locale: "zh-Hant",
  firstPublishedAt: Date.UTC(2026, 9, 10), pinned: false, campaign: null, readMinutes: 3, commentCount: 0, ...extra,
});
const columns = { items: [
  { id: "g1", slug: "official", name: { "zh-Hant": "官方消息" }, description: {}, sort: 0, enabled: true, parentId: null,
    columns: [{ id: "c1", slug: "news", name: { "zh-Hant": "公告" }, description: {}, sort: 0, enabled: true, parentId: "g1" }, { id: "c2", slug: "events", name: { "zh-Hant": "活動" }, description: {}, sort: 1, enabled: true, parentId: "g1" }] },
  { id: "g2", slug: "creators", name: { "zh-Hant": "創作指南" }, description: {}, sort: 1, enabled: true, parentId: null,
    columns: [{ id: "c3", slug: "guides", name: { "zh-Hant": "寫卡教程" }, description: {}, sort: 0, enabled: true, parentId: "g2" }] },
] };
let routes: Record<string, unknown>;
const fetched: string[] = [];

let app: App, host: HTMLElement;
beforeEach(() => {
  i18n.global.locale.value = "zh-Hant";
  tracked.length = 0;
  fetched.length = 0;
  routes = { "/v1/blog/columns": columns };
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    fetched.push(url);
    const path = url.split("?")[0]!;
    const body = routes[url] ?? routes[path];
    return body === undefined ? new Response(JSON.stringify({ error: "blog_post_not_found" }), { status: 404 }) : new Response(JSON.stringify(body), { status: 200 });
  }));
});
afterEach(() => { app?.unmount(); host?.remove(); document.body.innerHTML = ""; vi.unstubAllGlobals(); });

async function mount(component: object, path: string, pattern: string) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: pattern, component: { render: () => null } }, { path: "/:p(.*)*", component: { render: () => null } }] });
  await router.push(path); await router.isReady();
  host = document.body.appendChild(document.createElement("div"));
  app = createApp(component).use(router).use(i18n);
  app.mount(host);
  for (let i = 0; i < 6; i++) { await nextTick(); await new Promise((r) => setTimeout(r, 0)); }
  return host;
}
const t = (k: string, v: Record<string, unknown> = {}) => i18n.global.t(k, v);

it("lists the first pinned post as the hero and the rest as a card grid, with the column tabs and load more", async () => {
  routes["/v1/blog/posts"] = { total: 13, pinned: [card("p1", { pinned: true }), card("p2", { pinned: true })], items: [card("a"), card("b")] };
  const root = await mount(BlogListPage, "/blog", "/blog/:column?");
  expect(root.querySelector(".blog__hero")!.textContent).toContain("標題 p1");
  const grid = [...root.querySelectorAll(".blog__grid .post-card__title")].map((e) => e.textContent);
  expect(grid).toEqual(["標題 p2", "標題 a", "標題 b"]);
  const tabs = [...root.querySelectorAll(".blog__tabs--groups a")].map((a) => a.textContent?.trim());
  expect(tabs).toEqual([t("blog.all"), "官方消息", "創作指南"]);
  expect(root.querySelector(".blog__tabs--columns")).toBeNull();
  expect(root.querySelector(".blog__hero")!.textContent).toContain(t("blog.readMinutes", { n: 3 }));
  expect(root.querySelector(".blog__hero a")!.getAttribute("href")).toBe("/blog/news/post-p1");
  expect([...root.querySelectorAll("button")].some((b) => b.textContent?.trim() === t("comment.loadMore"))).toBe(true);
});

it("says there are no posts yet when the list is empty", async () => {
  routes["/v1/blog/posts"] = { total: 0, pinned: [], items: [] };
  const root = await mount(BlogListPage, "/blog/news", "/blog/:column?");
  expect(fetched.some((u) => u.includes("column=news"))).toBe(true);
  expect(root.textContent).toContain(t("blog.empty"));
});

const post = (extra: Record<string, unknown> = {}) => ({
  post: {
    id: "p9", columnId: "c1", columnSlug: "news", slug: "hello", locale: "zh-Hant", title: "開站公告", excerpt: "摘要", coverUrl: null,
    bodyMd: "## 第一節\n\n內文 <script>alert(1)</script>\n\n## 第二節\n\n### 小節\n\n結尾", status: "published", publishAt: 1, firstPublishedAt: Date.UTC(2026, 9, 10),
    pinned: false, commentsClosed: false, pinnedCommentId: null, updatedAt: Date.UTC(2026, 9, 20), contentUpdatedAt: Date.UTC(2026, 9, 10), createdAt: 1, version: 1, official: true, readMinutes: 2, ...extra,
  },
  adjacent: { prev: card("old"), next: null },
  related: [card("r1")],
});

it("renders the post with a table of contents and escapes HTML in the body", async () => {
  routes["/v1/blog/posts/news/hello"] = post();
  const root = await mount(BlogPostPage, "/blog/news/hello", "/blog/:column/:slug");
  expect(root.querySelector("h1")!.textContent).toBe("開站公告");
  const article = root.querySelector(".blog-post__body")!;
  expect(article.querySelector("script")).toBeNull();
  expect(article.textContent).toContain("<script>alert(1)</script>");
  expect([...root.querySelectorAll(".toc__link")].map((a) => a.textContent)).toEqual(["第一節", "第二節", "小節"]);
  expect(root.textContent).toContain(t("blog.official"));
  expect(root.textContent).toContain(t("blog.prev"));
  expect(root.textContent).toContain("標題 r1");
  expect(root.querySelector(".cmt-stub")!.getAttribute("data-post")).toBe("p9");
  expect(root.textContent).not.toContain(t("blog.preview"));
  expect(tracked).toContainEqual({ event: "blog_view", data: { subject: "hello" } });
});

it("labels a post updated by its latest content save, not by a pin or comment switch", async () => {
  routes["/v1/blog/posts/news/hello"] = post();
  expect((await mount(BlogPostPage, "/blog/news/hello", "/blog/:column/:slug")).textContent).not.toContain(t("blog.updated", { date: "" }).trim());
  app.unmount(); host.remove();
  routes["/v1/blog/posts/news/hello"] = post({ contentUpdatedAt: Date.UTC(2026, 9, 15) });
  expect((await mount(BlogPostPage, "/blog/news/hello", "/blog/:column/:slug")).textContent).toContain(t("blog.updated", { date: dateOnly(Date.UTC(2026, 9, 15) / 1000) }));
});

it("shows a decorative monogram on a card without a cover: the column name, else the first character of the title", async () => {
  routes["/v1/blog/posts"] = { total: 2, pinned: [card("p1", { pinned: true })], items: [card("a", { title: "你好世界" }), card("b", { coverUrl: "/v1/blog/images/x.webp" })] };
  const root = await mount(BlogListPage, "/blog", "/blog/:column?");
  const monos = [...root.querySelectorAll(".post-card__mono")];
  expect(monos.map((m) => m.textContent)).toEqual(["公告", "公告"]);
  expect(monos.every((m) => m.getAttribute("aria-hidden") === "true")).toBe(true);
  expect(root.querySelector(".blog__hero .post-card__mono")).not.toBeNull();
  expect(root.querySelectorAll(".post-card__cover img")).toHaveLength(1);
  expect(root.querySelector(".post-card__cover img")!.getAttribute("alt")).toBe("");
  routes["/v1/blog/posts"] = { total: 1, pinned: [], items: [card("c", { columnSlug: "ghost", title: "你好世界" })] };
  app.unmount(); host.remove();
  expect((await mount(BlogListPage, "/blog", "/blog/:column?")).querySelector(".post-card__mono")!.textContent).toBe("你");
});

it("shows the preview notice and sends the token when the link carries one", async () => {
  routes["/v1/blog/posts/news/hello?preview=tok%2B1"] = post({ status: "draft" });
  const root = await mount(BlogPostPage, "/blog/news/hello?preview=tok%2B1", "/blog/:column/:slug");
  expect(root.textContent).toContain(t("blog.preview"));
  expect(tracked.some((e) => e.event === "blog_view")).toBe(false);
});

it("shows the not-found page for a post that does not exist", async () => {
  const root = await mount(BlogPostPage, "/blog/news/missing", "/blog/:column/:slug");
  expect(root.textContent).toContain(t("notFound.title"));
});

it("records reaching the end once, and a copied link as a share", async () => {
  const watched: { el: Element; fire: (hit: boolean) => void }[] = [];
  vi.stubGlobal("IntersectionObserver", class {
    constructor(private cb: (e: { isIntersecting: boolean; target: Element; boundingClientRect: { top: number } }[]) => void) {}
    observe(el: Element) { watched.push({ el, fire: (hit) => this.cb([{ isIntersecting: hit, target: el, boundingClientRect: { top: 0 } }]) }); }
    disconnect() {}
  });
  const writeText = vi.fn(async () => {});
  vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
  routes["/v1/blog/posts/news/hello"] = post();
  const root = await mount(BlogPostPage, "/blog/news/hello", "/blog/:column/:slug");
  const end = watched.find((w) => w.el.classList.contains("blog-post__share"))!;
  end.fire(false); end.fire(true); end.fire(true);
  expect(tracked.filter((e) => e.event === "blog_read_end")).toEqual([{ event: "blog_read_end", data: { subject: "hello" } }]);
  [...root.querySelectorAll("button")].find((b) => b.textContent?.trim() === t("blog.copyLink"))!.click();
  await vi.waitFor(() => expect(tracked).toContainEqual({ event: "blog_share", data: { detail: "share_clipboard", subject: "hello" } }));
  expect(writeText).toHaveBeenCalledWith(`${location.origin}/blog/news/hello`);
  expect(root.textContent).toContain(t("blog.copied"));
});

it("a group page lists that group's posts, with its columns as a second row of tabs", async () => {
  routes["/v1/blog/posts"] = { total: 1, pinned: [], items: [card("a")] };
  const root = await mount(BlogListPage, "/blog/g/official", "/blog/g/:group");
  expect(fetched.some((u) => u.includes("/v1/blog/posts?group=official&page=1"))).toBe(true);
  expect(root.querySelector(".blog__tabs--groups .blog__tab--on")!.textContent?.trim()).toBe("官方消息");
  const cols = [...root.querySelectorAll(".blog__tabs--columns a")].map((a) => a.textContent?.trim());
  expect(cols).toEqual([t("blog.all"), "公告", "活動"]);
});

it("a column page highlights the group it belongs to", async () => {
  routes["/v1/blog/posts"] = { total: 0, pinned: [], items: [] };
  const root = await mount(BlogListPage, "/blog/guides", "/blog/:column?");
  expect(fetched.some((u) => u.includes("column=guides"))).toBe(true);
  expect(root.querySelector(".blog__tabs--groups .blog__tab--on")!.textContent?.trim()).toBe("創作指南");
  expect(root.querySelector(".blog__tabs--columns .blog__tab--on")!.textContent?.trim()).toBe("寫卡教程");
});

it("the post page shows where it lives: blog › group › column", async () => {
  routes["/v1/blog/posts/news/hello"] = post();
  const root = await mount(BlogPostPage, "/blog/news/hello", "/blog/:column/:slug");
  const crumbs = [...root.querySelectorAll(".blog-post__crumbs a")].map((a) => [a.textContent?.trim(), a.getAttribute("href")]);
  expect(crumbs).toEqual([[t("blog.title"), "/blog"], ["官方消息", "/blog/g/official"], ["公告", "/blog/news"]]);
});
