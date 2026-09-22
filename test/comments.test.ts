import {approveFixtureResponse} from './hosted-fixture';
import { SELF, env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bearer, identities, makeReviewer, resetDb, restoreUpstream, rolesOnMainSite } from "./helpers";

// 留言是本站自己的資料：掛在本站的卡上、寫的人是本站成員，供應商不參與。
const AUTHOR = 10001;
const FAN = 20001;
const OTHER = 20002;
const MOD = 30001;

let cardId = "";
beforeEach(async () => {
  await resetDb();
  identities({ "author-token": AUTHOR, "fan": FAN, "other": OTHER, "mod": MOD });
  rolesOnMainSite({ roleId: "role-1", authorNumId: AUTHOR });
  const res = await approveFixtureResponse(await SELF.fetch("https://c.test/v1/cards", {
    method: "POST", headers: { "Content-Type": "application/json", ...bearer("author-token") }, body: JSON.stringify({operationId:crypto.randomUUID(),...({ roleId: "role-1", nsfw: false })}),
  }));
  cardId = ((await res.json()) as { id: string }).id;
});
afterEach(() => restoreUpstream());

const json = async (r: Response) => (await r.json()) as any;
const list = (token?: string, page = 1) => SELF.fetch(`https://c.test/v1/cards/${cardId}/comments?page=${page}`, { headers: token ? bearer(token) : {} });
const post = (token: string, body: Record<string, unknown>) =>
  SELF.fetch(`https://c.test/v1/cards/${cardId}/comments`, { method: "POST", headers: { "Content-Type": "application/json", ...bearer(token) }, body: JSON.stringify(body) });
const say = async (token: string, content: string, extra: Record<string, unknown> = {}) => (await json(await post(token, { content, ...extra }))).commentId as string;
const like = (token: string, id: string, on = true) => SELF.fetch(`https://c.test/v1/comments/${id}/like`, { method: on ? "PUT" : "DELETE", headers: bearer(token) });
const del = (token: string, id: string) => SELF.fetch(`https://c.test/v1/comments/${id}`, { method: "DELETE", headers: bearer(token) });

describe("發表與列表", () => {
  it("訪客讀得到；沒登入不能寫；留言者用本站的公開 ID，不帶供應商身分", async () => {
    expect((await post("", { content: "hi" })).status).toBe(401);
    expect((await post("fan", { content: "  第一則  " })).status).toBe(201);
    const body = await json(await list());
    expect(body.total).toBe(1);
    expect(body.comments[0]).toMatchObject({ content: "第一則", likeCount: 0, replyCount: 0, isLiked: false, isOwner: false, isCreator: false, canDelete: false });
    expect(body.comments[0].handle).toMatch(/^[a-z]{8}$/);
    expect(Date.parse(body.comments[0].createTime)).not.toBeNaN();
    expect(JSON.stringify(body)).not.toContain(String(FAN));
  });

  it("空白、超過 500 字不收；不在榜的卡沒有留言區", async () => {
    expect((await post("fan", { content: "   " })).status).toBe(400);
    const long = await post("fan", { content: "字".repeat(501) });
    expect(long.status).toBe(400);
    expect((await json(long)).error).toBe("comment_too_long");
    expect((await post("fan", { content: "字".repeat(500) })).status).toBe(201);
    await env.DB.prepare("UPDATE cards SET status = 'needs_review' WHERE id = ?").bind(cardId).run();
    expect((await list()).status).toBe(404);
    expect((await post("fan", { content: "hi" })).status).toBe(404);
  });

  it("一分鐘最多 6 則", async () => {
    for (let i = 0; i < 6; i++) expect((await post("fan", { content: `第 ${i} 則` })).status).toBe(201);
    const res = await post("fan", { content: "第七則" });
    expect(res.status).toBe(429);
    expect((await json(res)).error).toBe("comment_rate_limited");
    // 別人不受影響
    expect((await post("other", { content: "我還能說" })).status).toBe(201);
  });

  it("新的在前、一頁 20 則；作者的留言帶作者標記、作者看得到 isRoleCreator", async () => {
    // 直接灌 25 則舊留言（繞過頻率限制）
    const fan = await env.DB.prepare("SELECT member_id FROM member_identities WHERE external_id = ?").bind(String(FAN)).first<{ member_id: string }>()
      ?? (await say("fan", "seed"), await env.DB.prepare("SELECT member_id FROM member_identities WHERE external_id = ?").bind(String(FAN)).first<{ member_id: string }>());
    await env.DB.prepare("DELETE FROM comments").run();
    await env.DB.batch(Array.from({ length: 25 }, (_, i) =>
      env.DB.prepare("INSERT INTO comments (id, card_id, member_id, content, created_at) VALUES (?, ?, ?, ?, ?)").bind(`c-${i}`, cardId, fan!.member_id, `n${i}`, 1000 + i)));
    const p1 = await json(await list());
    expect(p1.total).toBe(25);
    expect(p1.comments).toHaveLength(20);
    expect(p1.comments[0].content).toBe("n24");
    expect((await json(await list(undefined, 2))).comments.map((c: any) => c.content)).toEqual(["n4", "n3", "n2", "n1", "n0"]);

    await say("author-token", "作者來了");
    const asAuthor = await json(await list("author-token"));
    expect(asAuthor.isRoleCreator).toBe(true);
    expect(asAuthor.comments[0]).toMatchObject({ content: "作者來了", isCreator: true, isOwner: true, canDelete: true });
    // 作者能刪別人的留言
    expect(asAuthor.comments[1].canDelete).toBe(true);
    expect((await json(await list("fan"))).isRoleCreator).toBe(false);
  });
});

