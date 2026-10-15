import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { openAuth, sealAuth } from "./account-auth";
import {
  adjacentPosts, adminPost, adminPosts, adminView, getRevision, IMAGE_MAX_BYTES, imageServable, columnTree, listRevisions, postBySlug, publicPost,
  publicPostById, publicPosts, publicView, relatedPosts, restoreRevision, saveColumn, savePost, setPostState, uploadImage,
  type Actor, type ColumnInput, type Post, type PostInput, type StateChange,
} from "./blog";
import { blogFeed } from "./blog-head";
import { bearerOf, canWriteBlog } from "./community-admin";
import { providerOf, requireMember } from "./members";
import { operationOf } from "./moderation";
import { bumpOp } from "./ops-metrics";
import { HttpError, type Env } from "./types";

/**
 * 官方部落格的公開與管理 API。規則在 blog.ts；這裡只管身分、參數與回應。
 * 管理路由一律 private, no-store；公開讀取 public, max-age=60（預覽除外）。
 */
export const blogRoutes = new Hono<{ Bindings: Env }>();
type Ctx = Context<{ Bindings: Env }>;

const PUBLIC = { "Cache-Control": "public, max-age=60" };
const PRIVATE = "private, no-store";
const PREVIEW_PURPOSE = "blog-preview";
const PREVIEW_TTL = 24 * 3600_000;

const bodyOf = async (c: Ctx) => {
  const b = await c.req.json().catch(() => null);
  return (b && typeof b === "object" && !Array.isArray(b) ? b : {}) as Record<string, unknown>;
};
const page = (c: Ctx) => Number(c.req.query("page")) || 1;

/** 管理路由的寫入算哪一種操作（對應 hearthroom_blog_operations_total）；讀取與預覽不計。 */
async function operationFor(c: Ctx): Promise<string | null> {
  const { method, path } = c.req;
  if (method === "GET") return null;
  if (/^\/v1\/blog\/admin\/posts(\/[^/]+)?$/.test(path)) return "save";
  if (path.endsWith("/restore")) return "restore";
  if (path.startsWith("/v1/blog/admin/columns")) return "column";
  if (path === "/v1/blog/admin/images") return "image";
  if (path.endsWith("/state")) {
    const change = ((await bodyOf(c)).change ?? {}) as StateChange;
    if (change.status === "published") return "publish";
    if (change.status === "unpublished") return "unpublish";
    if ("commentsClosed" in change) return "comments";
    if ("pinned" in change || "pinnedCommentId" in change) return "pin";
  }
  return null;
}

// 成功由 blog.ts 在寫入後記；被拒與出錯在這裡依狀態碼記，一處涵蓋所有提早拋出的錯。
blogRoutes.use("/v1/blog/admin/*", async (c, next) => {
  await next();
  c.header("Cache-Control", PRIVATE);
  if (c.res.status < 400) return;
  const op = await operationFor(c);
  if (op) await bumpOp(c.env.DB, "blog", op, c.res.status < 500 ? "denied" : "error");
});

/** 寫作權限：供應商那邊本站應用的 owner／admin，不含 AI 帳號，所以稽核的 actor_kind 一律是 human。 */
async function writer(c: Ctx): Promise<Actor> {
  const member = await requireMember(c);
  if (!(await canWriteBlog(c.env, member.id, bearerOf(c), providerOf(c)))) throw new HttpError(403, "blog_write_forbidden");
  return { memberId: member.id, kind: "human" };
}
const admin = async (c: Ctx, post: Post) => c.json(await adminView(c.env.DB, post));

// ---- 公開 ---------------------------------------------------------------------

blogRoutes.get("/v1/blog/columns", async (c) => c.json({ items: await columnTree(c.env.DB, { admin: false }) }, 200, PUBLIC));

blogRoutes.get("/v1/blog/posts", async (c) =>
  c.json(await publicPosts(c.env.DB, { columnSlug: c.req.query("column") || undefined, page: page(c), now: Date.now() }), 200, PUBLIC));

/** 帶預覽碼（24 小時、只認那一篇）讀得到未公開的文章；碼不對就當沒帶，照公開規則。 */
async function previewed(c: Ctx, token: string, column: string, slug: string, now: number): Promise<Post | null> {
  try {
    const v = await openAuth<{ postId?: unknown; exp?: unknown }>(c.env, PREVIEW_PURPOSE, token);
    if (typeof v?.exp !== "number" || v.exp <= now) return null;
    const post = await postBySlug(c.env.DB, column, slug);
    return post && post.id === v.postId ? post : null;
  } catch {
    return null;
  }
}

blogRoutes.get("/v1/blog/posts/:column/:slug", async (c) => {
  const now = Date.now();
  const { column, slug } = c.req.param();
  const token = c.req.query("preview");
  const post = (token ? await previewed(c, token, column, slug, now) : null) ?? (await publicPost(c.env.DB, column, slug, now));
  const headers = token ? { "Cache-Control": PRIVATE } : PUBLIC;
  if (!post) return c.json({ error: "blog_post_not_found" }, 404, headers);
  const [adjacent, related] = await Promise.all([adjacentPosts(c.env.DB, post, now), relatedPosts(c.env.DB, post, now)]);
  return c.json({ post: publicView(post), adjacent, related }, 200, headers);
});

