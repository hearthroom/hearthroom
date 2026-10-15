import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import worker from "../src/index";
import { upstream } from "../src/upstream";
import { appAdmins, bearer, identities, makeAgent, makeMember, makeReviewer, resetDb, restoreUpstream } from "./helpers";

// 活動統計看板（計畫 6 任務 3）：每個口徑一筆手算的測試資料。
// 兩份內容（A 有卡、兩個平台；B 沒卡、一個平台）、十個位置、幾筆發放、四個歸因成員與活躍日，外加另一個活動當干擾。
const ADMIN = 66001, MOD = 66002, AGENT = 66003, OWNER = 66005;
const M = [66011, 66012, 66013, 66014];
const DAY = 86_400_000, HOUR = 3_600_000;
const NOW = Date.now();
const day = (ms: number) => Math.floor(ms / DAY);

async function call(path: string, token: string) {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request("https://c.test" + path, { headers: bearer(token) }), env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}
const json = async (r: Response) => (await r.json()) as any;
const stats = (token = "mod", slug = "launch") => call(`/v1/moderation/campaign/stats?campaign=${slug}`, token);

let owner = "", members: string[] = [];
const run = (sql: string, ...b: unknown[]) => env.DB.prepare(sql).bind(...b).run();

async function campaign(slug: string) {
  const id = crypto.randomUUID();
  await run(
    `INSERT INTO campaigns (id, slug, title, tiers, extra_placement_amount, status, created_by, created_at, updated_at)
     VALUES (?, ?, '{"zh-Hant":"開站分享"}', '{"light":500,"original":3000,"guide":5000,"video":10000}', 500, 'active', 'test', ?, ?)`,
    id, slug, NOW - 30 * DAY, NOW - 30 * DAY,
  );
  return id;
}
async function content(cId: string, title: string, code: string, cardId: number | null = null) {
  const id = crypto.randomUUID();
  await run("INSERT INTO share_contents (id, campaign_id, member_id, recipient_account_no, card_id, title, share_code, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    id, cId, owner, OWNER, cardId, title, code, NOW - 25 * DAY, NOW - 25 * DAY);
  return id;
}
async function placement(contentId: string, o: { platform: string; requested: string; status: string; approved?: string; key?: string; createdAt: number }) {
  const id = crypto.randomUUID();
  await run(
    `INSERT INTO share_placements (id, content_id, platform, location, location_key, published_at, requested_tier, approved_tier, review_status, created_at, updated_at)
     VALUES (?, ?, ?, '某處', ?, ?, ?, ?, ?, ?, ?)`,
    id, contentId, o.platform, o.key ?? `k:${id}`, o.createdAt, o.requested, o.approved ?? null, o.status, o.createdAt, o.createdAt,
  );
  return id;
}
const audit = (action: string, placementId: string, at: number, kind: "human" | "ai", status: string, reason = "") =>
  run(`INSERT INTO audit_log (id, subject_kind, subject_id, actor_member_id, actor_kind, action, reason, after_json, operation_id, created_at)
       VALUES (?, 'share_placement', ?, 'reviewer', ?, ?, ?, ?, ?, ?)`,
    crypto.randomUUID(), placementId, kind, action, reason, JSON.stringify({ reviewStatus: status }), crypto.randomUUID(), at);
const decide = (placementId: string, at: number, kind: "human" | "ai", status: string, reason = "") => audit("decide", placementId, at, kind, status, reason);
const resubmit = (placementId: string, at: number) => audit("resubmit", placementId, at, "human", "resubmitted");
const payout = (contentId: string, amount: number, status: string, settledAt: number | null) =>
  run("INSERT INTO share_payouts (id, content_id, amount, target_total, status, requested_by, created_at, updated_at, settled_at) VALUES (?, ?, ?, ?, ?, 'x', ?, ?, ?)",
    crypto.randomUUID(), contentId, amount, amount, status, NOW - 20 * DAY, NOW - 20 * DAY, settledAt);
const attribute = (memberId: string, contentId: string, code: string, cId: string, registeredAt: number, firstPlayAt: number | null) =>
  run("INSERT INTO campaign_attributions (member_id, share_code, content_id, campaign_id, first_seen_at, registered_at, first_play_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    memberId, code, contentId, cId, registeredAt, registeredAt, firstPlayAt, registeredAt);
const active = (memberId: string, d: number) => run("INSERT INTO campaign_active_days (member_id, day) VALUES (?, ?)", memberId, d);
const visits = (code: string, d: number, n: number) => run("INSERT INTO campaign_share_visits (share_code, day, visits) VALUES (?, ?, ?)", code, d, n);

let A = "", B = "";
const CODE_A = "AAAA1111", CODE_B = "BBBB2222", CODE_X = "XXXX9999";
let poolCalls = 0;

beforeEach(async () => {
  await resetDb();
  identities({ admin: ADMIN, mod: MOD, agent: AGENT, owner: OWNER });
  appAdmins("admin", "agent");
  poolCalls = 0;
  upstream.fetchCampaignPool = async () => {
    poolCalls++;
    return { balance: 70000, paidTotal: 0, enabled: true, usageScope: "all", validityDays: null, maxPayout: null, configured: true, updatedAt: null };
  };
  await makeReviewer(ADMIN);
  await makeReviewer(MOD);
  await makeAgent(AGENT);
  owner = await makeMember(OWNER);
  members = [];
  for (const n of M) members.push(await makeMember(n));

  const cId = await campaign("launch");
  await run("INSERT INTO cards (id, source_role_id, author_num_id, names, registered_at, last_synced_at, provider) VALUES (300001, 'role-a', 1, '{\"zh\":\"阿卡\",\"en\":\"Aka\"}', 0, 0, 'harbor')");
  A = await content(cId, "攻略A", CODE_A, 300001);
  B = await content(cId, "影片B", CODE_B);
  const T0 = NOW - 20 * DAY;
  // A：兩個核准位置（tieba 原創、qq_group 攻略）→ 檔位 guide、平台「多平台」。
  const pA1 = await placement(A, { platform: "tieba", requested: "original", status: "approved", approved: "original", createdAt: T0 });
  await decide(pA1, T0 + 1 * HOUR, "human", "approved");
  const pA2 = await placement(A, { platform: "qq_group", requested: "guide", status: "approved", approved: "guide", createdAt: T0 });
  await decide(pA2, T0 + 3 * HOUR, "ai", "approved");
  // B：只有一個核准位置（bahamut 輕量）→ 檔位 light、平台 bahamut。pB1 與 pB2 位置相同（重複標示）。
  const pB1 = await placement(B, { platform: "bahamut", requested: "light", status: "approved", approved: "light", key: "bahamut:同一處", createdAt: T0 });
  await decide(pB1, T0 + 10 * HOUR, "human", "approved");
  await resubmit(pB1, T0 + 5 * HOUR); // 補件 → 重送 → 核准
  await decide(pB1, T0 + 2 * HOUR, "human", "needs_info", "請補截圖"); // 第一次決定是較早的這筆
  const pB2 = await placement(B, { platform: "bahamut", requested: "light", status: "rejected", key: "bahamut:同一處", createdAt: T0 });
  await decide(pB2, T0 + 4 * HOUR, "human", "rejected", "重複投稿");
  const pB3 = await placement(B, { platform: "forum", requested: "light", status: "rejected", createdAt: T0 });
  await decide(pB3, T0 + 5 * HOUR, "ai", "rejected", "  重複投稿 ");
  const pB4 = await placement(B, { platform: "forum", requested: "light", status: "rejected", createdAt: T0 });
  await decide(pB4, T0 + 6 * HOUR, "human", "rejected", "Bad link");
  const pB5 = await placement(B, { platform: "forum", requested: "light", status: "needs_info", createdAt: T0 });
  await decide(pB5, T0 + 7 * HOUR, "ai", "needs_info", "請補截圖");
  const pB6 = await placement(B, { platform: "other", requested: "light", status: "resubmitted", createdAt: T0 });
  await decide(pB6, T0 + 8 * HOUR, "human", "needs_info", "請補截圖");
  await resubmit(pB6, T0 + 12 * HOUR);
  await placement(B, { platform: "other", requested: "light", status: "submitted", createdAt: T0 });
  const pB8 = await placement(B, { platform: "forum", requested: "light", status: "rejected", createdAt: T0 });
  await decide(pB8, T0 + 9 * HOUR, "ai", "rejected", "Another reason");

  // 發放：只算 paid。A 5000（10 天前）＋500（2 天前），B 500（10 天前）。
  await payout(A, 5000, "paid", NOW - 10 * DAY);
  await payout(A, 500, "paid", NOW - 2 * DAY);
  await payout(A, 500, "pending", null);
  await payout(B, 500, "paid", NOW - 10 * DAY);
  await payout(B, 500, "failed", null);

  // 歸因：M1、M2 經 A；M3、M4 經 B。
  const [m1, m2, m3, m4] = members as [string, string, string, string];
  const r1 = NOW - 40 * DAY, r2 = NOW - 38 * DAY, r3 = NOW - 15 * DAY, r4 = NOW - 3 * DAY;
  await attribute(m1, A, CODE_A, cId, r1, r1 + HOUR);
  await attribute(m2, A, CODE_A, cId, r2, r2 + HOUR);
  await attribute(m3, B, CODE_B, cId, r3, null);
  await attribute(m4, B, CODE_B, cId, r4, r4 + HOUR);
  await active(m1, day(r1) + 8); // D7 內
  await active(m1, day(r1) + 31); // D30 內
  for (const d of [6, 14, 29, 37]) await active(m2, day(r2) + d); // 都在窗外
  await active(m3, day(r3) + 13); // D7 最後一天
  await active(m4, day(r4) + 1);
  // M1 在 A 的卡上有對話；M2 只在別張卡上有。
  await run("INSERT INTO member_conversations (member_id, provider, role_id, conversation_id, created_at, updated_at) VALUES (?, 'harbor', 'role-a', 'c1', 1, 1)", m1);
  await run("INSERT INTO member_conversations (member_id, provider, role_id, conversation_id, created_at, updated_at) VALUES (?, 'harbor', 'role-z', 'c2', 1, 1)", m2);

  await visits(CODE_A, day(NOW) - 5, 5);
  await visits(CODE_A, day(NOW) - 4, 3);
  await visits(CODE_B, day(NOW) - 4, 2);

  // 另一個活動：不進本活動的任何數字，只進點數池的近 7 天消耗（池是共用的）。
  const other = await campaign("other");
  const X = await content(other, "別的", CODE_X);
  await payout(X, 1000, "paid", NOW - 1 * DAY);
  await visits(CODE_X, day(NOW) - 1, 100);
});
afterEach(() => restoreUpstream());

const zeros = (keys: readonly string[], v: unknown) => Object.fromEntries(keys.map((k) => [k, v]));
const PLATFORMS = ["qq_group", "tieba", "bahamut", "moments", "video", "forum", "other"] as const;

describe("活動統計", () => {
  it("漏斗：位置數依狀態、依申請／核准檔位、依平台；有 paid 發放的內容數", async () => {
    const r = await stats();
    expect(r.status).toBe(200);
    expect(r.headers.get("Cache-Control")).toBe("private, no-store");
    const { funnel } = await json(r);
    // needsInfo／resubmitted 是「曾經到過」：pB1、pB5、pB6 被要求補件過，pB1、pB6 重送過；approved／rejected 是現在的狀態。
    expect(funnel).toMatchObject({ submitted: 10, needsInfo: 3, resubmitted: 2, approved: 3, rejected: 4, paidContents: 2 });
    expect(funnel.byTier).toEqual({ light: { submitted: 8, approved: 1 }, original: { submitted: 1, approved: 1 }, guide: { submitted: 1, approved: 1 }, video: { submitted: 0, approved: 0 } });
    expect(funnel.byPlatform).toEqual({
      ...zeros(PLATFORMS, { submitted: 0, approved: 0 }),
      tieba: { submitted: 1, approved: 1 }, qq_group: { submitted: 1, approved: 1 }, bahamut: { submitted: 2, approved: 1 }, forum: { submitted: 4, approved: 0 }, other: { submitted: 2, approved: 0 },
    });
  });

  it("審核：第一次決定的中位數與 P90（取最近名次）、依決定者、拒絕理由前十、重複率", async () => {
    const { review } = await json(await stats());
    // 九個第一次決定：1..9 小時。中位數＝第 ceil(4.5)=5 名，P90＝第 ceil(8.1)=9 名。
    expect(review.firstDecisionMedianMs).toBe(5 * HOUR);
    expect(review.firstDecisionP90Ms).toBe(9 * HOUR);
    expect(review.byActor).toEqual({ human: 6, ai: 4 }); // 重送的稽核不算決定
    expect(review.pending).toBe(2); // pB6 重送中、pB7 待審
    // 原文去頭尾空白後比對；同次數依字母排。補件理由不算。
    expect(review.rejectReasons).toEqual([{ reason: "重複投稿", count: 2 }, { reason: "Another reason", count: 1 }, { reason: "Bad link", count: 1 }]);
    expect(review.duplicateRate).toBe(0.2);
  });

  it("支出：依內容當下的檔位與平台歸類；依結算日；點數池只給管理員", async () => {
    const { spend } = await json(await stats("admin"));
    expect(spend.paidTotal).toBe(6000);
    expect(spend.byTier).toEqual({ light: 500, original: 0, guide: 5500, video: 0 });
    expect(spend.byPlatform).toEqual({ ...zeros(PLATFORMS, 0), multi: 5500, bahamut: 500 });
    const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
    expect(spend.byDay).toEqual([{ day: iso(NOW - 10 * DAY), points: 5500 }, { day: iso(NOW - 2 * DAY), points: 500 }]);
    // 近 7 天消耗含別的活動（池是共用的）：500 + 1000。可撐天數＝70000 ÷ (1500 ÷ 7) 取整。
    expect(spend.pool).toEqual({ balance: 70000, burn7d: 1500, daysLeft: 326 });
  });

  it("成效：訪客、歸因、首玩；留存只算觀察期已滿的人；每留下一人的成本", async () => {
    const { effect } = await json(await stats());
    expect(effect).toMatchObject({
      visitors: 10, attributed: 4, firstPlay: 3,
      d7: { eligible: 3, retained: 2 }, d30: { eligible: 2, retained: 1 },
      costPerD7: 3000, costPerD30: 6000,
    });
  });

  it("留存只算觀察期已滿的人：剛註冊三天的人不進 D7 分母", async () => {
    const [, , , m4] = members as [string, string, string, string];
    // 手造：M4 在 D7 窗內「有」活躍日；觀察期沒滿，分母分子都不算他。
    await active(m4, day(NOW - 3 * DAY) + 8);
    let { effect } = await json(await stats());
    expect(effect.d7).toEqual({ eligible: 3, retained: 2 });
    // 註冊時間挪到剛好滿 14 天：進分母；原本那天的活躍日變成第 12 天，在窗內，算留存。
    await run("UPDATE campaign_attributions SET registered_at = ? WHERE member_id = ?", NOW - 3 * DAY - 11 * DAY, m4);
    ({ effect } = await json(await stats()));
    expect(effect.d7).toEqual({ eligible: 4, retained: 3 });
  });

  it("成效依平台（多個平台歸「多平台」）與前 20 份內容", async () => {
    const { effect } = await json(await stats());
    const empty = { visitors: 0, attributed: 0, firstPlay: 0, d7: { eligible: 0, retained: 0 }, d30: { eligible: 0, retained: 0 }, costPerD7: null, costPerD30: null };
    const a = { visitors: 8, attributed: 2, firstPlay: 2, d7: { eligible: 2, retained: 1 }, d30: { eligible: 2, retained: 1 }, costPerD7: 5500, costPerD30: 5500 };
    const b = { visitors: 2, attributed: 2, firstPlay: 1, d7: { eligible: 1, retained: 1 }, d30: { eligible: 0, retained: 0 }, costPerD7: 500, costPerD30: null };
    expect(effect.byPlatform).toEqual({ ...zeros(PLATFORMS, empty), multi: a, bahamut: b, unreviewed: empty });
    expect(effect.topContents).toEqual([
      { ...a, contentId: A, title: "攻略A", handle: expect.any(String) },
      { ...b, contentId: B, title: "影片B", handle: expect.any(String) },
    ]);
  });

  it("作者：有卡的內容帶來的新玩家，以及其中在這張卡上有對話的人", async () => {
    const { authors } = await json(await stats());
    expect(authors).toEqual([{ cardId: 300001, cardName: "阿卡", attributed: 2, firstPlays: 1 }]);
  });

  it("漏斗是到過的階段：待審 → 補件 → 重送 → 核准，每一階各算 1", async () => {
    const cId = await campaign("walk");
    const x = await content(cId, "走一遍", "WALK0001");
    const p = await placement(x, { platform: "tieba", requested: "light", status: "approved", approved: "light", createdAt: NOW - 5 * DAY });
    await decide(p, NOW - 5 * DAY + HOUR, "human", "needs_info", "請補截圖");
    await resubmit(p, NOW - 5 * DAY + 2 * HOUR);
    await decide(p, NOW - 5 * DAY + 3 * HOUR, "human", "approved");
    const { funnel, review } = await json(await stats("mod", "walk"));
    expect(funnel).toMatchObject({ submitted: 1, needsInfo: 1, resubmitted: 1, approved: 1, rejected: 0 });
    expect(review).toMatchObject({ pending: 0, firstDecisionMedianMs: HOUR, byActor: { human: 2, ai: 0 } });
  });

  it("成效依平台：沒有核准位置的內容歸「未核准」，各桶加起來等於總數", async () => {
    const cId = (await env.DB.prepare("SELECT id FROM campaigns WHERE slug = 'launch'").first<string>("id"))!;
    const C = await content(cId, "還沒審", "CCCC3333");
    await placement(C, { platform: "tieba", requested: "light", status: "submitted", createdAt: NOW - 20 * DAY });
    const m5 = await makeMember(66015);
    await attribute(m5, C, "CCCC3333", cId, NOW - 20 * DAY, null);
    await visits("CCCC3333", day(NOW) - 3, 1);
    const { effect } = await json(await stats());
    expect(effect.byPlatform.unreviewed).toEqual({ visitors: 1, attributed: 1, firstPlay: 0, d7: { eligible: 1, retained: 0 }, d30: { eligible: 0, retained: 0 }, costPerD7: null, costPerD30: null });
    const buckets = Object.values(effect.byPlatform) as any[];
    expect(buckets.reduce((a, e) => a + e.attributed, 0)).toBe(effect.attributed);
    expect(buckets.reduce((a, e) => a + e.visitors, 0)).toBe(effect.visitors);
    expect(buckets.reduce((a, e) => a + e.d7.eligible, 0)).toBe(effect.d7.eligible);
  });

  it("作者：卡片沒有中文名時名字是空字串，不會缺欄位", async () => {
    await run("UPDATE cards SET names = '{}' WHERE id = 300001");
    const { authors } = await json(await stats());
    expect(authors[0].cardName).toBe("");
  });

  it("沒有任何資料的活動：中位數與成本是 null，比率是 0", async () => {
    await campaign("empty");
    const b = await json(await stats("mod", "empty"));
    expect(b.review).toEqual({ pending: 0, firstDecisionMedianMs: null, firstDecisionP90Ms: null, byActor: { human: 0, ai: 0 }, rejectReasons: [], duplicateRate: 0 });
    expect(b.effect).toMatchObject({ visitors: 0, attributed: 0, costPerD7: null, costPerD30: null, topContents: [] });
    expect(b.spend).toMatchObject({ paidTotal: 0, byDay: [] });
    expect(b.authors).toEqual([]);
    expect(b.generatedAt).toEqual(expect.any(Number));
  });

  it("點數池數字只給管理員：一般審核員與 AI 帳號拿到 null，Provider 沒被呼叫", async () => {
    const mod = await stats("mod");
    expect(mod.status).toBe(200);
    expect((await json(mod)).spend.pool).toBeNull();
    const agent = await stats("agent");
    expect(agent.status).toBe(200);
    expect((await json(agent)).spend.pool).toBeNull();
    expect(poolCalls).toBe(0);
    await stats("admin");
    expect(poolCalls).toBe(1);
  });

  it("點數池問不到：pool 是 null，其他數字照樣回", async () => {
    upstream.fetchCampaignPool = async () => { throw new Error("down"); };
    const r = await stats("admin");
    expect(r.status).toBe(200);
    const b = await json(r);
    expect(b.spend.pool).toBeNull();
    expect(b.spend.paidTotal).toBe(6000);
  });

  it("不含成員 id、收款帳號與分享碼", async () => {
    const { generatedAt: _, ...body } = await json(await stats("admin")); // 時間戳的數字可能碰巧含帳號
    const text = JSON.stringify(body);
    for (const id of [owner, ...members]) expect(text).not.toContain(id);
    for (const n of [OWNER, ...M]) expect(text).not.toContain(String(n));
    for (const code of [CODE_A, CODE_B, CODE_X]) expect(text).not.toContain(code);
  });

  it("活動不存在或沒給是 404；不是審核員是 403", async () => {
    const r = await stats("mod", "nope");
    expect(r.status).toBe(404);
    expect((await json(r)).error).toBe("campaign_not_found");
    expect((await call("/v1/moderation/campaign/stats", "mod")).status).toBe(404);
    expect((await stats("owner")).status).toBe(403);
  });
});
