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

  it("一張卡的每一版共用同一份存檔：舊版留下的接得上、寫進卡本身、刪掉每一版的同一個 key", async () => {
    const now = Date.now();
    await env.DB.prepare("INSERT INTO cards (id, source_role_id, author_num_id, registered_at, last_synced_at, provider, approved_hosted_role_id) VALUES (100077, 'src-1', 1, ?, ?, 'harbor', 'rev-2')").bind(now, now).run();
    for (const [v, rev] of [["v1", "rev-1"], ["v2", "rev-2"]]) {
      await env.DB.prepare("INSERT INTO hosting_versions (version_id, work_id, member_id, operation_id, source_role_id, provider, nsfw, hosted_revision_id, card_id, state, created_at) VALUES (?, 'w', 'm', ?, 'src-1', 'harbor', 0, ?, 100077, 'approved', ?)").bind(v, v, rev, now).run();
    }
    const member = (await env.DB.prepare("SELECT DISTINCT member_id FROM card_saves").first<{ member_id: string }>())?.member_id;
    expect(member).toBeUndefined();
    // a save written while the card was at its first version (the old per-roleId row)
    const at = (rid: string) => `https://c.test/v1/me/cards/${rid}/saves`;
    await SELF.fetch(`${at("rev-1")}/prefs`, { method: "PUT", headers: { "Content-Type": "application/json", ...bearer("a-token") }, body: JSON.stringify({ value: { seenVer: "1.0" } }) });
    await env.DB.prepare("UPDATE card_saves SET role_id = 'rev-1'").run();
    // the card is approved again: the player now opens rev-2 and still finds it
    const read = async (rid: string) => ((await (await SELF.fetch(at(rid), { headers: bearer("a-token") })).json()) as { saves: Record<string, unknown> }).saves;
    expect(await read("rev-2")).toEqual({ prefs: { seenVer: "1.0" } });
    // writing goes to the card, and the newer value wins over the old version's row
    await SELF.fetch(`${at("rev-2")}/prefs`, { method: "PUT", headers: { "Content-Type": "application/json", ...bearer("a-token") }, body: JSON.stringify({ value: { seenVer: "1.1" } }) });
    expect(await read("rev-2")).toEqual({ prefs: { seenVer: "1.1" } });
    expect(await read("src-1")).toEqual({ prefs: { seenVer: "1.1" } });
    const keys = await env.DB.prepare("SELECT role_id FROM card_saves ORDER BY role_id").all<{ role_id: string }>();
    expect(keys.results.map((r) => r.role_id)).toEqual(["card:100077", "rev-1"]);
    // deleting removes the key from every version, so the old row does not come back
    await SELF.fetch(`${at("rev-2")}/prefs`, { method: "DELETE", headers: bearer("a-token") });
    expect(await read("rev-1")).toEqual({});
  });
});
