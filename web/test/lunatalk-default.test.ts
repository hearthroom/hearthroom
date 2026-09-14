import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 預設建置接的是 LunaTalk（線上服務）。Harbor 相容層只能「多一條路」，不能改動這條路：
 * 這裡把預設模式下送出去的每一種請求形狀釘住，任何 Harbor 改動漏進預設模式都會紅。
 */
type Call = { url: string; init: RequestInit };
function record(body: unknown = {}) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(body), { status: 200 });
  }));
  return calls;
}

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  localStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());

describe("預設模式（LunaTalk）不受 Harbor 相容層影響", () => {
  it("供應商旗標：不是 Harbor，每項能力都開著", async () => {
    const { HARBOR, FEATURES } = await import("@/lib/provider");
    expect(HARBOR).toBe(false);
    expect(Object.entries(FEATURES).filter(([, on]) => !on)).toEqual([]);
  });

  it("OAuth：註冊與授權都不帶 scope，client_id 沿用原本的儲存鍵", async () => {
    localStorage.setItem("hearthroom.oauth.client", "existing-lunatalk-client");
    const calls = record({ client_id: "should-not-register" });
    let target = "";
    vi.stubGlobal("location", { ...window.location, origin: "https://hearthroom.club", assign: (u: string) => { target = u; } });
    const { beginLogin } = await import("@/lib/oauth");
    await beginLogin("/mine");
    expect(calls).toHaveLength(0);
    const q = new URL(target).searchParams;
    expect(q.get("client_id")).toBe("existing-lunatalk-client");
    expect(q.has("scope")).toBe(false);
    expect(target.startsWith("https://api.lunatalk.ai/oauth/authorize?")).toBe(true);
  });

  it("寫入面仍打 LunaTalk 原本的端點與原本的 body", async () => {
    const api = await import("@/lib/api");
    const calls = record({ roleId: "r1" });
    await api.createRole({ roleName: "A", language: "en" }, "tok");
    await api.patchRoleDocument("r1", { roleDesc: "d" }, "tok");
    await api.patchRoleWelcome("r1", { roleWelcome: "hi", alternates: [], prologue: [] }, "tok");
    await api.submitRoleForReview("r1", "summary text", "tok");
    await api.fetchRoleValidation("r1", "tok");
    await api.fetchWallet("tok");
    const shape = calls.map((c) => [c.init.method ?? "GET", c.url.replace("https://api.lunatalk.ai", ""), c.init.body ? JSON.parse(String(c.init.body)) : null]);
    expect(shape).toEqual([
      ["POST", "/open/v1/role", { roleName: "A", language: "en", origin: "hearthroom" }],
      ["POST", "/open/v1/role/r1/document", { fields: { roleDesc: "d" } }],
      ["PATCH", "/open/v1/role/r1/welcome", { roleWelcome: "hi", alternates: [], prologue: [] }],
      ["POST", "/open/v1/role/r1/publish", { userConfirmed: true, confirmationSummary: "summary text" }],
      ["GET", "/open/v1/role/validate?roleId=r1", null],
      ["GET", "/open/v1/me/wallet", null],
    ]);
    expect(api.TOP_UP_URL).toBe("https://lunatalk.ai/pages/mine/vippay");
  });

  it("供應商名稱仍是 LunaTalk", async () => {
    const { providerName } = await import("@/lib/providers");
    expect(providerName("lunatalk")).toBe("LunaTalk");
  });
});
