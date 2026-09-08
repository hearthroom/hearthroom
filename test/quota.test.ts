import { SELF, env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bearer, resetDb, restoreUpstream, rolesOnMainSite, whoAmI, identities, myRolesOnUpstream } from "./helpers";
import { WEEKLY_LIMIT, WEEK_MS, weekWindow } from "../src/quota";

const DAY = 24 * 60 * 60 * 1000;

const register = (roleId: string, token = "alice-token") =>
  SELF.fetch("https://c.test/v1/cards", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...bearer(token) },
    body: JSON.stringify({ roleId, nsfw: false }),
  });
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
    expect(body.quota).toEqual({ limit: WEEKLY_LIMIT, used: 2, weekStart: start, weekEnd: end });
    const listed = await SELF.fetch("https://c.test/v1/me/cards?filter=listed", { headers: bearer("alice-token") });
    expect(((await listed.json()) as any).quota.used).toBe(2);
  });
});
