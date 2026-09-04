import { SELF, env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bearer, mainSiteDown, resetDb, restoreUpstream, rolesOnMainSite, whoAmI } from "./helpers";

beforeEach(async () => {
  await resetDb();
  whoAmI(10001);
  rolesOnMainSite();
});
afterEach(restoreUpstream);

const register = (body: unknown, headers: Record<string, string> = bearer()) =>
  SELF.fetch("https://c.test/v1/cards", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

const list = async (query = "") => {
  const res = await SELF.fetch(`https://c.test/v1/cards${query}`);
  return { status: res.status, body: (await res.json()) as { items: any[]; total: number } };
};

describe("登記", () => {
  it("轉發作者 token 向上游確認擁有關係，通過就直接上架", async () => {
    rolesOnMainSite({ roleId: "role-1", authorNumId: 10001 });

    const res = await register({ roleId: "role-1" });
    expect(res.status).toBe(201);
    const card = (await res.json()) as any;
    expect(card.name).toBe("夜行偵探");
    expect(card.author.accountNumId).toBe(10001);

    expect((await list()).body.items).toHaveLength(1);
  });

  it("卡不是他的 → 403，且不落庫", async () => {
    whoAmI(20002);
    rolesOnMainSite({ roleId: "role-1", authorNumId: 10001 });

    expect((await register({ roleId: "role-1" })).status).toBe(403);
    const { results } = await env.DB.prepare("SELECT id FROM cards").all();
    expect(results).toHaveLength(0);
  });

  it("沒帶 token → 401，且不打上游", async () => {
    expect((await register({ roleId: "role-1" }, {})).status).toBe(401);
  });

  it("上游說 token 無效 → 401", async () => {
    whoAmI(null);
    expect((await register({ roleId: "role-1" })).status).toBe(401);
  });

  it("上游掛了 → 502，不落庫", async () => {
    mainSiteDown();

    expect((await register({ roleId: "role-1" })).status).toBe(502);
    const { results } = await env.DB.prepare("SELECT id FROM cards").all();
    expect(results).toHaveLength(0);
  });

  it("缺 roleId → 400", async () => {
    expect((await register({})).status).toBe(400);
  });

  // 本站不做內容審核，前提就在這裡：內容根本不經作者的手，沒有可被夾帶的縫。
  it("作者送的內容欄位一律忽略，卡片內容只來自上游", async () => {
    rolesOnMainSite({ roleId: "role-1", authorNumId: 10001, name: "上游的真名" });

    const res = await register({ roleId: "role-1", name: "我自己填的假名", summary: "假簡介", tags: ["假標籤"] });
    const card = (await res.json()) as any;
    expect(card.name).toBe("上游的真名");
    expect(card.tags).toEqual(["推理"]);
  });

  it("上游回應裡的作者詳細設定不會進社群", async () => {
    rolesOnMainSite({ roleId: "role-1", authorNumId: 10001 });
    await register({ roleId: "role-1" });

    const row = (await env.DB.prepare("SELECT * FROM cards").first()) as any;
    expect(JSON.stringify(row)).not.toContain("作者的詳細設定");
    expect(JSON.stringify(row)).not.toContain("開場白");
  });

  it("重複登記同一張 = 更新，不會產生第二筆", async () => {
    rolesOnMainSite({ roleId: "role-1", authorNumId: 10001 });
    expect((await register({ roleId: "role-1" })).status).toBe(201);
    rolesOnMainSite({ roleId: "role-1", authorNumId: 10001, name: "改名後" });
    expect((await register({ roleId: "role-1" })).status).toBe(200);

    const { results } = await env.DB.prepare("SELECT names FROM cards").all();
    expect(results).toHaveLength(1);
    expect((results[0] as any).names).toContain("改名後");
  });

  it("作者可以撤銷自己的登記，別人不行", async () => {
    rolesOnMainSite({ roleId: "role-1", authorNumId: 10001 });
    await register({ roleId: "role-1" });

    whoAmI(20002);
    const stranger = await SELF.fetch("https://c.test/v1/cards/role-1", { method: "DELETE", headers: bearer() });
    expect(stranger.status).toBe(403);

    whoAmI(10001);
    const owner = await SELF.fetch("https://c.test/v1/cards/role-1", { method: "DELETE", headers: bearer() });
    expect(owner.status).toBe(204);
    expect((await list()).body.items).toHaveLength(0);
  });
});

describe("作者主頁", () => {
  it("彙總這個作者在社群登記的卡", async () => {
    rolesOnMainSite(
      { roleId: "role-1", authorNumId: 10001, talkNum: 30 },
      { roleId: "role-2", authorNumId: 10001, talkNum: 12 },
    );
    await register({ roleId: "role-1" });
    await register({ roleId: "role-2" });

    const res = await SELF.fetch("https://c.test/v1/authors/10001");
    expect(res.status).toBe(200);
    const author = (await res.json()) as any;
    expect(author.cardCount).toBe(2);
    expect(author.talkTotal).toBe(42);
    expect(author.name).toBe("月光");

    const own = await list("?author=10001");
    expect(own.body.items).toHaveLength(2);
  });

  it("沒有登記過的作者 → 404", async () => {
    expect((await SELF.fetch("https://c.test/v1/authors/99999")).status).toBe(404);
  });
});
