import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import { opsMetrics } from "../src/ops-metrics";
import { upstream } from "../src/upstream";
import { bearer, identities, makeMember, resetDb, restoreUpstream } from "./helpers";

// 推廣貼文逐篇歸因（任務 2026-11-25-post-attribution）：每篇貼文的代號就是已登記的 utm_campaign。
// 沒登入時在瀏覽器記下代號，登入後送一次；只有點了之後才建立的新帳號會寫一列。首聊補上時間。
// 註冊與首聊各送一筆 AE 事件（subject＝代號），不含任何帳號。推薦與分享季不碰。
const FRESH = 65001, OLD = 65002;
const MIN = 60_000;
const CAMPAIGN = "bh-limbus-20261116"; // config/promo-links.json 裡已登記的代號
type Point = { indexes: string[]; blobs: string[]; doubles: number[] };
let points: Point[] = [];
let fresh = "", old = "";

async function call(method: string, path: string, token: string, body: unknown) {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request("https://c.test" + path, { method, headers: { "Content-Type": "application/json", ...bearer(token) }, body: JSON.stringify(body) }),
    { ...env, EVENTS: { writeDataPoint: (p: Point) => points.push(p) } as unknown as AnalyticsEngineDataset } as typeof env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}
const bind = (body: unknown, token = "fresh") => call("POST", "/v1/me/promo-attribution", token, body);
const play = (token = "fresh", roleId = "role-a") => call("PUT", "/v1/me/conversations", token, { roleId, conversationId: "conv-" + roleId });
const rows = async () => (await env.DB.prepare("SELECT * FROM promo_attributions").all()).results;
const promoPoints = (event: string) => points.filter((p) => p.indexes[0] === event);
const setCreated = (memberId: string, at: number) => env.DB.prepare("UPDATE members SET created_at = ? WHERE id = ?").bind(at, memberId).run();

beforeEach(async () => {
  await resetDb();
  points = [];
  identities({ fresh: FRESH, old: OLD });
  fresh = await makeMember(FRESH);
  old = await makeMember(OLD);
});
afterEach(() => { restoreUpstream(); vi.restoreAllMocks(); });

describe("登入後綁定貼文代號", () => {
  it("點了之後才建立的帳號：寫一列、回應不含成員 id、送一筆註冊事件", async () => {
    const seen = Date.now() - MIN;
    const r = await bind({ campaign: CAMPAIGN, firstSeenAt: seen });
    expect(r.status).toBe(200);
    const text = await r.text();
    expect(JSON.parse(text)).toEqual({ bound: true });
    expect(text).not.toContain(fresh);
    expect(r.headers.get("Cache-Control")).toBe("private, no-store");
    const created = await env.DB.prepare("SELECT created_at FROM members WHERE id = ?").bind(fresh).first<number>("created_at");
    expect(await rows()).toEqual([{ member_id: fresh, campaign: CAMPAIGN, first_seen_at: seen, registered_at: created, first_play_at: null, created_at: expect.any(Number) }]);
    const signup = promoPoints("promo_signup");
    expect(signup).toHaveLength(1);
    expect(signup[0].blobs).toContain(CAMPAIGN);
    expect(signup[0].blobs.join("|")).not.toContain(fresh);
    expect(await opsMetrics(env.DB)).toContain('hearthroom_promo_attributions_total{operation="bind",outcome="bound"} 1');
  });

  it("沒登記的代號、舊帳號、已綁過、測試帳號都不寫列也不送事件", async () => {
    const seen = Date.now() - MIN;
    expect(await (await bind({ campaign: "not-a-registered-post", firstSeenAt: seen })).json()).toEqual({ bound: false, reason: "unknown" });
    await setCreated(old, seen - 60 * MIN);
    expect(await (await bind({ campaign: CAMPAIGN, firstSeenAt: seen }, "old")).json()).toEqual({ bound: false, reason: "not_new" });
    expect(await rows()).toEqual([]);
    expect(await (await bind({ campaign: CAMPAIGN, firstSeenAt: seen })).json()).toEqual({ bound: true });
    expect(await (await bind({ campaign: "bh-jinyong-20261116", firstSeenAt: seen })).json()).toEqual({ bound: false, reason: "existing" });
    expect((await rows()).map((r) => r.campaign)).toEqual([CAMPAIGN]);
    await env.DB.prepare("UPDATE members SET account_class='test', test_generation=1 WHERE id=?").bind(old).run();
    await setCreated(old, Date.now());
    vi.spyOn(upstream, "fetchMe").mockImplementation(async (_e, token) => token === "old" ? { accountNumId: OLD, accountClass: "test", testState: "active", testGeneration: 1 } as never : { accountNumId: FRESH } as never);
    expect(await (await bind({ campaign: CAMPAIGN, firstSeenAt: seen }, "old")).json()).toEqual({ bound: false, reason: "excluded" });
    expect(promoPoints("promo_signup")).toHaveLength(1);
  });

  it("格式不對回 400：代號格式、點擊時間太舊或在未來", async () => {
    expect((await bind({ campaign: "Bad Code!", firstSeenAt: Date.now() })).status).toBe(400);
    expect((await bind({ campaign: CAMPAIGN, firstSeenAt: Date.now() - 31 * 86_400_000 })).status).toBe(400);
    expect((await bind({ campaign: CAMPAIGN, firstSeenAt: Date.now() + 60 * MIN })).status).toBe(400);
    expect((await bind({ campaign: CAMPAIGN })).status).toBe(400);
    expect(await rows()).toEqual([]);
  });
});

describe("首聊", () => {
  it("有歸因的人第一次開聊：記下首聊時間、送一筆首聊事件；之後不再記", async () => {
    await bind({ campaign: CAMPAIGN, firstSeenAt: Date.now() - MIN });
    expect((await play()).status).toBe(200);
    const [row] = await rows() as { first_play_at: number | null }[];
    expect(row.first_play_at).toEqual(expect.any(Number));
    await play("fresh", "role-b");
    expect(((await rows())[0] as { first_play_at: number }).first_play_at).toBe(row.first_play_at);
    const first = promoPoints("promo_first_play");
    expect(first).toHaveLength(1);
    expect(first[0].blobs).toContain(CAMPAIGN);
    expect(await opsMetrics(env.DB)).toContain('hearthroom_promo_attributions_total{operation="first_play",outcome="recorded"} 1');
  });

  it("綁定晚於首聊（例如綁定重試才送到）：綁定時補上最早的開聊時間並送首聊事件", async () => {
    expect((await play()).status).toBe(200);
    const opened = await env.DB.prepare("SELECT MIN(created_at) AS t FROM member_conversations WHERE member_id = ?").bind(fresh).first<number>("t");
    expect(await (await bind({ campaign: CAMPAIGN, firstSeenAt: Date.now() - MIN })).json()).toEqual({ bound: true });
    expect(((await rows())[0] as { first_play_at: number }).first_play_at).toBe(opened);
    expect(promoPoints("promo_first_play")).toHaveLength(1);
    await play("fresh", "role-b");
    expect(promoPoints("promo_first_play")).toHaveLength(1);
  });

  it("沒有歸因的人開聊：不送首聊事件", async () => {
    expect((await play()).status).toBe(200);
    expect(promoPoints("promo_first_play")).toHaveLength(0);
  });
});
