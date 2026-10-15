import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { adjacentPosts, canWritePost, isPublic, listColumns, listRevisions, publicPost, publicPosts, relatedPosts, restoreRevision, saveColumn, savePost, setPostState } from "../src/blog";
import { makeAgent, makeMember, makeReviewer, resetDb } from "./helpers";

const op = () => crypto.randomUUID();
let editor = "";
let columnId = "";
beforeEach(async () => {
  await resetDb();
  editor = await makeReviewer(50001);
  await env.DB.prepare("UPDATE reviewers SET role='manager' WHERE member_id=?").bind(editor).run();
  columnId = (await saveColumn(env.DB, { slug: "news", name: { "zh-Hant": "最新消息" }, description: {}, sort: 0, enabled: true }, { memberId: editor, kind: "human" }, op(), 1)).id;
});
const draft = (over = {}) => savePost(env.DB, { columnId, slug: "hello", locale: "zh-Hant", title: "開站了", excerpt: "第一篇", bodyMd: "# 你好\n\n內容", ...over }, { memberId: editor, kind: "human" }, op(), 10);

describe("權限", () => {
  it("只有 manager／owner 能寫；一般審核人與 AI 帳號不能", async () => {
    expect(await canWritePost(env.DB, editor)).toBe(true);
    expect(await canWritePost(env.DB, await makeReviewer(50002))).toBe(false);
    const agent = await makeAgent(50003);
    await env.DB.prepare("UPDATE reviewers SET role='owner' WHERE member_id=?").bind(agent).run();
    expect(await canWritePost(env.DB, agent)).toBe(false);
    expect(await canWritePost(env.DB, await makeMember(50004))).toBe(false);
  });
});

describe("公開判定", () => {
  it("未到時間的文章對外不存在", async () => {
    const p = await draft();
    await setPostState(env.DB, p.id, { status: "published", publishAt: 1000 }, { memberId: editor, kind: "human" }, op(), 20);
    expect(await publicPost(env.DB, "news", "hello", 999)).toBeNull();
    expect((await publicPosts(env.DB, { page: 1, now: 999 })).total).toBe(0);
    expect((await publicPost(env.DB, "news", "hello", 1000))?.title).toBe("開站了");
    expect(isPublic({ status: "draft", publishAt: 0 } as never, 2000)).toBe(false);
  });

  it("撤下再發布保留網址與首發日期", async () => {
    const p = await draft();
    await setPostState(env.DB, p.id, { status: "published", publishAt: 100 }, { memberId: editor, kind: "human" }, op(), 100);
    await setPostState(env.DB, p.id, { status: "unpublished" }, { memberId: editor, kind: "human" }, op(), 200);
    expect(await publicPost(env.DB, "news", "hello", 300)).toBeNull();
    const again = await setPostState(env.DB, p.id, { status: "published", publishAt: 400 }, { memberId: editor, kind: "human" }, op(), 400);
    expect(again.firstPublishedAt).toBe(100);
    expect((await publicPost(env.DB, "news", "hello", 500))?.id).toBe(p.id);
  });

  it("置頂另列；前後篇與相關文章只看同欄目已公開的", async () => {
    const actor = { memberId: editor, kind: "human" as const };
    const ids: string[] = [];
    for (const [i, slug] of ["a", "b", "c"].entries()) {
      const p = await draft({ slug, title: slug });
      await setPostState(env.DB, p.id, { status: "published", publishAt: 100 + i }, actor, op(), 100 + i);
      ids.push(p.id);
    }
    await draft({ slug: "hidden", title: "hidden" });
    await setPostState(env.DB, ids[0]!, { pinned: true }, actor, op(), 200);
    const list = await publicPosts(env.DB, { page: 1, now: 300 });
    expect(list.pinned.map((p) => p.slug)).toEqual(["a"]);
    expect(list.items.map((p) => p.slug)).toEqual(["c", "b"]);
    expect(list.total).toBe(2);
    expect(list.items[0]).toMatchObject({ columnSlug: "news", readMinutes: 1, commentCount: 0 });
    const b = (await publicPost(env.DB, "news", "b", 300))!;
    const adj = await adjacentPosts(env.DB, b, 300);
    expect([adj.prev?.slug, adj.next?.slug]).toEqual(["a", "c"]);
    expect((await relatedPosts(env.DB, b, 300, 3)).map((p) => p.slug)).toEqual(["c", "a"]);
  });
});

