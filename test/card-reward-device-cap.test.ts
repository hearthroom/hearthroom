import { approveFixtureResponse } from "./hosted-fixture";
import { SELF, env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appAdmins, bearer, identities, makeMember, makeReviewer, myRolesOnUpstream, ratingBody, resetDb, restoreUpstream, rolesOnMainSite, testHandle } from "./helpers";
import { DEFAULT_DEVICE_CAP_EFFECTIVE_AT, quotaFor, quotaForMember } from "../src/quota";
import { RULE_NOTICE_INSERT_SQL } from "../src/card-reward";
import { hashDeviceToken, recordRewardDevice, trimRewardDevices } from "../src/reward-device";

const EFFECTIVE_AT = Date.UTC(2026, 10, 30, 0, 0, 0); // 2026-11-30 00:00 UTC
const DAY = 86_400_000;
const ALICE = 10001;
const BOB = 20002;
const CHARLIE = 30003;
const MOD = 40004;
const DEV_SHARED = "shared_device_token_0123456789abcdef";
const DEV_OTHER = "other_device_token_fedcba9876543210";

async function seedCampaign(over: { id?: string; slug?: string; startsAt?: number; endsAt?: number; weeklyLimit?: number } = {}) {
  const id = over.id ?? "creator-season-test";
  const slug = over.slug ?? "creator-season";
  const startsAt = over.startsAt ?? EFFECTIVE_AT - 14 * DAY;
  const endsAt = over.endsAt ?? EFFECTIVE_AT + 16 * 3_600_000;
  await env.DB.prepare(
    `INSERT INTO card_reward_campaigns (id, slug, title, starts_at, ends_at, payout_deadline, weekly_limit, reward, status, created_at, updated_at)
     VALUES (?, ?, '{"zh-Hant":"創作季"}', ?, ?, NULL, ?, 20000, 'active', 0, 0)`,
  ).bind(id, slug, startsAt, endsAt, over.weeklyLimit ?? 6).run();
}

async function setPolicy(effectiveAt: number | null, scope: "campaign" | "all" = "campaign") {
  await env.DB.prepare("UPDATE quota_device_policy SET effective_at = ?, scope = ?, updated_at = ? WHERE id = 1")
    .bind(effectiveAt, scope, Date.now()).run();
}

const insertReg = (account: number, roleId: string, at: number, opts: { deviceHash?: string | null; packId?: string | null } = {}) =>
  env.DB.prepare("INSERT INTO card_registrations (provider, author_num_id, source_role_id, registered_at, pack_id, device_hash) VALUES ('harbor', ?, ?, ?, ?, ?)")
    .bind(account, roleId, at, opts.packId ?? null, opts.deviceHash ?? null).run();

async function acceptedReg(account: number, roleId: string, at: number, opts: { deviceHash?: string | null; packId?: string | null } = {}) {
  try {
    await insertReg(account, roleId, at, opts);
    return true;
  } catch (e) {
    if (String(e).includes("weekly_quota_exceeded")) return false;
    throw e;
  }
}

async function grantPack(memberId: string, granted: number): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO registration_packs (id, member_id, granted, reason, granted_by, operation_id, created_at) VALUES (?, ?, ?, 'shared computer', ?, ?, ?)")
    .bind(id, memberId, granted, await makeMember(MOD), id, Date.now()).run();
  return id;
}

const registerCard = async (roleId: string, token: string, device?: string) =>
  approveFixtureResponse(await SELF.fetch("https://c.test/v1/cards", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...bearer(token),
      ...(device ? { "X-Device-Token": device } : {}),
    },
    body: JSON.stringify({ operationId: crypto.randomUUID(), roleId, ...ratingBody(false) }),
  }));

