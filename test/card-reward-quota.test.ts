import { approveFixtureResponse } from "./hosted-fixture";
import { SELF, env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bearer, identities, makeMember, myRolesOnUpstream, ratingBody, resetDb, restoreUpstream, rolesOnMainSite } from "./helpers";
import { quotaFor, weekWindow, weeklyLimitAt } from "../src/quota";

// 創作季第一期：台北 10-17 00:00 到 11-01 00:00。
const START = Date.UTC(2026, 9, 16, 16);
const END = Date.UTC(2026, 9, 31, 16);
const DAY = 86_400_000;
const ALICE = 10001;

async function campaign(over: { startsAt?: number; endsAt?: number; weeklyLimit?: number; status?: string } = {}) {
  const id = crypto.randomUUID();
  const startsAt = over.startsAt ?? START, endsAt = over.endsAt ?? END;
  await env.DB.prepare(
    `INSERT INTO card_reward_campaigns (id, slug, starts_at, ends_at, payout_deadline, weekly_limit, reward, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 10000, ?, 0, 0)`,
  ).bind(id, `t${id.slice(0, 8)}`, startsAt, endsAt, endsAt + 14 * DAY, over.weeklyLimit ?? 6, over.status ?? "active").run();
}

/** 直接落表：觸發器用 registered_at 判斷，這樣才量得到邊界前後一刻。 */
const insertAt = (roleId: string, at: number) =>
  env.DB.prepare("INSERT INTO card_registrations (provider, author_num_id, source_role_id, registered_at) VALUES ('harbor', ?, ?, ?)").bind(ALICE, roleId, at).run();
const accepted = async (roleId: string, at: number) => {
  try {
    await insertAt(roleId, at);
    return true;
  } catch (e) {
    if (String(e).includes("weekly_quota_exceeded")) return false;
    throw e;
  }
};

beforeEach(async () => {
  await resetDb();
  await makeMember(ALICE);
});
afterEach(restoreUpstream);

describe("台北時間換算", () => {
  it("第一期的起訖在台北是 10-17 00:00 與 11-01 00:00", () => {
    const fmt = (t: number) => new Date(t).toLocaleString("sv-SE", { timeZone: "Asia/Taipei" });
    expect(fmt(START)).toBe("2026-10-17 00:00:00");
    expect(fmt(END)).toBe("2026-11-01 00:00:00");
  });
});

describe("活動期間的每週額度", () => {
  it("沒有活動就是 3；期間內是活動設定的值；開始那一刻算期間內，結束那一刻不算", async () => {
    expect(await weeklyLimitAt(env.DB, START)).toBe(3);
    await campaign();
    expect(await weeklyLimitAt(env.DB, START - 1)).toBe(3);
    expect(await weeklyLimitAt(env.DB, START)).toBe(6);
    expect(await weeklyLimitAt(env.DB, END - 1)).toBe(6);
    expect(await weeklyLimitAt(env.DB, END)).toBe(3);
  });

  it("草稿活動不算", async () => {
    await campaign({ status: "draft" });
    expect(await weeklyLimitAt(env.DB, START)).toBe(3);
  });

  it("開始前一刻第 4 張被資料庫擋下；開始那一刻能登到第 6 張，第 7 張擋下", async () => {
    await campaign();
    for (const r of ["a1", "a2", "a3"]) expect(await accepted(r, START - 3)).toBe(true);
    expect(await accepted("a4", START - 1)).toBe(false);
    for (const r of ["a4", "a5", "a6"]) expect(await accepted(r, START)).toBe(true);
    expect(await accepted("a7", START)).toBe(false);
  });

  it("結束前一刻還能登第 6 張；結束那一刻同一週回到 3 張", async () => {
    await campaign();
    for (const r of ["b1", "b2", "b3", "b4", "b5"]) expect(await accepted(r, END - 10)).toBe(true);
    expect(await accepted("b6", END - 1)).toBe(true);
    expect(await accepted("b7", END - 1)).toBe(false);
    // 同一週（UTC 週一 10-26 到 11-02），結束後已經超過 3 張，一張都不能再登
    expect(weekWindow(END)).toEqual(weekWindow(END - 1));
    expect(await accepted("b8", END)).toBe(false);
  });

  it("結束後的下一週，已登 3 張就擋第 4 張", async () => {
    await campaign();
    const next = weekWindow(END).end;
    for (const r of ["c1", "c2", "c3"]) expect(await accepted(r, next)).toBe(true);
    expect(await accepted("c4", next)).toBe(false);
  });

  it("作者看到的額度上限跟著登記那一刻的活動設定", async () => {
    await campaign();
    expect((await quotaFor(env.DB, ALICE, START - 1)).limit).toBe(3);
    expect((await quotaFor(env.DB, ALICE, START)).limit).toBe(6);
    expect((await quotaFor(env.DB, ALICE, END)).limit).toBe(3);
  });
});

describe("登記路由跟著活動額度", () => {
  const register = async (roleId: string) =>
    approveFixtureResponse(await SELF.fetch("https://c.test/v1/cards", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...bearer("alice-token") },
      body: JSON.stringify({ operationId: crypto.randomUUID(), roleId, ...ratingBody(false) }),
    }));

  beforeEach(() => {
    identities({ "alice-token": ALICE });
    rolesOnMainSite(...["r1", "r2", "r3", "r4", "r5", "r6", "r7"].map((roleId) => ({ roleId, authorNumId: ALICE })));
    myRolesOnUpstream({ "alice-token": [] });
  });

  it("活動進行中一週能登 6 張，第 7 張 403 weekly_quota_exceeded；我的卡片顯示上限 6", async () => {
    await campaign({ startsAt: Date.now() - DAY, endsAt: Date.now() + DAY });
    for (const r of ["r1", "r2", "r3", "r4", "r5", "r6"]) expect((await register(r)).status).toBe(201);
    const res = await register("r7");
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "weekly_quota_exceeded" });
    const mine = (await (await SELF.fetch("https://c.test/v1/me/cards", { headers: bearer("alice-token") })).json()) as any;
    expect(mine.quota).toMatchObject({ limit: 6, used: 6 });
  });
});
