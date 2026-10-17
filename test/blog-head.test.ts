import { PRIMARY_HOST } from "../shared/site-hosts";
import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../src/index";
import { saveColumn, savePost, setPostState } from "../src/blog";
import { envWithAssets, makeReviewer, resetDb } from "./helpers";

const testEnv = envWithAssets();
const op = () => crypto.randomUUID();
const actor = () => ({ memberId: editor, kind: "human" as const });
let editor = "";
let columnId = "";

async function get(path: string) {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request(`https://c.test${path}`), testEnv, ctx);
  await waitOnExecutionContext(ctx);
  return { status: res.status, text: await res.text(), headers: res.headers };
}

/** 建一篇文章；publishAt 給了就發布（now 取 publishAt 本身）。 */
async function post(over: Record<string, unknown> = {}, publishAt: number | null = 1000) {
  const p = await savePost(env.DB, { columnId, slug: "hello", locale: "zh-Hant", title: "開站了", excerpt: "第一篇", bodyMd: "# 你好\n\n**內容**", ...over }, actor(), op(), 10);
  if (publishAt !== null) await setPostState(env.DB, p.id, { status: "published", publishAt }, actor(), op(), publishAt);
  return p;
}

beforeEach(async () => {
  await resetDb();
  editor = await makeReviewer(50001);
  await env.DB.prepare("UPDATE reviewers SET role='manager' WHERE member_id=?").bind(editor).run();
  const group = (await saveColumn(env.DB, { slug: "official", name: { "zh-Hant": "官方消息", en: "News" }, description: { "zh-Hant": "官方的消息" }, sort: 0, enabled: true, parentId: null }, actor(), op(), 1)).id;
  columnId = (await saveColumn(env.DB, { slug: "news", name: { "zh-Hant": "最新消息", en: "News" }, description: { "zh-Hant": "站上的新消息" }, sort: 0, enabled: true, parentId: group }, actor(), op(), 1)).id;
});

