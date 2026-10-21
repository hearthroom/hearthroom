import { SELF, env } from "cloudflare:test";
import { beforeEach, expect, it } from "vitest";
import { resetDb } from "./helpers";

beforeEach(async () => { await resetDb(); });
const request = (extra: Record<string, string> = {}, host = "sukisuki.ai") => SELF.fetch(`https://${host}/v1/analytics/session`, {
  method: "POST", headers: { Origin: `https://${host}`, "X-Hearthroom-Request": "1", ...extra },
});

it("supports disabled deployments without issuing a cookie", async () => {
  const response = await request();
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ enabled: false });
  expect(response.headers.get("Set-Cookie")).toBeNull();
  expect(response.headers.get("Cache-Control")).toContain("no-store");
});

it("issues a bounded same-site HttpOnly ID and reuses it without refreshing expiry", async () => {
  const { analyticsRoutes } = await import("../src/ga4");
  const make = (headers: Record<string, string> = {}) => analyticsRoutes.request("https://sukisuki.ai/v1/analytics/session", {
    method: "POST", headers: { Origin: "https://sukisuki.ai", "X-Hearthroom-Request": "1", ...headers },
  }, { ...env, GA4_ENABLED: "true" });
  const first = await make();
  expect(first.status).toBe(200);
  const body = await first.json() as { enabled: boolean; clientId: string };
  expect(body.enabled).toBe(true);
  expect(body.clientId).toMatch(/^\d+\.\d+$/);
  const cookie = first.headers.get("Set-Cookie")!;
  expect(cookie).toContain("HttpOnly"); expect(cookie).toContain("Secure"); expect(cookie).toContain("SameSite=Lax");
  expect(cookie).toContain("Domain=sukisuki.ai"); expect(cookie).toContain("Max-Age=33696000");
  const second = await make({ Cookie: cookie.split(";")[0] });
  expect(await second.json()).toEqual(body);
  expect(second.headers.get("Set-Cookie")).toBeNull();
  const metrics = await SELF.fetch("https://sukisuki.ai/metrics");
  const text = await metrics.text();
  expect(text).toContain('hearthroom_ga4_session_total{operation="session",outcome="issued"} 1');
  expect(text).toContain('hearthroom_ga4_session_total{operation="session",outcome="reused"} 1');
  expect(text).not.toContain(body.clientId);
});

it("denies cross-origin callers and clears its cookie on GPC", async () => {
  const { analyticsRoutes } = await import("../src/ga4");
  const make = (headers: Record<string, string> = {}, host = "sukisuki.ai") => analyticsRoutes.request(`https://${host}/v1/analytics/session`, {
    method: "POST", headers: { Origin: `https://${host}`, "X-Hearthroom-Request": "1", ...headers },
  }, { ...env, GA4_ENABLED: "true" });
  const denied = await make({ Origin: "https://attacker.example" });
  expect(denied.status).toBe(403); expect(denied.headers.get("Set-Cookie")).toBeNull();
  expect((await make({}, "c123.sukisuki.ai")).status).toBe(403);
  const gpc = await make({ "Sec-GPC": "1" });
  expect(await gpc.json()).toEqual({ enabled: false });
  expect(gpc.headers.get("Set-Cookie")).toContain("Max-Age=0");
});

it("accepts a numeric linker client ID without extending its original lifetime", async () => {
  const { analyticsRoutes } = await import("../src/ga4");
  const timestamp = Math.floor(Date.now() / 1000) - 86400;
  const response = await analyticsRoutes.request("https://sukisuki.ai/v1/analytics/session", {
    method: "POST", headers: { Origin: "https://sukisuki.ai", "X-Hearthroom-Request": "1", "Content-Type": "application/json" },
    body: JSON.stringify({ clientId: `1234.${timestamp}` }),
  }, { ...env, GA4_ENABLED: "true" });
  expect(await response.json()).toEqual({ enabled: true, clientId: `1234.${timestamp}` });
  expect(response.headers.get("Set-Cookie")).toContain("Max-Age=33609600");
});