describe("回覆", () => {
  it("回頂層、回另一則回覆；@對方的名字由本站查，不採信客戶端；回覆數跟著走", async () => {
    const root = await say("fan", "頂層");
    const r1 = await say("other", "回頂層", { rootId: root, parentId: root, replyToNickName: "偽造的名字" });
    const r2 = await say("fan", "回回覆", { rootId: root, parentId: r1 });
    const top = (await json(await list())).comments[0];
    expect(top.replyCount).toBe(2);
    expect(top.replies.map((r: any) => r.content)).toEqual(["回頂層", "回回覆"]);
    expect(JSON.stringify(top)).not.toContain("偽造的名字");
    const replies = await json(await SELF.fetch(`https://c.test/v1/cards/${cardId}/comments/${root}/replies`));
    expect(replies.total).toBe(2);
    const second = replies.replies.find((r: any) => r.commentId === r2);
    expect(second).toMatchObject({ parentId: r1, rootId: root });
    expect(second.replyToNickName).toBe(replies.replies[0].accountNickName);
  });

  it("回一則不存在、已刪、或別張卡的留言 → 404；回覆預覽最多 3 則、讚多的在前", async () => {
    expect((await post("fan", { content: "x", rootId: "nope" })).status).toBe(404);
    const root = await say("fan", "頂層");
    const ids: string[] = [];
    for (const t of ["一", "二", "三", "四"]) ids.push(await say("other", t, { rootId: root }));
    await like("fan", ids[3]!);
    const top = (await json(await list())).comments[0];
    expect(top.replyCount).toBe(4);
    expect(top.replies.map((r: any) => r.content)).toEqual(["四", "一", "二"]);
    await del("fan", root);
    expect((await post("other", { content: "x", rootId: root })).status).toBe(404);
  });
});

describe("讚", () => {
  it("一人一票，重複按不重複算；收回再收回也不會變負數；看的人知道自己按過沒", async () => {
    const id = await say("fan", "讚我");
    expect((await like("", id)).status).toBe(401);
    expect((await like("other", id)).status).toBe(204);
    expect((await like("other", id)).status).toBe(204);
    expect((await json(await list("other"))).comments[0]).toMatchObject({ likeCount: 1, isLiked: true });
    expect((await json(await list("fan"))).comments[0]).toMatchObject({ likeCount: 1, isLiked: false });
    await like("other", id, false);
    await like("other", id, false);
    expect((await json(await list("other"))).comments[0]).toMatchObject({ likeCount: 0, isLiked: false });
    expect((await like("other", "nope")).status).toBe(404);
  });
});

describe("刪除", () => {
  it("本人、卡片作者、站方審核人能刪；別人不行；刪頂層連回覆一起消失，刪回覆只少一則", async () => {
    const root = await say("fan", "頂層");
    const reply = await say("other", "回覆", { rootId: root });
    expect((await del("other", root)).status).toBe(403);
    expect((await del("other", reply)).status).toBe(204);
    expect((await json(await list())).comments[0].replyCount).toBe(0);

    await say("other", "第二則回覆", { rootId: root });
    expect((await del("author-token", root)).status).toBe(204);
    expect((await json(await list())).total).toBe(0);
    expect((await json(await SELF.fetch(`https://c.test/v1/cards/${cardId}/comments/${root}/replies`))).total).toBe(0);
    expect((await del("fan", root)).status).toBe(404);

    await makeReviewer(MOD);
    const spam = await say("fan", "廣告");
    expect((await json(await list("mod"))).comments[0].canDelete).toBe(true);
    expect((await del("mod", spam)).status).toBe(204);
  });
});

describe("成人內容", () => {
  it("留言區跟卡片頁同一道門：沒過門的人讀不到", async () => {
    await say("fan", "成人卡底下的留言");
    await env.DB.prepare("UPDATE cards SET nsfw = 1 WHERE id = ?").bind(cardId).run();
    const res = await list();
    expect(res.status).toBe(403);
    expect((await json(res)).error).toBe("adult_content");
    expect((await SELF.fetch(`https://c.test/v1/cards/${cardId}/comments/count`)).status).toBe(403);
    // 驗過年齡、開了展示的人帶 ?nsfw=1 就讀得到、也寫得了
    const birthdate = `${new Date().getUTCFullYear() - 20}-01-01`;
    await SELF.fetch("https://c.test/v1/me/settings", { method: "POST", headers: { "Content-Type": "application/json", ...bearer("other") }, body: JSON.stringify({ showNsfw: true, birthdate }) });
    const open = await SELF.fetch(`https://c.test/v1/cards/${cardId}/comments?page=1&nsfw=1`, { headers: bearer("other") });
    expect(open.status).toBe(200);
    expect((await json(open)).total).toBe(1);
    const write = await SELF.fetch(`https://c.test/v1/cards/${cardId}/comments?nsfw=1`, { method: "POST", headers: { "Content-Type": "application/json", ...bearer("other") }, body: JSON.stringify({ content: "我也來" }) });
    expect(write.status).toBe(201);
  });
});
