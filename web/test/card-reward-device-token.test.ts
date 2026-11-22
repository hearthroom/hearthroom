import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const install = "install_creator_cap_0123456789";
const key = "hr.rewards.device";
let requests: { path: string; method: string; headers: Headers }[];

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem(key, install);
  requests = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const path = new URL(url, "https://example.test").pathname;
    requests.push({ path, method: init?.method ?? "GET", headers: new Headers(init?.headers) });
    if (path.endsWith("/cards") && init?.method === "POST") {
      return new Response(JSON.stringify({ id: "100001", status: "pending" }), { status: 201 });
    }
    if (path.endsWith("/me/cards")) {
      return new Response(JSON.stringify({ items: [], total: 0, registeredTotal: 0, quota: { limit: 6, used: 0, weekStart: 0, weekEnd: 0, packRemaining: 0 }, page: 1, pageSize: 24, hasNext: false }));
    }
    if (path.endsWith("/card-rewards/creator-season/me")) {
      return new Response(JSON.stringify({ quota: { limit: 6, used: 0, weekStart: 0, weekEnd: 0, packRemaining: 0 }, approvedCount: 0, pendingCount: 0, creditsPaid: 0, items: [] }));
    }
    return new Response(JSON.stringify({ unread: 0 }));
  }));
});

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("card reward & quota requests carry X-Device-Token", () => {
  it("sends the shared reward installation token on submit, my-cards, campaign progress and notifications summary", async () => {
    const api = await import("../src/lib/api");
    const campaign = await import("../src/lib/campaign");
    const community = await import("../src/lib/community");

    await api.fetchMyCards("tok");
    await campaign.fetchRewardProgress("tok", "creator-season");
    await community.communityRequest("/me/community/notifications/summary?lang=zh-Hant", "tok");
    await api.registerCard("role-1", "tok", { version: 2, answers: { nudity: 0, sexual: 0, violence: 0, selfHarm: 0, illegal: 0, minors: 0 } } as any);

    expect(requests.find((r) => r.path.endsWith("/me/cards"))?.headers.get("X-Device-Token")).toBe(install);
    expect(requests.find((r) => r.path.endsWith("/card-rewards/creator-season/me"))?.headers.get("X-Device-Token")).toBe(install);
    expect(requests.find((r) => r.path.endsWith("/me/community/notifications/summary"))?.headers.get("X-Device-Token")).toBe(install);
    expect(requests.find((r) => r.path.endsWith("/cards") && r.method === "POST")?.headers.get("X-Device-Token")).toBe(install);
  });
});
