import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import { sealAuth } from "../src/account-auth";
import { cleanAvatars } from "../src/community-profile";
import type { Env } from "../src/types";
import { bearer, identities, makeAgent, makeMember, makeReviewer, resetDb, restoreUpstream } from "./helpers";

// 部落格 API：寫作權限、版本衝突、定時發布、預覽碼、短網址、圖片上傳與清理、指標、稽核。
const EDITOR = 60001, MEMBER = 60002, REVIEWER = 60003, AGENT = 60004;
const KEYRING = JSON.stringify({ active: "test", keys: { test: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" } });

const objects = new Map<string, ArrayBuffer>();
const bucket = {
  put: vi.fn(async (k: string, v: ArrayBuffer) => { objects.set(k, v); }),
  delete: vi.fn(async (k: string) => { objects.delete(k); }),
  get: vi.fn(async (k: string) => (objects.has(k) ? { body: objects.get(k) } : null)),
};
const images = {
  info: vi.fn(async (_s: ReadableStream<Uint8Array>) => ({ format: "image/png", width: 3000, height: 2000, fileSize: 8 })),
  input: vi.fn(() => ({ transform: () => ({ output: async () => ({ response: () => new Response("converted-webp") }) }) })),
};
const fixture = (over: Record<string, unknown> = {}) => ({ ...env, AVATARS: bucket, IMAGES: images, AUTH_KEYRING: KEYRING, ...over }) as unknown as Env;

async function call(path: string, init: { method?: string; token?: string; body?: unknown; form?: FormData } = {}, over: Record<string, unknown> = {}) {
  const headers: Record<string, string> = init.token ? bearer(init.token) : {};
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request("https://c.test" + path, {
    method: init.method ?? "GET", headers, body: init.form ?? (init.body === undefined ? undefined : JSON.stringify(init.body)),
  }), fixture(over), ctx);
  await waitOnExecutionContext(ctx);
  return res;
}
const json = async (r: Response) => (await r.json()) as any;
const op = () => crypto.randomUUID();
const count = async (sql: string, ...b: unknown[]) => (await env.DB.prepare(sql).bind(...b).first<{ n: number }>())!.n;

let columnId = "";
const newPost = async (over: Record<string, unknown> = {}) =>
  json(await call("/v1/blog/admin/posts", { method: "POST", token: "editor", body: { columnId, slug: "hello", locale: "zh-Hant", title: "開站了", excerpt: "第一篇", bodyMd: "內容", operationId: op(), ...over } }));
const state = (id: string, change: Record<string, unknown>) => call(`/v1/blog/admin/posts/${id}/state`, { method: "POST", token: "editor", body: { change, operationId: op() } });

beforeEach(async () => {
  await resetDb();
  objects.clear();
  vi.clearAllMocks();
  identities({ editor: EDITOR, member: MEMBER, reviewer: REVIEWER, agent: AGENT });
  const editor = await makeReviewer(EDITOR);
  await env.DB.prepare("UPDATE reviewers SET role='manager' WHERE member_id=?").bind(editor).run();
  await makeMember(MEMBER);
  await makeReviewer(REVIEWER);
  const agent = await makeAgent(AGENT);
  await env.DB.prepare("UPDATE reviewers SET role='owner' WHERE member_id=?").bind(agent).run();
  const col = await call("/v1/blog/admin/columns", { method: "POST", token: "editor", body: { slug: "news", name: { "zh-Hant": "最新消息" }, description: {}, sort: 0, enabled: true, operationId: op() } });
  columnId = (await json(col)).id;
});
afterEach(() => restoreUpstream());

describe("權限", () => {
  it("沒有寫作權限的人呼叫管理路由一律 403；沒登入 401；管理回應不快取", async () => {
    const routes: [string, string][] = [
      ["GET", "/v1/blog/admin/posts"], ["GET", "/v1/blog/admin/posts/x"], ["POST", "/v1/blog/admin/posts"], ["PUT", "/v1/blog/admin/posts/x"],
      ["POST", "/v1/blog/admin/posts/x/state"], ["GET", "/v1/blog/admin/posts/x/revisions"], ["POST", "/v1/blog/admin/posts/x/revisions/r/restore"],
      ["POST", "/v1/blog/admin/posts/x/preview"], ["GET", "/v1/blog/admin/columns"], ["POST", "/v1/blog/admin/columns"], ["PUT", "/v1/blog/admin/columns/x"],
      ["POST", "/v1/blog/admin/images"],
    ];
    for (const [method, path] of routes) {
      for (const token of ["member", "reviewer", "agent"]) {
        const r = await call(path, { method, token, body: method === "GET" ? undefined : { operationId: op() } });
        expect([path, token, r.status]).toEqual([path, token, 403]);
        expect((await json(r)).error).toBe("blog_write_forbidden");
        expect(r.headers.get("Cache-Control")).toBe("private, no-store");
      }
      expect((await call(path, { method, body: method === "GET" ? undefined : {} })).status).toBe(401);
    }
    const metrics = await (await call("/metrics")).text();
    expect(metrics).toContain('hearthroom_blog_operations_total{operation="save",outcome="denied"}');
  });
});

describe("文章生命週期", () => {
  it("建立、舊版本存檔衝突、定時發布到點才公開；公開回應不帶成員 id", async () => {
    const created = await newPost();
    expect(created.version).toBe(1);
    expect(created.authorMemberId).toBeUndefined();
    expect(created.authorHandle).toBeTruthy();
    const save = (expectedVersion: number) => call(`/v1/blog/admin/posts/${created.id}`, { method: "PUT", token: "editor", body: { columnId, slug: "hello", locale: "zh-Hant", title: "改標題", excerpt: "", bodyMd: "新內容", expectedVersion, operationId: op() } });
    const saved = await save(1);
    expect(saved.status).toBe(200);
    expect(saved.headers.get("Cache-Control")).toBe("private, no-store");
    expect((await json(saved)).version).toBe(2);
    const stale = await save(1);
    expect(stale.status).toBe(409);
    expect(await json(stale)).toMatchObject({ error: "blog_version_conflict", version: 2 });
    expect((await call("/v1/blog/admin/posts/x", { method: "PUT", token: "editor", body: { columnId, slug: "a", locale: "zh-Hant", title: "t", excerpt: "", bodyMd: "", expectedVersion: 1, operationId: "bad" } })).status).toBe(400);

    expect((await state(created.id, { status: "published", publishAt: Date.now() + 3600_000 })).status).toBe(200);
    expect((await json(await call("/v1/blog/posts"))).total).toBe(0);
    expect((await call("/v1/blog/posts/news/hello")).status).toBe(404);

    await env.DB.prepare("UPDATE blog_posts SET publish_at = ? WHERE id = ?").bind(Date.now() - 1000, created.id).run();
    const list = await call("/v1/blog/posts?column=news");
    expect(list.headers.get("Cache-Control")).toBe("public, max-age=60");
    const body = await json(list);
    expect(body.total).toBe(1);
    expect(body.items[0].slug).toBe("hello");
    const page = await call("/v1/blog/posts/news/hello");
    expect(page.status).toBe(200);
    expect(page.headers.get("Cache-Control")).toBe("public, max-age=60");
    const read = await json(page);
    expect(read.post.title).toBe("改標題");
    expect(read.post.official).toBe(true);
    expect(JSON.stringify(read)).not.toContain("member-");
    expect(read.adjacent).toEqual({ prev: null, next: null });
    expect(read.related).toEqual([]);

    const admin = await json(await call(`/v1/blog/admin/posts?status=published`, { token: "editor" }));
    expect(admin.total).toBe(1);
    expect(admin.items[0]).toMatchObject({ id: created.id, status: "published" });
    expect(admin.items[0].version).toBeGreaterThan(2);
    const revisions = await json(await call(`/v1/blog/admin/posts/${created.id}/revisions`, { token: "editor" }));
    expect(revisions.items).toHaveLength(2);
    const restored = await call(`/v1/blog/admin/posts/${created.id}/revisions/${revisions.items[1].id}/restore`, { method: "POST", token: "editor", body: { operationId: op() } });
    expect((await json(restored)).title).toBe("開站了");
  });

  it("欄目：公開只列啟用的，管理列全部；欄目 slug 撞名 409", async () => {
    const off = await call("/v1/blog/admin/columns", { method: "POST", token: "editor", body: { slug: "hidden", name: { "zh-Hant": "隱藏" }, description: {}, sort: 1, enabled: false, operationId: op() } });
    const hidden = await json(off);
    expect((await json(await call("/v1/blog/columns"))).items.map((c: any) => c.slug)).toEqual(["news"]);
    expect((await json(await call("/v1/blog/admin/columns", { token: "editor" }))).items).toHaveLength(2);
    const dup = await call(`/v1/blog/admin/columns/${hidden.id}`, { method: "PUT", token: "editor", body: { slug: "news", name: { "zh-Hant": "隱藏" }, description: {}, sort: 1, enabled: false, operationId: op() } });
    expect(dup.status).toBe(409);
    expect((await json(dup)).error).toBe("blog_column_slug_taken");
  });

  it("短網址：公開的回欄目與 slug，草稿 404", async () => {
    const p = await newPost();
    expect((await call(`/v1/blog/p/${p.id}`)).status).toBe(404);
    await state(p.id, { status: "published" });
    expect(await json(await call(`/v1/blog/p/${p.id}`))).toEqual({ column: "news", slug: "hello" });
  });

  it("稽核：發布、撤下、置頂、關閉留言各一筆，都是 human", async () => {
    const p = await newPost();
    for (const change of [{ status: "published" }, { pinned: true }, { commentsClosed: true }, { status: "unpublished" }]) expect((await state(p.id, change)).status).toBe(200);
    const rows = await env.DB.prepare("SELECT action, actor_kind FROM audit_log WHERE subject_id = ? AND action IN ('publish','unpublish','pin','comments_close') ORDER BY action").bind(p.id).all();
    expect(rows.results).toEqual([
      { action: "comments_close", actor_kind: "human" }, { action: "pin", actor_kind: "human" },
      { action: "publish", actor_kind: "human" }, { action: "unpublish", actor_kind: "human" },
    ]);
    const metrics = await (await call("/metrics")).text();
    expect(metrics).toContain('hearthroom_blog_operations_total{operation="save",outcome="success"}');
    expect(metrics).toContain('hearthroom_blog_operations_total{operation="publish",outcome="success"} 1');
  });
});

describe("預覽", () => {
  it("草稿用預覽碼讀得到且不快取；過期、竄改、換一篇都 404", async () => {
    const p = await newPost();
    const other = await newPost({ slug: "other" });
    const issued = await call(`/v1/blog/admin/posts/${p.id}/preview`, { method: "POST", token: "editor", body: {} });
    expect(issued.status).toBe(200);
    const { token, url } = await json(issued);
    expect(url).toBe(`/blog/news/hello?preview=${encodeURIComponent(token)}`);
    const read = await call(`/v1/blog/posts/news/hello?preview=${encodeURIComponent(token)}`);
    expect(read.status).toBe(200);
    expect(read.headers.get("Cache-Control")).toBe("private, no-store");
    expect((await json(read)).post.status).toBe("draft");

    expect((await call(`/v1/blog/posts/news/other?preview=${encodeURIComponent(token)}`)).status).toBe(404);
    expect(other.id).toBeTruthy();
    const tampered = JSON.stringify({ ...JSON.parse(token), data: btoa("x".repeat(40)) });
    expect((await call(`/v1/blog/posts/news/hello?preview=${encodeURIComponent(tampered)}`)).status).toBe(404);
    const expired = await sealAuth(fixture(), "blog-preview", { postId: p.id, exp: Date.now() - 1 });
    expect((await call(`/v1/blog/posts/news/hello?preview=${encodeURIComponent(expired)}`)).status).toBe(404);
    const wrongPurpose = await sealAuth(fixture(), "guest-adult", { postId: p.id, exp: Date.now() + 60_000 });
    expect((await call(`/v1/blog/posts/news/hello?preview=${encodeURIComponent(wrongPurpose)}`)).status).toBe(404);
  });

  it("沒設金鑰時發不出預覽碼", async () => {
    const p = await newPost();
    const r = await call(`/v1/blog/admin/posts/${p.id}/preview`, { method: "POST", token: "editor", body: {} }, { AUTH_KEYRING: undefined });
    expect(r.status).toBe(503);
    expect((await json(r)).error).toBe("blog_preview_unavailable");
  });
});

describe("圖片", () => {
  const upload = (file: File) => { const f = new FormData(); f.set("file", file); return call("/v1/blog/admin/images", { method: "POST", token: "editor", form: f }); };
  const png = () => new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], "a.png", { type: "image/png" });

  it("非圖片 400；上傳轉 WebP、最長邊 1600，24 小時內讀得到", async () => {
    const bad = await upload(new File(["<svg/>"], "a.svg", { type: "image/svg+xml" }));
    expect(bad.status).toBe(400);
    expect((await json(bad)).error).toBe("blog_image_invalid");
    images.info.mockRejectedValueOnce(new Error("not an image"));
    expect((await upload(png())).status).toBe(400);

    const r = await upload(png());
    expect(r.status).toBe(200);
    const { key, url } = await json(r);
    expect(key).toMatch(/^blog\/[-a-f0-9]{36}\.webp$/);
    expect(url).toBe(`/v1/blog/images/${key.slice(5)}`);
    expect(objects.has(key)).toBe(true);
    const got = await call(url);
    expect(got.status).toBe(200);
    expect(got.headers.get("Content-Type")).toBe("image/webp");
    expect(got.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
    expect((await call("/v1/blog/images/not-there.webp")).status).toBe(404);
    expect((await call(`/v1/avatars/blog/${key.slice(5)}`)).status).toBe(404);
  });

  it("沒被引用又過了 24 小時的圖會被清掉；被封面或內文引用的不會", async () => {
    const keys: string[] = [];
    for (let i = 0; i < 3; i++) keys.push((await json(await upload(png()))).key);
    const [orphan, cover, inline] = keys as [string, string, string];
    await newPost({ coverKey: cover, bodyMd: `圖：![x](/v1/blog/images/${inline.slice(5)})` });
    expect(await count("SELECT COUNT(*) AS n FROM avatar_cleanup")).toBe(1);
    // 存檔前就到期的那一刻（清理和存檔撞在一起）也不能刪掉被引用的圖
    await env.DB.prepare("INSERT OR REPLACE INTO avatar_cleanup(key, delete_after) VALUES (?, 0)").bind(cover).run();
    await env.DB.prepare("UPDATE avatar_cleanup SET delete_after = 0").run();
    await cleanAvatars(fixture());
    expect(objects.has(orphan)).toBe(false);
    expect((await call(`/v1/blog/images/${orphan.slice(5)}`)).status).toBe(404);
    for (const k of [cover, inline]) {
      expect(objects.has(k)).toBe(true);
      expect((await call(`/v1/blog/images/${k.slice(5)}`)).status).toBe(200);
    }
    const metrics = await (await call("/metrics")).text();
    expect(metrics).toContain('hearthroom_blog_operations_total{operation="image",outcome="success"} 3');
  });
});
