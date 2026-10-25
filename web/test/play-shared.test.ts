/**
 * 卡片共用狀態的宿主那一半（lib/play-shared.ts，舞台的 StageHost.shared）：打 Worker 的 /v1/cards/:roleId/state 與
 * share-tokens，把錯誤翻成舞台的大寫錯誤碼。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { playSharedHost, sharedErrorOf } from "../src/lib/play-shared";
import { playShareHost, setPlayShare, setPlayShareRef } from "../src/lib/play-share";
import { SHARED_ERROR_CODES } from "../../stage/src/common/shared-state";

const links = () => ({ origin: "https://sukisuki.ai", lp: (p: string) => `/en${p}` });
const host = () => playSharedHost({ links });
const fetchMock = vi.fn();
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
const fail = (status: number, error: string) => new Response(JSON.stringify({ error }), { status, headers: { "Content-Type": "application/json" } });
const base = { roleId: "r1", cardNumber: "100271", context: null, audience: "public" as const, enabled: true, provider: "harbor" as const, token: async () => "tok" as string | null };
const codeOf = async (p: Promise<unknown>) => { try { await p; return "ok"; } catch (e) { return (e as { code?: string }).code; } };

beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); setPlayShare(base); });
afterEach(() => { vi.unstubAllGlobals(); setPlayShare(null); });

describe("讀取", () => {
  it("帶 token 認人（回 mine）、帶供應商；作者試玩加 draft=1", async () => {
    fetchMock.mockImplementation(async () => ok({ enabled: true, items: { boss: { kind: "counter", total: 3, mine: 1 } } }));
    expect(await host().read("r1", ["boss", "p1-4"])).toEqual({ boss: { kind: "counter", total: 3, mine: 1 } });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/v1/cards/r1/state?keys=boss%2Cp1-4");
    expect(init.headers).toMatchObject({ Authorization: "Bearer tok", "X-Provider": "harbor" });
    setPlayShare({ ...base, draft: true });
    await host().read("r1", ["boss"]);
    expect(fetchMock.mock.calls[1]![0]).toBe("/v1/cards/r1/state?keys=boss&draft=1");
  });

  it("遊客不帶 token；平台或作者關了是 SHARED_DISABLED", async () => {
    setPlayShare({ ...base, token: async () => null });
    fetchMock.mockImplementation(async () => ok({ enabled: false, items: {} }));
    expect(await codeOf(host().read("r1", ["boss"]))).toBe("SHARED_DISABLED");
    expect(fetchMock.mock.calls[0]![1].headers.Authorization).toBeUndefined();
  });

  it("不是現在這張卡：HOST_DENIED，不打 Worker", async () => {
    expect(await codeOf(host().read("other", ["boss"]))).toBe("HOST_DENIED");
    setPlayShare(null);
    expect(await codeOf(host().read("r1", ["boss"]))).toBe("HOST_DENIED");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("排行榜帶 limit", async () => {
    fetchMock.mockImplementation(async () => ok({ items: [{ rank: 1, name: "月", value: 9 }] }));
    expect(await host().leaderboard("r1", "boss", 5)).toEqual({ items: [{ rank: 1, name: "月", value: 9 }] });
    expect(fetchMock.mock.calls[0]![0]).toBe("/v1/cards/r1/state/boss/leaderboard?limit=5");
  });
});

describe("寫入", () => {
  it("投票與加數：POST 帶 token；沒登入是 UNAUTHORIZED，不打 Worker", async () => {
    fetchMock.mockImplementation(async () => ok({ mine: "b" }));
    expect(await host().vote("r1", "p1-4", "b")).toEqual({ mine: "b" });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/v1/cards/r1/state/p1-4/vote");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ option: "b" });
    fetchMock.mockImplementation(async () => ok({ total: 4, mine: 1, reachedAt: null }));
    await host().add("r1", "boss", 1);
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body)).toEqual({ delta: 1 });
    setPlayShare({ ...base, token: async () => null });
    expect(await codeOf(host().add("r1", "boss", 1))).toBe("UNAUTHORIZED");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("Worker 的錯誤碼翻成舞台的；已達標與上限帶 reason；不認得的是 NETWORK", async () => {
    for (const [status, error, code] of [
      [403, "shared_disabled", "SHARED_DISABLED"], [400, "not_declared", "NOT_DECLARED"], [400, "option_invalid", "OPTION_INVALID"],
      [400, "delta_invalid", "INVALID_ARGS"], [403, "not_eligible", "NOT_ELIGIBLE"], [403, "own_token", "NOT_ELIGIBLE"],
      [429, "rate_limited", "RATE_LIMITED"], [429, "limit_reached", "LIMIT_REACHED"], [409, "goal_reached", "LIMIT_REACHED"],
      [400, "context_invalid", "SHARE_CONTEXT_INVALID"], [401, "unauthorized", "UNAUTHORIZED"], [503, "declaration_unavailable", "NETWORK"], [500, "internal error", "NETWORK"],
    ] as const) {
      fetchMock.mockResolvedValueOnce(fail(status, error));
      expect(await codeOf(host().add("r1", "boss", 1))).toBe(code);
    }
    expect(sharedErrorOf(409, "goal_reached")).toMatchObject({ code: "LIMIT_REACHED", data: { reason: "goal" } });
    expect(sharedErrorOf(429, "limit_reached")).toMatchObject({ code: "LIMIT_REACHED", data: { reason: "limit" } });
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    expect(await codeOf(host().vote("r1", "p1-4", "a"))).toBe("NETWORK");
  });

  it("翻出來的碼都在舞台的名單裡", () => {
    for (const [s, e] of [[403, "shared_disabled"], [400, "delta_invalid"], [409, "goal_reached"], [500, "x"]] as const) {
      expect(SHARED_ERROR_CODES).toContain(sharedErrorOf(s, e).code);
    }
  });
});

describe("分享回流", () => {
  it("tallyLink：產生短碼，連結是社群站卡片頁帶推薦碼與 ?share=~短碼", async () => {
    setPlayShareRef("r1", "ABCD");
    fetchMock.mockImplementation(async () => ok({ token: "~K7Q2M9XA", expiresAt: 1 }));
    expect(await host().tallyLink("r1", "p1-4.b", "p1-4")).toBe("https://sukisuki.ai/en/cards/100271?ref=ABCD&share=%7EK7Q2M9XA");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/v1/cards/r1/share-tokens");
    expect(JSON.parse(init.body)).toEqual({ context: "p1-4.b", poll: "p1-4" });
  });

  it("respond 用這次開卡帶來的短碼（卡片看不到）；不是從短碼開的是 HOST_DENIED", async () => {
    expect(await codeOf(host().respond("r1", "a"))).toBe("HOST_DENIED");
    setPlayShare({ ...base, poll: { token: "~K7Q2M9XA", key: "p1-4", options: ["a", "b"] } });
    fetchMock.mockImplementation(async () => ok({ mine: "a" }));
    expect(await host().respond("r1", "a")).toEqual({ ok: true });
    expect(fetchMock.mock.calls[0]![0]).toBe("/v1/cards/r1/share-tokens/~K7Q2M9XA/respond");
  });

  it("results 只給登入的分享者", async () => {
    fetchMock.mockImplementation(async () => ok({ items: [] }));
    expect(await host().results("r1")).toEqual({ items: [] });
    expect(fetchMock.mock.calls[0]![0]).toBe("/v1/cards/r1/share-tokens");
    setPlayShare({ ...base, token: async () => null });
    expect(await codeOf(host().results("r1"))).toBe("UNAUTHORIZED");
  });

  it("分享狀態把朋友可回答的那一題交給舞台，但不給短碼", () => {
    setPlayShare({ ...base, poll: { token: "~K7Q2M9XA", key: "p1-4", options: ["a", "b"] } });
    expect(playShareHost({ links }).read("r1")).toMatchObject({ poll: { key: "p1-4", options: ["a", "b"] } });
    expect(JSON.stringify(playShareHost({ links }).read("r1"))).not.toContain("K7Q2M9XA");
    setPlayShare({ ...base, enabled: false, poll: { token: "~K7Q2M9XA", key: "p1-4", options: ["a"] } });
    expect(playShareHost({ links }).read("r1")!.poll).toBeUndefined();
  });
});

describe("審查修正", () => {
  it("瀏覽器沒有 URLSearchParams.size（iOS 16 等）：查詢字串照樣送出，試玩的 draft=1 不會掉", async () => {
    const desc = Object.getOwnPropertyDescriptor(URLSearchParams.prototype, "size");
    Object.defineProperty(URLSearchParams.prototype, "size", { get: () => undefined, configurable: true });
    try {
      setPlayShare({ ...base, draft: true });
      fetchMock.mockImplementation(async () => ok({ enabled: true, items: {} }));
      await host().read("r1", ["boss"]);
      expect(fetchMock.mock.calls[0]![0]).toBe("/v1/cards/r1/state?keys=boss&draft=1");
    } finally {
      if (desc) Object.defineProperty(URLSearchParams.prototype, "size", desc);
    }
  });

  it("審核試玩（?review=）能讀，但投票、加數、產生與回答分享連結都不寫進正式數字", async () => {
    setPlayShare({ ...base, review: true, poll: { token: "~K7Q2M9XA", key: "p1-4", options: ["a"] } });
    fetchMock.mockImplementation(async () => ok({ enabled: true, items: {} }));
    expect(await codeOf(host().read("r1", ["boss"]))).toBe("ok");
    expect(await codeOf(host().vote("r1", "p1-4", "a"))).toBe("HOST_DENIED");
    expect(await codeOf(host().add("r1", "boss", 1))).toBe("HOST_DENIED");
    expect(await codeOf(host().tallyLink("r1", "p1-4.b", "p1-4"))).toBe("HOST_DENIED");
    expect(await codeOf(host().respond("r1", "a"))).toBe("HOST_DENIED");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