describe("編輯", () => {
  it("每次儲存留一個修訂；可以還原；還原本身也是一次修訂", async () => {
    const p = await draft();
    const v2 = await savePost(env.DB, { id: p.id, expectedVersion: p.version, columnId, slug: "hello", locale: "zh-Hant", title: "改過的標題", excerpt: "", bodyMd: "新內容" }, { memberId: editor, kind: "human" }, op(), 30);
    const revs = await listRevisions(env.DB, p.id);
    expect(revs).toHaveLength(2);
    const first = revs[revs.length - 1]!;
    const restored = await restoreRevision(env.DB, p.id, first.id, { memberId: editor, kind: "human" }, op(), 40);
    expect(restored.title).toBe("開站了");
    expect(restored.version).toBe(v2.version + 1);
    expect(await listRevisions(env.DB, p.id)).toHaveLength(3);
  });

  it("已發布的文章還原舊修訂：網址（欄目與 slug）不動，其餘照還原；草稿照舊連 slug 一起還原", async () => {
    const actor = { memberId: editor, kind: "human" as const };
    const other = (await saveColumn(env.DB, { slug: "guides", name: { "zh-Hant": "教學" }, description: {}, sort: 1, enabled: true }, actor, op(), 2)).id;
    const p = await draft({ slug: "old-slug", title: "舊標題" });
    const v2 = await savePost(env.DB, { id: p.id, expectedVersion: p.version, columnId: other, slug: "new-slug", locale: "zh-Hant", title: "新標題", excerpt: "", bodyMd: "新內容" }, actor, op(), 30);
    const first = (await listRevisions(env.DB, p.id)).at(-1)!;
    const asDraft = await restoreRevision(env.DB, p.id, first.id, actor, op(), 35);
    expect([asDraft.slug, asDraft.columnId, asDraft.title]).toEqual(["old-slug", columnId, "舊標題"]);
    const back = await savePost(env.DB, { id: p.id, expectedVersion: asDraft.version, columnId: other, slug: "new-slug", locale: "zh-Hant", title: v2.title, excerpt: "", bodyMd: "新內容" }, actor, op(), 36);
    await setPostState(env.DB, p.id, { status: "published", publishAt: 5000 }, actor, op(), 5000);
    const live = await restoreRevision(env.DB, p.id, first.id, actor, op(), 40);
    expect([live.slug, live.columnId, live.title]).toEqual(["new-slug", other, "舊標題"]);
    expect(live.version).toBe(back.version + 2);
  });

  it("公開的修改時間只看內容修訂：置頂、留言開關不動它；沒有修訂退回首次發布", async () => {
    const actor = { memberId: editor, kind: "human" as const };
    const p = await draft();
    await setPostState(env.DB, p.id, { status: "published", publishAt: 1000 }, actor, op(), 1000);
    expect((await publicPost(env.DB, "news", "hello", 2000))!.contentUpdatedAt).toBe(10);
    await setPostState(env.DB, p.id, { pinned: true }, actor, op(), 3000);
    await setPostState(env.DB, p.id, { commentsClosed: true }, actor, op(), 3001);
    const pinned = (await publicPost(env.DB, "news", "hello", 4000))!;
    expect([pinned.contentUpdatedAt, pinned.updatedAt]).toEqual([10, 3001]);
    await savePost(env.DB, { id: p.id, expectedVersion: pinned.version, columnId, slug: "hello", locale: "zh-Hant", title: "改", excerpt: "", bodyMd: "" }, actor, op(), 5000);
    expect((await publicPost(env.DB, "news", "hello", 6000))!.contentUpdatedAt).toBe(5000);
    await env.DB.prepare("DELETE FROM blog_post_revisions WHERE post_id = ?").bind(p.id).run();
    expect((await publicPost(env.DB, "news", "hello", 6000))!.contentUpdatedAt).toBe(1000);
  });

  it("同時編輯用版本號擋覆蓋", async () => {
    const p = await draft();
    await savePost(env.DB, { id: p.id, expectedVersion: p.version, columnId, slug: "hello", locale: "zh-Hant", title: "A 先存", excerpt: "", bodyMd: "" }, { memberId: editor, kind: "human" }, op(), 31);
    await expect(savePost(env.DB, { id: p.id, expectedVersion: p.version, columnId, slug: "hello", locale: "zh-Hant", title: "B 後存", excerpt: "", bodyMd: "" }, { memberId: editor, kind: "human" }, op(), 32)).rejects.toMatchObject({ status: 409, message: "blog_version_conflict", extra: { version: 2 } });
  });

  it("同欄目同 slug 不能重複；稽核一筆一筆都有", async () => {
    await draft();
    await expect(draft()).rejects.toMatchObject({ status: 409 });
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE subject_kind IN ('blog_post','blog_column')").first<{ n: number }>();
    expect(n!.n).toBe(2);
  });

  it("封面只收本站 blog/ 的 key", async () => {
    await expect(draft({ coverKey: "avatars/x.webp" })).rejects.toMatchObject({ status: 400, message: "blog_invalid", extra: { field: "coverKey" } });
    expect((await draft({ coverKey: "blog/0b6f.webp" })).coverUrl).toBe("/v1/blog/images/0b6f.webp");
  });

  it("置頂留言必須是這篇底下公開的頂層留言", async () => {
    const p = await draft();
    const actor = { memberId: editor, kind: "human" as const };
    await env.DB.prepare("INSERT INTO comments (id, card_id, post_id, member_id, content, created_at) VALUES ('c1', 0, ?, ?, 't', 1)").bind(p.id, editor).run();
    await expect(setPostState(env.DB, p.id, { pinnedCommentId: "nope" }, actor, op(), 50)).rejects.toMatchObject({ status: 400 });
    expect((await setPostState(env.DB, p.id, { pinnedCommentId: "c1" }, actor, op(), 51)).pinnedCommentId).toBe("c1");
  });
});

