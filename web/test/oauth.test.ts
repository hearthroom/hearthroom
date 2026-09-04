import { beforeEach, describe, expect, it, vi } from "vitest";
import { forgetSession, persist, refresh, restorePersisted } from "@/lib/oauth";

/** 伺服器把 refresh token 當一次性的：用第二次就是重放，整個 session 直接作廢。 */
function upstreamWithRotatingRefresh() {
  const state = { valid: "R0", issued: 0, replays: 0, revoked: false };
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    if (String(url).includes("/oauth/register")) {
      return new Response(JSON.stringify({ client_id: "client-1" }), { status: 200 });
    }
    const body = new URLSearchParams(String(init?.body ?? ""));
    if (body.get("grant_type") !== "refresh_token") return new Response("{}", { status: 400 });

    if (state.revoked || body.get("refresh_token") !== state.valid) {
      state.replays++;
      state.revoked = true;
      return new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });
    }
    state.issued++;
    state.valid = `R${state.issued}`;
    return new Response(
      JSON.stringify({ access_token: `A${state.issued}`, refresh_token: state.valid, expires_in: 3600 }),
      { status: 200 },
    );
  });
  return state;
}

beforeEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("換發憑證", () => {
  /**
   * 這是「一重新整理就要重新登入」的真正原因：路由守衛與 App 的 onMounted 同時
   * 觸發換發，兩個帶著同一顆 refresh token，第二個被判重放 → session 作廢。
   */
  it("並發呼叫只換發一次", async () => {
    const state = upstreamWithRotatingRefresh();
    localStorage.setItem("lt.oauth.refresh", "R0");
    localStorage.setItem("lt.oauth.client", "client-1");

    const [a, b, c] = await Promise.all([refresh(), refresh(), refresh()]);

    expect(state.issued).toBe(1);
    expect(state.replays).toBe(0);
    expect(state.revoked).toBe(false);
    expect(a?.accessToken).toBe("A1");
    // 並發的呼叫者拿到的是同一個結果，不是各自去換
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it("換發成功會把輪替後的新 refresh token 存起來", async () => {
    upstreamWithRotatingRefresh();
    localStorage.setItem("lt.oauth.refresh", "R0");
    localStorage.setItem("lt.oauth.client", "client-1");

    await refresh();
    expect(localStorage.getItem("lt.oauth.refresh")).toBe("R1");
    // 存了新的之後還能再換一次，證明沒有把自己鎖死
    await refresh();
    expect(localStorage.getItem("lt.oauth.refresh")).toBe("R2");
  });

  it("伺服器明確拒絕才清掉憑證", async () => {
    upstreamWithRotatingRefresh();
    localStorage.setItem("lt.oauth.refresh", "WRONG");
    localStorage.setItem("lt.oauth.client", "client-1");

    expect(await refresh()).toBeNull();
    expect(localStorage.getItem("lt.oauth.refresh")).toBeNull();
  });

  /** 一次網路抖動不該變成強制重新登入。 */
  it("網路錯誤保留憑證，下次再試", async () => {
    vi.stubGlobal("fetch", async (url: string) => {
      if (String(url).includes("/oauth/register")) {
        return new Response(JSON.stringify({ client_id: "client-1" }), { status: 200 });
      }
      return new Response("upstream down", { status: 503 });
    });
    localStorage.setItem("lt.oauth.refresh", "R0");
    localStorage.setItem("lt.oauth.client", "client-1");

    expect(await refresh()).toBeNull();
    expect(localStorage.getItem("lt.oauth.refresh")).toBe("R0");
  });
});

describe("憑證落地", () => {
  it("還沒過期就讀得回來，重新整理不用跑網路", () => {
    persist({ accessToken: "A1", expiresAt: Date.now() + 60_000 });
    expect(restorePersisted()?.accessToken).toBe("A1");
  });

  it("過期的不算數", () => {
    persist({ accessToken: "A1", expiresAt: Date.now() - 1 });
    expect(restorePersisted()).toBeNull();
  });

  it("登出把兩顆都清掉", () => {
    persist({ accessToken: "A1", expiresAt: Date.now() + 60_000 });
    localStorage.setItem("lt.oauth.refresh", "R0");
    forgetSession();
    expect(restorePersisted()).toBeNull();
    expect(localStorage.getItem("lt.oauth.refresh")).toBeNull();
  });

  it("壞掉的內容不會讓頁面掛掉", () => {
    localStorage.setItem("lt.oauth.access", "not json");
    expect(restorePersisted()).toBeNull();
  });
});
