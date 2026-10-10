import {approveFixtureResponse} from './hosted-fixture';
import { SELF, env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ratingBody, bearer, resetDb, restoreUpstream, rolesOnMainSite, whoAmI, identities, myRolesOnUpstream, makeMember } from "./helpers";
import { WEEKLY_LIMIT, WEEK_MS, weekWindow } from "../src/quota";

const DAY = 24 * 60 * 60 * 1000;

const register = async (roleId: string, token = "alice-token") =>
  approveFixtureResponse(await SELF.fetch("https://c.test/v1/cards", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...bearer(token) },
    body: JSON.stringify({operationId:crypto.randomUUID(),...({ roleId, ...ratingBody(false) })}),
  }));
const unregister = (roleId: string, token = "alice-token") =>
  SELF.fetch(`https://c.test/v1/cards/${roleId}`, { method: "DELETE", headers: bearer(token) });

beforeEach(async () => {
  await resetDb();
  identities({ "alice-token": 10001, "bob-token": 20002 });
  rolesOnMainSite(
    { roleId: "a1", authorNumId: 10001 },
    { roleId: "a2", authorNumId: 10001 },
    { roleId: "a3", authorNumId: 10001 },
    { roleId: "a4", authorNumId: 10001 },
    { roleId: "a5", authorNumId: 10001 },
    { roleId: "a6", authorNumId: 10001 },
    { roleId: "b1", authorNumId: 20002 },
  );
  myRolesOnUpstream({ "alice-token": [{ roleId: "a1", name: "一" }], "bob-token": [] });
});
afterEach(restoreUpstream);

describe("週的定義", () => {
  it("UTC 週一 00:00 起、下週一 00:00 止；週日算在前一週", () => {
    // 2026-09-07 是週一
    const mon = Date.UTC(2026, 8, 7, 0, 0, 0);
    expect(weekWindow(mon)).toEqual({ start: mon, end: mon + WEEK_MS });
    expect(weekWindow(mon + 3 * DAY + 5 * 60 * 60 * 1000)).toEqual({ start: mon, end: mon + WEEK_MS });
    // 週日 23:59 仍在同一週
    expect(weekWindow(mon + WEEK_MS - 1)).toEqual({ start: mon, end: mon + WEEK_MS });
    // 下週一 00:00 是新的一週
    expect(weekWindow(mon + WEEK_MS)).toEqual({ start: mon + WEEK_MS, end: mon + 2 * WEEK_MS });
  });
});

describe("每週登記額度", () => {
  it(`一週最多 ${WEEKLY_LIMIT} 張，第 ${WEEKLY_LIMIT + 1} 張 403 weekly_quota_exceeded 且不落庫`, async () => {
    expect((await register("a1")).status).toBe(201);
    expect((await register("a2")).status).toBe(201);
    expect((await register("a3")).status).toBe(201);
    const res = await register("a4");
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "weekly_quota_exceeded" });
    const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM cards").first<{ n: number }>();
    expect(row?.n).toBe(3);
  });

  it("撤掉再登同一張不多算；撤掉換一張新的才算——額度數的是不同的卡", async () => {
    await register("a1"); await register("a2"); await register("a3");
    expect((await unregister("a1")).status).toBe(204);
    // 同一張回鍋：不佔額度
    expect((await register("a1")).status).toBe(201);
    // 換一張新的：這週已經有三張不同的卡登記過了
    await unregister("a2");
    expect((await register("a4")).status).toBe(403);
  });

  it("已在榜上的卡再送一次是刷新（200），不佔額度也不被額度擋", async () => {
    await register("a1"); await register("a2"); await register("a3");
    expect((await register("a1")).status).toBe(200);
  });

  it("上週的登記不算在這週", async () => {
    const lastWeek = Date.now() - 8 * DAY;
    await env.DB.batch(
      ["x1", "x2", "x3"].map((id) =>
        env.DB.prepare("INSERT INTO card_registrations (author_num_id, source_role_id, registered_at) VALUES (?, ?, ?)").bind(10001, id, lastWeek),
      ),
    );
    expect((await register("a1")).status).toBe(201);
  });

  it("額度是每個作者各自的", async () => {
    await register("a1"); await register("a2"); await register("a3");
    expect((await register("b1", "bob-token")).status).toBe(201);
  });

  it("我的卡片帶著這週的額度：上限、已用、週起訖", async () => {
    await register("a1"); await register("a2");
    const res = await SELF.fetch("https://c.test/v1/me/cards", { headers: bearer("alice-token") });
    const body = (await res.json()) as any;
    const { start, end } = weekWindow(Date.now());
    expect(body.quota).toEqual({ limit: WEEKLY_LIMIT, used: 2, weekStart: start, weekEnd: end, packRemaining: 0 });
    const listed = await SELF.fetch("https://c.test/v1/me/cards?filter=listed", { headers: bearer("alice-token") });
    expect(((await listed.json()) as any).quota.used).toBe(2);
  });
});

