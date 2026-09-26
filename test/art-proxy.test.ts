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
