import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { siteRootOf } from "../shared/site-hosts";
import { bumpOp } from "./ops-metrics";
import type { Env } from "./types";
import { requireMember } from "./members";
import { apiBaseOf } from "./providers";
import { bodyLimit } from "hono/body-limit";

export const analyticsRoutes = new Hono<{ Bindings: Env }>();
const COOKIE = "__Secure-hearthroom_ga";
const MAX_AGE = 390 * 86400;
analyticsRoutes.use("/v1/analytics/session", bodyLimit({ maxSize: 1024 }));
function issuedAt(value: string, now: number): number | null {
  const timestamp = /^(?:[1-9]\d{0,19})\.([1-9]\d{9})$/.exec(value)?.[1];
  return timestamp && Number(timestamp) <= now && now - Number(timestamp) < MAX_AGE ? Number(timestamp) : null;
}

analyticsRoutes.post("/v1/analytics/signup", async c => {
  c.header("Cache-Control", "private, no-store");
  const url = new URL(c.req.url);
  if (!siteRootOf(url.hostname) || c.req.header("Origin") !== url.origin || c.req.header("X-Hearthroom-Request") !== "1") return c.json({ error: "forbidden" }, 403);
  if (c.env.GA4_ENABLED !== "true" || c.req.header("Sec-GPC") === "1") return c.json({ first: false });
  const member = await requireMember(c);
  const response = await fetch(apiBaseOf(c.env, member.provider) + "/open/v1/me/referral", {
    headers: { Authorization: c.req.header("Authorization")! }, signal: AbortSignal.timeout(3000),
  });
  if (!response.ok) return c.json({ first: false });
  const account = await response.json() as { registeredAt?: string };
  const age = Date.now() - Date.parse(account.registeredAt ?? "");
  if (!Number.isFinite(age) || age < 0 || age > 600000) return c.json({ first: false });
  const result = await c.env.DB.prepare("INSERT OR IGNORE INTO analytics_milestones(member_id,event,created_at) VALUES(?, 'sign_up', ?)")
    .bind(member.id, Date.now()).run();
  return c.json({ first: result.meta.changes === 1 });
});

analyticsRoutes.post("/v1/analytics/session", async c => {
  c.header("Cache-Control", "private, no-store");
  c.header("Vary", "Origin, Cookie, Sec-GPC");
  const url = new URL(c.req.url);
  const root = siteRootOf(url.hostname);
  if (!root || url.protocol !== "https:" || c.req.header("Origin") !== url.origin ||
      c.req.header("X-Hearthroom-Request") !== "1" || c.req.header("Sec-Fetch-Site") === "cross-site") {
    return c.json({ error: "forbidden" }, 403);
  }
  const options = { domain: root, path: "/", secure: true, httpOnly: true, sameSite: "Lax" as const };
  if (c.req.header("Sec-GPC") === "1" || c.req.header("X-Analytics-Opt-Out") === "1") {
    setCookie(c, COOKIE, "", { ...options, maxAge: 0 });
    await bumpOp(c.env.DB, "ga4_session", "session", "opted_out");
    return c.json({ enabled: false });
  }
  if (c.env.GA4_ENABLED !== "true") return c.json({ enabled: false });
  const now = Math.floor(Date.now() / 1000);
  const existing = getCookie(c, COOKIE) ?? "";
  const linked = c.req.header("Content-Type")?.includes("application/json")
    ? await c.req.json<{ clientId?: unknown }>().catch(() => null) : null;
  const incoming = typeof linked?.clientId === "string" && issuedAt(linked.clientId, now) !== null ? linked.clientId : "";
  const valid = issuedAt(existing, now) !== null;
  // A fixed creation timestamp bounds lifetime; reading does not refresh expiry.
  const random = crypto.getRandomValues(new Uint32Array(2));
  const clientId = incoming || (valid ? existing : `${(BigInt(random[0]) << 32n | BigInt(random[1])) || 1n}.${now}`);
  if (clientId !== existing) setCookie(c, COOKIE, clientId, { ...options, maxAge: MAX_AGE - (now - issuedAt(clientId, now)!) });
  await bumpOp(c.env.DB, "ga4_session", "session", valid ? "reused" : "issued");
  return c.json({ enabled: true, clientId });
});
