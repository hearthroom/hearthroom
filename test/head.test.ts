import { PRIMARY_HOST } from "../shared/site-hosts";
import { createExecutionContext, env, SELF, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import worker from "../src/index";
import { authorLine, oneLine, siteOgImage } from "../src/head";
import { envWithAssets, makeMember, resetDb, restoreUpstream, rolesOnProviders, role, testHandle } from "./helpers";
import { getCard, upsertCard } from "../src/cards";

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
  rolesOnProviders({});
  await upsertCard(env.DB, role({ roleId: "r-1", name: "夜行偵探 沈墨", nameEn: "Night Detective", desc: "民國二十四年的上海，租界的雨從不停。", authorNumId: 7, authorName: "月光" }), Date.now());
});
afterEach(restoreUpstream);

describe("分享預覽", () => {
  it("卡片頁的 <head> 帶著這張卡的標題、簡介與圖", async () => {
    const { status, html, headers } = await page("/cards/r-1");
    expect(status).toBe(200);
    // 無前綴＝繁體介面：站名是中文名（shared/site-name.ts）
    expect(html).toContain("<title>夜行偵探 沈墨 · 綺夢社</title>");
    expect(html).toContain('<meta name="description" content="民國二十四年的上海，租界的雨從不停。">');
    expect(html).toContain('<meta property="og:title" content="夜行偵探 沈墨 · 綺夢社">');
    expect(html).toContain('<meta property="og:image" content="https://assets.harperharbor.com/bg.png">');
    // 卡片圖是這頁最大的一張：HTML 一到就開始下載，不等 JS 讀完卡片資料
    expect(html).toContain('<link rel="preload" as="image" href="https://assets.harperharbor.com/bg.png" fetchpriority="high">');
    // canonical 一律指向正牌主機：搬家期間兩個網域並存，搜尋引擎要知道哪個才算數
    const card = await getCard(env.DB, 'r-1');
    expect(html).toContain(`<link rel="canonical" href="https://${PRIMARY_HOST}/cards/${card!.id}">`);
    expect(html).toContain('<html lang="zh-Hant">');
    expect(headers.get("cache-control")).toBe("no-store");
    // 改寫過的內容不能沿用殼的驗證器：帶著它去重驗會拿到 304，卡改了也看不到
    expect(headers.get("etag")).toBeNull();
    expect(headers.get("last-modified")).toBeNull();
    // 殼的其餘部分原封不動
    expect(html).toContain('<div id="app"></div>');
  });

  it("語言前綴決定 <html lang> 與用哪個語言的名字", async () => {
    const { html } = await page("/en/cards/r-1");
    expect(html).toContain('<html lang="en">');
    expect(html).toContain("<title>Night Detective · SukiSuki</title>");
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
    expect(html).toContain("<title>月光 · SukiSuki</title>");
    expect(html).toContain('<meta property="og:description" content="作品 1 · 会話 0">');
    // 作者頁的分享圖不是頁面主圖，不搶頻寬
    expect(html).not.toContain('rel="preload"');
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
    expect(html).toContain('content="She said &quot;hi&quot; &lt;b&gt; · 綺夢社"');
    expect(html).not.toContain("<b> · 綺夢社");
  });
});

it.each([
  ['', '下載綺夢社', 'zh_TW'],
  ['/zh-Hans', '下载绮梦社', 'zh_CN'],
  ['/en', 'Download SukiSuki', 'en_US'],
  ['/ja', 'SukiSuki をダウンロード', 'ja_JP'],
  ['/ko', 'SukiSuki 다운로드', 'ko_KR'],
])('serves localized download metadata in the initial HTML: %s', async (prefix, title, locale) => {
  const {html,headers,status}=await page(`${prefix}/download/?ref=discord`);
  expect(status).toBe(200);
  expect(html).toContain(`<title>${title}</title>`);
  expect(html).toContain(`<meta property="og:title" content="${title}">`);
  expect(html).toContain(`<meta property="og:locale" content="${locale}">`);
  expect(html).toContain(`<meta property="og:url" content="https://${PRIMARY_HOST}${prefix}/download">`);
  expect(html).toContain(`<meta property="og:image" content="${siteOgImage("download", prefix.slice(1) || "zh-Hant")}">`);
  expect(html).toContain('<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">');
  expect(html).toContain('<meta name="twitter:title"');
  expect(html).toContain('Android');
  expect(headers.get('etag')).toBeNull();
});

it('trailing slashes do not lose the card-specific preview',async()=>{
  const {html}=await page('/en/cards/r-1/');
  expect(html).toContain('<meta property="og:title" content="Night Detective · SukiSuki">');
  expect(html).toContain(`content="https://${PRIMARY_HOST}/en/cards/${(await getCard(env.DB,'r-1'))!.id}"`);
});

