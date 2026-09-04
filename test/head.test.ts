import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import worker from "../src/index";
import { authorLine, oneLine } from "../src/head";
import { resetDb, restoreUpstream, role } from "./helpers";
import { upsertCard } from "../src/cards";

/** 前端的殼：測試裡不建 web/dist，用一個假的資源層回同一份 index.html */
const SHELL = `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>Taproom</title><meta name="description" content="site"></head><body><div id="app"></div></body></html>`;
const assets = { fetch: async () => new Response(SHELL, { headers: { "content-type": "text/html; charset=utf-8" } }) };
const testEnv = { ...env, ASSETS: assets as unknown as Fetcher };

async function page(path: string) {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request(`https://c.test${path}`), testEnv, ctx);
  await waitOnExecutionContext(ctx);
  return { status: res.status, html: await res.text(), headers: res.headers };
}

beforeEach(async () => {
  await resetDb();
  await upsertCard(env.DB, role({ roleId: "r-1", name: "夜行偵探 沈墨", nameEn: "Night Detective", desc: "民國二十四年的上海，租界的雨從不停。", authorNumId: 7, authorName: "月光" }), Date.now());
});
afterEach(restoreUpstream);

describe("分享預覽", () => {
  it("卡片頁的 <head> 帶著這張卡的標題、簡介與圖", async () => {
    const { status, html, headers } = await page("/cards/r-1");
    expect(status).toBe(200);
    expect(html).toContain("<title>夜行偵探 沈墨 · Taproom</title>");
    expect(html).toContain('<meta name="description" content="民國二十四年的上海，租界的雨從不停。">');
    expect(html).toContain('<meta property="og:title" content="夜行偵探 沈墨 · Taproom">');
    expect(html).toContain('<meta property="og:image" content="https://cdn.lunatalk.ai/cover.png">');
    expect(html).toContain('<link rel="canonical" href="https://c.test/cards/r-1">');
    expect(html).toContain('<html lang="zh-Hant">');
    expect(headers.get("cache-control")).toContain("max-age=60");
    // 殼的其餘部分原封不動
    expect(html).toContain('<div id="app"></div>');
  });

  it("語言前綴決定 <html lang> 與用哪個語言的名字", async () => {
    const { html } = await page("/en/cards/r-1");
    expect(html).toContain('<html lang="en">');
    expect(html).toContain("<title>Night Detective · Taproom</title>");
    expect(html).toContain('<meta property="og:locale" content="en_US">');
  });

  it("找不到的卡回 404，但內容仍是前端的殼，讓它畫自己的 404 頁", async () => {
    const { status, html } = await page("/cards/nope");
    expect(status).toBe(404);
    expect(html).toContain('<div id="app"></div>');
    expect(html).not.toContain("og:title");
  });

  it("作者頁也有預覽", async () => {
    const { status, html } = await page("/ja/authors/7");
    expect(status).toBe(200);
    expect(html).toContain("<title>月光 · Taproom</title>");
    expect(html).toContain('<meta property="og:description" content="作品 1 · 会話 0">');
  });

  it("其他路徑原樣回殼", async () => {
    const { status, html } = await page("/mine");
    expect(status).toBe(200);
    expect(html).toContain("<title>Taproom</title>");
    expect(html).not.toContain("og:title");
  });

  it("屬性值會跳脫，簡介壓成一行", () => {
    expect(oneLine("a\n\n b   c")).toBe("a b c");
    expect(oneLine("x".repeat(300)).length).toBe(200);
    expect(authorLine("en", 1200, 3)).toBe("1,200 cards · 3 chats");
  });

  it("名字裡的引號不會撐破屬性", async () => {
    await upsertCard(env.DB, role({ roleId: "r-2", name: 'She said "hi" <b>', authorNumId: 8 }), Date.now());
    const { html } = await page("/cards/r-2");
    expect(html).toContain('content="She said &quot;hi&quot; &lt;b&gt; · Taproom"');
    expect(html).not.toContain("<b> · Taproom");
  });
});
