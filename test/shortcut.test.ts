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

  it("成人卡：過了門的人在卡片頁拿到鑰匙，帶著鑰匙 manifest 與圖示才開；沒鑰匙、錯鑰匙、過期都是 404", async () => {
    const { signShortcutKey, verifyShortcutKey } = await import("../src/shortcut");
    identities({ "author-token": AUTHOR, "viewer-token": 40004 });
    const settings = (body: Record<string, unknown>) =>
      SELF.fetch("https://c.test/v1/me/settings", { method: "POST", headers: { "Content-Type": "application/json", ...bearer("viewer-token") }, body: JSON.stringify(body) });
    const y = new Date().getUTCFullYear() - 20;
    expect((await settings({ showNsfw: true, birthdate: `${y}-01-01` })).status).toBe(200);
    const adult = await env.DB.prepare("SELECT id FROM cards WHERE source_role_id = 'role-adult'").first<{ id: string }>();
    // 沒開開關的人：卡片本身就 403，自然沒有鑰匙
    expect((await SELF.fetch(`https://c.test/v1/cards/${adult!.id}`)).status).toBe(403);
    const detail = await (await SELF.fetch(`https://c.test/v1/cards/${adult!.id}?nsfw=1`, { headers: bearer("viewer-token") })).json() as { shortcutKey?: string; nsfw: boolean };
    expect(detail.nsfw).toBe(true);
    expect(detail.shortcutKey).toMatch(/^\d+\.[A-Za-z0-9_-]+$/);
    // 一般卡不發鑰匙
    const safe = await (await SELF.fetch("https://c.test/v1/cards/role-safe")).json() as { shortcutKey?: string };
    expect(safe.shortcutKey).toBeUndefined();

    const k = encodeURIComponent(detail.shortcutKey!);
    expect((await get(`/v1/cards/${adult!.id}/manifest.webmanifest`)).status).toBe(404);
    expect((await get(`/v1/cards/${adult!.id}/manifest.webmanifest?k=${k}x`)).status).toBe(404);
    const ok = await get(`/v1/cards/${adult!.id}/manifest.webmanifest?lang=en&k=${k}`);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toBe("private, no-store");
    const m = await ok.json() as { name: string; icons: { src: string }[] };
    expect(m.name).toBe("深夜的卡");
    // 圖示網址也帶鑰匙，瀏覽器抓圖示時才進得來
    expect(m.icons[0].src).toBe(`/v1/cards/${adult!.id}/icon-192.png?k=${k}`);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(PNG, { headers: { "content-type": "image/png" } })));
    expect((await get(`/v1/cards/${adult!.id}/icon-192.png`, noImages())).status).toBe(404);
    expect((await get(`/v1/cards/${adult!.id}/icon-192.png?k=${k}`, noImages())).status).toBe(200);
    expect((await get(`/v1/cards/${adult!.id}/touch-icon.png?k=${k}`, noImages())).status).toBe(200);

    // 鑰匙綁卡片、綁到期時間、綁密鑰
    const now = Date.UTC(2026, 8, 15);
    const key = await signShortcutKey("s", "card-a", now);
    expect(await verifyShortcutKey("s", "card-a", key, now + 1000)).toBe(true);
    expect(await verifyShortcutKey("s", "card-b", key, now + 1000)).toBe(false);
    expect(await verifyShortcutKey("other", "card-a", key, now + 1000)).toBe(false);
    expect(await verifyShortcutKey("s", "card-a", key, now + 25 * 60 * 60 * 1000)).toBe(false);
    expect(await verifyShortcutKey(undefined, "card-a", key, now)).toBe(false);
    expect(await verifyShortcutKey("s", "card-a", "garbage", now)).toBe(false);
  });

  it("沒設密鑰：成人卡不發鑰匙，端點也照樣 404", async () => {
    identities({ "author-token": AUTHOR, "viewer-token": 40004 });
    const y = new Date().getUTCFullYear() - 20;
    await SELF.fetch("https://c.test/v1/me/settings", { method: "POST", headers: { "Content-Type": "application/json", ...bearer("viewer-token") }, body: JSON.stringify({ showNsfw: true, birthdate: `${y}-01-01` }) });
    const adult = await env.DB.prepare("SELECT id FROM cards WHERE source_role_id = 'role-adult'").first<{ id: string }>();
    const noSecret = { ...env, SHORTCUT_SECRET: undefined } as unknown as typeof env;
    const ctx = createExecutionContext();
    const res = await worker.fetch(new Request(`https://c.test/v1/cards/${adult!.id}?nsfw=1`, { headers: bearer("viewer-token") }), noSecret, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { shortcutKey?: string }).shortcutKey).toBeUndefined();
  });

  it("view=0 讀卡片不算一次瀏覽（對話頁換 manifest 用）", async () => {
    const points: unknown[] = [];
    env.EVENTS = { writeDataPoint: (p: unknown) => points.push(p) } as unknown as AnalyticsEngineDataset;
    expect((await get("/v1/cards/role-safe?view=0")).status).toBe(200);
    expect(points.filter((p) => (p as { blobs: string[] }).blobs[0] === "card_view")).toHaveLength(0);
    expect((await get("/v1/cards/role-safe")).status).toBe(200);
    expect(points.filter((p) => (p as { blobs: string[] }).blobs[0] === "card_view")).toHaveLength(1);
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