describe("欄目", () => {
  it("slug 不能是 p：/blog/p/<id> 是文章短網址", async () => {
    await expect(saveColumn(env.DB, { slug: "p", name: { "zh-Hant": "短" }, description: {}, sort: 1, enabled: true }, { memberId: editor, kind: "human" }, op(), 4)).rejects.toMatchObject({ status: 400, message: "blog_invalid", extra: { field: "slug" } });
  });

  it("停用欄目：文章網址還能開，欄目不在公開列表", async () => {
    const p = await draft();
    await setPostState(env.DB, p.id, { status: "published", publishAt: 1 }, { memberId: editor, kind: "human" }, op(), 2);
    await saveColumn(env.DB, { id: columnId, slug: "news", name: { "zh-Hant": "最新消息" }, description: {}, sort: 0, enabled: false }, { memberId: editor, kind: "human" }, op(), 3);
    expect((await publicPost(env.DB, "news", "hello", 5))?.id).toBe(p.id);
    expect(await listColumns(env.DB, { includeDisabled: false })).toHaveLength(0);
    expect(await listColumns(env.DB, { includeDisabled: true })).toHaveLength(1);
    expect((await publicPosts(env.DB, { page: 1, now: 5 })).total).toBe(0);
    expect((await publicPosts(env.DB, { columnSlug: "news", page: 1, now: 5 })).total).toBe(0);
  });
});

describe("留言目標", () => {
  it("文章留言 card_id 必為 0、卡片留言 card_id 必大於 0", async () => {
    await expect(env.DB.prepare("INSERT INTO comments (id, card_id, post_id, member_id, content, created_at) VALUES ('x', 5, 'p1', 'm', 't', 1)").run()).rejects.toThrow(/comment target invalid/);
    await expect(env.DB.prepare("INSERT INTO comments (id, card_id, member_id, content, created_at) VALUES ('y', 0, 'm', 't', 1)").run()).rejects.toThrow(/comment target invalid/);
  });

  it("文章留言的回覆、放行與按讚通知走文章短網址，card_id 寫 NULL", async () => {
    const a = await makeMember(50010);
    const b = await makeMember(50011);
    await env.DB.batch([
      env.DB.prepare("INSERT INTO comments (id, card_id, post_id, member_id, content, created_at) VALUES ('top', 0, 'p1', ?, 't', 1)").bind(a),
      env.DB.prepare("INSERT INTO comments (id, card_id, post_id, member_id, parent_id, root_id, content, created_at) VALUES ('r1', 0, 'p1', ?, 'top', 'top', 't', 2)").bind(b),
      env.DB.prepare("INSERT INTO comments (id, card_id, post_id, member_id, parent_id, root_id, content, created_at, status) VALUES ('r2', 0, 'p1', ?, 'top', 'top', 't', 3, 'held')").bind(b),
      env.DB.prepare("UPDATE comments SET status='visible', moderated_at=9 WHERE id='r2'"),
      env.DB.prepare("INSERT INTO comment_likes (comment_id, member_id, created_at) VALUES ('top', ?, 4)").bind(b),
    ]);
    const rows = await env.DB.prepare("SELECT event_key, path, card_id, created_at FROM community_notifications ORDER BY event_key").all<{ event_key: string; path: string; card_id: number | null; created_at: number }>();
    expect(rows.results).toEqual([
      { event_key: "comment:r1", path: "/blog/p/p1", card_id: null, created_at: 2 },
      { event_key: "comment:r2", path: "/blog/p/p1", card_id: null, created_at: 9 },
      { event_key: "like:top", path: "/blog/p/p1", card_id: null, created_at: 4 },
    ]);
  });
});

