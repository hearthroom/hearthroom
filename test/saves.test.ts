/**
 * 沙箱卡的存檔：每個成員每張卡自己一份；key 規則、單值上限、key 數上限；讀回整包。
 */
import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { bearer, identities, resetDb } from "./helpers";

beforeEach(async () => {
  await resetDb();
  identities({ "a-token": 10001, "b-token": 20002 });
});

const base = "https://c.test/v1/me/cards/role-1/saves";
const list = async (token = "a-token") => {
  const res = await SELF.fetch(base, { headers: bearer(token) });
  return { status: res.status, body: (await res.json()) as { saves: Record<string, unknown> } };
};
const put = async (key: string, value: unknown, token = "a-token") =>
  SELF.fetch(`${base}/${encodeURIComponent(key)}`, { method: "PUT", headers: { "Content-Type": "application/json", ...bearer(token) }, body: JSON.stringify({ value }) });
const del = async (key: string, token = "a-token") => SELF.fetch(`${base}/${encodeURIComponent(key)}`, { method: "DELETE", headers: bearer(token) });

describe("/v1/me/cards/:roleId/saves", () => {
  it("沒帶 token → 401；空的卡回空包", async () => {
    expect((await SELF.fetch(base)).status).toBe(401);
    const got = await list();
    expect(got.status).toBe(200);
    expect(got.body).toEqual({ saves: {} });
  });

  it("寫、覆寫、刪；讀回整包；別人看不到、別張卡看不到", async () => {
    expect((await put("hp", { cur: 3, max: 5 })).status).toBe(200);
    expect((await put("scene", "forest")).status).toBe(200);
    expect((await put("hp", { cur: 4, max: 5 })).status).toBe(200);
    expect((await list()).body.saves).toEqual({ hp: { cur: 4, max: 5 }, scene: "forest" });
    expect((await list("b-token")).body.saves).toEqual({});
    const other = await SELF.fetch("https://c.test/v1/me/cards/role-2/saves", { headers: bearer("a-token") });
    expect(((await other.json()) as { saves: Record<string, unknown> }).saves).toEqual({});
    expect((await del("scene")).status).toBe(200);
    expect((await list()).body.saves).toEqual({ hp: { cur: 4, max: 5 } });
    const rows = await env.DB.prepare("SELECT COUNT(*) AS n FROM card_saves").first<{ n: number }>();
    expect(rows?.n).toBe(1);
  });

  it("key 含冒號或太長 → key_invalid；沒有 value → value_required；null 可以存", async () => {
    const bad = await put("hp:cur", 1);
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toBe("key_invalid");
    expect((await put("k".repeat(65), 1)).status).toBe(400);
    const missing = await SELF.fetch(`${base}/hp`, { method: "PUT", headers: { "Content-Type": "application/json", ...bearer("a-token") }, body: "{}" });
    expect(((await missing.json()) as { error: string }).error).toBe("value_required");
    expect((await put("cleared", null)).status).toBe(200);
    expect((await list()).body.saves).toEqual({ cleared: null });
  });

  it("單值超過 64 KB → value_too_large；第 11 個 key → saves_full，覆寫既有的不算", async () => {
    const big = await put("big", "x".repeat(64 * 1024));
    expect(((await big.json()) as { error: string }).error).toBe("value_too_large");
    for (let i = 0; i < 10; i++) expect((await put(`k${i}`, i)).status).toBe(200);
    const full = await put("k10", 10);
    expect(full.status).toBe(400);
    expect(((await full.json()) as { error: string }).error).toBe("saves_full");
    expect((await put("k0", "again")).status).toBe(200);
    expect((await list()).body.saves.k0).toBe("again");
  });
});