beforeEach(async () => {
  await resetDb();
  await makeMember(ALICE);
  await makeMember(BOB);
  await makeMember(CHARLIE);
  await makeReviewer(MOD);
  identities({ "alice-token": ALICE, "bob-token": BOB, "charlie-token": CHARLIE, "mod-token": MOD });
  rolesOnMainSite(
    ...Array.from({ length: 8 }, (_, i) => ({ roleId: `a${i + 1}`, authorNumId: ALICE })),
    ...Array.from({ length: 8 }, (_, i) => ({ roleId: `b${i + 1}`, authorNumId: BOB })),
    ...Array.from({ length: 8 }, (_, i) => ({ roleId: `c${i + 1}`, authorNumId: CHARLIE })),
  );
  myRolesOnUpstream({ "alice-token": [], "bob-token": [], "charlie-token": [] });
});

afterEach(restoreUpstream);

describe("0144 遷移預設設定與公開活動資訊", () => {
  it("預設生效時間為 2026-11-30 00:00 UTC 且範圍僅限發卡獎活動（campaign）", async () => {
    expect(DEFAULT_DEVICE_CAP_EFFECTIVE_AT).toBe(EFFECTIVE_AT);
    const row = await env.DB.prepare("SELECT effective_at, scope FROM quota_device_policy WHERE id = 1").first<{ effective_at: number; scope: string }>();
    expect(row).toEqual({ effective_at: EFFECTIVE_AT, scope: "campaign" });

    await seedCampaign();
    const res = await SELF.fetch("https://c.test/v1/card-rewards/creator-season");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { deviceCapEffectiveAt: number | null };
    expect(body.deviceCapEffectiveAt).toBe(EFFECTIVE_AT);

    // 活動頁實際呼叫的是 /v1/campaigns/:slug，同樣必須帶出 deviceCapEffectiveAt
    const campaignRes = await SELF.fetch("https://c.test/v1/campaigns/creator-season");
    expect(campaignRes.status).toBe(200);
    const campaignBody = (await campaignRes.json()) as { kind: string; deviceCapEffectiveAt: number | null };
    expect(campaignBody.kind).toBe("card_reward");
    expect(campaignBody.deviceCapEffectiveAt).toBe(EFFECTIVE_AT);
  });
});

describe("HMAC 裝置代碼與 90 天清理", () => {
  it("雜湊為固定格式 v1:<64-hex> 且不存原值；超過 90 天於維護清掉", async () => {
    const h = await hashDeviceToken(env, DEV_SHARED);
    expect(h).toMatch(/^v1:[0-9a-f]{64}$/);
    expect(h).not.toContain(DEV_SHARED);
    expect(await hashDeviceToken(env, "short")).toBeNull();
    expect(await hashDeviceToken({ ...env, REWARD_DEVICE_SECRET: "" }, DEV_SHARED)).toBeNull();

    const oldAt = EFFECTIVE_AT - 91 * DAY;
    await recordRewardDevice(env.DB, `member-${ALICE}`, h, oldAt);
    await recordRewardDevice(env.DB, `member-${BOB}`, h, EFFECTIVE_AT);
    await trimRewardDevices(env.DB, EFFECTIVE_AT);
    const rows = (await env.DB.prepare("SELECT member_id FROM reward_devices ORDER BY member_id").all<{ member_id: string }>()).results;
    expect(rows).toEqual([{ member_id: `member-${BOB}` }]);
  });
});

