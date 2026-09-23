import { SELF, env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bearer, identities, makeReviewer, resetDb, restoreUpstream, reviewUpstream, role, rolesOnMainSite } from "./helpers";
import { upsertCard } from "../src/cards";
import { upstream } from "../src/upstream";
import { HttpError } from "../src/types";

// HearthRoom 精選卡：審核人裡在供應商那邊是本站管理員的人，替社群把在榜的卡標成精選。
// 標記先送到供應商（那邊管權限、配額、返點等級），成功了本站才畫徽章。
const ADMIN = 20001;
const REVIEWER = 20002;
const STRANGER = 30003;

/** 假供應商：誰是社群代表、每次標記的紀錄。 */
const admins = new Set<string>();
const featuredCalls: { token: string; roleId: string; featured: boolean; provider: string }[] = [];

beforeEach(async () => {
  await resetDb();
  identities({ "admin-token": ADMIN, "rev-token": REVIEWER, "stranger": STRANGER });
  rolesOnMainSite({ roleId: "role-1", authorNumId: 10001 }, { roleId: "role-2", authorNumId: 10001 });
  reviewUpstream();
  admins.clear();
  admins.add("admin-token");
  featuredCalls.length = 0;
  upstream.fetchCommunityStatus = async (_env, token, _provider) =>
    admins.has(token) ? { admin: true, featuredUsed: featuredCalls.filter((c) => c.featured).length, featuredQuota: 50 } : { admin: false, featuredUsed: 0, featuredQuota: 50 };
  upstream.setFeatured = async (_env, token, roleId, featured, provider) => {
    if (!admins.has(token)) throw new HttpError(403, "not_community_admin");
    featuredCalls.push({ token, roleId, featured, provider: provider ?? "harbor" });
  };
  await makeReviewer(ADMIN);
  await makeReviewer(REVIEWER);
  const now = Date.now();
  await upsertCard(env.DB, role({ roleId: "role-1" }), now, { status: "approved", provider: "harbor" });
  await upsertCard(env.DB, role({ roleId: "role-2" }), now, { status: "pending", provider: "harbor" });
});
afterEach(restoreUpstream);

const mark = (id: string, featured: boolean, token: string) =>
  SELF.fetch(`https://c.test/v1/review/cards/${id}/featured`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...bearer(token) },
    body: JSON.stringify({ featured }),
  });
const cardOf = async (id: string) => (await (await SELF.fetch(`https://c.test/v1/cards/${id}?_=${Math.random()}`)).json()) as { featured: boolean };

describe("HearthRoom 精選卡", () => {
  it("審核面板知道誰能標：管理員看得到配額，普通審核人看到 admin=false，非審核人不問供應商", async () => {
    const me = async (token: string) => (await (await SELF.fetch("https://c.test/v1/review/me", { headers: bearer(token) })).json()) as any;
    expect(await me("admin-token")).toMatchObject({ reviewer: true, featured: { admin: true, featuredUsed: 0, featuredQuota: 50 } });
    expect(await me("rev-token")).toMatchObject({ reviewer: true, featured: { admin: false, featuredUsed: 0, featuredQuota: 50 } });
    expect(await me("stranger")).toMatchObject({ reviewer: false, featured: null });
  });

  it("管理員標記後：先同步到供應商，本站再畫徽章；取消也一樣", async () => {
    const res = await mark("role-1", true, "admin-token");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ featured: true });
    expect(featuredCalls).toEqual([{ token: "admin-token", roleId: "role-1", featured: true, provider: "harbor" }]);
    expect((await cardOf("role-1")).featured).toBe(true);
    expect((await mark("role-1", false, "admin-token")).status).toBe(200);
    expect((await cardOf("role-1")).featured).toBe(false);
  });

  it("供應商說不是社群代表就 403，本站不留任何痕跡", async () => {
    expect((await mark("role-1", true, "rev-token")).status).toBe(403);
    expect(featuredCalls).toHaveLength(0);
    expect((await cardOf("role-1")).featured).toBe(false);
  });

  it("非審核人 403、沒登入 401、不在榜的卡 404、非布林 400", async () => {
    expect((await mark("role-1", true, "stranger")).status).toBe(403);
    expect((await SELF.fetch("https://c.test/v1/review/cards/role-1/featured", { method: "POST", body: "{}" })).status).toBe(401);
    expect((await mark("role-2", true, "admin-token")).status).toBe(404);
    const bad = await SELF.fetch("https://c.test/v1/review/cards/role-1/featured", {
      method: "POST", headers: { "Content-Type": "application/json", ...bearer("admin-token") }, body: JSON.stringify({ featured: "yes" }),
    });
    expect(bad.status).toBe(400);
  });

  it("供應商配額用完時把原因帶回來", async () => {
    upstream.setFeatured = async () => { throw new HttpError(409, "featured_quota_exceeded"); };
    const res = await mark("role-1", true, "admin-token");
    expect(res.status).toBe(409);
    expect(await res.text()).toContain("featured_quota_exceeded");
    expect((await cardOf("role-1")).featured).toBe(false);
  });
});
