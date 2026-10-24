import {legacyPolicyFixture} from './work-policy-fixture';
import { SELF, env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { upstream, type PayResult } from "../src/upstream";
import { appAdmins, bearer, identities, makeReviewer, ratingBody, resetDb, restoreUpstream, reviewOff, reviewOn, reviewUpstream, rolesOnMainSite } from "./helpers";

// 創作季發放：審核通過就發、待發放清單（補發與沒發成的）、同一張卡只給一次、作者自己的進度。
// Provider 用記憶體裡的點數池模擬：同一把 key 再送回 replayed:true。
const AUTHOR = 10001, ADMIN = 20001, MOD = 20002, ADMIN_AUTHOR = 20003;
const DAY = 86_400_000;

type Sent = { token: string; key: string; accountNo: number; amount: number; campaignRef: string; contentRef: string };
const pool = { balance: 0, entries: new Map<string, { body: Omit<Sent, "token">; entryId: string }>(), sent: [] as Sent[] };
function providerPool(balance: number) {
  Object.assign(pool, { balance, entries: new Map(), sent: [] });
  upstream.payCampaign = async (_env, token, body): Promise<PayResult> => {
    pool.sent.push({ token, ...body });
    const prior = pool.entries.get(body.key);
    if (prior) return JSON.stringify(prior.body) === JSON.stringify(body) ? { kind: "paid", entryId: prior.entryId, paidAt: "2026-10-17T00:00:00Z", replayed: true } : { kind: "rejected", code: "idempotency_conflict" };
    if (pool.balance < body.amount) return { kind: "insufficient" };
    pool.balance -= body.amount;
    const entryId = crypto.randomUUID();
    pool.entries.set(body.key, { body: { ...body }, entryId });
    return { kind: "paid", entryId, paidAt: "2026-10-17T00:00:00Z", replayed: false };
  };
  upstream.getCampaignPayout = async (_env, _token, key) => {
    const e = pool.entries.get(key);
    return e ? { kind: "paid", entryId: e.entryId, paidAt: "2026-10-17T00:00:00Z" } : { kind: "absent" };
  };
}

let campaignId = "";
async function campaign(over: { startsAt?: number; endsAt?: number; reward?: number } = {}) {
  campaignId = crypto.randomUUID();
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO card_reward_campaigns (id, slug, title, starts_at, ends_at, payout_deadline, weekly_limit, reward, status, created_at, updated_at)
     VALUES (?, 'creator-season', '{"zh-Hant":"綺夢創作季"}', ?, ?, NULL, 6, ?, 'active', 0, 0)`,
  ).bind(campaignId, over.startsAt ?? now - DAY, over.endsAt ?? now + DAY, over.reward ?? 10000).run();
}

const submit = async (roleId: string, token = "author-token") => { const r = await submitRaw(roleId, token); if (r.status >= 300) throw new Error(`submit ${r.status} ${await r.text()}`); return r; };
const submitRaw = async (roleId: string, token = "author-token") => {
  const pending = await env.DB.prepare("SELECT v.operation_id FROM hosting_versions v JOIN review_submissions s ON s.id=v.submission_id WHERE v.source_role_id=? AND s.status='pending'").bind(roleId).first<{ operation_id: string }>();
  return SELF.fetch("https://c.test/v1/cards", { method: "POST", headers: { "Content-Type": "application/json", ...bearer(token) }, body: JSON.stringify({ roleId, ...ratingBody(false), operationId: pending?.operation_id ?? crypto.randomUUID() }) });
};
const post = (path: string, token: string, body: unknown = {}) =>
  SELF.fetch(`https://c.test${path}`, { method: "POST", headers: { "Content-Type": "application/json", ...bearer(token) }, body: JSON.stringify(body) });
const get = (path: string, token?: string) => SELF.fetch(`https://c.test${path}`, { headers: token ? bearer(token) : {} });

/** 領、蓋章通過，回蓋章的回應。 */
async function approve(roleId: string, token: string) {
  const sub = (await env.DB.prepare("SELECT s.id FROM review_submissions s JOIN cards c ON c.id = s.card_id WHERE c.source_role_id = ? AND s.status = 'pending'").bind(roleId).first<{ id: string }>())!;
  const claim = (await (await post(`/v1/review/${sub.id}/claim`, token)).json()) as { generation: string };
  const res = await post(`/v1/review/${sub.id}/stamp`, token, { verdict: "approve", generation: claim.generation });
  expect(res.status).toBe(200);
  return (await res.json()) as any;
}
const cardIdOf = async (roleId: string) => (await env.DB.prepare("SELECT id FROM cards WHERE source_role_id = ?").bind(roleId).first<{ id: number }>())!.id;
const rewards = async () => (await env.DB.prepare("SELECT card_id, status, amount, recipient_account_no, campaign_id FROM card_rewards ORDER BY created_at").all<any>()).results;
const op = () => crypto.randomUUID();

beforeEach(async () => {
  await resetDb();legacyPolicyFixture();
  identities({ "author-token": AUTHOR, "admin-token": ADMIN, "mod-token": MOD, "admin-author-token": ADMIN_AUTHOR });
  rolesOnMainSite(...["r1", "r2", "r3"].map((roleId) => ({ roleId, authorNumId: AUTHOR })), { roleId: "own", authorNumId: ADMIN_AUTHOR });
  reviewUpstream();
  reviewOn();
  appAdmins("admin-token", "admin-author-token");
  await makeReviewer(ADMIN);
  await makeReviewer(MOD);
  await makeReviewer(ADMIN_AUTHOR);
  providerPool(1_000_000);
  await campaign();
});
afterEach(() => {
  restoreUpstream();
  reviewOff();
});

describe("審核通過就發", () => {
  it("應用管理員審過活動期間送審的卡：作者入帳 10000，金額來自活動設定，冪等鍵與作品記在發放紀錄", async () => {
    await submit("r1");
    const stamped = await approve("r1", "admin-token");
    expect(stamped.reward).toMatchObject({ status: "paid", amount: 10000, cardId: await cardIdOf("r1") });
    expect(pool.sent).toHaveLength(1);
    // 發放不帶有效期：點數池只是額度，不帶就是永久
    expect(pool.sent[0]).toEqual({ token: "admin-token", key: expect.any(String), accountNo: AUTHOR, amount: 10000, campaignRef: campaignId, contentRef: "harbor:r1" });
    expect(await rewards()).toEqual([{ card_id: await cardIdOf("r1"), status: "paid", amount: 10000, recipient_account_no: AUTHOR, campaign_id: campaignId }]);
    const audit = await env.DB.prepare("SELECT action FROM audit_log WHERE subject_kind = 'card_reward' ORDER BY created_at, action").all<{ action: string }>();
    expect(audit.results.map((r) => r.action).sort()).toEqual(["paid", "request"]);
  });

  it("金額跟著活動設定", async () => {
    await env.DB.prepare("UPDATE card_reward_campaigns SET reward = 8000").run();
    await submit("r1");
    expect((await approve("r1", "admin-token")).reward).toMatchObject({ amount: 8000 });
  });

  it("不是應用管理員的審核員審過：不發，卡出現在待發放；管理員從清單發", async () => {
    await submit("r1");
    expect((await approve("r1", "mod-token")).reward).toBeNull();
    expect(pool.sent).toHaveLength(0);
    const due = (await (await get("/v1/moderation/card-rewards/due", "admin-token")).json()) as any;
    expect(due.items).toEqual([expect.objectContaining({ cardId: await cardIdOf("r1"), amount: 10000, campaignSlug: "creator-season" })]);
    expect(JSON.stringify(due)).not.toContain(String(AUTHOR));
    const paid = await post(`/v1/moderation/card-rewards/cards/${await cardIdOf("r1")}/pay`, "admin-token", { operationId: op() });
    expect(paid.status).toBe(200);
    expect(await paid.json()).toMatchObject({ status: "paid", amount: 10000 });
    expect(((await (await get("/v1/moderation/card-rewards/due", "admin-token")).json()) as any).items).toEqual([]);
  });

  // 資格看卡片「第一次過審上架」的時間（owner 2026-10-17）：登記、送審、撤回的時間都不看。
  it("活動開始前送審、撤回，活動開始後才第一次過審上架：照發", async () => {
    await submit("r1");
    // 這個作品第一次登記、送審都在活動開始之前，審核中就撤回
    const before = Date.now() - 2 * DAY; // 登記與送審同一刻（同一個請求寫的）
    await env.DB.prepare("UPDATE card_registrations SET registered_at = ? WHERE source_role_id = 'r1'").bind(before).run();
    await env.DB.prepare("UPDATE review_submissions SET submitted_at = ? WHERE card_id = (SELECT id FROM cards WHERE source_role_id = 'r1')").bind(before).run();
    expect((await SELF.fetch(`https://c.test/v1/cards/${await cardIdOf("r1")}`, { method: "DELETE", headers: bearer("author-token") })).status).toBe(204);
    await submit("r1");
    expect((await approve("r1", "admin-token")).reward).toMatchObject({ status: "paid", amount: 10000 });
  });

  it("送審在活動開始前、過審在活動開始後：照發", async () => {
    await submit("r1");
    const before = Date.now() - 2 * DAY; // 登記與送審同一刻（同一個請求寫的）
    await env.DB.prepare("UPDATE card_registrations SET registered_at = ? WHERE source_role_id = 'r1'").bind(before).run();
    await env.DB.prepare("UPDATE review_submissions SET submitted_at = ? WHERE card_id = (SELECT id FROM cards WHERE source_role_id = 'r1')").bind(before).run();
    expect((await approve("r1", "admin-token")).reward).toMatchObject({ status: "paid" });
  });

  it("活動開始前就已經過審上架過的卡，下架重發再過審：不發", async () => {
    await submit("r1");
    await approve("r1", "mod-token");
    // 第一次過審上架在活動開始之前
    await env.DB.prepare("UPDATE review_submissions SET submitted_at = ?, decided_at = ? WHERE card_id = (SELECT id FROM cards WHERE source_role_id = 'r1')").bind(Date.now() - 3 * DAY, Date.now() - 2 * DAY).run();
    await env.DB.prepare("UPDATE card_registrations SET registered_at = ? WHERE source_role_id = 'r1'").bind(Date.now() - 3 * DAY).run();
    expect((await SELF.fetch(`https://c.test/v1/cards/${await cardIdOf("r1")}`, { method: "DELETE", headers: bearer("author-token") })).status).toBe(204);
    await submit("r1");
    expect((await approve("r1", "admin-token")).reward).toBeNull();
    expect(await rewards()).toEqual([]);
  });

  it("舊制上架的卡（沒有託管版本紀錄）活動前就過審過，下架重發再過審：不發", async () => {
    await submit("r1");
    await approve("r1", "mod-token");
    const cardId = await cardIdOf("r1");
    await env.DB.prepare("UPDATE review_submissions SET submitted_at = ?, decided_at = ? WHERE card_id = ?").bind(Date.now() - 3 * DAY, Date.now() - 2 * DAY, cardId).run();
    // 2026-09-20 以前的上架沒有 hosting_versions 列
    await env.DB.prepare("UPDATE hosting_versions SET submission_id = NULL WHERE source_role_id = 'r1'").run();
    expect((await SELF.fetch(`https://c.test/v1/cards/${cardId}`, { method: "DELETE", headers: bearer("author-token") })).status).toBe(204);
    await submit("r1");
    expect(await cardIdOf("r1")).toBe(cardId);
    expect((await approve("r1", "admin-token")).reward).toBeNull();
  });

  it("審核制度之前就直接上架過的卡（只有登記、沒有送審紀錄），再送審過審：不發", async () => {
    // 這筆登記在審核制度開始（2026-09-07）之前：那時登記就是上架
    await env.DB.prepare("INSERT INTO card_registrations (provider, author_num_id, source_role_id, registered_at) VALUES ('harbor', ?, 'r1', ?)").bind(AUTHOR, Date.UTC(2026, 8, 5)).run();
    await submit("r1");
    expect((await approve("r1", "admin-token")).reward).toBeNull();
  });

  it("期間內送審、活動結束後才過審的照發", async () => {
    await submit("r1");
    await env.DB.prepare("UPDATE review_submissions SET submitted_at = ? WHERE card_id = (SELECT id FROM cards WHERE source_role_id = 'r1')").bind(Date.now() - DAY).run();
    await env.DB.prepare("UPDATE card_reward_campaigns SET ends_at = ?").bind(Date.now() - DAY / 2).run();
    expect((await approve("r1", "admin-token")).reward).toMatchObject({ status: "paid" });
  });

  it("活動結束後才送審的不發", async () => {
    await submit("r1");
    // 這次送審在活動結束之後
    await env.DB.prepare("UPDATE card_reward_campaigns SET ends_at = ?").bind(Date.now() - DAY).run();
    await env.DB.prepare("UPDATE review_submissions SET submitted_at = ? WHERE card_id = (SELECT id FROM cards WHERE source_role_id = 'r1')").bind(Date.now() - DAY / 2).run();
    expect((await approve("r1", "admin-token")).reward).toBeNull();
  });

  it("管理員不能發給自己：自己的卡停在待發放，由另一位管理員發", async () => {
    await submit("own", "admin-author-token");
    const stamped = await approve("own", "admin-author-token");
    expect(stamped.reward).toBeNull();
    expect(stamped.rewardError).toBe("card_reward_self");
    expect(pool.sent).toHaveLength(0);
    expect((await post(`/v1/moderation/card-rewards/cards/${await cardIdOf("own")}/pay`, "admin-token", { operationId: op() })).status).toBe(200);
  });
});

describe("發放出錯不推翻過審", () => {
  it("寫發放紀錄時資料庫出錯：蓋章照樣成功，回 rewardError，卡留在待發放", async () => {
    await submit("r1");
    await env.DB.prepare("ALTER TABLE card_rewards RENAME TO card_rewards_gone").run();
    try {
      const stamped = await approve("r1", "admin-token");
      expect(stamped).toMatchObject({ status: "approved", reward: null, rewardError: "internal_error" });
    } finally {
      await env.DB.prepare("ALTER TABLE card_rewards_gone RENAME TO card_rewards").run();
    }
    expect(((await (await get("/v1/moderation/card-rewards/due", "admin-token")).json()) as any).total).toBe(1);
  });
});

describe("被下架的卡不發", () => {
  it("站方封鎖公開的卡不在待發放，也不能發", async () => {
    await submit("r1");
    await approve("r1", "mod-token");
    await env.DB.prepare("UPDATE cards SET public_blocked = 1 WHERE source_role_id = 'r1'").run();
    expect(((await (await get("/v1/moderation/card-rewards/due", "admin-token")).json()) as any).total).toBe(0);
    expect((await post(`/v1/moderation/card-rewards/cards/${await cardIdOf("r1")}/pay`, "admin-token", { operationId: op() })).status).toBe(409);
  });
});

describe("同一張卡只給一次", () => {
  it("已經發過的卡再要求發放 409；下架重發、再審過也不再發", async () => {
    await submit("r1");
    await approve("r1", "admin-token");
    const cardId = await cardIdOf("r1");
    expect((await post(`/v1/moderation/card-rewards/cards/${cardId}/pay`, "admin-token", { operationId: op() })).status).toBe(409);
    expect((await SELF.fetch(`https://c.test/v1/cards/${cardId}`, { method: "DELETE", headers: bearer("author-token") })).status).toBe(204);
    await submit("r1");
    expect((await approve("r1", "admin-token")).reward).toBeNull();
    expect(pool.sent).toHaveLength(1);
    expect(await rewards()).toHaveLength(1);
  });

  it("同一個操作編號重送拿回同一筆，不再送 Provider", async () => {
    await submit("r1");
    await approve("r1", "mod-token");
    const cardId = await cardIdOf("r1"), o = op();
    const a = (await (await post(`/v1/moderation/card-rewards/cards/${cardId}/pay`, "admin-token", { operationId: o })).json()) as any;
    const b = (await (await post(`/v1/moderation/card-rewards/cards/${cardId}/pay`, "admin-token", { operationId: o })).json()) as any;
    expect(b.id).toBe(a.id);
    expect(pool.sent).toHaveLength(1);
  });
});

describe("點數池不足與重試", () => {
  it("池不足：過審成立、發放停在池不足；補池後重試用同一把 key 入帳", async () => {
    providerPool(0);
    await submit("r1");
    const stamped = await approve("r1", "admin-token");
    expect(stamped.status).toBe("approved");
    expect(stamped.reward).toMatchObject({ status: "blocked_insufficient" });
    pool.balance = 50_000;
    const retried = (await (await post(`/v1/moderation/card-rewards/${stamped.reward.id}/retry`, "admin-token", { operationId: op() })).json()) as any;
    expect(retried).toMatchObject({ status: "paid", attempts: 2 });
    expect(new Set(pool.sent.map((s) => s.key)).size).toBe(1);
    const metrics = await (await get("/metrics")).text();
    expect(metrics).toContain('hearthroom_card_reward_operations_total{operation="payout",outcome="insufficient"} 1');
    expect(metrics).toContain('hearthroom_card_reward_operations_total{operation="payout",outcome="success"} 1');
  });
});

describe("上線前已過審的卡補發", () => {
  it("活動期間送審、已經過審但沒有發放紀錄的卡都在待發放；批次一次發完", async () => {
    await submit("r1");
    await submit("r2");
    await approve("r1", "mod-token");
    await approve("r2", "mod-token");
    await submit("r3"); // 還在審，不在清單
    const due = (await (await get("/v1/moderation/card-rewards/due", "admin-token")).json()) as any;
    expect(due.total).toBe(2);
    const cardIds = due.items.map((i: any) => i.cardId);
    const batch = (await (await post("/v1/moderation/card-rewards/batch", "admin-token", { cardIds, operationId: op() })).json()) as any;
    expect(batch.items.map((i: any) => i.reward.status)).toEqual(["paid", "paid"]);
    expect(pool.sent.map((s) => s.amount)).toEqual([10000, 10000]);
  });

  it("後台發放只給應用管理員", async () => {
    expect((await get("/v1/moderation/card-rewards/due", "mod-token")).status).toBe(403);
    expect((await get("/v1/moderation/card-rewards/due", "author-token")).status).toBe(403);
  });
});

describe("活動資料與作者進度", () => {
  it("作者已收金額加上獨立補額的 paid，pending 不計入，原獎勵不變", async () => {
    await submit("r1");
    await approve("r1", "admin-token");
    const original = (await env.DB.prepare("SELECT * FROM card_rewards").first<any>())!;
    await env.DB.prepare(`INSERT INTO card_reward_topups
      (id, reward_id, target_amount, amount, status, requested_by, created_at)
      VALUES ('topup-fixture', ?, 20000, 10000, 'pending', ?, ?)`)
      .bind(original.id, original.requested_by, Date.now()).run();
    const progress = async () => (await (await get("/v1/card-rewards/creator-season/me", "author-token")).json()) as any;
    expect((await progress()).creditsPaid).toBe(10000);
    await expect(env.DB.prepare("UPDATE card_reward_topups SET amount=9000 WHERE id='topup-fixture'").run()).rejects.toThrow('card_reward_topup_immutable');
    await expect(env.DB.prepare(`INSERT INTO card_reward_topups (id,reward_id,target_amount,amount,status,requested_by,created_at)
      SELECT 'duplicate-fixture',reward_id,target_amount,amount,status,requested_by,created_at FROM card_reward_topups WHERE id='topup-fixture'`).run()).rejects.toThrow();
    await env.DB.prepare("UPDATE card_reward_topups SET status='paid', provider_entry_id='provider-topup-fixture', settled_at=? WHERE id='topup-fixture'").bind(Date.now()).run();
    const paid = await progress();
    expect(paid.creditsPaid).toBe(20000);
    expect(paid.items.find((i: any) => i.cardId === original.card_id).reward).toEqual({ status: "paid", amount: 20000 });
    expect(await env.DB.prepare("SELECT * FROM card_rewards WHERE id=?").bind(original.id).first()).toEqual(original);
    expect((await rewards())[0].amount).toBe(10000);
    await expect(env.DB.prepare("UPDATE card_reward_topups SET status='pending' WHERE id='topup-fixture'").run()).rejects.toThrow('card_reward_topup_immutable');
    const metrics = await (await get('/metrics')).text();
    expect(metrics).toContain('hearthroom_card_reward_operations_total{operation="topup_request",outcome="success"} 1');
    expect(metrics).toContain('hearthroom_card_reward_operations_total{operation="topup",outcome="success"} 1');
  });

  it("公開活動設定：每張金額、活動每週額度、平常額度、期間", async () => {
    const res = await get("/v1/card-rewards/creator-season");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ kind: "card_reward", slug: "creator-season", reward: 10000, weeklyLimit: 6, normalWeeklyLimit: 3, payoutDeadline: null });
  });

  it("作者看到這期送審過的卡、過審與審核中張數、已入帳積分、本週額度", async () => {
    await submit("r1");
    await submit("r2");
    await submit("r3");
    await approve("r1", "admin-token");
    await approve("r2", "mod-token");
    const me = (await (await get("/v1/card-rewards/creator-season/me", "author-token")).json()) as any;
    expect(me).toMatchObject({ approvedCount: 2, pendingCount: 1, creditsPaid: 10000, quota: { limit: 6, used: 3 } });
    expect(me.items).toHaveLength(3);
    const byId = new Map(me.items.map((i: any) => [i.cardId, i]));
    expect(byId.get(await cardIdOf("r1"))).toMatchObject({ review: "approved", reward: { status: "paid", amount: 10000 } });
    // 過審了、等補發：顯示已通過，沒有金額
    expect(byId.get(await cardIdOf("r2"))).toMatchObject({ review: "approved", reward: null });
    expect(byId.get(await cardIdOf("r3"))).toMatchObject({ review: "pending", reward: null });
  });

  it("公開活動列表帶著創作季：種類、精選與排序值；活動頁網址 /v1/campaigns/:slug 也讀得到", async () => {
    await env.DB.prepare("UPDATE card_reward_campaigns SET featured = 1, featured_rank = 2, timezone = 'Asia/Taipei'").run();
    const list = (await (await get("/v1/campaigns")).json()) as any;
    expect(list.items).toContainEqual(expect.objectContaining({ kind: "card_reward", slug: "creator-season", featured: true, featuredRank: 2, phase: "open", timezone: "Asia/Taipei", bannerUrl: null }));
    const detail = (await (await get("/v1/campaigns/creator-season")).json()) as any;
    expect(detail).toMatchObject({ kind: "card_reward", slug: "creator-season", phase: "open", reward: 10000, weeklyLimit: 6, normalWeeklyLimit: 3, timezone: "Asia/Taipei" });
    expect(detail).not.toHaveProperty("id");
  });

  it("分享活動不能用創作季的 slug（兩種活動共用 /campaign/:slug）", async () => {
    const res = await post("/v1/moderation/campaigns", "admin-token", { slug: "creator-season", title: { "zh-Hant": "撞名" }, operationId: op() });
    expect(res.status).toBe(409);
    expect(((await res.json()) as any).error).toBe("campaign_slug_taken");
  });

  it("創作季的橫幅讀得到：設定引用的圖算公開圖，列表帶 bannerUrl", async () => {
    await env.AVATARS.put("blog/creator-season-1.webp", new Uint8Array([82, 73, 70, 70]), { httpMetadata: { contentType: "image/webp" } });
    expect((await get("/v1/blog/images/creator-season-1.webp")).status).toBe(404);
    await env.DB.prepare("UPDATE card_reward_campaigns SET banner_key = 'blog/creator-season-1.webp'").run();
    const img = await get("/v1/blog/images/creator-season-1.webp");
    expect(img.status).toBe(200);
    expect(img.headers.get("Content-Type")).toBe("image/webp");
    const list = (await (await get("/v1/campaigns")).json()) as any;
    expect(list.items.find((c: any) => c.kind === "card_reward").bannerUrl).toBe("/v1/blog/images/creator-season-1.webp");
  });

  it("進度：活動前就上架過的卡不列；還沒上架過、活動結束前送審的卡列成審核中", async () => {
    await submit("r1");
    await approve("r1", "mod-token");
    const old = await cardIdOf("r1");
    await env.DB.prepare("UPDATE review_submissions SET submitted_at = ?, decided_at = ? WHERE card_id = ?").bind(Date.now() - 3 * DAY, Date.now() - 2 * DAY, old).run();
    expect((await SELF.fetch(`https://c.test/v1/cards/${old}`, { method: "DELETE", headers: bearer("author-token") })).status).toBe(204);
    await submit("r1");
    await submit("r2");
    // r2 在活動開始前就送審了，還在審：之後過審也算，所以列出來
    await env.DB.prepare("UPDATE review_submissions SET submitted_at = ? WHERE card_id = (SELECT id FROM cards WHERE source_role_id = 'r2')").bind(Date.now() - 2 * DAY).run();
    const me = (await (await get("/v1/card-rewards/creator-season/me", "author-token")).json()) as any;
    expect(me.items.map((i: any) => i.cardId)).toEqual([await cardIdOf("r2")]);
    expect(me.items[0]).toMatchObject({ review: "pending" });
  });

  it("沒登入不能看進度", async () => {
    expect((await get("/v1/card-rewards/creator-season/me")).status).toBe(401);
  });
});
