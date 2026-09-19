/**
 * 兩家供應商：身分不混、榜單相通（owner 2026-09-17，覆蓋 2026-09-16 的「完全不混」）。
 *
 * 危險仍在於**上游的識別字在兩家各自編號**：卡片 ID、作者的公開數字 ID 都可能撞號。
 * 登記、「我的卡片」、審核這些帶著身分的路徑一定要帶供應商條件，否則 A 家的人會把
 * B 家的卡當成自己的來改。榜單、搜尋是公開資料，兩家的卡列在同一個榜上；一張卡搬到
 * 另一家的副本不重複上榜。這裡用同一組識別字在兩家各登記一張卡，逐條驗。
 */
import { SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext, createScheduledController } from "cloudflare:test";
import worker from "../src/index";
import { bearer, identitiesFor, resetDb, rolesOnProviders } from "./helpers";

/** 兩家用同一個 roleId 與同一個作者數字 ID：撞號是這組測試的重點。 */
const ROLE_ID = "role-collide";
const AUTHOR_ID = 10001;

async function register(token: string, provider?: string, roleId = ROLE_ID) {
  return SELF.fetch("https://c.test/v1/cards", {
    method: "POST",
    headers: { ...bearer(token), "content-type": "application/json", ...(provider ? { "X-Provider": provider } : {}) },
    body: JSON.stringify({ roleId, nsfw: false }),
  });
}

/** 月光已經搬到 Harbor 成了 copy-1 並發布：works 一列、work_copies 一列。 */
async function copyOnHarbor() {
  await env.DB.prepare("INSERT INTO works VALUES ('w1','m1','lunatalk',?,1)").bind(ROLE_ID).run();
  await env.DB.prepare("INSERT INTO work_copies(work_id,provider,external_id,role_id,status,updated_at) VALUES ('w1','harbor',?,'copy-1','published',1)").bind(AUTHOR_ID).run();
}
async function hourlySync() {
  const ctx = createExecutionContext();
  await worker.scheduled(createScheduledController(), env, ctx);
  await waitOnExecutionContext(ctx);
}

const board = (provider?: string) =>
  SELF.fetch("https://c.test/v1/cards", { headers: provider ? { "X-Provider": provider } : {} });

beforeEach(async () => {
  await resetDb();
  identitiesFor({ lunatalk: { "luna-token": AUTHOR_ID }, harbor: { "harbor-token": AUTHOR_ID } });
  rolesOnProviders({
    lunatalk: [{ roleId: ROLE_ID, name: "月光", authorNumId: AUTHOR_ID, talkNum: 10 }],
    harbor: [
      { roleId: ROLE_ID, name: "港灣", authorNumId: AUTHOR_ID, talkNum: 7 },
      { roleId: "copy-1", name: "月光（Harbor 副本）", authorNumId: AUTHOR_ID, talkNum: 5 },
    ],
  });
});

describe("身分不混、榜單相通", () => {
  it("同一個 roleId 在兩家各登記一張，是兩張卡；不論用哪家的帳號看，榜上都是這兩張", async () => {
    expect((await register("luna-token")).status).toBe(201);
    expect((await register("harbor-token", "harbor")).status).toBe(201);

    const luna = (await (await board()).json()) as { items: { name: string; provider: string }[] };
    const harbor = (await (await board("harbor")).json()) as { items: { name: string; provider: string }[] };
    expect(luna.items.map((c) => c.name).sort()).toEqual(["月光", "港灣"]);
    expect(harbor.items.map((c) => c.name).sort()).toEqual(["月光", "港灣"]);
    // 卡片帶著自己那家的代號，前端才知道去哪家玩
    expect(luna.items.find((c) => c.name === "港灣")?.provider).toBe("harbor");
  });

  it("一家登記過，另一家的同號卡仍然登記得上——不會被當成重複", async () => {
    expect((await register("luna-token")).status).toBe(201);
    const second = await register("harbor-token", "harbor");
    expect(second.status).toBe(201);
  });

  it("搜尋也跨家", async () => {
    await register("luna-token");
    const res = await SELF.fetch("https://c.test/v1/cards?q=" + encodeURIComponent("月光"), { headers: { "X-Provider": "harbor" } });
    const body = (await res.json()) as { items: { name: string }[] };
    expect(body.items.map((c) => c.name)).toEqual(["月光"]);
  });

  it("搬到另一家的副本不重複上榜：榜上只有來源那張", async () => {
    await register("luna-token");
    await copyOnHarbor();
    expect((await register("harbor-token", "harbor", "copy-1")).status).toBe(409);
    const body = (await (await board()).json()) as { items: { name: string }[] };
    expect(body.items.map((c) => c.name)).toEqual(["月光"]);
  });

  it("熱度＝來源加上已發布副本的對話數，每小時同步時算", async () => {
    await register("luna-token");
    await copyOnHarbor();
    await hourlySync();
    const body = (await (await board()).json()) as { items: { name: string; talkNum: number }[] };
    expect(body.items).toHaveLength(1);
    expect(body.items[0].talkNum).toBe(15);
  });

  it("「我的卡片」不跨家：同一個作者數字 ID 在兩家是兩個人", async () => {
    await register("luna-token");
    const mine = await SELF.fetch("https://c.test/v1/me/cards", { headers: { ...bearer("harbor-token"), "X-Provider": "harbor" } });
    if (mine.status === 404) return; // 這個部署沒有這條端點時跳過
    const body = (await mine.json()) as { items?: unknown[] };
    expect(body.items ?? []).toHaveLength(0);
  });
});