/** 管理員發的補充包：直接落表，端點另有測試（registration-packs.test.ts）。 */
async function grantPack(memberId: string, granted: number, at = Date.now()): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO registration_packs (id, member_id, granted, reason, granted_by, operation_id, created_at) VALUES (?, ?, ?, 'test', ?, ?, ?)")
    .bind(id, memberId, granted, await makeMember(4), id, at).run();
  return id;
}
const packRows = async () => (await env.DB.prepare("SELECT COUNT(*) AS n FROM card_registrations WHERE pack_id IS NOT NULL").first<{ n: number }>())!.n;

describe("登記補充包", () => {
  it("免費 3 張用完後，有補充包就能繼續登記，每張新卡扣一次；扣完回到 403", async () => {
    const alice = await makeMember(10001);
    await grantPack(alice, 2);
    await register("a1"); await register("a2"); await register("a3");
    expect((await register("a4")).status).toBe(201);
    expect((await register("a5")).status).toBe(201);
    expect(await packRows()).toBe(2);
    const res = await register("a6");
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "weekly_quota_exceeded" });
    expect(await packRows()).toBe(2);
  });

  it("免費額度還有就先用免費的，不動補充包", async () => {
    const alice = await makeMember(10001);
    await grantPack(alice, 1);
    await register("a1");
    expect(await packRows()).toBe(0);
    const res = await SELF.fetch("https://c.test/v1/me/cards", { headers: bearer("alice-token") });
    expect(((await res.json()) as any).quota).toMatchObject({ used: 1, packRemaining: 1 });
  });

  it("用補充包登過的卡撤掉再登同一張，不再扣一次", async () => {
    const alice = await makeMember(10001);
    await grantPack(alice, 1);
    await register("a1"); await register("a2"); await register("a3");
    expect((await register("a4")).status).toBe(201);
    expect((await unregister("a4")).status).toBe(204);
    expect((await register("a4")).status).toBe(201);
    expect(await packRows()).toBe(1);
  });

  it("補充包不隨週重置：上週扣掉的這週不會回來，但沒用完的留著", async () => {
    const alice = await makeMember(10001);
    const pack = await grantPack(alice, 2, Date.now() - 20 * DAY);
    await env.DB.prepare("INSERT INTO card_registrations (provider, author_num_id, source_role_id, registered_at, pack_id) VALUES ('harbor', ?, ?, ?, ?)").bind(10001, "old", Date.now() - 8 * DAY, pack).run();
    await register("a1"); await register("a2"); await register("a3");
    expect((await register("a4")).status).toBe(201);
    expect((await register("a5")).status).toBe(403);
  });

  it("我的卡片帶著補充包餘額：免費用量不把補充包算進去", async () => {
    const alice = await makeMember(10001);
    await grantPack(alice, 3);
    await register("a1"); await register("a2"); await register("a3"); await register("a4");
    const res = await SELF.fetch("https://c.test/v1/me/cards", { headers: bearer("alice-token") });
    expect(((await res.json()) as any).quota).toMatchObject({ limit: WEEKLY_LIMIT, used: 3, packRemaining: 2 });
  });

  it("資料庫擋住：別人的補充包、或已扣完的補充包，直接寫也寫不進去", async () => {
    const alice = await makeMember(10001);
    const bob = await makeMember(20002);
    const bobs = await grantPack(bob, 1);
    const insert = (roleId: string, pack: string, author = 10001) =>
      env.DB.prepare("INSERT INTO card_registrations (provider, author_num_id, source_role_id, registered_at, pack_id) VALUES ('harbor', ?, ?, ?, ?)").bind(author, roleId, Date.now(), pack).run();
    await expect(insert("x1", bobs)).rejects.toThrow(/registration_pack_unavailable/);
    const own = await grantPack(alice, 1);
    await insert("x2", own);
    await expect(insert("x3", own)).rejects.toThrow(/registration_pack_unavailable/);
  });
});