it('canonical social URLs preserve the global identity when providers have the same upstream ID',async()=>{
  await upsertCard(env.DB,role({roleId:'r-1',name:'Harbor card'}),Date.now(),{status:'approved',provider:'harbor'});
  const card=await getCard(env.DB,'r-1','harbor');
  const expected=`https://${PRIMARY_HOST}/cards/${encodeURIComponent(card!.id)}`;
  for(const id of [encodeURIComponent(card!.id),String(card!.num)]){
    const {html}=await page(`/cards/${id}`);
    expect(html).toContain('content="Harbor card · 綺夢社"');
    expect(html).toContain(`<meta property="og:url" content="${expected}">`);
  }
});

it('does not expose restricted card details to sharing crawlers',async()=>{
  for(const change of ["rating='R'","rating=NULL,status='pending'","status='approved',public_blocked=1"]){
    await env.DB.prepare(`UPDATE cards SET ${change} WHERE source_role_id='r-1'`).run();
    const {html}=await page('/cards/r-1/');
    expect(html).not.toContain('Night Detective');
    expect(html).not.toContain('夜行偵探');
    expect(html).not.toContain('cover.png');
  }
});


it.each([
  ['/', '綺夢社・AI寢物語', 'zh-Hant', 'zh_TW', `https://${PRIMARY_HOST}/`],
  ['/zh-Hans/', '绮梦社・AI寝物语', 'zh-Hans', 'zh_CN', `https://${PRIMARY_HOST}/zh-Hans`],
  ['/en/', 'SukiSuki · Character Board', 'en', 'en_US', `https://${PRIMARY_HOST}/en`],
  ['/ja?sort=hot', 'SukiSuki · キャラクターカード ランキング', 'ja', 'ja_JP', `https://${PRIMARY_HOST}/ja`],
])('首頁的 <head> 帶著各語言的站名與副標，不跑 JS 的爬蟲也看得到：%s', async (path, title, lang, locale, canonical) => {
  const response = await SELF.fetch(`https://${PRIMARY_HOST}${path}`, { headers: { 'User-Agent': 'bingbot' } });
  expect(response.status).toBe(200);
  const html = await response.text();
  expect(html).toContain(`<title>${title}</title>`);
  expect(html).toContain(`<meta property="og:title" content="${title}">`);
  expect(html).toContain(`<meta property="og:locale" content="${locale}">`);
  expect(html).toContain(`<meta property="og:url" content="${canonical}">`);
  expect(html).toContain('<meta property="og:type" content="website">');
  expect(html).toContain(`<meta property="og:image" content="${siteOgImage("default", lang)}">`);
  expect(html).toContain('<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">');
  expect(html.match(/property="og:title"/g)).toHaveLength(1);
});

// 沒有語言前綴：看抓取器的 Accept-Language 分繁簡，分不出來用簡體（owner 2026-10-17）
it.each([
  ["/me", "zh-TW", "zh-Hant", "綺夢社・AI寢物語"],
  ["/me", "", "zh-Hans", "绮梦社・AI寝物语"],
  ["/en/me", "zh-TW", "en", "SukiSuki · Character Board"],
])("SPA 頁面的 HTML 殼有各語言的預設分享圖：%s（%s）", async (path, acceptLanguage, lang, title) => {
  const response = await SELF.fetch(`https://${PRIMARY_HOST}${path}`, { headers: acceptLanguage ? { "Accept-Language": acceptLanguage } : {} });
  expect(response.headers.get("content-type")).toContain("text/html");
  const html = await response.text();
  expect(html).toContain(`<meta property="og:title" content="${title}">`);
  expect(html).toContain(`<meta name="twitter:title" content="${title}">`);
  expect(html).toContain(`<meta property="og:image" content="${siteOgImage("default", lang)}">`);
  expect(html).toContain('<meta name="twitter:card" content="summary_large_image">');
  expect(html).toContain('<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">');
  expect(html).not.toContain('rel="canonical"');
  // 微信、QQ 讀 <title> 與 description：殼的也換成站名與說明
  expect(html).toContain(`<title>${title}</title>`);
  expect(html).toContain(`<html lang="${lang}"`);
});

it("靜態資源不會被加上分享標籤", async () => {
  const ctx = createExecutionContext();
  const assets = envWithAssets({ "/assets/site.js": "console.log('site')" });
  const response = await worker.fetch(new Request(`https://${PRIMARY_HOST}/assets/site.js`), assets, ctx);
  await waitOnExecutionContext(ctx);
  const body = await response.text();
  expect(response.headers.get("content-type")).toContain("text/javascript");
  expect(body).toBe("console.log('site')");
  expect(body).not.toContain("og:image");
});

it("站內 play 頁不會被加上站台分享圖", async () => {
  const ctx = createExecutionContext();
  const response = await worker.fetch(new Request(`https://${PRIMARY_HOST}/play/100001`), testEnv, ctx);
  await waitOnExecutionContext(ctx);
  const html = await response.text();
  expect(response.headers.get("content-type")).toContain("text/html");
  expect(html).not.toContain("/og/default-");
});

it("siteOgImage 不認得的語言退回英文", () => {
  expect(siteOgImage("updates", "fr")).toBe(`https://${PRIMARY_HOST}/og/updates-en.jpg?v=3`);
});