describe("D1 觸發器與 Worker 兩層一致：時間開關、活動限定、H1 降級與白名單", () => {
  it("生效時間前（暖機期）同裝置兩號仍各自享有 6 張；生效後活動內同裝置合計 6 張", async () => {
    await seedCampaign({ startsAt: EFFECTIVE_AT - 14 * DAY, endsAt: EFFECTIVE_AT + 7 * DAY });
    const h = (await hashDeviceToken(env, DEV_SHARED))!;
    // 生效前前一週（暖機期）
    const beforeWeek = EFFECTIVE_AT - 3 * DAY;
    for (let i = 1; i <= 6; i++) expect(await acceptedReg(ALICE, `pre-a${i}`, beforeWeek, { deviceHash: h })).toBe(true);
    for (let i = 1; i <= 6; i++) expect(await acceptedReg(BOB, `pre-b${i}`, beforeWeek, { deviceHash: h })).toBe(true);

    // 生效後（EFFECTIVE_AT 當週，活動進行中）
    for (let i = 1; i <= 4; i++) expect(await acceptedReg(ALICE, `a${i}`, EFFECTIVE_AT + i, { deviceHash: h })).toBe(true);
    for (let i = 1; i <= 2; i++) expect(await acceptedReg(BOB, `b${i}`, EFFECTIVE_AT + 10 + i, { deviceHash: h })).toBe(true);
    expect(await acceptedReg(BOB, "b3", EFFECTIVE_AT + 20, { deviceHash: h })).toBe(false);
    expect(await acceptedReg(ALICE, "a5", EFFECTIVE_AT + 21, { deviceHash: h })).toBe(false);

    // 不同裝置 Charlie 不受影響
    const hOther = (await hashDeviceToken(env, DEV_OTHER))!;
    for (let i = 1; i <= 6; i++) expect(await acceptedReg(CHARLIE, `c${i}`, EFFECTIVE_AT + i, { deviceHash: hOther })).toBe(true);
  });

  it("非發卡獎活動期間（平時每週 3 張）維持每帳號各自計算，不同裝置合計（PM 裁定①）", async () => {
    // 沒有 active card_reward_campaigns，但時間已過 effective_at
    const h = (await hashDeviceToken(env, DEV_SHARED))!;
    await recordRewardDevice(env.DB, `member-${ALICE}`, h, EFFECTIVE_AT);
    await recordRewardDevice(env.DB, `member-${BOB}`, h, EFFECTIVE_AT);
    for (let i = 1; i <= 3; i++) expect(await acceptedReg(ALICE, `a${i}`, EFFECTIVE_AT + i, { deviceHash: h })).toBe(true);
    expect(await acceptedReg(ALICE, "a4", EFFECTIVE_AT + 10, { deviceHash: h })).toBe(false);
    // 同裝置 Bob 仍有自己的 3 張
    for (let i = 1; i <= 3; i++) expect(await acceptedReg(BOB, `b${i}`, EFFECTIVE_AT + i, { deviceHash: h })).toBe(true);
    expect(await acceptedReg(BOB, "b4", EFFECTIVE_AT + 10, { deviceHash: h })).toBe(false);
  });

  it("H1：已關聯裝置的帳號省略 device_hash 仍合計；從未留過裝置紀錄者退回帳號計", async () => {
    await seedCampaign({ startsAt: EFFECTIVE_AT - DAY, endsAt: EFFECTIVE_AT + 7 * DAY });
    const h = (await hashDeviceToken(env, DEV_SHARED))!;
    await recordRewardDevice(env.DB, `member-${ALICE}`, h, EFFECTIVE_AT - 1000);
    await recordRewardDevice(env.DB, `member-${BOB}`, h, EFFECTIVE_AT - 1000);

    for (let i = 1; i <= 6; i++) expect(await acceptedReg(ALICE, `a${i}`, EFFECTIVE_AT + i, { deviceHash: h })).toBe(true);
    // Bob 刻意不帶 device_hash，仍因 reward_devices 關聯被觸發器擋下
    expect(await acceptedReg(BOB, "b1", EFFECTIVE_AT + 10, { deviceHash: null })).toBe(false);
    // Charlie 從未留過裝置紀錄，不帶 device_hash 退回帳號計，可正常登 6 張
    for (let i = 1; i <= 6; i++) expect(await acceptedReg(CHARLIE, `c${i}`, EFFECTIVE_AT + i, { deviceHash: null })).toBe(true);
  });

  it("補充包登記不吃共用免費額度，且同裝置被擋帳號有補充包仍可登記", async () => {
    await seedCampaign({ startsAt: EFFECTIVE_AT - DAY, endsAt: EFFECTIVE_AT + 7 * DAY });
    const h = (await hashDeviceToken(env, DEV_SHARED))!;
    const alicePack = await grantPack(`member-${ALICE}`, 2);
    const bobPack = await grantPack(`member-${BOB}`, 1);

    for (let i = 1; i <= 5; i++) expect(await acceptedReg(ALICE, `a${i}`, EFFECTIVE_AT + i, { deviceHash: h })).toBe(true);
    // Alice 用補充包多登 1 張，不佔共用免費額度（仍剩 1 張免費）
    expect(await acceptedReg(ALICE, "a6", EFFECTIVE_AT + 6, { deviceHash: h, packId: alicePack })).toBe(true);
    expect(await acceptedReg(BOB, "b1", EFFECTIVE_AT + 7, { deviceHash: h })).toBe(true);
    // 共用免費 6 張已滿，Bob 第 2 張沒包會被擋，帶包可過
    expect(await acceptedReg(BOB, "b2", EFFECTIVE_AT + 8, { deviceHash: h })).toBe(false);
    expect(await acceptedReg(BOB, "b2", EFFECTIVE_AT + 9, { deviceHash: h, packId: bobPack })).toBe(true);
  });
});

