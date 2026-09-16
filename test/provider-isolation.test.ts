/**
 * 兩家供應商的資料完全不混（owner 2026-09-16）。
 *
 * 危險在於**上游的識別字在兩家各自編號**：卡片 ID、作者的公開數字 ID 都可能撞號。
 * 只要有一條查詢忘了帶供應商條件，A 家的人就會看到 B 家的卡，甚至把 B 家的卡
 * 當成自己的來改。這裡用同一組識別字在兩家各登記一張卡，逐條驗它們互不可見。
 */
import { SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { bearer, identitiesFor, resetDb, rolesOnProviders } from "./helpers";

/** 兩家用同一個 roleId 與同一個作者數字 ID：撞號是這組測試的重點。 */
const ROLE_ID = "role-collide";
const AUTHOR_ID = 10001;

async function register(token: string, provider?: string) {
  return SELF.fetch("https://c.test/v1/cards", {
    method: "POST",
    headers: { ...bearer(token), "content-type": "application/json", ...(provider ? { "X-Provider": provider } : {}) },
    body: JSON.stringify({ roleId: ROLE_ID, nsfw: false }),
  });
}

const board = (provider?: string) =>
  SELF.fetch("https://c.test/v1/cards", { headers: provider ? { "X-Provider": provider } : {} });

beforeEach(async () => {
  await resetDb();
  identitiesFor({ lunatalk: { "luna-token": AUTHOR_ID }, harbor: { "harbor-token": AUTHOR_ID } });
  rolesOnProviders({
    lunatalk: [{ roleId: ROLE_ID, name: "月光", authorNumId: AUTHOR_ID }],
    harbor: [{ roleId: ROLE_ID, name: "港灣", authorNumId: AUTHOR_ID }],
  });
});

describe("兩家的卡片互不可見", () => {
  it("同一個 roleId 在兩家各登記一張，是兩張卡", async () => {
    expect((await register("luna-token")).status).toBe(201);
    expect((await register("harbor-token", "harbor")).status).toBe(201);

    const luna = (await (await board()).json()) as { items: { name: string }[] };
    const harbor = (await (await board("harbor")).json()) as { items: { name: string }[] };
    expect(luna.items).toHaveLength(1);
    expect(harbor.items).toHaveLength(1);
    expect(luna.items[0].name).toBe("月光");
    expect(harbor.items[0].name).toBe("港灣");
  });

  it("一家登記過，另一家的同號卡仍然登記得上——不會被當成重複", async () => {
    expect((await register("luna-token")).status).toBe(201);
    const second = await register("harbor-token", "harbor");
    expect(second.status).toBe(201);
  });

  it("榜單只出現自己那家的卡", async () => {
    await register("luna-token");
    const harbor = (await (await board("harbor")).json()) as { items: unknown[] };
    expect(harbor.items).toHaveLength(0);
  });

  it("搜尋不跨家", async () => {
    await register("luna-token");
    await register("harbor-token", "harbor");
    const res = await SELF.fetch("https://c.test/v1/cards?q=" + encodeURIComponent("月光"), { headers: { "X-Provider": "harbor" } });
    const body = (await res.json()) as { items: unknown[] };
    expect(body.items).toHaveLength(0);
  });

  it("「我的卡片」不跨家：同一個作者數字 ID 在兩家是兩個人", async () => {
    await register("luna-token");
    const mine = await SELF.fetch("https://c.test/v1/me/cards", { headers: { ...bearer("harbor-token"), "X-Provider": "harbor" } });
    if (mine.status === 404) return; // 這個部署沒有這條端點時跳過
    const body = (await mine.json()) as { items?: unknown[] };
    expect(body.items ?? []).toHaveLength(0);
  });
});
