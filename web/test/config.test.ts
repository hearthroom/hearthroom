import { afterEach, describe, expect, it, vi } from "vitest";
import * as config from "../src/lib/config";

const DEFAULT = "https://api.lunatalk.ai";
const reply = (body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } }));

afterEach(() => config.resetUpstreamForTest());

describe("resolveUpstream", () => {
  it("邊緣說走備用網域就換掉 UPSTREAM_API，並記在這個分頁", async () => {
    const fetcher = reply({ country: "CN", apiBase: "https://api.example.pro/" });
    expect(await config.resolveUpstream(fetcher as unknown as typeof fetch)).toBe("https://api.example.pro");
    expect(config.UPSTREAM_API).toBe("https://api.example.pro");
    expect(fetcher).toHaveBeenCalledWith("/v1/region", expect.anything());
    // 第二次不再問
    const again = reply({ apiBase: "https://other.example" });
    expect(await config.resolveUpstream(again as unknown as typeof fetch)).toBe("https://api.example.pro");
    expect(again).not.toHaveBeenCalled();
  });

  it("問不到、回壞資料、逾時都維持預設，頁面照常開", async () => {
    expect(await config.resolveUpstream(vi.fn(async () => { throw new Error("offline"); }) as unknown as typeof fetch)).toBe(DEFAULT);
    expect(await config.resolveUpstream(reply({ apiBase: "not a url" }) as unknown as typeof fetch)).toBe(DEFAULT);
    const never = vi.fn((_: string, init?: RequestInit) => new Promise<Response>((_r, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted")))));
    expect(await config.resolveUpstream(never as unknown as typeof fetch, 10)).toBe(DEFAULT);
  });

  it("resource 指示器固定用主網域，不跟著實際打的網域走", async () => {
    await config.resolveUpstream(reply({ apiBase: "https://api.example.pro" }) as unknown as typeof fetch);
    expect(config.OAUTH_RESOURCE).toBe(`${DEFAULT}/open/v1`);
  });
});
