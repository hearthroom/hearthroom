/**
 * 前端的「現在接哪一家」。
 *
 * 以前這是建置期常數（一次建置只連一家）；兩家同時上線之後，它屬於**這個會話**：
 * 登入哪一家就用哪一家的 API，換一家等於換一個帳號。
 *
 * 這組測試釘住三件事：預設仍是 LunaTalk（線上今天的行為）、每個對本站的請求都說清楚
 * 自己是哪一家、換家會把上一家的憑證清掉（不清的話，下一次請求會拿 A 家的 token 去問 B 家）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiBaseOf, currentProvider, PROVIDERS, setProvider } from "@/lib/provider";
import { fetchTags } from "@/lib/api";

beforeEach(() => {
  localStorage.clear();
  setProvider("lunatalk");
});

afterEach(() => vi.unstubAllGlobals());

function captureFetch(body: unknown = { items: [] }) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }));
  return calls;
}

describe("目前的供應商", () => {
  it("預設是 LunaTalk：沒選過的人看到的還是今天這個站", () => {
    expect(currentProvider()).toBe("lunatalk");
  });

  it("兩家都在名單上，各有自己的顯示名", () => {
    expect(PROVIDERS.map((p) => p.id)).toEqual(["lunatalk", "harbor"]);
    expect(PROVIDERS.map((p) => p.name)).toEqual(["LunaTalk", "HarperHarbor"]);
  });

  it("選過之後記得住，重新整理不會掉回預設", () => {
    setProvider("harbor");
    expect(currentProvider()).toBe("harbor");
    expect(localStorage.getItem("hearthroom.provider")).toBe("harbor");
  });

  it("每家有自己的 API 位址", () => {
    expect(apiBaseOf("lunatalk")).toMatch(/lunatalk/);
    expect(apiBaseOf("harbor")).toMatch(/harperharbor/);
  });

  it("不認得的代號一律當預設，不讓壞掉的 localStorage 把人送去別家", () => {
    localStorage.setItem("hearthroom.provider", "openai");
    expect(currentProvider()).toBe("lunatalk");
  });
});

describe("對本站的每個請求都說清楚自己是哪一家", () => {
  it("預設那家也要帶：後端才不必猜", async () => {
    const calls = captureFetch({ items: [] });
    await fetchTags("zh");
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers["X-Provider"]).toBe("lunatalk");
  });

  it("換家之後帶的是新的那家", async () => {
    setProvider("harbor");
    const calls = captureFetch({ items: [] });
    await fetchTags("zh");
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers["X-Provider"]).toBe("harbor");
  });
});

describe("換一家等於換一個帳號", () => {
  it("換家會清掉上一家的憑證：留著的話下一個請求會拿 A 家的 token 去問 B 家", () => {
    localStorage.setItem("hearthroom.oauth.access", JSON.stringify({ accessToken: "a", expiresAt: 0 }));
    localStorage.setItem("hearthroom.oauth.refresh", "r");
    localStorage.setItem("hearthroom.oauth.client", "client-for-lunatalk");
    setProvider("harbor");
    expect(localStorage.getItem("hearthroom.oauth.access")).toBeNull();
    expect(localStorage.getItem("hearthroom.oauth.refresh")).toBeNull();
    // 動態註冊的客戶端 ID 也是一家一組。
    expect(localStorage.getItem("hearthroom.oauth.client")).toBeNull();
  });

  it("選同一家不算換，不會把人登出", () => {
    localStorage.setItem("hearthroom.oauth.access", JSON.stringify({ accessToken: "a", expiresAt: 0 }));
    setProvider("lunatalk");
    expect(localStorage.getItem("hearthroom.oauth.access")).not.toBeNull();
  });
});
