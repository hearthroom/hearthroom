/**
 * 連結預覽的分享圖：作者畫的 1.91:1 分享圖優先；沒有就用直式封面合成一張 1200×630（模糊鋪底＋原圖置中）。
 * 直式封面直接當 og:image 的話，Discord／LINE／X 從中間裁 1.91:1，作者畫在圖上的標題常被切掉。
 */
import { PRIMARY_HOST } from "../shared/site-hosts";
import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker, { ogCache } from "../src/index";
import { envWithAssets, resetDb, restoreUpstream, role, rolesOnProviders } from "./helpers";
import { getCard, upsertCard } from "../src/cards";

const PORTRAIT = "https://assets.harperharbor.com/bg.png";
const SHARE = "https://assets.harperharbor.com/share.png";
const JPG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

let gen = 0;
beforeEach(async () => {
  await resetDb();
  rolesOnProviders({});
  ogCache.namespace = `card-og-test-${++gen}`;
  await upsertCard(env.DB, role({ roleId: "r-1", name: "夜行偵探 沈墨" }), Date.now());
});
afterEach(() => { vi.unstubAllGlobals(); restoreUpstream(); });

async function get(path: string, e: typeof env = envWithAssets()) {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request(`https://c.test${path}`), e, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}
const cardId = async (roleId = "r-1") => (await getCard(env.DB, roleId))!.id;

describe("卡片頁的 og:image", () => {
  it("作者有畫分享圖：og:image 用它，頁面主圖的預載仍是直式封面", async () => {
    await env.DB.prepare("UPDATE cards SET share_image_url=? WHERE source_role_id='r-1'").bind(SHARE).run();
    const html = await (await get("/cards/r-1")).text();
    expect(html).toContain(`<meta property="og:image" content="${SHARE}">`);
    expect(html).toContain(`<meta name="twitter:image" content="${SHARE}">`);
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image">');
    expect(html).toContain(`<link rel="preload" as="image" href="${PORTRAIT}" fetchpriority="high">`);
    expect(html).not.toContain(`/og/cards/`);
  });

  it("沒有分享圖：og:image 指向正牌主機上合成的 1200×630，並註明尺寸", async () => {
    const id = await cardId();
    const html = await (await get("/en/cards/r-1")).text();
    const og = html.match(/<meta property="og:image" content="([^"]+)">/)?.[1];
    expect(og).toBeDefined();
    const url = new URL(og!.replace(/&amp;/g, "&"));
    expect(url.origin).toBe(`https://${PRIMARY_HOST}`);
    expect(url.pathname).toBe(`/og/cards/${id}.jpg`);
    // 換了封面就換網址：抓取器照網址快取預覽圖
    expect(url.searchParams.get("v")).toMatch(/^[0-9a-z]+$/);
    expect(html).toContain('<meta property="og:image:width" content="1200">');
    expect(html).toContain('<meta property="og:image:height" content="630">');
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image">');
    expect(html).toContain(`<link rel="preload" as="image" href="${PORTRAIT}" fetchpriority="high">`);

    await env.DB.prepare("UPDATE cards SET background_url=? WHERE source_role_id='r-1'").bind("https://assets.harperharbor.com/bg2.png").run();
    const again = (await (await get("/en/cards/r-1")).text()).match(/<meta property="og:image" content="([^"]+)">/)?.[1];
    expect(again).not.toBe(og);
  });

  it("分享圖不註明尺寸（作者畫的，不保證是 1200×630）", async () => {
    await env.DB.prepare("UPDATE cards SET share_image_url=? WHERE source_role_id='r-1'").bind(SHARE).run();
    const html = await (await get("/cards/r-1")).text();
    expect(html).not.toContain("og:image:width");
  });

  it("沒有分享圖也沒有封面：不放 og:image", async () => {
    await env.DB.prepare("UPDATE cards SET background_url=NULL WHERE source_role_id='r-1'").run();
    const html = await (await get("/cards/r-1")).text();
    expect(html).not.toContain('property="og:image"');
    expect(html).toContain('<meta name="twitter:card" content="summary">');
  });
});

/** 假的 Images 綁定：記下呼叫，回一張固定的 JPEG。本機的 Images 不一定支援 draw()，不靠它。 */
function fakeImages(opts: { fail?: boolean } = {}) {
  const calls: { op: string; arg?: unknown; opts?: unknown }[] = [];
  const transformer = (label: string): ImageTransformer => ({
    transform(t) { calls.push({ op: `${label}.transform`, arg: t }); return this; },
    draw(img, o) { calls.push({ op: `${label}.draw`, arg: (img as unknown as { label?: string }).label, opts: o }); return this; },
    async output(o) {
      calls.push({ op: `${label}.output`, arg: o });
      if (opts.fail) throw new Error("images unavailable");
      return {
        response: () => new Response(JPG, { headers: { "content-type": "image/jpeg" } }),
        contentType: () => "image/jpeg",
        image: () => new Response(JPG).body!,
      };
    },
    label,
  } as ImageTransformer & { label: string });
  let n = 0;
  const binding = {
    async info() { calls.push({ op: "info" }); return { format: "image/png", fileSize: 7, width: 900, height: 1600 }; },
    input() { return transformer(`input${++n}`); },
  } as unknown as ImagesBinding;
  return { binding, calls };
}