describe("同一個操作編號重送", () => {
  const actor = () => ({ memberId: editor, kind: "human" as const });
  const body = () => ({ columnId, slug: "hello", locale: "zh-Hant" as const, title: "開站了", excerpt: "", bodyMd: "內容" });
  const counts = async () => {
    const one = async (sql: string) => (await env.DB.prepare(sql).first<{ n: number }>())!.n;
    return {
      revisions: await one("SELECT COUNT(*) AS n FROM blog_post_revisions"),
      audits: await one("SELECT COUNT(*) AS n FROM audit_log"),
      metric: await one("SELECT COALESCE(SUM(value), 0) AS n FROM ops_metrics WHERE metric = 'blog'"),
    };
  };
  const same = (a: { id: string; version: number }, b: { id: string; version: number }) => expect([b.id, b.version]).toEqual([a.id, a.version]);

  it("建立：第一次成功，重送回同一篇、不多寫", async () => {
    const id = op();
    const a = await savePost(env.DB, body(), actor(), id, 10);
    const n = await counts();
    same(a, await savePost(env.DB, body(), actor(), id, 11));
    expect(await counts()).toEqual(n);
  });

  it("儲存：重送不會因為版本號已經前進而回衝突", async () => {
    const p = await draft();
    const id = op();
    const a = await savePost(env.DB, { ...body(), id: p.id, expectedVersion: p.version, title: "改" }, actor(), id, 20);
    const n = await counts();
    same(a, await savePost(env.DB, { ...body(), id: p.id, expectedVersion: p.version, title: "改" }, actor(), id, 21));
    expect(await counts()).toEqual(n);
  });

  it("還原：重送不再多一筆修訂", async () => {
    const p = await draft();
    await savePost(env.DB, { ...body(), id: p.id, expectedVersion: p.version, title: "改" }, actor(), op(), 20);
    const rev = (await listRevisions(env.DB, p.id)).at(-1)!;
    const id = op();
    const a = await restoreRevision(env.DB, p.id, rev.id, actor(), id, 30);
    const n = await counts();
    same(a, await restoreRevision(env.DB, p.id, rev.id, actor(), id, 31));
    expect(await counts()).toEqual(n);
  });

  it("狀態：重送不再改版本號", async () => {
    const p = await draft();
    const id = op();
    const a = await setPostState(env.DB, p.id, { pinned: true }, actor(), id, 40);
    const n = await counts();
    same(a, await setPostState(env.DB, p.id, { pinned: true }, actor(), id, 41));
    expect(await counts()).toEqual(n);
  });

  it("欄目：重送回同一個欄目", async () => {
    const id = op();
    const input = { slug: "events", name: { "zh-Hant": "活動" }, description: {}, sort: 1, enabled: true };
    const a = await saveColumn(env.DB, input, actor(), id, 50);
    const n = await counts();
    expect((await saveColumn(env.DB, input, actor(), id, 51)).id).toBe(a.id);
    expect(await counts()).toEqual(n);
    expect(await listColumns(env.DB, { includeDisabled: true })).toHaveLength(2);
  });

  it("同時送出兩次：只留一次，兩邊都拿到同一篇", async () => {
    const id = op();
    const [a, b] = await Promise.all([savePost(env.DB, body(), actor(), id, 60), savePost(env.DB, body(), actor(), id, 60)]);
    expect(b.id).toBe(a.id);
    expect((await counts()).revisions).toBe(1);
  });

  it("編號已經用在別的東西上：回衝突", async () => {
    const id = op();
    await savePost(env.DB, body(), actor(), id, 70);
    await expect(saveColumn(env.DB, { slug: "x", name: { "zh-Hant": "x" }, description: {}, sort: 0, enabled: true }, actor(), id, 71)).rejects.toMatchObject({ status: 409, message: "blog_operation_repeated" });
  });
});
