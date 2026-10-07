/**
 * 連結預覽的 og:image：作者畫的分享圖 → 橫式背景 → 直式背景。
 * 直式背景直接當 og:image 的話，Discord／LINE／X 從中間裁 1.91:1，作者畫在圖上的標題常被切掉；
 * 橫式背景至少是橫的，裁掉的少。本站不合成預覽圖。
 */
import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import worker from "../src/index";
import { envWithAssets, resetDb, restoreUpstream, role, rolesOnProviders } from "./helpers";
import { getCard, upsertCard } from "../src/cards";

const PORTRAIT = "https://assets.harperharbor.com/bg.png";
const LANDSCAPE = "https://assets.harperharbor.com/landscape.png";
const SHARE = "https://assets.harperharbor.com/share.png";

beforeEach(async () => {
  await resetDb();
  rolesOnProviders({});
  await upsertCard(env.DB, role({ roleId: "r-1", name: "夜行偵探 沈墨" }), Date.now());
});
afterEach(restoreUpstream);

async function get(path: string, e: typeof env = envWithAssets()) {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request(`https://c.test${path}`), e, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}
const cardId = async (roleId = "r-1") => (await getCard(env.DB, roleId))!.id;
const set = (sql: string, ...args: unknown[]) => env.DB.prepare(`UPDATE cards SET ${sql} WHERE source_role_id='r-1'`).bind(...args).run();
const ogImage = (html: string) => html.match(/<meta property="og:image" content="([^"]+)">/)?.[1];

describe("卡片頁的 og:image", () => {
  it("作者有畫分享圖：用它（就算也有橫式背景），並註明 1200×630", async () => {
    await set("share_image_url=?, landscape_url=?", SHARE, LANDSCAPE);
    const html = await (await get("/cards/r-1")).text();
    expect(ogImage(html)).toBe(SHARE);
    expect(html).toContain(`<meta name="twitter:image" content="${SHARE}">`);
    expect(html).toContain('<meta property="og:image:width" content="1200">');
    expect(html).toContain('<meta property="og:image:height" content="630">');
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image">');
    // 頁面主圖的預載仍是直式背景：預覽圖是給抓取器的，不是頁面上畫的那張
    expect(html).toContain(`<link rel="preload" as="image" href="${PORTRAIT}" fetchpriority="high">`);
  });

  it("沒有分享圖：用橫式背景，不註明尺寸", async () => {
    await set("landscape_url=?", LANDSCAPE);
    const html = await (await get("/cards/r-1")).text();
    expect(ogImage(html)).toBe(LANDSCAPE);
    expect(html).not.toContain("og:image:width");
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image">');
    expect(html).toContain(`<link rel="preload" as="image" href="${PORTRAIT}" fetchpriority="high">`);
  });

  it("兩張都沒有：用直式背景，不註明尺寸", async () => {
    const html = await (await get("/cards/r-1")).text();
    expect(ogImage(html)).toBe(PORTRAIT);
    expect(html).not.toContain("og:image:width");
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image">');
  });

  it("什麼圖都沒有：不放 og:image", async () => {
    await set("background_url=NULL");
    const html = await (await get("/cards/r-1")).text();
    expect(html).not.toContain('property="og:image"');
    expect(html).toContain('<meta name="twitter:card" content="summary">');
  });
});

it("本站不合成預覽圖：/og/cards/:id.jpg 不是 Worker 的路由，原樣交給資源層", async () => {
  const res = await get(`/og/cards/${await cardId()}.jpg`);
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("text/html");
  expect(res.headers.get("location")).toBeNull();
});

it("卡片 API 帶出分享圖與橫式背景", async () => {
  await set("share_image_url=?, landscape_url=?", SHARE, LANDSCAPE);
  const card = (await (await get(`/v1/cards/${await cardId()}`)).json()) as { shareImageUrl?: string; landscapeUrl?: string };
  expect(card.shareImageUrl).toBe(SHARE);
  expect(card.landscapeUrl).toBe(LANDSCAPE);
});
