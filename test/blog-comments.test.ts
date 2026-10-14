import { approveFixtureResponse } from "./hosted-fixture";
import { SELF, env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bearer, identities, makeMember, makeReviewer, ratingBody, resetDb, restoreUpstream, rolesOnMainSite } from "./helpers";

// 文章留言：沿用卡片留言與計畫 2 的審核；只有公開文章有留言區，關閉留言只擋寫，置頂留言讀取時判斷。
const AUTHOR = 61001, EDITOR = 61002, FAN = 61003, OTHER = 61004, MOD = 61005;

const json = async (r: Response) => (await r.json()) as any;
const op = () => crypto.randomUUID();
const send = (path: string, token: string | null, method = "GET", body?: unknown) =>
  SELF.fetch("https://c.test" + path, {
    method,
    headers: { ...(token ? bearer(token) : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

let postId = "";
let cardId = "";
const list = (token: string | null = null, q = "") => send(`/v1/blog/posts/${postId}/comments${q}`, token);
const post = (token: string, body: Record<string, unknown>) => send(`/v1/blog/posts/${postId}/comments`, token, "POST", body);
const say = async (token: string, content: string, extra: Record<string, unknown> = {}) => (await json(await post(token, { content, ...extra }))).commentId as string;
const state = (change: Record<string, unknown>) => send(`/v1/blog/admin/posts/${postId}/state`, "editor", "POST", { change, operationId: op() });
const decide = (id: string, action: string) => send(`/v1/moderation/comments/${id}/decision`, "mod", "POST", { action, reason: "理由", operationId: op() });
const memberOf = (n: number) => `member-${n}`;
const revision = async () => (await env.DB.prepare("SELECT comment_revision AS r FROM cards WHERE id = ?").bind(cardId).first<{ r: string }>())!.r;

beforeEach(async () => {
  await resetDb();
  identities({ "author-token": AUTHOR, editor: EDITOR, fan: FAN, other: OTHER, mod: MOD });
  await env.DB.prepare("UPDATE reviewers SET role='manager' WHERE member_id=?").bind(await makeReviewer(EDITOR)).run();
  await makeReviewer(MOD);
  await makeMember(FAN);
  await makeMember(OTHER);
  const col = await json(await send("/v1/blog/admin/columns", "editor", "POST", { slug: "news", name: { "zh-Hant": "最新消息" }, description: {}, sort: 0, enabled: true, operationId: op() }));
  const created = await json(await send("/v1/blog/admin/posts", "editor", "POST", { columnId: col.id, slug: "hello", locale: "zh-Hant", title: "開站了", excerpt: "", bodyMd: "內容", operationId: op() }));
  postId = created.id;
  expect((await state({ status: "published" })).status).toBe(200);
  rolesOnMainSite({ roleId: "role-1", authorNumId: AUTHOR });
  const card = await approveFixtureResponse(await SELF.fetch("https://c.test/v1/cards", {
    method: "POST", headers: { "Content-Type": "application/json", ...bearer("author-token") }, body: JSON.stringify({ operationId: op(), roleId: "role-1", ...ratingBody(false) }),
  }));
  cardId = (await json(card)).id;
});
afterEach(() => restoreUpstream());

describe("文章留言", () => {
  it("公開文章可以留言、回覆；回覆通知指向文章；未公開的文章沒有留言區", async () => {
    const root = await say("fan", "第一則");
    const reply = await post("other", { content: "回你", rootId: root, parentId: root });
    expect(reply.status).toBe(201);
    const body = await json(await list());
    expect(body.total).toBe(1);
    expect(body.pinnedCommentId).toBeNull();
    expect(body.comments[0]).toMatchObject({ content: "第一則", replyCount: 1, official: false, isCreator: false });
    expect(body.comments[0].replies[0]).toMatchObject({ content: "回你", replyToNickName: expect.any(String) });
    const replies = await json(await send(`/v1/blog/posts/${postId}/comments/${root}/replies`, null));
    expect(replies.total).toBe(1);
    expect((await json(await send(`/v1/blog/posts/${postId}/comments/count`, null))).count).toBe(1);
    const n = await env.DB.prepare("SELECT path, card_id FROM community_notifications WHERE kind = 'comment_reply' AND member_id = ?").bind(memberOf(FAN)).first();
    expect(n).toEqual({ path: `/blog/p/${postId}`, card_id: null });
    expect(await env.DB.prepare("SELECT card_id, post_id FROM comments WHERE id = ?").bind(root).first()).toEqual({ card_id: 0, post_id: postId });

    expect((await state({ status: "unpublished" })).status).toBe(200);
    expect((await list()).status).toBe(404);
    expect((await post("fan", { content: "還在嗎" })).status).toBe(404);
    expect((await send(`/v1/blog/posts/${postId}/comments/count`, null)).status).toBe(404);
    expect((await send(`/v1/blog/posts/${postId}/comments/${root}/replies`, null)).status).toBe(404);
  });

  it("留言者本人才能刪；文章作者與審核人看不到刪除，刪除也不行（走審核移除）", async () => {
    const editorSays = await say("editor", "官方說明");
    const fanSays = await say("fan", "讀者");
    const asMod = await json(await list("mod"));
    expect(asMod.comments.every((c: any) => c.canDelete === false)).toBe(true);
    expect((await json(await list("editor"))).comments.find((c: any) => c.commentId === fanSays).canDelete).toBe(false);
    expect((await send(`/v1/comments/${fanSays}`, "mod", "DELETE")).status).toBe(403);
    expect((await send(`/v1/comments/${fanSays}`, "editor", "DELETE")).status).toBe(403);
    expect((await json(await list("fan"))).comments.find((c: any) => c.commentId === fanSays).canDelete).toBe(true);
    expect((await send(`/v1/comments/${fanSays}`, "fan", "DELETE")).status).toBe(204);
    expect((await send(`/v1/comments/${editorSays}`, "editor", "DELETE")).status).toBe(204);
    expect((await json(await list())).total).toBe(0);
  });

  it("關閉留言：既有留言照常顯示，新留言與回覆都回 403", async () => {
    const root = await say("fan", "關之前");
    expect((await state({ commentsClosed: true })).status).toBe(200);
    expect((await json(await list())).comments[0].content).toBe("關之前");
    const fresh = await post("other", { content: "新的" });
    expect(fresh.status).toBe(403);
    expect((await json(fresh)).error).toBe("blog_comments_closed");
    const reply = await post("other", { content: "回覆", rootId: root, parentId: root });
    expect(reply.status).toBe(403);
    expect((await json(reply)).error).toBe("blog_comments_closed");
  });

  it("命中關鍵詞的文章留言進待審，佇列標出文章；放行後被回覆的人收到指向文章的通知", async () => {
    const root = await say("fan", "頂層");
    await env.DB.prepare("INSERT INTO comment_keywords VALUES ('k1','違禁','test',1)").run();
    const held = await json(await post("other", { content: "違禁回覆", rootId: root, parentId: root }));
    expect(held.status).toBe("held");
    const queue = await json(await send("/v1/moderation/comments?tab=held", "mod"));
    expect(queue.total).toBe(1);
    expect(queue.items[0]).toMatchObject({ id: held.commentId, target: { kind: "post", id: postId, title: "開站了", column: "news", slug: "hello" } });
    expect((await decide(held.commentId, "release")).status).toBe(200);
    const n = await env.DB.prepare("SELECT path, card_id FROM community_notifications WHERE kind = 'comment_reply' AND member_id = ?").bind(memberOf(FAN)).first();
    expect(n).toEqual({ path: `/blog/p/${postId}`, card_id: null });
  });

  it("待審的文章留言算進其他審核人的徽章數，自己的不算", async () => {
    const summary = async (token: string) => (await json(await send("/v1/moderation/summary", token))).comments;
    await env.DB.prepare("INSERT INTO comment_keywords VALUES ('k1','違禁','test',1)").run();
    expect((await json(await post("fan", { content: "違禁一" }))).status).toBe("held");
    expect(await summary("mod")).toBe(1);
    expect((await json(await post("mod", { content: "違禁二" }))).status).toBe("held");
    expect(await summary("mod")).toBe(1);
    expect(await summary("editor")).toBe(2);
  });

  it("檢舉記成文章目標；移除通知指向文章，卡片的留言版本號不動", async () => {
    const id = await say("fan", "要被檢舉的");
    const before = await revision();
    const r = await send(`/v1/comments/${id}/report`, "other", "POST", { reason: "spam" });
    expect(r.status).toBe(200);
    expect(await env.DB.prepare("SELECT target_kind FROM comment_reports WHERE comment_id = ?").bind(id).first()).toEqual({ target_kind: "post" });
    const reported = await json(await send("/v1/moderation/comments?tab=reported", "mod"));
    expect(reported.items[0]).toMatchObject({ id, target: { kind: "post" }, reports: { total: 1 } });
    expect((await decide(id, "remove")).status).toBe(200);
    expect(await env.DB.prepare("SELECT resolution FROM comment_reports WHERE comment_id = ?").bind(id).first()).toEqual({ resolution: "removed" });
    const n = await env.DB.prepare("SELECT path, card_id FROM community_notifications WHERE kind = 'comment_removed'").first();
    expect(n).toEqual({ path: `/blog/p/${postId}`, card_id: null });
    expect(await revision()).toBe(before);
    expect((await json(await send("/v1/moderation/comments?tab=removed", "mod"))).items[0].target).toMatchObject({ kind: "post", id: postId });
  });

  it("置頂留言在第一頁最上面出現一次，翻頁不重複；被移除後不再置頂", async () => {
    const now = Date.now();
    const ids = Array.from({ length: 25 }, (_, i) => `seed-${String(i).padStart(2, "0")}`);
    await env.DB.batch(ids.map((id, i) =>
      env.DB.prepare("INSERT INTO comments (id, card_id, post_id, member_id, content, created_at) VALUES (?, 0, ?, ?, ?, ?)").bind(id, postId, memberOf(FAN), id, now - 100_000 + i)));
    const pinned = ids[0];
    expect((await state({ pinnedCommentId: pinned })).status).toBe(200);
    const p1 = await json(await list(null, "?page=1"));
    const p2 = await json(await list(null, "?page=2"));
    expect(p1.pinnedCommentId).toBe(pinned);
    expect(p1.total).toBe(25);
    expect(p1.comments[0].commentId).toBe(pinned);
    const seen = [...p1.comments, ...p2.comments].map((c: any) => c.commentId);
    expect(seen.filter((id: string) => id === pinned)).toHaveLength(1);
    expect(new Set(seen).size).toBe(25);
    expect(p1.comments).toHaveLength(20);

    expect((await decide(pinned, "remove")).status).toBe(200);
    const after = await json(await list());
    expect(after.pinnedCommentId).toBeNull();
    expect(after.comments[0].commentId).toBe(ids[24]);
    expect(after.comments.some((c: any) => c.commentId === pinned)).toBe(false);
  });

  it("留言列表跟單篇文章路徑同形：slug 叫 comments 的文章照常讀得到", async () => {
    const col = (await json(await send("/v1/blog/columns", null))).items[0].id;
    const other = await json(await send("/v1/blog/admin/posts", "editor", "POST", { columnId: col, slug: "comments", locale: "zh-Hant", title: "留言規則", excerpt: "", bodyMd: "內容", operationId: op() }));
    expect((await send(`/v1/blog/admin/posts/${other.id}/state`, "editor", "POST", { change: { status: "published" }, operationId: op() })).status).toBe(200);
    const r = await send("/v1/blog/posts/news/comments", null);
    expect(r.status).toBe(200);
    expect((await json(r)).post.title).toBe("留言規則");
    const missing = await send("/v1/blog/posts/nope/comments", null);
    expect([missing.status, (await json(missing)).error]).toEqual([404, "blog_post_not_found"]);
  });

  it("寫作權限者的留言標成官方", async () => {
    await say("editor", "官方回應");
    await say("fan", "讀者");
    const body = await json(await list());
    const byContent = Object.fromEntries(body.comments.map((c: any) => [c.content, c.official]));
    expect(byContent).toEqual({ 官方回應: true, 讀者: false });
  });
});

describe("熱門排序", () => {
  const order = async (path: string) => (await json(await send(path, null))).comments.map((c: any) => c.content);
  // 同一毫秒寫進去的留言排序看 id，這裡把時間拉開。
  const spread = (...ids: string[]) => env.DB.batch(ids.map((id, i) => env.DB.prepare("UPDATE comments SET created_at = ? WHERE id = ?").bind(1_000_000 + i, id)));

  it("文章：讚多的在前，同讚新的在前；預設照時間", async () => {
    const old = await say("fan", "舊的");
    await spread(old, await say("fan", "中間"), await say("other", "新的"));
    expect((await send(`/v1/comments/${old}/like`, "other", "PUT")).status).toBe(204);
    expect(await order(`/v1/blog/posts/${postId}/comments`)).toEqual(["新的", "中間", "舊的"]);
    expect(await order(`/v1/blog/posts/${postId}/comments?sort=hot`)).toEqual(["舊的", "新的", "中間"]);
  });

  it("卡片：讚多的在前，同讚新的在前；預設照時間", async () => {
    const say = async (token: string, content: string) =>
      (await json(await send(`/v1/cards/${cardId}/comments`, token, "POST", { content }))).commentId as string;
    const old = await say("fan", "舊的");
    await spread(old, await say("fan", "中間"), await say("other", "新的"));
    expect((await send(`/v1/comments/${old}/like`, "other", "PUT")).status).toBe(204);
    expect(await order(`/v1/cards/${cardId}/comments`)).toEqual(["新的", "中間", "舊的"]);
    expect(await order(`/v1/cards/${cardId}/comments?sort=hot`)).toEqual(["舊的", "新的", "中間"]);
  });
});
