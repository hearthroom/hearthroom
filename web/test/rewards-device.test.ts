import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

vi.mock("../src/lib/session", () => ({ useSession: () => ({ accessToken: async () => "test-access" }) }));

const install = "install_test-0123456789";
const key = "hr.rewards.device";
let requests: { path: string; headers: Headers; body: Record<string, unknown> }[];

beforeEach(() => {
  vi.resetModules();
  setActivePinia(createPinia());
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem(key, install);
  requests = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const path = new URL(url, "https://example.test").pathname;
    requests.push({ path, headers: new Headers(init?.headers), body: init?.body ? JSON.parse(String(init.body)) : {} });
    return new Response(JSON.stringify({ planVersion: 1, version: 1, businessDay: "2026-10-20", claims: [], claim: { status: "granted" } }));
  }));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("reward requests from the checkin store", () => {
  it.each(["manual", "link"] as const)("referral binding via %s shares the reward installation token", async (via) => {
    const rewards = await import("../src/lib/rewards");
    const api = await import("../src/lib/api");
    await api.redeemReferral("invite-access", "FRIEND42", "harbor", via);
    await rewards.fetchPanel("invite-access");
    const req = requests.find((r) => r.path.endsWith("/me/referral/redeem"))!;
    expect(req.body.deviceToken).toBe(install);
    expect(req.body.code).toBe("FRIEND42");
    expect(req.body.via).toBe(via === "link" ? "link" : undefined);
    expect(req.headers.get("Authorization")).toBe("Bearer invite-access");
    expect(requests.find((r) => r.path.endsWith("/me/rewards"))!.headers.get("X-Device-Token")).toBe(req.body.deviceToken);
  });

  it.each(["panel", "checkin", "makeup", "task", "newcomer"])("%s carries the installation token", async (action) => {
    const { useCheckin } = await import("../src/lib/checkin-store");
    const store = useCheckin();
    if (action === "panel") await store.load();
    if (action === "checkin") await store.checkin();
    if (action === "makeup") await store.makeup("2026-10-19");
    if (action === "task") await store.claimTask({ id: "daily_chat", period: "2026-10-20" } as Parameters<typeof store.claimTask>[0]);
    if (action === "newcomer") await store.claimNewcomer();
    const paths = { panel: "/me/rewards", checkin: "/me/rewards/checkin", makeup: "/me/rewards/makeup", task: "/me/rewards/tasks/daily_chat/claim", newcomer: "/me/rewards/newcomer/claim" };
    const req = requests.find((r) => r.path.endsWith(paths[action as keyof typeof paths]))!;
    expect(req.headers.get("Authorization")).toBe("Bearer test-access");
    if (action === "panel") expect(req.headers.get("X-Device-Token")).toBe(install);
    else {
      expect(req.body.deviceToken).toBe(install);
      expect(req.body.requestId).toEqual(expect.any(String));
      if (action === "makeup") expect(req.body.day).toBe("2026-10-19");
      if (action === "task") expect(req.body.period).toBe("2026-10-20");
    }
  });

  it("creates a random token once and reuses it after reload and account changes", async () => {
    localStorage.clear();
    let api = await import("../src/lib/rewards");
    await api.fetchPanel("first-account");
    const token = requests[0].headers.get("X-Device-Token");
    expect(token).toMatch(/^[A-Za-z0-9_.-]{16,128}$/);
    expect(localStorage.getItem(key)).toBe(token);
    vi.resetModules();
    api = await import("../src/lib/rewards");
    await api.checkin("second-account", "request");
    expect(requests[1].body.deviceToken).toBe(token);
    localStorage.clear();
    vi.resetModules();
    api = await import("../src/lib/rewards");
    await api.fetchPanel("third-account");
    expect(requests[2].headers.get("X-Device-Token")).not.toBe(token);
  });

  it.each(["short", "x".repeat(129), "invalid token with spaces"])("replaces an invalid stored token: %s", async (stored) => {
    localStorage.setItem(key, stored);
    const api = await import("../src/lib/rewards");
    await api.fetchPanel("access");
    expect(requests[0].headers.get("X-Device-Token")).toMatch(/^[A-Za-z0-9_.-]{16,128}$/);
    expect(localStorage.getItem(key)).not.toBe(stored);
  });

  it.each(["getItem", "setItem"] as const)("still sends one stable token when storage %s throws", async (method) => {
    localStorage.clear();
    const storage = localStorage;
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => { if (method === "getItem") throw new Error("storage unavailable"); return storage.getItem(key); },
      setItem: (key: string, value: string) => { if (method === "setItem") throw new Error("storage unavailable"); storage.setItem(key, value); },
    });
    const api = await import("../src/lib/rewards");
    await api.fetchPanel("access");
    await api.checkin("access", "request");
    const token = requests[0].headers.get("X-Device-Token");
    expect(token).toMatch(/^[A-Za-z0-9_.-]{16,128}$/);
    expect(requests[1].body.deviceToken).toBe(token);
  });

  it("preserves an explicitly supplied device token", async () => {
    const api = await import("../src/lib/rewards");
    await api.checkin("access", "request", "explicit_install-012345");
    expect(requests[0].body.deviceToken).toBe("explicit_install-012345");
  });
});
