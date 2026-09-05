import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker, { imageCache } from "../src/index";

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

async function get(path: string) {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request(`https://c.test${path}`), env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

let gen = 0;
beforeEach(() => { imageCache.namespace = `image-test-${++gen}`; });
afterEach(() => vi.unstubAllGlobals());

describe("圖片代抓（匯出 PNG 卡用）", () => {
  it("放行的主機：原樣轉回位元組與 content-type，帶快取頭", async () => {
    const fetchSpy = vi.fn(async () => new Response(PNG, { headers: { "content-type": "image/png" } }));
    vi.stubGlobal("fetch", fetchSpy);
    const res = await get("/v1/image?u=" + encodeURIComponent("https://objects.lunatalk.ai/asset/a.png"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toContain("max-age=86400");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("不在名單上的主機、非 https、壞網址一律拒絕，而且不去抓", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect((await get("/v1/image?u=" + encodeURIComponent("https://evil.example/x.png"))).status).toBe(403);
    expect((await get("/v1/image?u=" + encodeURIComponent("http://objects.lunatalk.ai/x.png"))).status).toBe(403);
    expect((await get("/v1/image?u=not-a-url")).status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("上游回的不是圖就不轉：這條路不能變成任意內容的代理", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>", { headers: { "content-type": "text/html" } })));
    expect((await get("/v1/image?u=" + encodeURIComponent("https://objects.lunatalk.ai/x"))).status).toBe(502);
  });
});
