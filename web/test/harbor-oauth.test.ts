import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Harbor 的授權伺服器照 scope 發能力：註冊時不帶 scope 只拿到唯讀，建卡會被 403。
 * LunaTalk 那邊不看這個參數，所以只在 Harbor 模式送。
 */
describe("Harbor 模式的 OAuth 要求建卡需要的能力", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
    localStorage.clear();
  });

  it("註冊與授權都帶 scope", async () => {
    vi.stubEnv("VITE_PROVIDER", "harbor");
    vi.resetModules();
    // 同一個網域以前向別家上游註冊過的 client_id 不能沿用：換了授權伺服器，它就是 invalid_client。
    localStorage.setItem("hearthroom.oauth.client", "mcp_client_from_another_upstream");
    let registered: Record<string, unknown> = {};
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      registered = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ client_id: "c-1" }), { status: 201 });
    }));
    let target = "";
    vi.stubGlobal("location", { ...window.location, origin: "http://localhost:8850", assign: (u: string) => { target = u; } });
    const { beginLogin } = await import("@/lib/oauth");
    await beginLogin("/mine");
    expect(registered.scope).toBe("profile.read role.read role.write");
    expect(new URL(target).searchParams.get("scope")).toBe("profile.read role.read role.write");
    expect(new URL(target).searchParams.get("client_id")).toBe("c-1");
  });
});

/** 瀏覽器實際的載入順序是 oauth → harbor → api；循環引用時 api 的頂層常數會碰到還沒初始化的 HARBOR。 */
describe("Harbor 模式的模組載入順序", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("先載 oauth 再載 api 不會在初始化前讀到供應商旗標", async () => {
    vi.stubEnv("VITE_PROVIDER", "harbor");
    vi.stubEnv("VITE_HARBOR_CONSOLE_URL", "http://console.test");
    vi.resetModules();
    await import("@/lib/oauth");
    const api = await import("@/lib/api");
    expect(api.TOP_UP_URL).toBe("http://console.test/me/wallet");
  });
});