it.each(['hearthroom.club','sukisuki.ai','sukisuki.chat'])('static asset routing invokes the metadata handler on %s',async host=>{
  for(const path of ['/download','/download/','/en/download']){
    const response=await SELF.fetch(`https://${host}${path}`,{headers:{'User-Agent':'Discordbot'}});
    expect(response.status).toBe(200);
    const html=await response.text();
    expect(html).toContain('<meta property="og:type" content="website">');
    expect(html).toContain('Android');
    expect(html.match(/property="og:title"/g)).toHaveLength(1);
    expect(html).toContain('<meta name="twitter:image"');
  }
});


const GUIDE_PREVIEWS = [
  ["", "zh-Hant", "zh_TW", "寫卡指南 · 綺夢社", "綺夢社的寫卡指南教你用 AI 工具或網頁編輯器，把角色與故事的想法寫成能對話、能試玩的角色卡。"],
  ["/zh-Hans", "zh-Hans", "zh_CN", "写卡指南 · 绮梦社", "绮梦社的写卡指南带你用 AI 工具或网页编辑器，把角色和故事的想法做成可以聊天、试玩的角色卡。"],
  ["/en", "en", "en_US", "Card authoring guide · SukiSuki", "The SukiSuki card authoring guide helps you turn a character or story idea into a playable card with AI tools or the web editor."],
  ["/ja", "ja", "ja_JP", "カード作成ガイド · SukiSuki", "SukiSuki のカード作成ガイドでは、AI ツールやウェブエディターで、キャラクターや物語のアイデアを会話して遊べるカードにする方法を紹介します。"],
  ["/ko", "ko", "ko_KR", "카드 작성 가이드 · SukiSuki", "SukiSuki 카드 작성 가이드는 AI 도구나 웹 편집기로 캐릭터와 이야기 아이디어를 직접 대화하며 즐길 수 있는 카드로 만드는 방법을 알려 줘요."],
];
it.each(GUIDE_PREVIEWS)("guide sharing describes card authoring in its own language: %s", async (prefix, lang, locale, title, description) => {
  for (const suffix of ["", "/?way=web&ref=discord"]) {
    const ctx = createExecutionContext();
    const response = await worker.fetch(new Request(`https://${PRIMARY_HOST}${prefix}/guide${suffix}`, {
      headers: { "User-Agent": "facebookexternalhit/1.1", "Accept-Language": lang === "en" ? "ja" : "en" },
    }), testEnv, ctx);
    await waitOnExecutionContext(ctx);
    const html = await response.text();
    const canonical = `https://${PRIMARY_HOST}${prefix}/guide`;
    expect(response.status).toBe(200);
    expect(html).toContain(`<html lang="${lang}">`);
    expect(html).toContain(`<title>${title}</title>`);
    expect(html).toContain(`<meta name="description" content="${description}">`);
    expect(html).toContain(`<link rel="canonical" href="${canonical}">`);
    for (const [key, value] of Object.entries({ title, description, url: canonical, locale, image: siteOgImage("default", lang) })) {
      expect(html).toContain(`<meta property="og:${key}" content="${value}">`);
      expect(html.match(new RegExp(`property="og:${key}"`, "g"))).toHaveLength(1);
    }
    for (const [key, value] of Object.entries({ card: "summary_large_image", title, description, image: siteOgImage("default", lang) })) {
      expect(html).toContain(`<meta name="twitter:${key}" content="${value}">`);
      expect(html.match(new RegExp(`name="twitter:${key}"`, "g"))).toHaveLength(1);
    }
    expect(html).toContain('<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">');
    expect(html).toContain('<div id="app"></div>');
    expect(response.headers.get("etag")).toBeNull();
    expect(response.headers.get("last-modified")).toBeNull();
  }
});

it("guide metadata does not apply to play hosts, static files or guide subpaths", async () => {
  for (const url of [`https://play.${PRIMARY_HOST}/guide`, `https://${PRIMARY_HOST}/guide.md`, `https://${PRIMARY_HOST}/guide/extra`]) {
    const ctx = createExecutionContext();
    const response = await worker.fetch(new Request(url), testEnv, ctx);
    await waitOnExecutionContext(ctx);
    const html = await response.text();
    expect(html).not.toContain('content="寫卡指南 · 綺夢社"');
    expect(html).not.toContain(`<meta property="og:url" content="https://${PRIMARY_HOST}/guide">`);
  }
});

it.each(["/guide", "/guide/", "/en/guide"])("asset routing runs guide metadata before serving the SPA: %s", async path => {
  const response = await SELF.fetch(`https://${PRIMARY_HOST}${path}`, { headers: { "User-Agent": "Discordbot" } });
  const html = await response.text();
  expect(response.status).toBe(200);
  expect(html).toContain(path.startsWith("/en") ? '<meta property="og:title" content="Card authoring guide · SukiSuki">' : '<meta property="og:title" content="寫卡指南 · 綺夢社">');
  expect(html.match(/property="og:title"/g)).toHaveLength(1);
});
