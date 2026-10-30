import {approveFixtureResponse} from './hosted-fixture';
import { SELF, env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ratingBody, bearer, identities, resetDb, restoreUpstream, rolesOnMainSite } from "./helpers";
import { flagVisible } from "../src/comment-moderation";
import { ADULT_CONSENT_VERSION } from "../shared/adult-consent";

// 留言是本站自己的資料：掛在本站的卡上、寫的人是本站成員，供應商不參與。
const AUTHOR = 10001;
const FAN = 20001;
const OTHER = 20002;
const MOD = 30001;
const AGENT = 30002;

let cardId = "";
beforeEach(async () => {
  await resetDb();
  identities({ "author-token": AUTHOR, "fan": FAN, "other": OTHER, "mod": MOD, "agent": AGENT });
  rolesOnMainSite({ roleId: "role-1", authorNumId: AUTHOR });
  const res = await approveFixtureResponse(await SELF.fetch("https://c.test/v1/cards", {
    method: "POST", headers: { "Content-Type": "application/json", ...bearer("author-token") }, body: JSON.stringify({operationId:crypto.randomUUID(),...({ roleId: "role-1", ...ratingBody(false) })}),
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
const memberIdOf = (n: number) => env.DB.prepare("SELECT member_id FROM member_identities WHERE external_id = ?").bind(String(n)).first<{ member_id: string }>().then((r) => r!.member_id);
const del = (token: string, id: string) => SELF.fetch(`https://c.test/v1/comments/${id}`, { method: "DELETE", headers: bearer(token) });

describe("發表時命中規則：照常公開、標記待審", () => {
  const rowOf = (id: string) => env.DB.prepare("SELECT status, hold_reason FROM comments WHERE id=?").bind(id).first<{ status: string; hold_reason: string | null }>();

  it("未設定門檻時不標記：有連結、新帳號都直接公開", async () => {
    const res = await post("fan", { content: "看這個 https://a.test https://b.test https://c.test" });
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.status).toBe("visible");
    expect((await rowOf(body.commentId))!.hold_reason).toBeNull();
  });

  it("命中關鍵詞照常公開、所有人看得到；只在後台留下原因", async () => {
    await env.DB.prepare("INSERT INTO comment_keywords VALUES ('k1','加群領錢','test',1)").run();
    const body = await json(await post("fan", { content: "快來加群領錢" }));
    expect(body.status).toBe("visible");
    expect(await rowOf(body.commentId)).toEqual({ status: "visible", hold_reason: "keyword" });
    for (const t of [undefined, "other", "fan"]) {
      const res = await json(await list(t));
      expect(res.total).toBe(1);
      expect(res.comments[0]).toMatchObject({ content: "快來加群領錢", status: "visible", removed: false });
    }
  });

  it("新帳號帶連結、連結太多分別標記，留言照常公開", async () => {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO community_settings VALUES ('commentNewAccountDays','3',NULL,1)"),
      env.DB.prepare("INSERT INTO community_settings VALUES ('commentMaxLinks','1',NULL,1)"),
    ]);
    const fresh = await json(await post("fan", { content: "新帳號 https://a.test" }));
    expect(fresh.status).toBe("visible");
    expect((await rowOf(fresh.commentId))!.hold_reason).toBe("new_account_link");
    await say("other", "先露個臉");
    await env.DB.prepare("UPDATE members SET created_at = ? WHERE id = (SELECT member_id FROM member_identities WHERE external_id = ?)").bind(Date.now() - 10 * 86400_000, String(OTHER)).run();
    expect((await rowOf(await say("other", "一個 https://a.test")))!.hold_reason).toBeNull();
    expect(await rowOf(await say("other", "兩個 https://a.test https://b.test"))).toEqual({ status: "visible", hold_reason: "too_many_links" });
  });

  it("門檻設 0 天＝規則開著但永遠不標記；沒設才是關", async () => {
    await env.DB.prepare("INSERT INTO community_settings VALUES ('commentNewAccountDays','0',NULL,1)").run();
    expect((await rowOf(await say("fan", "有連結 https://a.test")))!.hold_reason).toBeNull();
  });

  it("重複相同的短評不擋也不標記；近 30 天被移除過的人照常公開、標記", async () => {
    const first = await say("fan", "好玩");
    const again = await say("fan", "好玩");
    expect(await rowOf(first)).toEqual({ status: "visible", hold_reason: null });
    expect(await rowOf(again)).toEqual({ status: "visible", hold_reason: null });
    expect((await json(await list())).total).toBe(2);
    await env.DB.prepare("UPDATE comments SET status='removed', deleted_at=?, moderated_at=? WHERE id=?").bind(Date.now(), Date.now(), first).run();
    expect(await rowOf(await say("fan", "完全不同的話"))).toEqual({ status: "visible", hold_reason: "recent_removal" });
  });

  it("被禁言的人不能留言；到期後恢復", async () => {
    await say("fan", "先建立成員");
    const fan = await memberIdOf(FAN);
    await env.DB.prepare("INSERT INTO comment_mutes VALUES (?, ?, 'spam', 'm', 1)").bind(fan, Date.now() + 60_000).run();
    const res = await post("fan", { content: "還能說嗎" });
    expect(res.status).toBe(403);
    expect((await json(res)).error).toBe("comment_muted");
    await env.DB.prepare("UPDATE comment_mutes SET until = ? WHERE member_id = ?").bind(Date.now() - 1, fan).run();
    expect((await post("fan", { content: "到期了" })).status).toBe(201);
  });

  it("標記時寫稽核與計數", async () => {
    await env.DB.prepare("INSERT INTO comment_keywords VALUES ('k1','違禁','test',1)").run();
    const id = (await json(await post("fan", { content: "違禁" }))).commentId;
    const a = await env.DB.prepare("SELECT actor_kind, action, reason FROM audit_log WHERE subject_id=?").bind(id).first();
    expect(a).toEqual({ actor_kind: "system", action: "flag", reason: "keyword" });
    const m = await env.DB.prepare("SELECT value FROM ops_metrics WHERE metric='comment_moderation' AND operation='flag' AND outcome='success'").first<{ value: number }>();
    expect(m!.value).toBe(1);
  });
});

describe("被標記的回覆", () => {
  it("被標記的回覆立刻通知被回覆者、計入回覆數，別人看得到", async () => {
    const root = await say("fan", "頂層");
    await env.DB.prepare("INSERT INTO comment_keywords VALUES ('k1','違禁','test',1)").run();
    await post("other", { content: "違禁回覆", rootId: root, parentId: root });
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM community_notifications WHERE kind='comment_reply'").first<{ n: number }>();
    expect(n!.n).toBe(1);
    for (const t of [undefined, "fan", "other"]) {
      const top = (await json(await list(t))).comments[0];
      expect(top.replyCount).toBe(1);
      expect(top.replies[0]).toMatchObject({ content: "違禁回覆", status: "visible" });
    }
  });

  it("可以回覆被標記的留言；不能回覆被移除的留言", async () => {
    await env.DB.prepare("INSERT INTO comment_keywords VALUES ('k1','違禁','test',1)").run();
    const flagged = (await json(await post("fan", { content: "違禁" }))).commentId;
    expect((await post("other", { content: "回你", rootId: flagged })).status).toBe(201);
    await env.DB.prepare("UPDATE comments SET status='removed', deleted_at=? WHERE id=?").bind(Date.now(), flagged).run();
    expect((await post("other", { content: "再回你", rootId: flagged })).status).toBe(404);
  });
});

describe("移除與刪除", () => {
  it("移除頂層保留樓層：頂層是佔位、回覆照常顯示", async () => {
    const root = await say("fan", "頂層");
    await say("other", "回覆一", { rootId: root, parentId: root });
    await env.DB.prepare("UPDATE comments SET status='removed', deleted_at=?, moderation_reason='spam' WHERE id=?").bind(Date.now(), root).run();
    const body = await json(await list());
    expect(body.total).toBe(1);
    expect(body.comments[0]).toMatchObject({ commentId: root, removed: true, content: "", status: "removed" });
    expect(body.comments[0].replies[0].content).toBe("回覆一");
  });

  it("被移除的頂層佔位不帶留言者的名字、頭像、星數與讚數", async () => {
    const root = await say("fan", "頂層");
    await say("other", "回覆一", { rootId: root, parentId: root });
    await env.DB.prepare("INSERT INTO card_scores VALUES (?, ?, 5, 1, 1)").bind(cardId, await memberIdOf(FAN)).run();
    await env.DB.prepare("UPDATE members SET avatar_url='https://img.test/a.png' WHERE id=?").bind(await memberIdOf(FAN)).run();
    await env.DB.prepare("UPDATE comments SET status='removed', deleted_at=?, like_count=4 WHERE id=?").bind(Date.now(), root).run();
    const top = (await json(await list("other"))).comments[0];
    expect(top).toMatchObject({ removed: true, handle: "", accountNickName: "", accountAvatar: "", score: null, likeCount: 0, isCreator: false });
  });

  it("本人刪除照舊連同回覆一起消失；被標記的留言本人也能刪", async () => {
    await env.DB.prepare("INSERT INTO comment_keywords VALUES ('k1','違禁','test',1)").run();
    const flagged = (await json(await post("fan", { content: "違禁" }))).commentId;
    expect((await del("fan", flagged)).status).toBe(204);
    expect((await json(await list("fan"))).comments).toHaveLength(0);
    const row = await env.DB.prepare("SELECT status FROM comments WHERE id=?").bind(flagged).first<{ status: string }>();
    expect(row!.status).toBe("deleted");
  });

  it("被標記的留言照常能按讚；被移除的不能", async () => {
    await env.DB.prepare("INSERT INTO comment_keywords VALUES ('k1','違禁','test',1)").run();
    const flagged = (await json(await post("fan", { content: "違禁" }))).commentId;
    expect((await like("other", flagged)).status).toBe(204);
    await env.DB.prepare("UPDATE comments SET status='removed', deleted_at=? WHERE id=?").bind(Date.now(), flagged).run();
    expect((await like("other", flagged)).status).toBe(404);
  });

  it("作者或審核人刪別人的留言：寫一筆稽核", async () => {
    const id = await say("fan", "普通留言");
    expect((await del("author-token", id)).status).toBe(204);
    const a = await env.DB.prepare("SELECT actor_kind, action FROM audit_log WHERE subject_id=?").bind(id).first<{ actor_kind: string; action: string }>();
    expect(a).toEqual({ actor_kind: "human", action: "delete_by_author" });
  });

  it("本人刪除不寫稽核；刪被標記的回覆，回覆數跟著減", async () => {
    const root = await say("fan", "頂層");
    const own = await say("other", "我的回覆", { rootId: root });
    expect((await del("other", own)).status).toBe(204);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE subject_id=?").bind(own).first<{ n: number }>())!.n).toBe(0);
    await env.DB.prepare("INSERT INTO comment_keywords VALUES ('k1','違禁','test',1)").run();
    const flagged = (await json(await post("other", { content: "違禁", rootId: root }))).commentId;
    expect((await json(await list())).comments[0].replyCount).toBe(1);
    await del("other", flagged);
    expect((await json(await list())).comments[0].replyCount).toBe(0);
  });
});

const report = (token: string, id: string, body: Record<string, unknown>) =>
  SELF.fetch(`https://c.test/v1/comments/${id}/report`, { method: "POST", headers: { "Content-Type": "application/json", ...bearer(token) }, body: JSON.stringify(body) });

describe("檢舉", () => {
  it("一人一則一次；自己不能檢舉自己；理由要在列舉裡", async () => {
    const id = await say("fan", "可疑");
    expect((await report("", id, { reason: "spam" })).status).toBe(401);
    expect((await report("fan", id, { reason: "spam" })).status).toBe(403);
    expect((await report("other", id, { reason: "bogus" })).status).toBe(400);
    expect((await report("other", id, { reason: "spam", note: "加群" })).status).toBe(200);
    expect((await report("other", id, { reason: "abuse" })).status).toBe(200);
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM comment_reports WHERE comment_id=?").bind(id).first<{ n: number }>();
    expect(n!.n).toBe(1);
  });

  it("達到門檻只標記、不摺疊：照常公開並寫稽核；沒設門檻就只記檢舉", async () => {
    const id = await say("fan", "可疑");
    expect((await report("other", id, { reason: "spam" })).status).toBe(200);
    await env.DB.prepare("INSERT INTO community_settings VALUES ('commentReportFoldThreshold','2',NULL,1)").run();
    identities({ "author-token": AUTHOR, fan: FAN, other: OTHER, third: 20003 });
    expect(await json(await report("third", id, { reason: "abuse" }))).toEqual({ ok: true });
    const row = await env.DB.prepare("SELECT status, hold_reason FROM comments WHERE id=?").bind(id).first<{ status: string; hold_reason: string }>();
    expect(row).toEqual({ status: "visible", hold_reason: "reports" });
    expect((await json(await list())).total).toBe(1);
    const a = await env.DB.prepare("SELECT actor_kind, action FROM audit_log WHERE subject_id=?").bind(id).first<{ actor_kind: string; action: string }>();
    expect(a).toEqual({ actor_kind: "system", action: "flag" });
  });

  it("標記一則公開回覆時，頂層的回覆數不變", async () => {
    const root = await say("fan", "頂層");
    const reply = await say("other", "回覆", { rootId: root });
    await env.DB.prepare("INSERT INTO community_settings VALUES ('commentReportFoldThreshold','1',NULL,1)").run();
    identities({ "author-token": AUTHOR, fan: FAN, other: OTHER, third: 20003 });
    await report("third", reply, { reason: "spam" });
    expect((await json(await list())).comments[0].replyCount).toBe(1);
  });

  describe("flagVisible 只生效一次", () => {
    const setup = async () => {
      const root = await say("fan", "頂層");
      const reply = await say("other", "回覆", { rootId: root });
      return { root, reply };
    };
    const flags = (id: string) => env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE subject_id=? AND action='flag'").bind(id).first<{ n: number }>().then((r) => r!.n);

    it("連續呼叫兩次：一筆稽核、第二次回 false", async () => {
      const { reply } = await setup();
      expect(await flagVisible(env.DB, reply, "reports", null, "system", "op-1", Date.now())).toBe(true);
      expect(await flagVisible(env.DB, reply, "reports", null, "system", "op-2", Date.now())).toBe(false);
      expect(await flags(reply)).toBe(1);
    });

    it("同時呼叫：只有一個贏，一筆稽核", async () => {
      const { reply } = await setup();
      const out = await Promise.all([1, 2, 3].map((i) => flagVisible(env.DB, reply, "reports", null, "system", "op-" + i, Date.now())));
      expect(out.filter(Boolean)).toHaveLength(1);
      expect(await flags(reply)).toBe(1);
    });

    it("已被移除的留言：回 false、沒有稽核", async () => {
      const { reply } = await setup();
      await env.DB.prepare("UPDATE comments SET status='removed', deleted_at=? WHERE id=?").bind(Date.now(), reply).run();
      expect(await flagVisible(env.DB, reply, "reports", null, "system", "op-1", Date.now())).toBe(false);
      expect(await flags(reply)).toBe(0);
    });
  });
});

describe("0098：殘留的待審留言轉公開", () => {
  it("待審的頂層與回覆都轉公開、保留原因；頂層補上回覆數", async () => {
    const root = await say("fan", "頂層");
    const top = await say("other", "被攔的頂層");
    const reply = await say("other", "被攔的回覆", { rootId: root, parentId: root });
    // 重建上線前的樣子：待審的留言不算進回覆數。
    await env.DB.batch([
      env.DB.prepare("UPDATE comments SET status='held', hold_reason='keyword' WHERE id IN (?, ?)").bind(top, reply),
      env.DB.prepare("UPDATE comments SET hold_reason='duplicate' WHERE id=?").bind(root),
      env.DB.prepare("UPDATE comments SET reply_count=0 WHERE id=?").bind(root),
    ]);
    const migration = env.TEST_MIGRATIONS.find((m) => m.name.includes("0098_comment_post_then_review"))!;
    for (const sql of migration.queries.filter((q) => /^\s*UPDATE/i.test(q))) await env.DB.prepare(sql).run();
    const rows = await env.DB.prepare("SELECT id, status, hold_reason, reply_count FROM comments ORDER BY created_at").all();
    expect(rows.results).toEqual([
      { id: root, status: "visible", hold_reason: null, reply_count: 1 },
      { id: top, status: "visible", hold_reason: "keyword", reply_count: 0 },
      { id: reply, status: "visible", hold_reason: "keyword", reply_count: 0 },
    ]);
  });
});
