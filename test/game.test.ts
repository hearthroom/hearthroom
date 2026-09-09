import { SELF, env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bearer, resetDb, restoreUpstream, rolesOnMainSite, whoAmI } from "./helpers";

beforeEach(async () => {
  await resetDb();
  whoAmI(10001);
  rolesOnMainSite({ roleId: "aaaaaaaa-0000-4000-8000-000000000001", authorNumId: 10001 }, { roleId: "aaaaaaaa-0000-4000-8000-000000000002", authorNumId: 20002 });
});
afterEach(restoreUpstream);

const MINE = "aaaaaaaa-0000-4000-8000-000000000001";
const THEIRS = "aaaaaaaa-0000-4000-8000-000000000002";
const spec = { version: 2, characters: [{ name: "阿罗娜", accessory: "halo-arc", pos: [0, -3] }], environment: { places: [{ match: "办公室", pos: [0, 4], label: "夏莱办公室" }] } };

const put = (roleId: string, body: unknown, headers: Record<string, string> = bearer()) =>
  SELF.fetch(`https://c.test/v1/cards/${roleId}/game`, { method: "PUT", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });

describe("遊戲模式配置", () => {
  it("沒登入不能存", async () => {
    expect((await put(MINE, { spec }, {})).status).toBe(401);
  });

  it("不是這張卡的作者不能存", async () => {
    expect((await put(THEIRS, { spec })).status).toBe(403);
  });

  it("形狀不對回 400 並列出錯在哪", async () => {
    const res = await put(MINE, { spec: { version: 2, characters: [{ name: "x", pos: [1] }], environment: { places: [{ match: "(", pos: [0, 0], label: "a" }] } } });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { errors: string[] };
    expect(body.errors.join("\n")).toMatch(/characters\[0\]\.pos/);
    expect(body.errors.join("\n")).toMatch(/environment\.places\[0\]\.match/);
  });

  it("作者存了之後任何人都讀得到；再存會覆蓋；刪掉就回 404", async () => {
    expect((await SELF.fetch(`https://c.test/v1/cards/${MINE}/game`)).status).toBe(404);
    const saved = await put(MINE, { spec });
    expect(saved.status).toBe(200);
    const read = await SELF.fetch(`https://c.test/v1/cards/${MINE}/game`);
    expect(read.status).toBe(200);
    const body = (await read.json()) as { spec: { characters: { name: string }[] } };
    expect(body.spec.characters[0].name).toBe("阿罗娜");
    const row = await env.DB.prepare("SELECT author_num_id FROM game_worlds WHERE role_id = ?").bind(MINE).first<{ author_num_id: number }>();
    expect(row?.author_num_id).toBe(10001);

    await put(MINE, { spec: { ...spec, characters: [{ name: "早濑优香" }] } });
    const again = (await (await SELF.fetch(`https://c.test/v1/cards/${MINE}/game?_=2`)).json()) as { spec: { characters: { name: string }[] } };
    expect(again.spec.characters[0].name).toBe("早濑优香");

    expect((await SELF.fetch(`https://c.test/v1/cards/${MINE}/game`, { method: "DELETE", headers: bearer() })).status).toBe(200);
    expect((await SELF.fetch(`https://c.test/v1/cards/${MINE}/game?_=3`)).status).toBe(404);
  });
});
