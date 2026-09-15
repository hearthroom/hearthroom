/**
 * 把一張卡加到主畫面：卡片專屬 manifest 與圖示（src/shortcut.ts）。
 */
import { SELF, createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker, { boardCache, iconCache } from "../src/index";
import { cardManifest, iconSize, localePrefix, svgWrap } from "../src/shortcut";
import { bearer, identities, resetDb, restoreUpstream, rolesOnMainSite, upstreamHashes } from "./helpers";

const AUTHOR = 10001;
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]);

let gen = 0;
beforeEach(async () => {
  await resetDb();
  upstreamHashes.clear();
  boardCache.namespace = `board-${Math.random()}`;
  iconCache.namespace = `card-icon-test-${++gen}`;
  identities({ "author-token": AUTHOR });
  rolesOnMainSite(
    { roleId: "role-safe", authorNumId: AUTHOR, name: "夜行偵探", nameEn: "Night Detective" },
    { roleId: "role-adult", authorNumId: AUTHOR, name: "深夜的卡" },
  );
  expect((await submit("role-safe", { nsfw: false })).status).toBe(201);
  expect((await submit("role-adult", { nsfw: true })).status).toBe(201);
});
afterEach(() => { vi.unstubAllGlobals(); restoreUpstream(); });

const submit = (roleId: string, body: Record<string, unknown>) =>
  SELF.fetch("https://c.test/v1/cards", { method: "POST", headers: { "Content-Type": "application/json", ...bearer("author-token") }, body: JSON.stringify({ roleId, ...body }) });

/** 直接呼叫 worker.fetch 才能換掉 env（拿掉 IMAGES 綁定，走退路）。 */
async function get(path: string, e: typeof env = env) {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request(`https://c.test${path}`), e, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}
const noImages = () => ({ ...env, IMAGES: undefined }) as unknown as typeof env;

describe("卡片 manifest", () => {
  it("在榜的卡：id 與 start_url 是那張卡的對話頁，名字照語言挑，scope 仍是整站", async () => {
    const res = await get("/v1/cards/role-safe/manifest.webmanifest?lang=en");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/manifest+json");
    const m = await res.json() as Record<string, unknown>;
    expect(m.id).toBe("/play/role-safe");
    expect(m.start_url).toBe("/en/play/role-safe");
    expect(m.scope).toBe("/");
    expect(m.name).toBe("Night Detective");
    expect(m.display).toBe("standalone");
    const icons = m.icons as { src: string; sizes: string }[];
    expect(icons.map((i) => i.sizes)).toEqual(["192x192", "512x512"]);
    expect(icons[0].src).toMatch(/^\/v1\/cards\/[^/]+\/icon-192\.png$/);
    expect(icons[1].src).toMatch(/\/icon-512\.png$/);
  });

  it("來源語言不帶前綴；沒有該語言的名字就退回中文", async () => {
    const m = await (await get("/v1/cards/role-safe/manifest.webmanifest?lang=zh-Hant")).json() as Record<string, unknown>;
    expect(m.start_url).toBe("/play/role-safe");
    expect(m.name).toBe("夜行偵探");
    const ja = await (await get("/v1/cards/role-safe/manifest.webmanifest?lang=ja")).json() as Record<string, unknown>;
    expect(ja.start_url).toBe("/ja/play/role-safe");
    expect(ja.name).toBe("夜行偵探");
  });

  it("成人內容與不存在的卡都是 404：瀏覽器抓 manifest 帶不了登入狀態，名字與頭像不能漏", async () => {
    expect((await get("/v1/cards/role-adult/manifest.webmanifest")).status).toBe(404);
    expect((await get("/v1/cards/nope/manifest.webmanifest")).status).toBe(404);
    expect((await get("/v1/cards/role-adult/icon-192.png")).status).toBe(404);
    expect((await get("/v1/cards/role-adult/touch-icon.png")).status).toBe(404);
  });

  it("純函式：語言前綴與尺寸收斂", () => {
    expect(localePrefix("zh-Hant")).toBe("");
    expect(localePrefix("zh-Hans")).toBe("/zh-Hans");
    expect(localePrefix("fr")).toBe("");
    expect(iconSize(undefined)).toBe(192);
    expect(iconSize("300")).toBe(192);
    expect(iconSize("400")).toBe(512);
    expect(iconSize("9999")).toBe(512);
    expect(cardManifest({ id: "c1", source_role_id: "r1", names: JSON.stringify({ zh: "", en: "", ja: "", ko: "" }) } as never, "en").name).toBe("r1");
  });
});

describe("卡片圖示", () => {
  it("沒有 Images 綁定、頭像本來就是 PNG：原樣給，帶快取頭", async () => {
    const fetchSpy = vi.fn(async () => new Response(PNG, { headers: { "content-type": "image/png" } }));
    vi.stubGlobal("fetch", fetchSpy);
    const res = await get("/v1/cards/role-safe/icon-192.png", noImages());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toContain("max-age=86400");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String((fetchSpy.mock.calls[0] as unknown[])[0])).toBe("https://cdn.lunatalk.ai/cover.png");
  });

  it("沒有 Images 綁定、頭像是 JPEG：manifest 用的圖示包成 SVG，touch-icon 給原圖", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JPG, { headers: { "content-type": "image/jpeg" } })));
    const svg = await get("/v1/cards/role-safe/icon-512.png", noImages());
    expect(svg.status).toBe(200);
    expect(svg.headers.get("content-type")).toBe("image/svg+xml");
    const body = await svg.text();
    expect(body).toContain('width="512" height="512"');
    expect(body).toContain("data:image/jpeg;base64,/9j/4A==");
    const raw = await get("/v1/cards/role-safe/touch-icon.png", noImages());
    expect(raw.headers.get("content-type")).toBe("image/jpeg");
    expect(new Uint8Array(await raw.arrayBuffer())).toEqual(JPG);
  });

  it("第二次同樣的請求走快取，不再抓上游", async () => {
    const fetchSpy = vi.fn(async () => new Response(PNG, { headers: { "content-type": "image/png" } }));
    vi.stubGlobal("fetch", fetchSpy);
    await get("/v1/cards/role-safe/icon-192.png", noImages());
    const again = await get("/v1/cards/role-safe/icon-192.png", noImages());
    expect(again.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("上游抓不到或回的不是圖：退到站台圖示，而不是把錯誤當圖示", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>", { status: 200, headers: { "content-type": "text/html" } })));
    const res = await get("/v1/cards/role-safe/icon-512.png", noImages());
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://c.test/icons/icon-512.png");
  });

  it("有 Images 綁定時：回 PNG（本機的實作轉得出來），轉不出來也不會比退路差", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JPG, { headers: { "content-type": "image/jpeg" } })));
    const res = await get("/v1/cards/role-safe/icon-192.png");
    expect(res.status).toBe(200);
    expect(["image/png", "image/svg+xml"]).toContain(res.headers.get("content-type"));
  });

  it("svgWrap 把位元組包進 data URI，尺寸照給的", () => {
    const s = svgWrap(PNG.buffer, "image/png", 192);
    expect(s.startsWith("<svg ")).toBe(true);
    expect(s).toContain('viewBox="0 0 192 192"');
    expect(s).toContain("data:image/png;base64,iVBORw0KGgo=");
  });
});
