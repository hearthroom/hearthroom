import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import worker from "../src/index";
import { upstream } from "../src/upstream";
import { bearer, identities, makeMember, makeReviewer, resetDb, restoreUpstream } from "./helpers";

beforeEach(resetDb);
afterEach(restoreUpstream);

const path = "/v1/me/header-summary";
async function request(path: string, headers: HeadersInit = {}, overrides = {}) {
  const ctx = createExecutionContext();
  const response = await worker.fetch(new Request("https://sukisuki.ai" + path, { headers }), { ...env, ...overrides }, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

it("uses one member resolution, preserves both legacy summaries and records the locale and reward device", async () => {
  identities({ reviewer: 77001, other: 77002 });
  const authentication = vi.fn(upstream.fetchMe);
  upstream.fetchMe = authentication;
  upstream.fetchCommunityStatus = async () => ({ admin: true, featuredUsed: 3, featuredQuota: 6 });
  const member = await makeReviewer(77001);
  const other = await makeMember(77002);
  const now = Date.now();
  await env.DB.prepare(`INSERT INTO community_notifications(event_key,member_id,kind,path,created_at,read_at)
    VALUES ('mine',?1,'enforcement_notice','/me',?3,NULL),
           ('read',?1,'enforcement_notice','/me',?3,?3),
           ('other',?2,'enforcement_notice','/me',?3,NULL)`).bind(member, other, now).run();

  const headers = { ...bearer("reviewer"), "X-Device-Token": "fixture-device-001" };
  const merged = await request(path + "?lang=ja", headers);
  expect(merged.status).toBe(200);
  expect(merged.headers.get("Cache-Control")).toBe("private, no-store");
  expect(authentication).toHaveBeenCalledTimes(1);
  const body = await merged.json();
  expect(body).toMatchObject({ review: { reviewer: true, blogWriter: true }, notifications: { unread: 1 } });
  expect(await env.DB.prepare("SELECT locale FROM members WHERE id=?").bind(member).first("locale")).toBe("ja");
  expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM reward_devices WHERE member_id=?").bind(member).first("n")).toBe(1);

  const review = await request("/v1/review/me", headers);
  const notifications = await request("/v1/me/community/notifications/summary?lang=ja", headers);
  expect(body).toEqual({ review: await review.json(), notifications: await notifications.json() });
});

it("requires authentication and keeps a partial success private", async () => {
  expect((await request(path)).status).toBe(401);
  identities({ reviewer: 77001 });
  await makeReviewer(77001);
  upstream.fetchCommunityStatus = async () => ({ admin: true, featuredUsed: 0, featuredQuota: 6 });
  const db = {
    prepare(sql: string) {
      if (sql.includes("SELECT COUNT(*) AS unread FROM community_notifications")) throw Error("unread unavailable");
      return env.DB.prepare(sql);
    },
    batch: env.DB.batch.bind(env.DB),
  };
  const writeDataPoint = vi.fn();
  const response = await request(path, bearer("reviewer"), { DB: db, EVENTS: { writeDataPoint } });
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(await response.json()).toMatchObject({ review: { reviewer: true }, notifications: null });
  expect(writeDataPoint.mock.calls.some(([point]) => point.blobs[0] === "header_summary" && point.blobs[11] === "partial")).toBe(true);
});

it("returns unread counts when the optional Provider reviewer hint reaches its deadline", async () => {
  identities({ reviewer: 77001 });
  await makeReviewer(77001);
  const originalTimeout = AbortSignal.timeout.bind(AbortSignal);
  const shorten = vi.spyOn(AbortSignal, "timeout").mockImplementation(ms => originalTimeout(ms === 5_000 ? 25 : ms));
  const aborted = vi.fn();
  upstream.fetchCommunityStatus = async (_env, _token, _provider, signal) => {
    return new Promise((_, reject) => {
      if (!signal) return reject(new Error("Expected a polling deadline"));
      const onAbort = () => {
        aborted();
        reject(signal.reason);
      };
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    });
  };
  try {
    const response = await request(path, bearer("reviewer"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ review: { reviewer: true, featured: null }, notifications: { unread: 0 } });
    expect(aborted).toHaveBeenCalledTimes(1);
  } finally {
    shorten.mockRestore();
  }
});