describe("合成的分享圖 /og/cards/:id.jpg", () => {
  it("在榜的一般卡：模糊鋪底、原圖等高置中，輸出 1200×630 JPEG 並快取", async () => {
    const fetchSpy = vi.fn(async () => new Response(JPG, { headers: { "content-type": "image/png" } }));
    vi.stubGlobal("fetch", fetchSpy);
    const { binding, calls } = fakeImages();
    const id = await cardId();
    const res = await get(`/og/cards/${id}.jpg`, { ...envWithAssets(), IMAGES: binding });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("cache-control")).toContain("public");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(JPG);
    expect(fetchSpy).toHaveBeenCalledWith(PORTRAIT, expect.anything());
    const back = calls.find((c) => c.op === "input1.transform")!.arg as ImageTransform;
    expect(back).toMatchObject({ width: 1200, height: 630, fit: "cover" });
    expect(back.blur).toBeGreaterThan(0);
    expect(back.brightness).toBeLessThan(1);
    // 900×1600 等高縮到 630 → 寬 354，置中 left = (1200-354)/2 = 423
    expect(calls.find((c) => c.op === "input2.transform")!.arg).toMatchObject({ width: 354, height: 630, fit: "contain" });
    expect(calls.find((c) => c.op === "input1.draw")).toMatchObject({ arg: "input2", opts: { top: 0, left: 423 } });
    expect(calls.find((c) => c.op === "input1.output")!.arg).toMatchObject({ format: "image/jpeg" });

    const again = await get(`/og/cards/${id}.jpg`, { ...envWithAssets(), IMAGES: binding });
    expect(again.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("換了封面就重新合成（快取鍵含原圖網址）", async () => {
    const fetchSpy = vi.fn(async () => new Response(JPG, { headers: { "content-type": "image/png" } }));
    vi.stubGlobal("fetch", fetchSpy);
    const { binding } = fakeImages();
    const id = await cardId();
    await get(`/og/cards/${id}.jpg`, { ...envWithAssets(), IMAGES: binding });
    await env.DB.prepare("UPDATE cards SET background_url=? WHERE source_role_id='r-1'").bind("https://assets.harperharbor.com/bg2.png").run();
    await get(`/og/cards/${id}.jpg`, { ...envWithAssets(), IMAGES: binding });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy).toHaveBeenLastCalledWith("https://assets.harperharbor.com/bg2.png", expect.anything());
  });

  it("Images 失敗或沒有綁定：轉到原本的直式封面，不是錯誤", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JPG, { headers: { "content-type": "image/png" } })));
    const id = await cardId();
    const failing = await get(`/og/cards/${id}.jpg`, { ...envWithAssets(), IMAGES: fakeImages({ fail: true }).binding });
    expect(failing.status).toBe(302);
    expect(failing.headers.get("location")).toBe(PORTRAIT);
    const none = await get(`/og/cards/${id}.jpg`, { ...envWithAssets(), IMAGES: undefined } as unknown as typeof env);
    expect(none.status).toBe(302);
    expect(none.headers.get("location")).toBe(PORTRAIT);
  });

  it("跟卡片頁的分享預覽同一道門：沒過審、成人內容、被封鎖、不存在都是 404", async () => {
    const fetchSpy = vi.fn(async () => new Response(JPG, { headers: { "content-type": "image/png" } }));
    vi.stubGlobal("fetch", fetchSpy);
    const { binding } = fakeImages();
    const id = await cardId();
    for (const change of ["nsfw=1", "nsfw=0,status='pending'", "status='approved',public_blocked=1"]) {
      await env.DB.prepare(`UPDATE cards SET ${change} WHERE source_role_id='r-1'`).run();
      expect((await get(`/og/cards/${id}.jpg`, { ...envWithAssets(), IMAGES: binding })).status).toBe(404);
    }
    expect((await get(`/og/cards/999999.jpg`, { ...envWithAssets(), IMAGES: binding })).status).toBe(404);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("沒有封面（或不在放行的主機上）：404", async () => {
    const id = await cardId();
    await env.DB.prepare("UPDATE cards SET background_url='https://evil.example/x.png' WHERE source_role_id='r-1'").run();
    expect((await get(`/og/cards/${id}.jpg`)).status).toBe(404);
    await env.DB.prepare("UPDATE cards SET background_url=NULL WHERE source_role_id='r-1'").run();
    expect((await get(`/og/cards/${id}.jpg`)).status).toBe(404);
  });

  it("本機真的 Images 綁定：合成成功或退回原圖，都不是錯誤", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JPG, { headers: { "content-type": "image/jpeg" } })));
    const res = await get(`/og/cards/${await cardId()}.jpg`);
    expect([200, 302]).toContain(res.status);
  });
});

it("卡片 API 帶出分享圖", async () => {
  await env.DB.prepare("UPDATE cards SET share_image_url=? WHERE source_role_id='r-1'").bind(SHARE).run();
  const res = await get(`/v1/cards/${await cardId()}`);
  expect(((await res.json()) as { shareImageUrl?: string }).shareImageUrl).toBe(SHARE);
});
