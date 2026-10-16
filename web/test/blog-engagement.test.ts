/**
 * 文章頁的閱讀數與喜歡：同一個瀏覽器一天只記一次閱讀，localStorage 壞掉照記；預覽不記；
 * 閱讀數未滿門檻（伺服器回 null）不顯示；訪客按喜歡出現登入面板；會員按下去立刻變、失敗還原。
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, nextTick, type App } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { i18n } from "../src/lib/i18n";

const tracked = vi.hoisted(() => [] as { event: string; data: Record<string, unknown> }[]);
const session = vi.hoisted(() => ({ me: null as null | { accountNumId: number }, ready: true, restore: async () => {}, accessToken: async () => "tok" }));
vi.mock("../src/lib/track", () => ({ track: (event: string, data: Record<string, unknown> = {}) => tracked.push({ event, data }), currentSurface: () => "blog", setSurface: () => {} }));
vi.mock("../src/lib/session", () => ({ useSession: () => session }));
vi.mock("../src/components/CommentPanel.vue", () => ({ default: defineComponent({ render: () => h("div") }) }));
vi.mock("../src/components/GuestSignInSheet.vue", () => ({ default: defineComponent({ render: () => h("div", { "data-signin": "" }) }) }));

import BlogPostPage from "../src/pages/BlogPostPage.vue";

const post = {
  post: { id: "p9", columnSlug: "news", slug: "hello", title: "開站了", excerpt: "", coverUrl: null, locale: "zh-Hant", firstPublishedAt: 1, pinned: false, readMinutes: 1, commentCount: 0,
    campaign: null, bodyMd: "內文", status: "published", publishAt: 1, commentsClosed: false, pinnedCommentId: null, createdAt: 1, updatedAt: 1, contentUpdatedAt: 1, official: true, columnId: "c1" },
  adjacent: { prev: null, next: null }, related: [],
};
type Call = { method: string; path: string; body: any; auth: string | null };
let calls: Call[];
let stats: { views: number | null; likes: number; liked: boolean };
let likeStatus: number;

let app: App, host: HTMLElement;
beforeEach(() => {
  i18n.global.locale.value = "zh-Hant";
  tracked.length = 0;
  calls = [];
  session.me = null;
  session.ready = true;
  session.restore = async () => {};
  stats = { views: null, likes: 0, liked: false };
  likeStatus = 200;
  localStorage.clear();
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    const path = url.split("?")[0]!.replace(/^.*\/v1/, "/v1");
    const headers = (init.headers ?? {}) as Record<string, string>;
    calls.push({ method, path, body: typeof init.body === "string" ? JSON.parse(init.body) : null, auth: headers.Authorization ?? null });
    if (path === "/v1/blog/columns") return new Response(JSON.stringify({ items: [] }));
    if (path === "/v1/blog/posts/news/hello") return new Response(JSON.stringify(post));
    if (path === "/v1/blog/posts/p9/view") return new Response(JSON.stringify(stats));
    if (path === "/v1/blog/posts/p9/like") return likeStatus === 200 ? new Response(JSON.stringify({ likes: stats.likes + (method === "PUT" ? 1 : -1), liked: method === "PUT" })) : new Response("{}", { status: likeStatus });
    return new Response(JSON.stringify({ error: "not_found" }), { status: 404 });
  }));
});
afterEach(() => { app?.unmount(); host?.remove(); document.body.innerHTML = ""; vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function settle() { for (let i = 0; i < 8; i++) { await nextTick(); await new Promise((r) => setTimeout(r, 0)); } }
async function mount(path = "/blog/news/hello") {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/blog/:column/:slug", component: { render: () => null } }, { path: "/:p(.*)*", component: { render: () => null } }] });
  await router.push(path); await router.isReady();
  host = document.body.appendChild(document.createElement("div"));
  app = createApp(BlogPostPage).use(router).use(i18n);
  app.mount(host);
  await settle();
  return host;
}
const t = (k: string, v: Record<string, unknown> = {}) => i18n.global.t(k, v);
const views = () => calls.filter((c) => c.path === "/v1/blog/posts/p9/view");
const likeBtn = () => host.querySelector<HTMLButtonElement>('[data-action="like"]')!;

it("counts a view the first time today only", async () => {
  await mount();
  app.unmount(); host.remove();
  await mount();
  expect(views().map((c) => c.body)).toEqual([{ count: true }, { count: false }]);
});

it("still counts the view and shows the post when storage is unavailable", async () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
  const root = await mount();
  expect(root.querySelector("h1")!.textContent).toBe("開站了");
  expect(views().map((c) => c.body)).toEqual([{ count: true }]);
});

it("does not count previews", async () => {
  await mount("/blog/news/hello?preview=abc");
  expect(views()).toEqual([]);
});

it("shows the view count only when the server returns one", async () => {
  const meta = async () => (await mount()).querySelector(".blog-post__meta")!.textContent!;
  expect(await meta()).not.toContain(t("blog.views", { n: "" }).trim());
  app.unmount(); host.remove();
  stats = { views: 1234, likes: 0, liked: false };
  const n = new Intl.NumberFormat("zh-Hant", { notation: "compact", maximumFractionDigits: 1 }).format(1234);
  expect(await meta()).toContain(t("blog.views", { n }));
});

it("asks a guest to sign in instead of liking", async () => {
  await mount();
  likeBtn().click();
  await settle();
  expect(host.querySelector("[data-signin]")).not.toBeNull();
  expect(calls.some((c) => c.path.endsWith("/like"))).toBe(false);
});

it("likes at once for a member and rolls back when the request fails", async () => {
  session.me = { accountNumId: 7 };
  stats = { views: null, likes: 4, liked: false };
  await mount();
  expect(views()[0]!.auth).toBe("Bearer tok");
  likeBtn().click();
  await nextTick();
  expect(likeBtn().getAttribute("aria-pressed")).toBe("true");
  expect(likeBtn().textContent).toContain("5");
  await settle();
  expect(calls.filter((c) => c.path.endsWith("/like")).map((c) => c.method)).toEqual(["PUT"]);
  expect(tracked.filter((e) => e.event === "blog_like")).toEqual([{ event: "blog_like", data: { detail: "on", subject: "hello" } }]);

  likeStatus = 500;
  likeBtn().click();
  await settle();
  expect(likeBtn().getAttribute("aria-pressed")).toBe("true");
  expect(likeBtn().textContent).toContain("5");
  expect(host.textContent).toContain(t("blog.likeFailed"));
});

it("waits for the sign-in to come back before asking, so a member sees their own like after a reload", async () => {
  session.ready = false;
  session.restore = async () => { await new Promise((r) => setTimeout(r, 5)); session.me = { accountNumId: 7 }; session.ready = true; };
  stats = { views: null, likes: 1, liked: true };
  await mount();
  await settle();
  expect(views()[0]!.auth).toBe("Bearer tok");
  expect(likeBtn().getAttribute("aria-pressed")).toBe("true");
});
