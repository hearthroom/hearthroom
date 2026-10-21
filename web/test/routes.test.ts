/**
 * 線路：編號跟網域綁定、推薦規則、毫秒格式、目前線路夠快時一個多餘請求都不打、
 * 切換時目標連不上就留在原頁、發換手失敗分得出「目前線路不通」與「被拒」。
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { resetManagedAuthForTest } from "@/lib/managed-auth";
import {
  LINES, ROUTE_TUNING, SwitchError, backgroundCheck, currentLine, dismissPrompt, formatLatency, lineByNumber,
  pendingSwitch, prepareSwitch, promptDismissed, recommend, routesAvailable, routesState, signalOf, targetUrl,
} from "@/lib/routes";

const loc = (hostname: string, pathname = "/cards/42", search = "?x=1", hash = "#c") =>
  ({ hostname, host: hostname, origin: `https://${hostname}`, protocol: "https:", pathname, search, hash, href: `https://${hostname}${pathname}${search}${hash}`, assign: vi.fn(), replace: vi.fn(), reload: vi.fn() });

beforeEach(() => {
  resetManagedAuthForTest(true);
  localStorage.clear(); sessionStorage.clear();
  routesState.results = {}; routesState.measuredAt = 0; routesState.recommended = 0;
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it("numbers lines by domain, matching the Android app", () => {
  expect(LINES.map((l) => [l.n, l.host])).toEqual([[1, "sukisuki.ai"], [2, "hearthroom.club"], [3, "sukisuki.chat"], [4, "sukisuki.pro"]]);
  expect(currentLine("www.sukisuki.chat")?.n).toBe(3);
  expect(currentLine("play.sukisuki.pro")?.n).toBe(4);
  expect(currentLine("localhost")).toBeUndefined();
  expect(currentLine("preview.hearthroom.pages.dev")).toBeUndefined();
});

it("shows no route interface off the official domains, on card-app domains or inside the Android app", () => {
  expect(routesAvailable({ hostname: "sukisuki.ai", ua: "Mozilla/5.0" })).toBe(true);
  expect(routesAvailable({ hostname: "localhost", ua: "Mozilla/5.0" })).toBe(false);
  expect(routesAvailable({ hostname: "play.sukisuki.ai", ua: "Mozilla/5.0" })).toBe(false);
  expect(routesAvailable({ hostname: "sukisuki.ai", ua: "Mozilla/5.0 HearthroomApp/1.4.0" })).toBe(false);
});

it("recommends only a clearly faster line, and the lowest-numbered one among several", () => {
  const line1 = lineByNumber(1)!;
  // 目前不慢：不推薦
  expect(recommend(line1, new Map([[1, 900], [3, 100]]))).toBeUndefined();
  // 慢，但別條只快一點：不推薦
  expect(recommend(line1, new Map([[1, 1500], [2, 1200], [3, 1000]]))).toBeUndefined();
  // 2.5 s：線路三 380 ms、線路四 300 ms 都合格，取編號小的
  expect(recommend(line1, new Map([[1, 2500], [2, null], [3, 380], [4, 300]]))?.n).toBe(3);
  // 目前連不上：任何連得上的都算更快
  expect(recommend(lineByNumber(3)!, new Map([[3, null], [1, 4000], [4, 200]]))?.n).toBe(1);
});

it("formats latency with international units", () => {
  expect(formatLatency(376)).toBe("380 ms");
  expect(formatLatency(3)).toBe("10 ms");
  expect(formatLatency(1180)).toBe("1.2 s");
  expect(formatLatency(2449)).toBe("2.4 s");
  expect([signalOf(100), signalOf(800), signalOf(2000), signalOf(null)]).toEqual([3, 2, 1, 0]);
});

it("does not touch other domains when the current line is fast", async () => {
  vi.stubGlobal("location", loc("sukisuki.ai"));
  const fetch = vi.fn(async () => new Response("[]"));
  vi.stubGlobal("fetch", fetch);
  expect(await backgroundCheck()).toBe(false);
  expect(fetch.mock.calls.every(([url]) => String(url).startsWith("https://sukisuki.ai/.well-known/assetlinks.json?"))).toBe(true);
  expect(routesState.recommended).toBe(0);
});

it("tests the other lines without credentials when the current one is down, and recommends one", async () => {
  vi.stubGlobal("location", loc("sukisuki.ai"));
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    if (url.startsWith("https://sukisuki.ai/")) throw new TypeError("offline");
    expect(init).toMatchObject({ mode: "no-cors", cache: "no-store", credentials: "omit" });
    return new Response(null);
  });
  vi.stubGlobal("fetch", fetch);
  expect(await backgroundCheck()).toBe(true);
  expect(routesState.recommended).toBe(2);
  expect(routesState.results[1]).toEqual({ state: "down" });
});

it("calls the current line down only when both probes fail", async () => {
  vi.stubGlobal("location", loc("sukisuki.ai"));
  let calls = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.startsWith("https://sukisuki.ai/") && calls++ === 0) throw new TypeError("blip");
    return new Response("[]");
  }));
  expect(await backgroundCheck()).toBe(false);
  expect(routesState.results[1]?.state).toBe("ok");
});

it("remembers a dismissal on this domain for three days", () => {
  const now = Date.UTC(2026, 9, 22);
  expect(promptDismissed(now)).toBe(false);
  dismissPrompt(now);
  expect(promptDismissed(now + 2 * 86_400_000)).toBe(true);
  expect(promptDismissed(now + ROUTE_TUNING.dismissDays * 86_400_000 + 1)).toBe(false);
});

it("keeps the path, query and hash and always lands on the bare domain", () => {
  expect(targetUrl(lineByNumber(3)!, loc("www.sukisuki.ai", "/en/cards/42", "?tab=a", "#top"))).toBe("https://sukisuki.chat/en/cards/42?tab=a#top");
});

it("stays put when the target line is unreachable", async () => {
  vi.stubGlobal("location", loc("sukisuki.ai"));
  vi.stubGlobal("fetch", vi.fn(async (url: string) => { if (url.startsWith("https://sukisuki.chat/")) throw new TypeError("down"); return Response.json({}); }));
  await expect(prepareSwitch(lineByNumber(3)!, { withLogin: true })).rejects.toEqual(new SwitchError("target-down"));
  expect(routesState.results[3]).toEqual({ state: "down" });
});

it("goes straight to the same page when signed out", async () => {
  vi.stubGlobal("location", loc("sukisuki.ai"));
  const fetch = vi.fn(async () => new Response(null));
  vi.stubGlobal("fetch", fetch);
  expect(await prepareSwitch(lineByNumber(3)!, { withLogin: false })).toBe("https://sukisuki.chat/cards/42?x=1#c");
  expect(fetch.mock.calls.some(([url]) => String(url).includes("/v1/auth/"))).toBe(false);
});

it("asks the current line for a handoff when signed in and remembers where it was going", async () => {
  vi.stubGlobal("location", loc("sukisuki.ai"));
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/v1/auth/route-start") {
      expect(JSON.parse(String(init?.body))).toEqual({ targetOrigin: "https://sukisuki.chat", returnTo: "/cards/42?x=1#c" });
      expect(init?.headers).toMatchObject({ "X-Hearthroom-Request": "1" });
      return Response.json({ url: "https://sukisuki.chat/auth/route/prepare?request=abc" });
    }
    return new Response(null);
  });
  vi.stubGlobal("fetch", fetch);
  expect(await prepareSwitch(lineByNumber(3)!, { withLogin: true })).toBe("https://sukisuki.chat/auth/route/prepare?request=abc");
  expect(pendingSwitch()).toMatchObject({ target: 3, returnTo: "/cards/42?x=1#c" });
});

it("tells an unreachable current line apart from a refused handoff", async () => {
  vi.stubGlobal("location", loc("sukisuki.ai"));
  vi.stubGlobal("fetch", vi.fn(async (url: string) => url === "/v1/auth/route-start" ? new Response("bad gateway", { status: 502 }) : new Response(null)));
  await expect(prepareSwitch(lineByNumber(3)!, { withLogin: true })).rejects.toEqual(new SwitchError("start-unavailable"));
  vi.stubGlobal("fetch", vi.fn(async (url: string) => url === "/v1/auth/route-start" ? Response.json({ error: "site_session_required" }, { status: 401 }) : new Response(null)));
  await expect(prepareSwitch(lineByNumber(3)!, { withLogin: true })).rejects.toEqual(new SwitchError("start-denied"));
  // 伺服器給了別的網域：不跟著走
  vi.stubGlobal("fetch", vi.fn(async (url: string) => url === "/v1/auth/route-start" ? Response.json({ url: "https://evil.example/x" }) : new Response(null)));
  await expect(prepareSwitch(lineByNumber(3)!, { withLogin: true })).rejects.toEqual(new SwitchError("start-denied"));
});
