import { SELF, env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bearer, resetDb, restoreUpstream, rolesOnMainSite, whoAmI } from "./helpers";

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
  it("登記時發號，從 1 起、依登記順序遞增；卡片回應與榜單都帶著它", async () => {
    rolesOnMainSite({ roleId: "role-a", authorNumId: 10001 }, { roleId: "role-b", authorNumId: 10001 });
    expect(((await (await register("role-a")).json()) as any).num).toBe(1);
    expect(((await (await register("role-b")).json()) as any).num).toBe(2);

    const list = (await (await SELF.fetch("https://c.test/v1/cards?sort=new")).json()) as { items: any[] };
    expect(list.items.map((i) => [i.roleId, i.num])).toEqual([["role-b", 2], ["role-a", 1]]);
  });

  it("用卡號開卡片頁，拿到的是同一張卡；用卡片 ID 開也看得到卡號", async () => {
    rolesOnMainSite({ roleId: "role-a", authorNumId: 10001 });
    await register("role-a");
    const byNum = await card("1");
    expect(byNum.status).toBe(200);
    expect(byNum.body.roleId).toBe("role-a");
    const byId = await card("role-a");
    expect(byId.body.num).toBe(1);
  });

  it("撤銷登記後號碼查不到卡；再登記回來還是原來的號", async () => {
    rolesOnMainSite({ roleId: "role-a", authorNumId: 10001 }, { roleId: "role-b", authorNumId: 10001 });
    await register("role-a");
    await register("role-b");
    expect((await unregister("role-a")).status).toBe(204);
    expect((await card("1")).status).toBe(404);

    expect(((await (await register("role-a")).json()) as any).num).toBe(1);
    expect((await card("1")).body.roleId).toBe("role-a");
  });

  it("沒有這個號 → 404，不會誤認成卡片 ID 去問上游", async () => {
    expect((await card("999")).status).toBe(404);
  });

  it("HTML 殼：用卡號開的頁 canonical 指向卡片 ID 那個網址", async () => {
    rolesOnMainSite({ roleId: "role-a", authorNumId: 10001 });
    await register("role-a");
    const html = await (await SELF.fetch("https://c.test/cards/1")).text();
    expect(html).toContain('<link rel="canonical" href="https://hearthroom.club/cards/role-a">');
  });
});

describe("作者看自己還沒上榜的卡", () => {
  it("沒提交過的卡：帶著作者的 token 開卡片頁，拿到從上游拼的預覽，狀態是 unlisted，不進快取", async () => {
    rolesOnMainSite({ roleId: "role-draft", authorNumId: 10001, name: "草稿卡" });
    const res = await card("role-draft", bearer());
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("草稿卡");
    expect(res.body.status).toBe("unlisted");
    expect(res.body.num).toBeUndefined();
    expect(res.cache).toBe("private, no-store");
  });

  it("不是作者、或沒登入 → 照舊 404", async () => {
    rolesOnMainSite({ roleId: "role-draft", authorNumId: 10001 });
    expect((await card("role-draft")).status).toBe(404);
    whoAmI(20002);
    expect((await card("role-draft", bearer())).status).toBe(404);
  });

  it("提交了還在審的卡：作者看得到、附審核狀態；別人 404", async () => {
    rolesOnMainSite({ roleId: "role-a", authorNumId: 10001 });
    await register("role-a");
    await env.DB.prepare("UPDATE cards SET status = 'pending'").run();
    const mine = await card("role-a", bearer());
    expect(mine.status).toBe(200);
    expect(mine.body.status).toBe("pending");
    expect(mine.body.num).toBe(1);
    expect((await card("role-a")).status).toBe(404);
    expect((await card("1")).status).toBe(404);
  });
});
