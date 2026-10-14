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
    await expect(draft({ coverKey: "avatars/x.webp" })).rejects.toMatchObject({ status: 400 });
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
