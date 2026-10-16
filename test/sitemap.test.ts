import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { beforeEach, expect, it } from "vitest";
import worker from "../src/index";
import { PRIMARY_HOST } from "../shared/site-hosts";
import type { Env } from "../src/types";
import { appAdmins, bearer, identities, makeMember, resetDb } from "./helpers";

const O = `https://${PRIMARY_HOST}`;
// /sitemap.xml：只收公開的頁面；文章用自己的語言前綴（跟 canonical 一致），欄目與分組頁五種語言各一個。
const EDITOR = 62001;
const KEYRING = JSON.stringify({ active: "test", keys: { test: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" } });
const fixture = () => ({ ...env, AUTH_KEYRING: KEYRING }) as unknown as Env;
async function call(path: string, init: { method?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = { ...bearer("editor") };
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request("https://c.test" + path, { method: init.method ?? "GET", headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) }), fixture(), ctx);
  await waitOnExecutionContext(ctx);
  return res;
}
const json = async (r: Response) => (await r.json()) as any;
const op = () => crypto.randomUUID();
const column = async (slug: string, parentId: string | null, enabled = true) =>
  (await json(await call("/v1/blog/admin/columns", { method: "POST", body: { slug, name: { "zh-Hant": slug }, description: {}, sort: 0, enabled, parentId, operationId: op() } }))).id as string;
async function post(columnId: string, slug: string, locale: string, publish: boolean) {
  const id = (await json(await call("/v1/blog/admin/posts", { method: "POST", body: { columnId, slug, locale, title: slug, excerpt: "", bodyMd: "內容", operationId: op() } }))).id;
  if (publish) expect((await call(`/v1/blog/admin/posts/${id}/state`, { method: "POST", body: { change: { status: "published" }, operationId: op() } })).status).toBe(200);
}
const campaign = (slug: string, status: string) =>
  env.DB.prepare("INSERT INTO campaigns (id, slug, title, status, created_by, created_at, updated_at) VALUES (?, ?, '{\"zh-Hant\":\"活動\"}', ?, 'x', 1, 1792113249379)").bind(crypto.randomUUID(), slug, status).run();

beforeEach(async () => {
  await resetDb();
  identities({ editor: EDITOR });
  appAdmins("editor");
  await makeMember(EDITOR);
  const group = await column("official", null);
  const news = await column("news", group);
  const hidden = await column("hidden", group);
  await post(news, "hello", "zh-Hant", true);
  await post(news, "hello-en", "en", true);
  await post(news, "draft-post", "zh-Hant", false);
  await post(hidden, "secret", "zh-Hant", true);
  await call(`/v1/blog/admin/columns/${hidden}`, { method: "PUT", body: { slug: "hidden", name: { "zh-Hant": "hidden" }, description: {}, sort: 1, enabled: false, parentId: group, operationId: op() } });
  await campaign("share-season", "active");
  await campaign("later", "draft");
});

it("lists public pages only, with each post under its own locale prefix", async () => {
  const res = await call("/sitemap.xml");
  expect(res.status).toBe(200);
  expect(res.headers.get("Content-Type")).toContain("application/xml");
  expect(res.headers.get("Cache-Control")).toBe("public, max-age=3600");
  const xml = await res.text();
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  expect(locs).toContain(`${O}/`);
  expect(locs).toContain(`${O}/ko/updates`);
  // 各語言首頁跟 canonical 一樣沒有結尾斜線
  expect(locs).toContain(`${O}/en`);
  expect(locs).not.toContain(`${O}/en/`);
  expect(locs).toContain(`${O}/blog/news/hello`);
  expect(locs).toContain(`${O}/en/blog/news/hello-en`);
  expect(locs).not.toContain(`${O}/blog/news/hello-en`);
  expect(locs).toContain(`${O}/blog/g/official`);
  expect(locs).toContain(`${O}/ja/blog/news`);
  expect(locs).toContain(`${O}/campaign/share-season`);
  expect(locs.filter((u) => /draft-post|secret|\/blog\/hidden|\/campaign\/later/.test(u))).toEqual([]);
  expect(new Set(locs).size).toBe(locs.length);
  expect(xml).toContain(`<url><loc>${O}/blog/news/hello</loc><lastmod>`);
});