blogRoutes.get("/v1/blog/p/:id", async (c) => {
  const target = await publicPostById(c.env.DB, c.req.param("id"), Date.now());
  if (!target) throw new HttpError(404, "blog_post_not_found");
  return c.json(target, 200, PUBLIC);
});

blogRoutes.get("/v1/blog/images/:file", async (c) => {
  const key = `blog/${c.req.param("file")}`;
  const image = (await imageServable(c.env.DB, key, Date.now())) ? await c.env.AVATARS?.get(key) : null;
  if (!image) throw new HttpError(404, "blog_image_not_found");
  return new Response(image.body, { headers: { "Content-Type": "image/webp", "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" } });
});

// ---- 管理 ---------------------------------------------------------------------

blogRoutes.get("/v1/blog/admin/posts", async (c) => {
  await writer(c);
  return c.json(await adminPosts(c.env.DB, { status: c.req.query("status"), column: c.req.query("column"), page: page(c) }));
});

blogRoutes.get("/v1/blog/admin/posts/:id", async (c) => {
  await writer(c);
  return c.json(await adminPost(c.env.DB, c.req.param("id")));
});

blogRoutes.post("/v1/blog/admin/posts", async (c) => {
  const actor = await writer(c);
  const { id: _, expectedVersion: __, operationId, ...input } = await bodyOf(c);
  return admin(c, await savePost(c.env.DB, input as PostInput, actor, operationOf(operationId), Date.now()));
});

blogRoutes.put("/v1/blog/admin/posts/:id", async (c) => {
  const actor = await writer(c);
  const { operationId, ...input } = await bodyOf(c);
  return admin(c, await savePost(c.env.DB, { ...(input as PostInput & { expectedVersion?: number }), id: c.req.param("id") }, actor, operationOf(operationId), Date.now()));
});

blogRoutes.post("/v1/blog/admin/posts/:id/state", async (c) => {
  const actor = await writer(c);
  const b = await bodyOf(c);
  const change = b.change && typeof b.change === "object" && !Array.isArray(b.change) ? (b.change as StateChange) : {};
  return admin(c, await setPostState(c.env.DB, c.req.param("id"), change, actor, operationOf(b.operationId), Date.now()));
});

blogRoutes.get("/v1/blog/admin/posts/:id/revisions", async (c) => {
  await writer(c);
  return c.json({ items: await listRevisions(c.env.DB, c.req.param("id")) });
});

blogRoutes.get("/v1/blog/admin/posts/:id/revisions/:rev", async (c) => {
  await writer(c);
  return c.json(await getRevision(c.env.DB, c.req.param("id"), c.req.param("rev")));
});

blogRoutes.post("/v1/blog/admin/posts/:id/revisions/:rev/restore", async (c) => {
  const actor = await writer(c);
  const b = await bodyOf(c);
  return admin(c, await restoreRevision(c.env.DB, c.req.param("id"), c.req.param("rev"), actor, operationOf(b.operationId), Date.now()));
});

blogRoutes.post("/v1/blog/admin/posts/:id/preview", async (c) => {
  await writer(c);
  const post = await adminPost(c.env.DB, c.req.param("id"));
  if (!c.env.AUTH_KEYRING) throw new HttpError(503, "blog_preview_unavailable");
  const token = await sealAuth(c.env, PREVIEW_PURPOSE, { postId: post.id, exp: Date.now() + PREVIEW_TTL }).catch(() => {
    throw new HttpError(503, "blog_preview_unavailable");
  });
  return c.json({ token, url: `/blog/${post.columnSlug}/${post.slug}?preview=${encodeURIComponent(token)}` });
});

blogRoutes.get("/v1/blog/admin/columns", async (c) => {
  await writer(c);
  return c.json({ items: await columnTree(c.env.DB, { admin: true }) });
});

blogRoutes.post("/v1/blog/admin/columns", async (c) => {
  const actor = await writer(c);
  const { id: _, operationId, ...input } = await bodyOf(c);
  return c.json(await saveColumn(c.env.DB, input as ColumnInput, actor, operationOf(operationId), Date.now()));
});

blogRoutes.put("/v1/blog/admin/columns/:id", async (c) => {
  const actor = await writer(c);
  const { operationId, ...input } = await bodyOf(c);
  return c.json(await saveColumn(c.env.DB, { ...(input as ColumnInput), id: c.req.param("id") }, actor, operationOf(operationId), Date.now()));
});

blogRoutes.post("/v1/blog/admin/images", bodyLimit({ maxSize: IMAGE_MAX_BYTES + 16384, onError: (c) => c.json({ error: "blog_image_invalid" }, 400) }), async (c) => {
  await writer(c);
  const form = await c.req.formData().catch(() => {
    throw new HttpError(400, "blog_image_invalid");
  });
  return c.json(await uploadImage(c.env, form.get("file"), Date.now()));
});

// ---- Atom（最新 20 篇公開文章）---------------------------------------------------

const feed = async (c: Ctx, locale: string) => c.body(await blogFeed(c.env, locale, Date.now()), 200, {
  "Content-Type": "application/atom+xml; charset=utf-8", "Cache-Control": "public, max-age=600",
});
blogRoutes.get("/blog.atom", (c) => feed(c, "zh-Hant"));
blogRoutes.get("/:locale{zh-Hans|en|ja|ko}/blog.atom", (c) => feed(c, c.req.param("locale")));
