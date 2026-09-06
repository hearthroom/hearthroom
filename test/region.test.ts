import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import worker from "../src/index";

async function region(country?: string) {
  const ctx = createExecutionContext();
  const headers = country ? { "cf-ipcountry": country } : undefined;
  const res = await worker.fetch(new Request("https://c.test/v1/region", { headers }), env, ctx);
  await waitOnExecutionContext(ctx);
  return { status: res.status, body: (await res.json()) as { country: string; apiBase: string }, cache: res.headers.get("Cache-Control") };
}

describe("/v1/region", () => {
  it("中國來源改打備用網域，其他地區與判不出來的都走主網域", async () => {
    expect((await region("CN")).body).toEqual({ country: "CN", apiBase: env.LUNATALK_API_BASE_CN });
    expect((await region("cn")).body.apiBase).toBe(env.LUNATALK_API_BASE_CN);
    expect((await region("TW")).body).toEqual({ country: "TW", apiBase: env.LUNATALK_API_BASE });
    expect((await region()).body).toEqual({ country: "", apiBase: env.LUNATALK_API_BASE });
  });

  it("回應依來源而異，禁止快取", async () => {
    const { status, cache } = await region("CN");
    expect(status).toBe(200);
    expect(cache).toBe("no-store");
  });
});
