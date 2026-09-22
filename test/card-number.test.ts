import { getCard } from '../src/cards';
import { SELF, env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bearer, resetDb, restoreUpstream, rolesOnMainSite, rolesOnProviders, whoAmI } from "./helpers";

/**
 * 卡號與作者自看（玩家回報 2026-09-17）：
 *   - 卡片 ID 是一長串，報卡、搜卡不方便 → 每張登記過的卡一個短數字，撤掉再登記不換號。
 *   - 作者從「我的角色卡」點自己還沒登記的卡的封面掉進 404 → 作者本人看得到預覽。
 */

beforeEach(async () => {
  await resetDb();
  whoAmI(10001);
  rolesOnMainSite();
});
afterEach(restoreUpstream);

const register = (roleId: string, headers: Record<string, string> = bearer()) =>
  SELF.fetch("https://c.test/v1/cards", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ roleId, nsfw: false }),
  });
const unregister = (roleId: string) => SELF.fetch(`https://c.test/v1/cards/${roleId}`, { method: "DELETE", headers: bearer() });
const card = async (id: string, headers: Record<string, string> = {}) => {
  const res = await SELF.fetch(`https://c.test/v1/cards/${id}`, { headers });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as any, cache: res.headers.get("Cache-Control") };
};

describe("卡號", () => {
  it("登記時發號，固定 6 位數從 100001 起、依登記順序遞增；卡片回應與榜單都帶著它", async () => {
    rolesOnMainSite({ roleId: "role-a", authorNumId: 10001 }, { roleId: "role-b", authorNumId: 10001 });
    expect(((await (await register("role-a")).json()) as any).num).toBe(100001);
    expect(((await (await register("role-b")).json()) as any).num).toBe(100002);

    const list = (await (await SELF.fetch("https://c.test/v1/cards?sort=new")).json()) as { items: any[] };
    expect(list.items.map((i) => [i.roleId, i.num])).toEqual([["role-b", 100002], ["role-a", 100001]]);
  });

  it("用卡號開卡片頁，拿到的是同一張卡；用卡片 ID 開也看得到卡號", async () => {
    rolesOnMainSite({ roleId: "role-a", authorNumId: 10001 });
    await register("role-a");
    const byNum = await card("100001");
    expect(byNum.status).toBe(200);
    expect(byNum.body.roleId).toBe("role-a");
    const byId = await card("role-a");
    expect(byId.body.num).toBe(100001);
  });

  it("撤銷登記後號碼查不到卡；再登記回來還是原來的號", async () => {
    rolesOnMainSite({ roleId: "role-a", authorNumId: 10001 }, { roleId: "role-b", authorNumId: 10001 });
    await register("role-a");
    await register("role-b");
    expect((await unregister("role-a")).status).toBe(204);
    expect((await card("100001")).status).toBe(404);

    expect(((await (await register("role-a")).json()) as any).num).toBe(100001);
    expect((await card("100001")).body.roleId).toBe("role-a");
  });

  it("沒有這個號 → 404，不會誤認成卡片 ID 去問上游；平移前的小號也查不到", async () => {
    expect((await card("999")).status).toBe(404);
    expect((await card("1")).status).toBe(404);
  });

  it("既有的號整批平移：舊號 21 變成 100021，之後發的號接在最大號後面", async () => {
    rolesOnMainSite({ roleId: "role-a", authorNumId: 10001 }, { roleId: "role-b", authorNumId: 10001 });
    await register("role-a");
    // 模擬遷移前的狀態：號是 21、序號表停在 21
    await env.DB.batch([
      env.DB.prepare("UPDATE card_numbers SET num = 21"),
      env.DB.prepare("UPDATE sqlite_sequence SET seq = 21 WHERE name = 'card_numbers'"),
    ]);
    // 跟 0015 同一組語句
    await env.DB.batch([
      env.DB.prepare("UPDATE card_numbers SET num = num + 100000 WHERE num < 100000"),
      env.DB.prepare("UPDATE sqlite_sequence SET seq = (SELECT COALESCE(MAX(num), 100000) FROM card_numbers) WHERE name = 'card_numbers'"),
      env.DB.prepare("INSERT INTO sqlite_sequence (name, seq) SELECT 'card_numbers', (SELECT COALESCE(MAX(num), 100000) FROM card_numbers) WHERE NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name = 'card_numbers')"),
    ]);
    expect((await card("100021")).body.roleId).toBe("role-a");
    expect(((await (await register("role-b")).json()) as any).num).toBe(100022);
  });

  it("HTML 殼：用卡號開的頁 canonical 指向卡片 ID 那個網址", async () => {
    rolesOnMainSite({ roleId: "role-a", authorNumId: 10001 });
    await register("role-a");
    const html = await (await SELF.fetch("https://c.test/cards/100001")).text();
    expect(html).toContain(`<link rel="canonical" href="https://hearthroom.club/cards/${(await getCard(env.DB, 'role-a'))!.id}">`);
  });
});

describe("作者看自己還沒上榜的卡", () => {
  it("沒提交過的卡：帶著作者的 token 開卡片頁，拿到從上游拼的預覽，狀態是 unlisted，不進快取", async () => {
    rolesOnProviders({lunatalk:[{ roleId: "role-draft", authorNumId: 10001, name: "草稿卡" }]});
    const res = await card("role-draft", bearer());
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("草稿卡");
    expect(res.body.status).toBe("unlisted");
    expect(res.body.num).toBeUndefined();
    expect(res.cache).toBe("private, no-store");
  });

  it("不是作者或沒登入，仍可透過連結查看草稿", async () => {
    rolesOnProviders({lunatalk:[{ roleId: "role-draft", authorNumId: 10001 }]});
    expect((await card("role-draft")).status).toBe(200);
    whoAmI(20002);
    expect((await card("role-draft", bearer())).status).toBe(200);
  });

  it("提交了還在審的卡：連結顯示審核狀態，訪客也能查看", async () => {
    rolesOnMainSite({ roleId: "role-a", authorNumId: 10001 });
    await register("role-a");
    await env.DB.prepare("UPDATE cards SET status = 'pending'").run();
    const mine = await card("role-a", bearer());
    expect(mine.status).toBe(200);
    expect(mine.body.status).toBe("pending");
    expect(mine.body.num).toBe(100001);
    expect((await card("role-a")).status).toBe(200);
    expect((await card("100001")).status).toBe(200);
  });
});
