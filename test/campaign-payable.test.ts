import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import worker from "../src/index";
import { upstream } from "../src/upstream";
import { bearer, identities, makeAgent, makeMember, makeReviewer, resetDb, restoreUpstream } from "./helpers";

// 待發放清單：有應發金額、沒有進行中發放、活動還能發的內容；閘門同發放。
const ADMIN = 65001, MOD = 65003, AGENT = 65004, OWNER = 65005;
const DAY = 86_400_000;

async function call(path: string, token: string) {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request("https://c.test" + path, { headers: bearer(token) }), env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}
const json = async (r: Response) => (await r.json()) as any;
const list = (q = "", token = "admin") => call(`/v1/moderation/campaign/payable${q}`, token);

let owner = "", campaignId = "";
async function campaign(over: { status?: string; slug?: string } = {}) {
  const now = Date.now(), id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO campaigns (id, slug, title, starts_at, ends_at, timezone, submit_deadline, payout_deadline, tiers, extra_placement_amount, status, created_by, created_at, updated_at)
     VALUES (?, ?, '{"zh-Hant":"開站分享"}', ?, ?, 'Asia/Taipei', ?, ?, '{"light":500,"original":3000,"guide":5000,"video":10000}', 500, ?, 'test', ?, ?)`,
  ).bind(id, over.slug ?? `c${id.slice(0, 8)}`, now - 5 * DAY, now + 9 * DAY, now + 11 * DAY, now + 20 * DAY, over.status ?? "active", now, now).run();
  return id;
}
let tick = 0;
async function content(over: { cId?: string; tier?: string | null; title?: string } = {}) {
  const id = crypto.randomUUID(), at = Date.now() + tick++;
  await env.DB.prepare("INSERT INTO share_contents (id, campaign_id, member_id, recipient_account_no, title, share_code, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(id, over.cId ?? campaignId, owner, OWNER, over.title ?? "介紹", id.slice(0, 8).toUpperCase(), at, at).run();
  const tier = over.tier === undefined ? "original" : over.tier;
  await env.DB.prepare(
    `INSERT INTO share_placements (id, content_id, platform, location, location_key, published_at, url, requested_tier, approved_tier, review_status, created_at, updated_at)
     VALUES (?, ?, 'tieba', '角色扮演吧', ?, ?, 'https://tieba.baidu.com/p/1', 'original', ?, ?, ?, ?)`,
  ).bind(crypto.randomUUID(), id, `url:${id}`, at - 60_000, tier, tier ? "approved" : "submitted", at, at).run();
  return id;
}
const payout = (contentId: string, amount: number, status: string) =>
  env.DB.prepare("INSERT INTO share_payouts (id, content_id, amount, target_total, status, requested_by, attempts, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'x', 1, ?, ?)")
    .bind(crypto.randomUUID(), contentId, amount, amount, status, Date.now(), Date.now()).run();

beforeEach(async () => {
  await resetDb();
  identities({ admin: ADMIN, mod: MOD, agent: AGENT, owner: OWNER });
  upstream.fetchCommunityStatus = async (_env, token) => ({ admin: token === "admin" || token === "agent", featuredUsed: 0, featuredQuota: 50 });
  await makeReviewer(ADMIN);
  await makeReviewer(MOD);
  await makeAgent(AGENT);
  owner = await makeMember(OWNER);
  campaignId = await campaign();
});
afterEach(() => restoreUpstream());

describe("待發放清單", () => {
  it("只列還有應發金額、沒有進行中發放的內容；舊的在前；不回成員 id 與收款帳號", async () => {
    const due = await content({ title: "攻略文" });
    const partial = await content({ tier: "guide" });
    await payout(partial, 3000, "paid");
    const done = await content();
    await payout(done, 3000, "paid");
    const pending = await content();
    await payout(pending, 3000, "pending");
    const queued = await content();
    await payout(queued, 3000, "blocked_insufficient");
    const failed = await content();
    await payout(failed, 3000, "failed");
    await content({ tier: null }); // 還沒核准

    const r = await list();
    expect(r.status).toBe(200);
    expect(r.headers.get("Cache-Control")).toBe("private, no-store");
    const b = await json(r);
    expect(b.total).toBe(3);
    expect(b.items.map((x: any) => x.contentId)).toEqual([due, partial, failed]);
    const slug = (await env.DB.prepare("SELECT slug FROM campaigns WHERE id = ?").bind(campaignId).first<string>("slug"))!;
    expect(b.items[0]).toEqual({ contentId: due, contentTitle: "攻略文", campaignSlug: slug, applicant: { handle: expect.any(String) }, target: 3000, paidTotal: 0, due: 3000 });
    expect(b.items[1]).toMatchObject({ target: 5000, paidTotal: 3000, due: 2000 });
    const text = JSON.stringify(b);
    expect(text).not.toContain(owner);
    expect(text).not.toContain(String(OWNER));
    expect(text).not.toContain("requested");
  });

  it("草稿、設定不完整、過了發獎截止的活動不列；可以只看一個活動", async () => {
    const mine = await content();
    const draft = await campaign({ status: "draft" });
    await content({ cId: draft });
    const broken = await campaign();
    await env.DB.prepare("UPDATE campaigns SET extra_placement_amount = NULL WHERE id = ?").bind(broken).run();
    await content({ cId: broken });
    const closed = await campaign({ slug: "closed" });
    await content({ cId: closed });
    const now = Date.now();
    await env.DB.prepare("UPDATE campaigns SET starts_at = ?, ends_at = ?, submit_deadline = ?, payout_deadline = ?, status = 'ended' WHERE id = ?").bind(now - 10 * DAY, now - 3 * DAY, now - 2 * DAY, now - 1, closed).run();
    const other = await campaign({ slug: "other" });
    const theirs = await content({ cId: other });

    expect((await json(await list())).items.map((x: any) => x.contentId)).toEqual([mine, theirs]);
    expect((await json(await list("?campaign=other"))).items.map((x: any) => x.contentId)).toEqual([theirs]);
    expect(await json(await list("?campaign=closed"))).toEqual({ total: 0, items: [] });
  });

  it("每頁 20 筆", async () => {
    const ids = [];
    for (let i = 0; i < 21; i++) ids.push(await content());
    const p1 = await json(await list());
    expect(p1.total).toBe(21);
    expect(p1.items).toHaveLength(20);
    const p2 = await json(await list("?page=2"));
    expect(p2.items.map((x: any) => x.contentId)).toEqual([ids[20]]);
  });

  it("AI 帳號與一般審核員都是 403", async () => {
    await content();
    const a = await list("", "agent");
    expect(a.status).toBe(403);
    expect((await json(a)).error).toBe("agent_not_allowed");
    const m = await list("", "mod");
    expect(m.status).toBe(403);
    expect((await json(m)).error).toBe("community_admin_required");
    expect((await list("", "owner")).status).toBe(403);
  });
});
