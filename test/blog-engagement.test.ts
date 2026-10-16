import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { beforeEach, expect, it } from "vitest";
import worker from "../src/index";
import type { Env } from "../src/types";
import { appAdmins, bearer, identities, makeMember, resetDb } from "./helpers";

// 部落格的閱讀數與喜歡：只有公開的文章收；閱讀數未滿門檻不公開；喜歡一人一票；計數不動文章版本。
const EDITOR = 61001, READER = 61002, OTHER = 61003;
const KEYRING = JSON.stringify({ active: "test", keys: { test: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" } });
const fixture = () => ({ ...env, AUTH_KEYRING: KEYRING }) as unknown as Env;
async function call(path: string, init: { method?: string; token?: string; body?: unknown; ua?: string } = {}) {
  const headers: Record<string, string> = init.token ? bearer(init.token) : {};
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  if (init.ua) headers["User-Agent"] = init.ua;
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request("https://c.test" + path, { method: init.method ?? "GET", headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) }), fixture(), ctx);
  await waitOnExecutionContext(ctx);
  return res;
}
const json = async (r: Response) => (await r.json()) as any;
const op = () => crypto.randomUUID();
let postId = "";

beforeEach(async () => {
  await resetDb();
  identities({ editor: EDITOR, reader: READER, other: OTHER });
  appAdmins("editor");
  for (const id of [EDITOR, READER, OTHER]) await makeMember(id);
  const g = await json(await call("/v1/blog/admin/columns", { method: "POST", token: "editor", body: { slug: "official", name: { "zh-Hant": "官方消息" }, description: {}, sort: 0, enabled: true, parentId: null, operationId: op() } }));
  const col = await json(await call("/v1/blog/admin/columns", { method: "POST", token: "editor", body: { slug: "news", name: { "zh-Hant": "公告" }, description: {}, sort: 0, enabled: true, parentId: g.id, operationId: op() } }));
  postId = (await json(await call("/v1/blog/admin/posts", { method: "POST", token: "editor", body: { columnId: col.id, slug: "hello", locale: "zh-Hant", title: "開站了", excerpt: "", bodyMd: "內容", operationId: op() } }))).id;
  const published = await call(`/v1/blog/admin/posts/${postId}/state`, { method: "POST", token: "editor", body: { change: { status: "published" }, operationId: op() } });
  expect(published.status).toBe(200);
});

const view = (count: boolean, token?: string, ua?: string) => call(`/v1/blog/posts/${postId}/view`, { method: "POST", token, body: { count }, ua });
const like = (token?: string) => call(`/v1/blog/posts/${postId}/like`, { method: "PUT", token });
const unlike = (token?: string) => call(`/v1/blog/posts/${postId}/like`, { method: "DELETE", token });
const viewsInDb = async () => (await env.DB.prepare("SELECT view_count n FROM blog_posts WHERE id=?").bind(postId).first<{ n: number }>())!.n;

it("counts a view only when asked, and never for crawlers", async () => {
  await view(true);
  await view(false);
  await view(true, undefined, "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)");
  expect(await viewsInDb()).toBe(1);
});

it("hides the view count below the public threshold, and is never cached", async () => {
  const below = await view(true);
  expect(below.status).toBe(200);
  expect(below.headers.get("Cache-Control")).toBe("private, no-store");
  expect(await json(below)).toEqual({ views: null, likes: 0, liked: false });
  await env.DB.prepare("UPDATE blog_posts SET view_count=49 WHERE id=?").bind(postId).run();
  expect((await json(await view(true))).views).toBe(50);
});

it("answers 404 for posts that are not public", async () => {
  await call(`/v1/blog/admin/posts/${postId}/state`, { method: "POST", token: "editor", body: { change: { status: "unpublished" }, operationId: op() } });
  expect((await view(true)).status).toBe(404);
  expect((await like("reader")).status).toBe(404);
  expect(await viewsInDb()).toBe(0);
  expect((await call("/v1/blog/posts/nope/view", { method: "POST", body: { count: true } })).status).toBe(404);
});

it("likes once per member, can be taken back, and never goes negative", async () => {
  expect((await like()).status).toBe(401);
  await Promise.all([like("reader"), like("reader")]);
  const again = await like("reader");
  expect(again.headers.get("Cache-Control")).toBe("private, no-store");
  expect(await json(again)).toEqual({ likes: 1, liked: true });
  await like("other");
  expect(await json(await view(false, "reader"))).toMatchObject({ likes: 2, liked: true });
  expect(await json(await view(false))).toMatchObject({ likes: 2, liked: false });
  await unlike("reader");
  await unlike("reader");
  expect(await json(await view(false, "reader"))).toMatchObject({ likes: 1, liked: false });
  await unlike("other");
  await unlike("other");
  expect((await json(await view(false))).likes).toBe(0);
});

it("a like or a view does not bump the post version, so the editor can still save", async () => {
  const before = await json(await call(`/v1/blog/admin/posts/${postId}`, { token: "editor" }));
  await like("reader");
  await view(true);
  const after = await json(await call(`/v1/blog/admin/posts/${postId}`, { token: "editor" }));
  expect([after.version, after.updatedAt]).toEqual([before.version, before.updatedAt]);
});

it("counts likes in the blog operations metric without identifiers", async () => {
  await like("reader");
  await unlike("reader");
  await like();
  const rows = (await env.DB.prepare("SELECT operation, outcome, value FROM ops_metrics WHERE metric='blog' AND operation IN ('like','unlike') ORDER BY operation, outcome").all()).results;
  expect(rows).toEqual([{ operation: "like", outcome: "denied", value: 1 }, { operation: "like", outcome: "success", value: 1 }, { operation: "unlike", outcome: "success", value: 1 }]);
});
