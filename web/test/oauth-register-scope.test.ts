/**
 * 動態註冊要說清楚自己要哪些範圍。
 *
 * 註冊不帶 scope，Harbor 只會給唯讀的那兩項；登入時卻拿 role.write 去要授權，
 * 授權端點就回 invalid_scope——註冊要什麼、登入要什麼，必須是同一份。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { beginLogin } from "@/lib/oauth";
import { scopeOf, setProvider } from "@/lib/provider";
import { useProviderUpstream } from "@/lib/config";

function captureRegister() {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ client_id: "client-new" }), { status: 200 });
  }));
  // beginLogin 最後會跳轉，jsdom 沒有導航：擋掉才不會蓋過測試的判斷
  vi.spyOn(window.location, "assign").mockImplementation(() => {});
  return calls;
}

function registerBody(calls: { url: string; init?: RequestInit }[]) {
  const call = calls.find((c) => c.url.includes("/oauth/register"));
  return call ? JSON.parse(String(call.init?.body ?? "{}")) : null;
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setProvider("harbor");
  useProviderUpstream();
});

describe("動態註冊的權限範圍", () => {
  it("Harbor：註冊時就要把寫入範圍登記進去", async () => {
    setProvider("harbor");
    useProviderUpstream();
    const calls = captureRegister();

    await beginLogin("/");

    expect(registerBody(calls)?.scope).toBe(scopeOf("harbor"));
    expect(registerBody(calls)?.scope).toContain("role.write");
  });

  it("HarperHarbor：沒有要求範圍就不帶，維持那一家的預設", async () => {
    setProvider("harbor");
    useProviderUpstream();
    const calls = captureRegister();

    await beginLogin("/");

    expect(registerBody(calls)).toHaveProperty("scope", "profile.read email.read role.read role.write chat.play");
  });

  it("換範圍等於換一組客戶端：舊的唯讀 client 不會被拿來用", async () => {
    setProvider("harbor");
    useProviderUpstream();
    // 這是線上那顆：註冊時沒帶 scope，只拿到唯讀
    localStorage.setItem("hearthroom.oauth.client.harbor", "client-readonly");
    const calls = captureRegister();

    await beginLogin("/");

    // 重新註冊了一顆，而且送去授權的是新的那顆，不是唯讀的舊的
    expect(registerBody(calls)?.scope).toContain("role.write");
    const authorizeUrl = vi.mocked(window.location.assign).mock.calls[0]?.[0] as string;
    expect(new URL(authorizeUrl).searchParams.get("client_id")).toBe("client-new");
  });
});
