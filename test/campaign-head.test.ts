import { PRIMARY_HOST } from "../shared/site-hosts";
import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../src/index";
import { envWithAssets, resetDb } from "./helpers";

/**
 * 活動頁 /campaign/:slug 的分享預覽：標題、簡介、圖片寫進 <head>，不跑 JS 的抓取器（LINE、Discord、QQ、微信）才看得到。
 * 語言：網址有語言前綴就照前綴；沒有前綴時看抓取器的 Accept-Language 分繁簡，分不出來用簡體（owner 2026-10-17）。
 */
const testEnv = envWithAssets();

async function get(path: string, acceptLanguage?: string, host = "c.test") {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request(`https://${host}${path}`, { headers: acceptLanguage ? { "Accept-Language": acceptLanguage } : {} }), testEnv, ctx);
  await waitOnExecutionContext(ctx);
  return { status: res.status, text: await res.text(), headers: res.headers };
}

const title = { "zh-Hant": "綺夢分享季", "zh-Hans": "绮梦分享季", en: "Hearthroom Share Season" };
const intro = {
  "zh-Hant": "## 分享好卡，帶朋友來玩\n把喜歡的卡分享到社群，**審核通過**就拿積分。\n\n### 各檔怎麼認定\n- **輕量分享**：群組裡介紹",
  "zh-Hans": "## 分享好卡，带朋友来玩\n把喜欢的卡分享到社区，**审核通过**就拿积分。",
  en: "## Share a great card\nShare a card you love and earn credits.",
};
async function campaign(slug: string, status: string, bannerKey: string | null) {
  await env.DB.prepare("INSERT INTO campaigns (id, slug, title, intro, banner_key, tiers, status, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, '{\"light\":500,\"video\":10000}', ?, 'x', 1, 1)")
    .bind(crypto.randomUUID(), slug, JSON.stringify(title), JSON.stringify(intro), bannerKey, status).run();
}

beforeEach(async () => {
  await resetDb();
  await campaign("share-season", "active", "blog/banner-1.webp");
  await campaign("plain", "active", null);
  await campaign("later", "draft", null);
});

describe("活動頁分享資訊", () => {
  it("繁中抓取器：活動名接站名、介紹第一段當簡介、橫幅當分享圖", async () => {
    const { status, text, headers } = await get("/campaign/share-season", "zh-TW,zh;q=0.9");
    expect(status).toBe(200);
    expect(text).toContain('<html lang="zh-Hant">');
    expect(text).toContain("<title>綺夢分享季 · 綺夢社</title>");
    expect(text).toContain('<meta property="og:title" content="綺夢分享季 · 綺夢社">');
    expect(text).toContain('<meta property="og:description" content="把喜歡的卡分享到社群，審核通過就拿積分。">');
    expect(text).toContain(`<meta property="og:image" content="https://${PRIMARY_HOST}/v1/blog/images/banner-1.webp">`);
    expect(text).toContain('<meta name="twitter:card" content="summary_large_image">');
    expect(text).toContain('<meta property="og:locale" content="zh_TW">');
    expect(text).toContain(`<link rel="canonical" href="https://${PRIMARY_HOST}/campaign/share-season">`);
    expect(headers.get("vary")).toContain("Accept-Language");
  });

  it("沒有語言前綴時：簡中抓取器、或分不出繁簡（沒送語言、送英文）都用簡體", async () => {
    for (const al of ["zh-CN,zh;q=0.9", "zh", undefined, "en-US"]) {
      const { text } = await get("/campaign/share-season", al);
      expect(text, String(al)).toContain('<html lang="zh-Hans">');
      expect(text, String(al)).toContain('<meta property="og:title" content="绮梦分享季 · 绮梦社">');
    }
    for (const al of ["zh-HK", "zh-Hant-TW", "zh-MO,en;q=0.5"]) {
      expect((await get("/campaign/share-season", al)).text, al).toContain('<html lang="zh-Hant">');
    }
  });

  it("網址有語言前綴就照前綴，不看抓取器的語言", async () => {
    const hans = await get("/zh-Hans/campaign/share-season", "zh-TW");
    expect(hans.text).toContain('<meta property="og:title" content="绮梦分享季 · 绮梦社">');
    expect(hans.text).toContain(`<link rel="canonical" href="https://${PRIMARY_HOST}/zh-Hans/campaign/share-season">`);
    const en = await get("/en/campaign/share-season/", "zh-CN");
    expect(en.text).toContain('<meta property="og:title" content="Hearthroom Share Season · Hearthroom">');
    expect(en.text).toContain('<meta property="og:description" content="Share a card you love and earn credits.">');
    // 這個語言沒填的欄位退回繁中
    const ja = await get("/ja/campaign/share-season");
    expect(ja.text).toContain('<meta property="og:title" content="綺夢分享季 · Hearthroom">');
  });

  it("沒有橫幅用站台預設分享圖", async () => {
    const { text } = await get("/zh-Hans/campaign/plain");
    expect(text).toContain(`<meta property="og:image" content="https://${PRIMARY_HOST}/og/default-zh-Hans.jpg?v=2">`);
  });

  it("草稿與不存在的活動：SPA 殼＋noindex＋404，沒有分享標籤", async () => {
    for (const path of ["/campaign/later", "/campaign/nope"]) {
      const { status, text } = await get(path);
      expect(status, path).toBe(404);
      expect(text, path).toContain('<meta name="robots" content="noindex, nofollow">');
      expect(text, path).not.toContain('property="og:title"');
    }
  });
});

describe("帶推薦碼的首頁分享預覽（專屬連結）", () => {
  it("?ref= 的首頁換成邀請版：說這是什麼網站、為什麼要點進來；語言規則跟活動頁一樣", async () => {
    const hant = await get("/?ref=K7XQ2M", "zh-TW", PRIMARY_HOST);
    expect(hant.status).toBe(200);
    expect(hant.text).toContain('<meta property="og:title" content="朋友邀你來綺夢社：和 AI 角色一起寫故事">');
    expect(hant.text).toMatch(/<meta property="og:description" content="戀愛、冒險[^"]*朋友的連結註冊[^"]*">/);
    expect(hant.text).toContain(`<meta property="og:image" content="https://${PRIMARY_HOST}/og/default-zh-Hant.jpg?v=2">`);
    expect(hant.text).toContain(`<link rel="canonical" href="https://${PRIMARY_HOST}/">`);
    expect(hant.headers.get("vary")).toContain("Accept-Language");
    expect((await get("/?ref=K7XQ2M", "zh-CN", PRIMARY_HOST)).text).toContain('<meta property="og:title" content="朋友邀你来绮梦社：和 AI 角色一起写故事">');
    expect((await get("/?ref=K7XQ2M", undefined, PRIMARY_HOST)).text).toContain('<html lang="zh-Hans">');
    expect((await get("/en/?ref=K7XQ2M", "zh-TW", PRIMARY_HOST)).text).toContain("A friend invited you to Hearthroom");
  });

  it("沒有推薦碼或推薦碼格式不對：照原本的首頁預覽", async () => {
    for (const path of ["/", "/?ref=x"]) {
      const { text } = await get(path, "zh-CN", PRIMARY_HOST);
      expect(text, path).not.toContain("朋友邀你");
      expect(text, path).toContain('<html lang="zh-Hant">');
    }
  });
});
