import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeEach, expect, it } from "vitest";
import worker from "../src/index";
import type { Env } from "../src/types";
import { appAdmins, bearer, identities, makeAgent, makeMember, resetDb, restoreUpstream } from "./helpers";

const key = "12".repeat(32);
let memberId = "", config = "";
const json = async (r: Response) => await r.json() as any;
async function call(path: string, method = "GET", body?: unknown, headers: Record<string,string> = { "X-Blog-Publisher-Key": key }, binding = config) {
  const ctx = createExecutionContext();
  const r = await worker.fetch(new Request("https://c.test" + path, { method, headers: { ...headers, ...(body instanceof FormData ? {} : { "Content-Type": "application/json" }) }, body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body) }), { ...env, BLOG_PUBLISHER_CONFIG: binding, IMAGES: { info: async () => ({ format: "image/png", width: 10, height: 10 }), input: () => ({ transform: () => ({ output: async () => ({ response: () => new Response("webp") }) }) }) } } as unknown as Env, ctx);
  await waitOnExecutionContext(ctx);
  return r;
}
const save = (body: Record<string,unknown>) => call("/v1/blog/admin/posts", "POST", { operationId: crypto.randomUUID(), ...body });
beforeEach(async () => {
  await resetDb(); identities({ agent: 76001, other: 76002, member: 76003 }); appAdmins("agent", "other");
  memberId = await makeAgent(76001); await makeAgent(76002); await makeMember(76003);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  config = JSON.stringify({ memberId, keySha256: [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2,"0")).join("") });
});
afterEach(restoreUpstream);

it("designated publisher creates five translations, publishes and withdraws through the shared service with ai audit", async () => {
  const groupResponse = await call("/v1/blog/admin/columns", "POST", { slug: "official", name: { "zh-Hant": "官方" }, description: {}, sort: 0, enabled: true, parentId: null, operationId: crypto.randomUUID() });
  expect(groupResponse.status).toBe(200);
  const group = await json(groupResponse);
  const colResponse = await call("/v1/blog/admin/columns", "POST", { slug: "creators", name: { "zh-Hant": "創作指南" }, description: {}, sort: 0, enabled: true, parentId: group.id, operationId: crypto.randomUUID() });
  expect(colResponse.status).toBe(200);
  const col = await json(colResponse);
  let source: any;
  const posts: any[] = [];
  for (const locale of ["zh-Hant", "zh-Hans", "en", "ja", "ko"]) {
    const input = { columnId: col.id, slug: "rewards-" + locale.toLowerCase(), title: "Rules " + locale, locale, excerpt: "", bodyMd: "Synthetic rules", ...(source ? { translationOfPostId: source.id, expectedTranslationGroupVersion: source.groupVersion } : {}) };
    const r = await save(input); expect(r.status).toBe(200); const post = await json(r); posts.push(post);
    source = await json(await call("/v1/blog/admin/posts/" + posts[0].id));
  }
  for (const post of posts) {
    const r = await call(`/v1/blog/admin/posts/${post.id}/state`, "POST", { operationId: crypto.randomUUID(), change: { status: "published", publishAt: Date.now()-1000 } });
    expect(r.status).toBe(200); expect((await json(r)).pinned).toBe(false);
    const publicResponse = await call(`/v1/blog/posts/creators/${post.slug}?locale=${post.locale}`, "GET", undefined, {});
    expect(publicResponse.status).toBe(200); expect((await json(publicResponse)).post.locale).toBe(post.locale);
  }
  expect((await call(`/v1/blog/admin/posts/${posts[0].id}/state`, "POST", { operationId: crypto.randomUUID(), change: { status: "unpublished" } })).status).toBe(200);
  const audits = await env.DB.prepare("SELECT actor_member_id,actor_kind,action,subject_kind FROM audit_log").all<any>();
  expect(audits.results.length).toBeGreaterThanOrEqual(13);
  expect(audits.results.every(r => r.actor_member_id === memberId && r.actor_kind === "ai")).toBe(true);
  expect(audits.results.some(r => r.action === "unpublish")).toBe(true);
  const metrics = await env.DB.prepare("SELECT operation,outcome,value FROM ops_metrics WHERE metric='blog_publisher'").all<any>();
  expect(metrics.results).toContainEqual(expect.objectContaining({ operation: "admission", outcome: "allow" }));
});

it("normal member and both agents still get 403 with ordinary login, including the designated member", async () => {
  for (const token of ["agent", "other", "member"]) expect((await call("/v1/blog/admin/posts", "GET", undefined, bearer(token))).status).toBe(403);
});

it("wrong, missing, malformed, revoked or browser credential fails closed and cannot fall back to an admin token", async () => {
  for (const [headers,binding] of [
    [{ "X-Blog-Publisher-Key": "34".repeat(32), ...bearer("agent") }, config],
    [{ "X-Blog-Publisher-Key": "" }, config],
    [{ "X-Blog-Publisher-Key": key }, ""],
    [{ "X-Blog-Publisher-Key": key }, "{"],
    [{ "X-Blog-Publisher-Key": key, Origin: "https://c.test" }, config],
    [{ "X-Blog-Publisher-Key": key }, JSON.stringify({memberId:"missing",keySha256:JSON.parse(config).keySha256})],
  ] as [Record<string,string>,string][]) expect((await call("/v1/blog/admin/posts", "GET", undefined, headers, binding)).status).toBe(403);
  expect((await call("/v1/blog/admin/posts", "GET", undefined, {})).status).toBe(401);
  const metric = await env.DB.prepare("SELECT value FROM ops_metrics WHERE metric='blog_publisher' AND operation='admission' AND outcome='denied'").first<any>();
  expect(metric.value).toBe(6);
});

it("publisher credential grants no community settings, points or review powers", async () => {
  for (const path of ["/v1/review/me", "/v1/moderation/settings"]) expect((await call(path)).status).toBe(401);
});

it("publisher image upload is audited and reusing an operation ID does not upload twice", async () => {
  const form = new FormData(); form.set("file", new File(["png"], "cover.png", {type:"image/png"})); form.set("operationId",crypto.randomUUID());
  const first = await call("/v1/blog/admin/images", "POST", form); expect(first.status).toBe(200);
  const image = await json(first);
  const replay = await call("/v1/blog/admin/images", "POST", form); expect(replay.status).toBe(200); expect(await json(replay)).toEqual(image);
  const audits = await env.DB.prepare("SELECT actor_member_id,actor_kind,subject_id,action FROM audit_log WHERE subject_kind='blog_image'").all<any>();
  expect(audits.results).toEqual([{ actor_member_id:memberId,actor_kind:"ai",subject_id:image.key,action:"upload" }]);
  expect((await env.DB.prepare("SELECT value FROM ops_metrics WHERE metric='blog' AND operation='image' AND outcome='success'").first<any>()).value).toBe(1);
});