describe("部落格分享資訊", () => {
  it("文章頁：標題、簡介、圖與發布時間；canonical 用文章自己的語言", async () => {
    await post({ locale: "en", title: "Hello", excerpt: "First post", shareTitle: "Share me", shareDescription: "For cards", coverKey: null }, 1000);
    const { status, text, headers } = await get("/ja/blog/news/hello");
    expect(status).toBe(200);
    expect(text).toContain('<meta property="og:title" content="Share me">');
    expect(text).toContain('<meta property="og:description" content="For cards">');
    expect(text).toContain('<meta property="og:type" content="article">');
    expect(text).toContain(`<link rel="canonical" href="https://${PRIMARY_HOST}/en/blog/news/hello">`);
    expect(text).toContain('<html lang="en">');
    expect(text).toContain(`<meta property="og:image" content="https://${PRIMARY_HOST}/og/default-en.jpg?v=3">`);
    expect(text).toContain(`<meta property="article:published_time" content="${new Date(1000).toISOString()}">`);
    expect(text).toContain('<meta property="article:modified_time"');
    expect(headers.get("cache-control")).toBe("public, max-age=60");
  });

  it("沒填分享欄位時退回標題、摘要；沒有摘要用內文前 200 字（去 Markdown 符號）", async () => {
    await post({ excerpt: "", bodyMd: "# 標題\n\n這是**重點**，見[連結](https://x.test/a)。" }, 1000);
    const { text } = await get("/blog/news/hello");
    expect(text).toContain('<meta property="og:title" content="開站了">');
    expect(text).toContain('<meta property="og:description" content="標題 這是重點，見連結。">');
    expect(text).toContain(`<link rel="canonical" href="https://${PRIMARY_HOST}/blog/news/hello">`);
  });

  it("JSON-LD 是 Article，標題裡的 </script> 被轉義，不含成員 id", async () => {
    const p = await post({ title: "a</script><b>" }, 1000);
    const { text } = await get("/blog/news/hello");
    const m = text.match(/<script type="application\/ld\+json">(.*?)<\/script>/s);
    expect(m).not.toBeNull();
    expect(m![1]).not.toContain("<");
    const ld = JSON.parse(m![1]!);
    expect(ld).toMatchObject({
      "@type": "Article", headline: "a</script><b>", datePublished: new Date(1000).toISOString(),
      author: { "@type": "Organization" }, mainEntityOfPage: `https://${PRIMARY_HOST}/blog/news/hello`,
    });
    expect(text).not.toContain(editor);
    expect(text).not.toContain(p.authorMemberId);
  });

  it("草稿、撤下、未到時間、不存在：SPA 殼＋noindex＋404", async () => {
    await post({ slug: "draft" }, null);
    await post({ slug: "later" }, Date.now() + 86_400_000);
    const gone = await post({ slug: "gone" }, 1000);
    await setPostState(env.DB, gone.id, { status: "unpublished" }, actor(), op(), 2000);
    for (const slug of ["draft", "later", "gone", "nope"]) {
      const { status, text, headers } = await get(`/blog/news/${slug}`);
      expect(status).toBe(404);
      expect(text).toContain('<div id="app"></div>');
      expect(text).toContain('name="robots" content="noindex');
      expect(text).not.toContain('property="og:title"');
      expect(headers.get("x-robots-tag")).toContain("noindex");
    }
  });

  it("?preview= 的草稿網址：照樣是 404 殼＋noindex，沒有分享標籤", async () => {
    await post({ slug: "wip" }, null);
    const { status, text } = await get("/blog/news/wip?preview=anything");
    expect(status).toBe(404);
    expect(text).toContain('name="robots" content="noindex');
    expect(text).not.toContain('property="og:title"');
  });

  it("資料庫讀取出錯不是 404／noindex，壞掉的網址編碼才是", async () => {
    await post({}, 1000);
    const failing = (db: D1Database): D1Database => new Proxy(db, { get(t, k) {
      if (k === "prepare") return (sql: string) => { if (sql.includes("blog_")) throw new Error("d1 down"); return t.prepare(sql); };
      if (k === "withSession") return (c?: string) => failing(t.withSession(c as never) as unknown as D1Database);
      const v = Reflect.get(t, k);
      return typeof v === "function" ? v.bind(t) : v;
    } });
    const ctx = createExecutionContext();
    const res = await worker.fetch(new Request("https://c.test/blog/news/hello"), { ...testEnv, DB: failing(env.DB) }, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(await res.text()).not.toContain("noindex");
    const bad = await get("/blog/%E0%A4%A");
    expect(bad.status).toBe(404);
    expect(bad.text).toContain("noindex");
  });

  it("/blog 與欄目頁：站名接標題、website 型、站台預設圖；不存在的欄目 404", async () => {
    const home = await get("/blog");
    expect(home.status).toBe(200);
    expect(home.text).toContain("<title>部落格 · 綺夢社</title>");
    expect(home.text).toContain('<meta property="og:type" content="website">');
    expect(home.text).toContain(`<meta property="og:image" content="https://${PRIMARY_HOST}/og/default-zh-Hant.jpg?v=3">`);
    const col = await get("/en/blog/news");
    expect(col.text).toContain("<title>News · SukiSuki</title>");
    expect(col.text).toContain(`<link rel="canonical" href="https://${PRIMARY_HOST}/en/blog/news">`);
    expect((await get("/blog/nope")).status).toBe(404);
  });
});

describe("短網址與停用欄目", () => {
  it("/blog/p/:id：公開文章 302 到 canonical（保留語言前綴）；草稿與未到時間 404＋noindex", async () => {
    const live = await post({ slug: "live", locale: "en" }, 1000);
    for (const [path, to] of [[`/blog/p/${live.id}`, "/blog/news/live"], [`/en/blog/p/${live.id}`, "/en/blog/news/live"], [`/ja/blog/p/${live.id}`, "/ja/blog/news/live"]] as const) {
      const ctx = createExecutionContext();
      const res = await worker.fetch(new Request(`https://c.test${path}`, { redirect: "manual" }), testEnv, ctx);
      await waitOnExecutionContext(ctx);
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe(to);
    }
    for (const id of [(await post({ slug: "d" }, null)).id, (await post({ slug: "s" }, Date.now() + 86_400_000)).id, "nope"]) {
      const r = await get(`/blog/p/${id}`);
      expect(r.status).toBe(404);
      expect(r.text).toContain("noindex");
    }
  });

  it("停用欄目的列表頁 404＋noindex、沒有分享標籤；裡面的單篇仍可開", async () => {
    await post({}, 1000);
    await env.DB.prepare("UPDATE blog_columns SET enabled = 0 WHERE id = ?").bind(columnId).run();
    const col = await get("/blog/news");
    expect(col.status).toBe(404);
    expect(col.text).toContain('name="robots" content="noindex');
    expect(col.text).not.toContain('property="og:title"');
    expect((await get("/blog/news/hello")).status).toBe(200);
  });
});

describe("部落格 Atom", () => {
  it("只列公開文章，未到時間、草稿、撤下的都沒有；entry 連結是 canonical", async () => {
    await post({ slug: "live", title: "公開的", excerpt: "摘要一" }, 1000);
    await post({ slug: "later", title: "未來的" }, Date.now() + 86_400_000);
    await post({ slug: "draft", title: "草稿的" }, null);
    const gone = await post({ slug: "gone", title: "撤下的" }, 1000);
    await setPostState(env.DB, gone.id, { status: "unpublished" }, actor(), op(), 2000);
    const { status, text, headers } = await get("/blog.atom");
    expect(status).toBe(200);
    expect(headers.get("content-type")).toContain("application/atom+xml");
    expect(text).toContain("公開的");
    expect(text).toContain("<summary>摘要一</summary>");
    expect(text).toContain(`<link href="https://${PRIMARY_HOST}/blog/news/live"/>`);
    for (const hidden of ["未來的", "草稿的", "撤下的"]) expect(text).not.toContain(hidden);
    expect((await get("/en/blog.atom")).text).toContain('xml:lang="en"');
  });

  it("標題與摘要裡 XML 1.0 不允許的控制字元被拿掉，feed 仍有該篇", async () => {
    await post({ slug: "ctl", title: "a\u000Bb\u0000c", excerpt: "x\u001Fy\uFFFEz" }, 1000);
    const { text } = await get("/blog.atom");
    expect(text).toContain("<title>abc</title>");
    expect(text).toContain("<summary>xyz</summary>");
    // eslint-disable-next-line no-control-regex
    expect(text).not.toMatch(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/);
  });

  it("置頂不會動 Atom 的 <updated> 與 article:modified_time；存內容才會", async () => {
    const p = await post({}, 1000);
    const before = { feed: (await get("/blog.atom")).text, page: (await get("/blog/news/hello")).text };
    await setPostState(env.DB, p.id, { pinned: true }, actor(), op(), 9_000_000);
    const feed = (await get("/blog.atom")).text;
    expect(feed).toBe(before.feed);
    expect(feed).toContain(`<updated>${new Date(1000).toISOString()}</updated>`);
    const page = (await get("/blog/news/hello")).text;
    expect(page).toContain(`<meta property="article:modified_time" content="${new Date(1000).toISOString()}">`);
    expect(page).toContain(`"dateModified":"${new Date(1000).toISOString()}"`);
    expect(page).toBe(before.page);
  });

  it("最多 20 篇，標題裡的符號被轉義", async () => {
    for (let i = 0; i < 22; i++) await post({ slug: `p${i}`, title: i === 21 ? "a & <b>" : `t${i}` }, 1000 + i);
    const { text } = await get("/blog.atom");
    expect(text.match(/<entry /g)).toHaveLength(20);
    expect(text).toContain("a &amp; &lt;b&gt;");
    expect(text).not.toContain("<title>t0</title>"); // 最舊的兩篇被擠出去
    expect(text).not.toContain("<title>t1</title>");
  });
});

describe("分組頁", () => {
  it("/blog/g/<分組> 有分組名稱的標題與 canonical；不存在或停用 404＋noindex", async () => {
    await post({}, 1000);
    const ok = await get("/blog/g/official");
    expect(ok.status).toBe(200);
    expect(ok.text).toContain("<title>官方消息");
    expect(ok.text).toContain(`<link rel="canonical" href="https://${PRIMARY_HOST}/blog/g/official">`);
    const en = await get("/en/blog/g/official");
    expect(en.text).toContain("<title>News");
    for (const path of ["/blog/g/nope", "/blog/g/news"]) {
      const r = await get(path);
      expect([path, r.status]).toEqual([path, 404]);
      expect(r.text).toContain('name="robots" content="noindex');
    }
    await env.DB.prepare("UPDATE blog_columns SET enabled = 0 WHERE slug = 'official'").run();
    expect((await get("/blog/g/official")).status).toBe(404);
    expect((await get("/blog/news")).status).toBe(404);
    expect((await get("/blog/news/hello")).status).toBe(200);
  });

  it("分組的 slug 不是欄目頁：/blog/official 是 404", async () => {
    expect((await get("/blog/official")).status).toBe(404);
  });
});
