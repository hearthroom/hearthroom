import { SELF, env } from "cloudflare:test";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { resetDb, identities, bearer, restoreUpstream } from "./helpers";

beforeEach(async () => { await resetDb(); identities({ fan: 20001 }); });
afterEach(() => { restoreUpstream(); vi.restoreAllMocks(); });
const put = (role: string) => SELF.fetch("https://sukisuki.ai/v1/me/conversations", {
  method: "PUT", headers: { ...bearer("fan"), "Content-Type": "application/json" }, body: JSON.stringify({ roleId: role, conversationId: `chat-${role}` }),
});

it("marks the first conversation once across concurrent requests and later deletion", async () => {
  const results = await Promise.all([put("role-a"), put("role-b")]);
  const bodies = await Promise.all(results.map(response => response.json() as Promise<{ first?: boolean }>));
  expect(bodies.filter(body => body.first === true)).toHaveLength(1);
  expect((await (await put("role-a")).json() as {first:boolean}).first).toBe(false);
  await env.DB.prepare("DELETE FROM member_conversations").run();
  expect((await (await put("role-c")).json() as {first:boolean}).first).toBe(false);
});

it("uses authoritative account registration time and a durable signup claim", async () => {
  const { analyticsRoutes } = await import("../src/ga4");
  const originalFetch = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => String(input).endsWith("/open/v1/me/referral")
    ? Promise.resolve(Response.json({ registeredAt: new Date().toISOString() })) : originalFetch(input, init));
  const make = () => analyticsRoutes.request("https://sukisuki.ai/v1/analytics/signup", {
    method: "POST", headers: { ...bearer("fan"), Origin: "https://sukisuki.ai", "X-Hearthroom-Request": "1" },
  }, { ...env, GA4_ENABLED: "true" });
  expect(await (await make()).json()).toEqual({ first: true });
  expect(await (await make()).json()).toEqual({ first: false });
});
