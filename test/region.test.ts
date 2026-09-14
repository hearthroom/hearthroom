import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import worker from "../src/index";
import { parseGateways, providerApiBaseFor } from "../src/providers";

async function region(country?: string) {
  const ctx = createExecutionContext();
  const headers = country ? { "cf-ipcountry": country } : undefined;
  const res = await worker.fetch(new Request("https://c.test/v1/region", { headers }), env, ctx);
  await waitOnExecutionContext(ctx);
  return { status: res.status, body: (await res.json()) as { country: string; apiBase: string }, cache: res.headers.get("Cache-Control") };
}

describe("/v1/region", () => {
  it("有閘道的地區回閘道網址，其他地區與判不出來的都回主網址", async () => {
    const gateways = parseGateways(env.PROVIDER_API_GATEWAYS);
    expect(gateways.size).toBeGreaterThan(0);
    const [cc, url] = [...gateways.entries()][0];
    expect((await region(cc)).body).toEqual({ country: cc, apiBase: url });
    expect((await region(cc.toLowerCase())).body.apiBase).toBe(url);
    expect((await region("AQ")).body).toEqual({ country: "AQ", apiBase: env.PROVIDER_API_BASE });
    expect((await region()).body).toEqual({ country: "", apiBase: env.PROVIDER_API_BASE });
  });

  it("回應依來源而異，禁止快取", async () => {
    const { status, cache } = await region("CN");
    expect(status).toBe(200);
    expect(cache).toBe("no-store");
  });
});

describe("parseGateways", () => {
  const base = { PROVIDER_API_BASE: "https://api.example", PROVIDER_API_GATEWAYS: "" };
  it("解析 CC=網址 的清單，逗號或空白分隔，國碼不分大小寫，尾斜線去掉", () => {
    const g = parseGateways("cn=https://cn.example/, JP=https://jp.example");
    expect([...g.entries()]).toEqual([["CN", "https://cn.example"], ["JP", "https://jp.example"]]);
  });
  it("空清單、壞項目都忽略，退回主網址", () => {
    expect(providerApiBaseFor(base, "CN")).toBe("https://api.example");
    expect(providerApiBaseFor({ ...base, PROVIDER_API_GATEWAYS: "nonsense,=x,CN=ftp://no" }, "CN")).toBe("https://api.example");
    expect(providerApiBaseFor({ ...base, PROVIDER_API_GATEWAYS: undefined }, "")).toBe("https://api.example");
  });
});
