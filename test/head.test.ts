import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import worker from "../src/index";
import { authorLine, oneLine } from "../src/head";
import { envWithAssets, makeMember, resetDb, restoreUpstream, role, testHandle } from "./helpers";
import { upsertCard } from "../src/cards";

// 殼帶驗證器：測「改寫後要清 ETag／Last-Modified」那幾條
const testEnv = envWithAssets({}, { etag: '"shell-v1"', "last-modified": "Mon, 01 Sep 2025 00:00:00 GMT" });

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
    expect(html).toContain("<title>夜行偵探 沈墨 · Hearthroom</title>");
    expect(html).toContain('<meta name="description" content="民國二十四年的上海，租界的雨從不停。">');
    expect(html).toContain('<meta property="og:title" content="夜行偵探 沈墨 · Hearthroom">');
    expect(html).toContain('<meta property="og:image" content="https://cdn.lunatalk.ai/cover.png">');
    // canonical 一律指向正牌主機：搬家期間兩個網域並存，搜尋引擎要知道哪個才算數
    expect(html).toContain('<link rel="canonical" href="https://hearthroom.club/cards/r-1">');
    expect(html).toContain('<html lang="zh-Hant">');
    expect(headers.get("cache-control")).toContain("max-age=60");
    // 改寫過的內容不能沿用殼的驗證器：帶著它去重驗會拿到 304，卡改了也看不到
    expect(headers.get("etag")).toBeNull();
    expect(headers.get("last-modified")).toBeNull();
    // 殼的其餘部分原封不動
    expect(html).toContain('<div id="app"></div>');
  });

  it("語言前綴決定 <html lang> 與用哪個語言的名字", async () => {
    const { html } = await page("/en/cards/r-1");
    expect(html).toContain('<html lang="en">');
    expect(html).toContain("<title>Night Detective · Hearthroom</title>");
    expect(html).toContain('<meta property="og:locale" content="en_US">');
  });

  it("找不到的卡回 404，但內容仍是前端的殼，讓它畫自己的 404 頁", async () => {
    const { status, html } = await page("/cards/nope");
    expect(status).toBe(404);
    expect(html).toContain('<div id="app"></div>');
    expect(html).not.toContain("og:title");
  });

  it("壞掉的百分號編碼是 404，不是 500", async () => {
    const { status, html } = await page("/cards/100%");
    expect(status).toBe(404);
    expect(html).toContain('<div id="app"></div>');
  });

  it("作者頁也有預覽（網址是本站的公開 ID）", async () => {
    await makeMember(7);
    const { status, html } = await page(`/ja/authors/${testHandle(7)}`);
    expect(status).toBe(200);
    expect(html).toContain("<title>月光 · Hearthroom</title>");
    expect(html).toContain('<meta property="og:description" content="作品 1 · 会話 0">');
  });

  it("其他路徑原樣回殼", async () => {
    const { status, html } = await page("/mine");
    expect(status).toBe(200);
    expect(html).toContain("<title>Hearthroom</title>");
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
    expect(html).toContain('content="She said &quot;hi&quot; &lt;b&gt; · Hearthroom"');
    expect(html).not.toContain("<b> · Hearthroom");
  });
});
