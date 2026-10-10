import { approveFixtureResponse } from "./hosted-fixture";
import { SELF, env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ratingBody, bearer, identities, resetDb, restoreUpstream, rolesOnMainSite } from "./helpers";

// 評分：本站自己的資料，一位成員對一張卡一份 1–5 星，可以改、可以收回。
const AUTHOR = 10001;
const FAN = 20001;
const OTHER = 20002;

let cardId = "";
beforeEach(async () => {
  await resetDb();
  identities({ "author-token": AUTHOR, fan: FAN, other: OTHER });
  rolesOnMainSite({ roleId: "role-1", authorNumId: AUTHOR });
  const res = await approveFixtureResponse(await SELF.fetch("https://c.test/v1/cards", {
    method: "POST", headers: { "Content-Type": "application/json", ...bearer("author-token") }, body: JSON.stringify({ operationId: crypto.randomUUID(), roleId: "role-1", ...ratingBody(false) }),
  }));
  cardId = ((await res.json()) as { id: string }).id;
});
afterEach(() => restoreUpstream());

const json = async (r: Response) => (await r.json()) as any;
const read = (token?: string) => SELF.fetch(`https://c.test/v1/cards/${cardId}/score`, { headers: token ? bearer(token) : {} });
const put = (token: string, score: unknown) =>
  SELF.fetch(`https://c.test/v1/cards/${cardId}/score`, { method: "PUT", headers: { "Content-Type": "application/json", ...bearer(token) }, body: JSON.stringify({ score }) });
const clear = (token: string) => SELF.fetch(`https://c.test/v1/cards/${cardId}/score`, { method: "DELETE", headers: bearer(token) });

describe("評分", () => {
  it("沒人評過：平均是 null、分布全 0；訪客沒有自己的分數", async () => {
    const body = await json(await read());
    expect(body).toEqual({ average: null, count: 0, histogram: [0, 0, 0, 0, 0], mine: null });
  });

  it("一人一份：再評一次是改分，不會多算一票；平均與分布跟著變", async () => {
    expect((await put("fan", 5)).status).toBe(204);
    expect((await put("other", 2)).status).toBe(204);
    expect((await put("fan", 4)).status).toBe(204);
    const body = await json(await read("fan"));
    expect(body).toEqual({ average: 3, count: 2, histogram: [0, 1, 0, 1, 0], mine: 4 });
    expect((await json(await read("other"))).mine).toBe(2);
  });

  it("收回評分", async () => {
    await put("fan", 5);
    expect((await clear("fan")).status).toBe(204);
    expect(await json(await read("fan"))).toMatchObject({ count: 0, mine: null });
  });

  it("只收 1–5 的整數；沒登入不能評；作者不能評自己的卡", async () => {
    for (const bad of [0, 6, 3.5, "5", null]) expect((await put("fan", bad)).status).toBe(400);
    expect((await put("", 5)).status).toBe(401);
    const own = await put("author-token", 5);
    expect(own.status).toBe(403);
    expect((await json(own)).error).toBe("own_card");
  });

  it("不在榜的卡沒有評分", async () => {
    await env.DB.prepare("UPDATE cards SET status = 'needs_review' WHERE id = ?").bind(cardId).run();
    expect((await read()).status).toBe(404);
    expect((await put("fan", 5)).status).toBe(404);
  });

  it("留言帶上留言者給這張卡的星數；沒評過的是 null", async () => {
    await put("fan", 4);
    for (const [token, content] of [["fan", "好玩"], ["other", "還沒評"]] as const) {
      await SELF.fetch(`https://c.test/v1/cards/${cardId}/comments`, { method: "POST", headers: { "Content-Type": "application/json", ...bearer(token) }, body: JSON.stringify({ content }) });
    }
    const list = await json(await SELF.fetch(`https://c.test/v1/cards/${cardId}/comments?page=1`));
    const byContent = Object.fromEntries(list.comments.map((c: any) => [c.content, c.score]));
    expect(byContent).toEqual({ 好玩: 4, 還沒評: null });
  });
});