describe("HTTP 路由端到端：POST /v1/cards、額度查詢、白名單與站內通知", () => {
  it("同裝置兩帳號透過路由共用創作季 6 張上限，被擋回 device_shared 並寫入指標", async () => {
    const now = Date.now();
    await seedCampaign({ startsAt: now - DAY, endsAt: now + DAY });
    await setPolicy(now - DAY, "campaign");

    for (const r of ["a1", "a2", "a3", "a4"]) expect((await registerCard(r, "alice-token", DEV_SHARED)).status).toBe(201);
    for (const r of ["b1", "b2"]) expect((await registerCard(r, "bob-token", DEV_SHARED)).status).toBe(201);

    // Bob 查詢我的卡片與創作季進度：已用 6/6 且標記 deviceShared: true
    const mine = (await (await SELF.fetch("https://c.test/v1/me/cards", { headers: { ...bearer("bob-token"), "X-Device-Token": DEV_SHARED } })).json()) as any;
    expect(mine.quota).toMatchObject({ limit: 6, used: 6, deviceShared: true });
    const progress = (await (await SELF.fetch("https://c.test/v1/card-rewards/creator-season/me", { headers: { ...bearer("bob-token"), "X-Device-Token": DEV_SHARED } })).json()) as any;
    expect(progress.quota).toMatchObject({ limit: 6, used: 6, deviceShared: true });

    // Bob 送第 3 張（合計第 7 張）被同裝置上限擋下
    const blocked = await registerCard("b3", "bob-token", DEV_SHARED);
    expect(blocked.status).toBe(403);
    expect(await blocked.json()).toEqual({ error: "weekly_quota_exceeded", reason: "device_shared" });

    // Bob 拔掉 X-Device-Token（H1）仍被擋下
    const stripped = await registerCard("b3", "bob-token");
    expect(stripped.status).toBe(403);
    expect(await stripped.json()).toEqual({ error: "weekly_quota_exceeded", reason: "device_shared" });

    // /metrics 有低基數計數器
    const metrics = await (await SELF.fetch("https://c.test/metrics")).text();
    expect(metrics).toContain('hearthroom_card_reward_device_cap_total{operation="check",outcome="blocked_device"}');
  });

  it("共用電腦白名單：核發後雙方互不佔額度，撤銷後恢復共用", async () => {
    const now = Date.now();
    await seedCampaign({ startsAt: now - DAY, endsAt: now + DAY });
    await setPolicy(now - DAY, "campaign");

    const opGrant = crypto.randomUUID();
    const grantRes = await SELF.fetch(`https://c.test/v1/moderation/members/${testHandle(BOB)}/device-quota-exemption`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...bearer("mod-token") },
      body: JSON.stringify({ reason: "Family shared computer verified", operationId: opGrant }),
    });
    expect(grantRes.status).toBe(201);
    const detail = (await grantRes.json()) as any;
    expect(detail.deviceQuotaExempt).toMatchObject({ active: true, reason: "Family shared computer verified" });

    // 冪等重放回 200
    const replayRes = await SELF.fetch(`https://c.test/v1/moderation/members/${testHandle(BOB)}/device-quota-exemption`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...bearer("mod-token") },
      body: JSON.stringify({ reason: "Family shared computer verified", operationId: opGrant }),
    });
    expect(replayRes.status).toBe(200);

    // 不可幫自己開白名單
    const selfRes = await SELF.fetch(`https://c.test/v1/moderation/members/${testHandle(MOD)}/device-quota-exemption`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...bearer("mod-token") },
      body: JSON.stringify({ reason: "self", operationId: crypto.randomUUID() }),
    });
    expect(selfRes.status).toBe(403);

    // 白名單生效：Bob 與 Alice 同裝置各自能登 6 張，互不佔額度
    for (const r of ["b1", "b2", "b3", "b4", "b5", "b6"]) expect((await registerCard(r, "bob-token", DEV_SHARED)).status).toBe(201);
    for (const r of ["a1", "a2", "a3", "a4", "a5", "a6"]) expect((await registerCard(r, "alice-token", DEV_SHARED)).status).toBe(201);
    const aliceQuota = await quotaForMember(env.DB, `member-${ALICE}`, now, await hashDeviceToken(env, DEV_SHARED));
    expect(aliceQuota.deviceShared).toBeUndefined();

    // 撤銷白名單後，Bob 立即與 Alice 共用額度
    const revokeRes = await SELF.fetch(`https://c.test/v1/moderation/members/${testHandle(BOB)}/device-quota-exemption`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json", ...bearer("mod-token") },
      body: JSON.stringify({ reason: "No longer sharing", operationId: crypto.randomUUID() }),
    });
    expect(revokeRes.status).toBe(200);
    expect(((await revokeRes.json()) as any).deviceQuotaExempt).toBeNull();
    const bobAfter = await quotaFor(env.DB, { accountNumId: BOB }, now, "harbor", await hashDeviceToken(env, DEV_SHARED));
    expect(bobAfter.deviceShared).toBe(true);
  });

  it("管理員發送本季作者規則變更站內通知：以 candidates CTE 驅動（不掃 members 全表）、涵蓋初審作者且冪等可續", async () => {
    const now = Date.now();
    await seedCampaign({ id: "creator-season-1", slug: "creator-season", startsAt: now - 7 * DAY, endsAt: now + 7 * DAY });
    appAdmins("mod-token");

    // 驗證查詢計畫以 candidates CTE（card_rewards UNION review_submissions）驅動，不對 members 做外層全表掃描
    const plan = (
      await env.DB.prepare(`EXPLAIN QUERY PLAN ${RULE_NOTICE_INSERT_SQL}`)
        .bind("campaign_quota_device:creator-season:1:", "/campaign/creator-season", now, "{}", "creator-season-1", now - 7 * DAY, now + 7 * DAY)
        .all<{ detail: string }>()
    ).results.map((r) => r.detail);
    expect(plan.some((d) => /\bSCAN m\b/.test(d))).toBe(false);
    expect(plan.some((d) => /COMPOUND QUERY|UNION/i.test(d))).toBe(true);

    // Alice 有本季 card_rewards 紀錄；Bob 有本季紀錄但關了通知；Charlie 僅透過真實送審留下本季初審紀錄（尚無 card_rewards）
    await env.DB.batch([
      env.DB.prepare("INSERT INTO card_rewards (id, campaign_id, work_key, card_id, member_id, recipient_account_no, amount, status, requested_by, created_at, updated_at) VALUES ('rw-1', 'creator-season-1', 'harbor:a1', 100001, ?, ?, 20000, 'paid', 'system', ?, ?)")
        .bind(`member-${ALICE}`, ALICE, now - DAY, now - DAY),
      env.DB.prepare("INSERT INTO card_rewards (id, campaign_id, work_key, card_id, member_id, recipient_account_no, amount, status, requested_by, created_at, updated_at) VALUES ('rw-2', 'creator-season-1', 'harbor:b1', 100002, ?, ?, 20000, 'paid', 'system', ?, ?)")
        .bind(`member-${BOB}`, BOB, now - DAY, now - DAY),
      env.DB.prepare("INSERT INTO community_preferences (member_id, notifications) VALUES (?, 0)").bind(`member-${BOB}`),
    ]);
    rolesOnMainSite({ roleId: "c1", authorNumId: CHARLIE, name: "Charlie First Sub" });
    expect((await registerCard("c1", "charlie-token")).status).toBe(201);

    const op1 = crypto.randomUUID();
    const send = (operationId = crypto.randomUUID(), effectiveAt: unknown = EFFECTIVE_AT) => SELF.fetch("https://c.test/v1/moderation/card-rewards/creator-season/notify-rule-change", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...bearer("mod-token") },
      body: JSON.stringify({ operationId, effectiveAt }),
    });
    // 不合法的 effectiveAt 直接回 400，且不污染 payout 指標
    const bad = await send(crypto.randomUUID(), "2026-11-30");
    expect(bad.status).toBe(400);
    const errMetrics = await (await SELF.fetch("https://c.test/metrics")).text();
    expect(errMetrics).not.toContain('hearthroom_card_reward_operations_total{operation="payout"');
    expect(errMetrics).toContain('hearthroom_card_reward_device_cap_total{operation="notice",outcome="error"}');

    const first = await send(op1, EFFECTIVE_AT);
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ slug: "creator-season", effectiveAt: EFFECTIVE_AT, delivered: 2 });

    // 同 operationId 重試回冪等重放（200，不 500、不重發）
    const replay = await send(op1, EFFECTIVE_AT);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual({ slug: "creator-season", effectiveAt: EFFECTIVE_AT, delivered: 2 });

    // 同 operationId 換參數必須 409 且不寫出新通知
    const conflict = await send(op1, EFFECTIVE_AT + DAY);
    expect(conflict.status).toBe(409);

    // 新 operationId 重送仍由 event_key 冪等（不再多發）
    const second = await send(crypto.randomUUID(), EFFECTIVE_AT);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ slug: "creator-season", effectiveAt: EFFECTIVE_AT, delivered: 0 });

    // 失敗／漏發可續：若 Bob 重新打開通知，新 operationId 只補發給 Bob，Alice／Charlie 不重複
    await env.DB.prepare("UPDATE community_preferences SET notifications = 1 WHERE member_id = ?").bind(`member-${BOB}`).run();
    const resume = await send(crypto.randomUUID(), EFFECTIVE_AT);
    expect(resume.status).toBe(200);
    expect(await resume.json()).toEqual({ slug: "creator-season", effectiveAt: EFFECTIVE_AT, delivered: 1 });

    const notices = (await env.DB.prepare("SELECT member_id, kind, path, extra FROM community_notifications WHERE kind = 'campaign_rule_notice' ORDER BY member_id").all<{ member_id: string; kind: string; path: string; extra: string }>()).results;
    expect(notices).toEqual([
      {
        member_id: `member-${ALICE}`,
        kind: "campaign_rule_notice",
        path: "/campaign/creator-season",
        extra: JSON.stringify({ slug: "creator-season", effectiveAt: EFFECTIVE_AT }),
      },
      {
        member_id: `member-${BOB}`,
        kind: "campaign_rule_notice",
        path: "/campaign/creator-season",
        extra: JSON.stringify({ slug: "creator-season", effectiveAt: EFFECTIVE_AT }),
      },
      {
        member_id: `member-${CHARLIE}`,
        kind: "campaign_rule_notice",
        path: "/campaign/creator-season",
        extra: JSON.stringify({ slug: "creator-season", effectiveAt: EFFECTIVE_AT }),
      },
    ]);
  });
});
