/**
 * 卡片封面的同網域來源（縮圖在主網域轉一次，所有網域共用）：
 * 只轉發白名單上的來源與路徑形狀，而且必須是圖；可長期快取。
 */
import { SELF } from "cloudflare:test";
import { afterEach, expect, it, vi } from "vitest";

afterEach(() => vi.restoreAllMocks());

it("轉發 Harbor 與舊存放處的封面，帶長期快取", async () => {
  const calls: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    calls.push(String(input));
    return new Response(new Uint8Array([71, 73, 70]), { headers: { "content-type": "image/gif" } });
  });
  const harbor = await SELF.fetch("https://c.test/v1/art/harbor/versions/01a0dc2c-1437-757e-bf0c-1642b26fa778");
  expect(harbor.status).toBe(200);
  expect(harbor.headers.get("content-type")).toBe("image/gif");
  expect(harbor.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
  const media = await SELF.fetch("https://c.test/v1/art/harbor/media/01a0c91e-04d1?raw=1");
  expect(media.status).toBe(200);
  expect((await SELF.fetch("https://c.test/v1/art/lunatalk/hosting/dcbf9395")).status).toBe(200);
  expect(calls).toEqual([
    "https://assets.harperharbor.com/versions/01a0dc2c-1437-757e-bf0c-1642b26fa778",
    "https://assets.harperharbor.com/media/01a0c91e-04d1?raw=1",
    "https://objects.lunatalk.ai/hosting/dcbf9395",
  ]);
});

it("白名單以外的來源、路徑、或不是圖：404，而且不去外面抓", async () => {
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("<html>", { headers: { "content-type": "text/html" } }));
  for (const path of ["/v1/art/evil/versions/abc", "/v1/art/harbor/secret/abc", "/v1/art/harbor/versions/../x", "/v1/art/harbor/versions/a/b"]) {
    expect((await SELF.fetch(`https://c.test${path}`)).status, path).toBe(404);
  }
  expect(fetchSpy).not.toHaveBeenCalled();
  expect((await SELF.fetch("https://c.test/v1/art/harbor/versions/abc")).status).toBe(404);
});

/** 只有標頭的動態 WebP：畫布 w×h、frames 格（格子內容是空的，這裡只看標頭） */
function animatedWebP(w: number, h: number, frames: number): Uint8Array {
  const chunk = (id: string, payload: number[]) => {
    const n = payload.length;
    return [...id].map((c) => c.charCodeAt(0)).concat([n & 255, (n >> 8) & 255, (n >> 16) & 255, 0], payload, n % 2 ? [0] : []);
  };
  const le24 = (v: number) => [v & 255, (v >> 8) & 255, (v >> 16) & 255];
  let body = chunk("VP8X", [0x12, 0, 0, 0, ...le24(w - 1), ...le24(h - 1)]).concat(chunk("ANIM", [0, 0, 0, 0, 0, 0]));
  for (let i = 0; i < frames; i++) body = body.concat(chunk("ANMF", [0, 0, 0, 0, 0, 0, ...le24(w - 1), ...le24(h - 1), 50, 0, 0, 0]));
  const size = body.length + 4;
  return new Uint8Array([..."RIFF"].map((c) => c.charCodeAt(0)).concat([size & 255, (size >> 8) & 255, (size >> 16) & 255, size >>> 24], [..."WEBP"].map((c) => c.charCodeAt(0)), body));
}

// 動圖總面積超過 Cloudflare 轉換上限（5000 萬像素）就轉不了；改向 Harbor 要一份縮小、照樣會動的
it("超過轉換上限的動圖：改給 Harbor 縮好的那份；Harbor 還沒好就先給原圖、短快取", async () => {
  const big = animatedWebP(1024, 1792, 110);
  const calls: string[] = [];
  let previewReady = true;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("/preview/")) return previewReady ? new Response(new Uint8Array([9, 9]), { headers: { "content-type": "image/webp" } }) : new Response(null, { status: 503 });
    return new Response(big, { headers: { "content-type": "image/webp" } });
  });
  const res = await SELF.fetch("https://c.test/v1/art/harbor/versions/01a12f5a-b7d5-7eee-a403-fc80e84bafa6");
  expect(res.status).toBe(200);
  expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([9, 9]);
  expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
  expect(calls).toEqual(["https://assets.harperharbor.com/versions/01a12f5a-b7d5-7eee-a403-fc80e84bafa6", "https://api.harperharbor.com/preview/versions/01a12f5a-b7d5-7eee-a403-fc80e84bafa6?v=1"]);

  previewReady = false;
  const fallback = await SELF.fetch("https://c.test/v1/art/harbor/versions/01a12f5a-b7d5-7eee-a403-fc80e84bafa6");
  expect(fallback.status).toBe(200);
  expect((await fallback.arrayBuffer()).byteLength).toBe(big.byteLength);
  expect(fallback.headers.get("cache-control")).toBe("public, max-age=600");
});

it("沒超過上限的動圖照舊轉發原圖，不去要縮小版", async () => {
  const calls: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    calls.push(String(input));
    return new Response(animatedWebP(360, 640, 80), { headers: { "content-type": "image/webp" } });
  });
  const res = await SELF.fetch("https://c.test/v1/art/harbor/versions/01a0dc2c-1437-757e-bf0c-1642b26fa778");
  expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
  expect(calls).toHaveLength(1);
});
