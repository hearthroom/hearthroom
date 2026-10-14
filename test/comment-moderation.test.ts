import {approveFixtureResponse} from './hosted-fixture';
import { SELF, env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ratingBody, bearer, identities, resetDb, restoreUpstream, rolesOnMainSite } from "./helpers";
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

describe("發表時的攔截", () => {
  it("未設定門檻時不攔：有連結、新帳號都直接公開", async () => {
    const res = await post("fan", { content: "看這個 https://a.test https://b.test https://c.test" });
    expect(res.status).toBe(201);
    expect((await json(res)).status).toBe("visible");
  });

  it("命中關鍵詞先攔；本人看得到「審核中」，別人看不到", async () => {
    await env.DB.prepare("INSERT INTO comment_keywords VALUES ('k1','加群領錢','test',1)").run();
    const body = await json(await post("fan", { content: "快來加群領錢" }));
    expect(body.status).toBe("held");
    expect((await json(await list())).total).toBe(0);
    const mine = await json(await list("fan"));
    expect(mine.comments[0]).toMatchObject({ content: "快來加群領錢", status: "held", removed: false });
  });

  it("新帳號帶連結、連結太多分別攔", async () => {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO community_settings VALUES ('commentNewAccountDays','3',NULL,1)"),
      env.DB.prepare("INSERT INTO community_settings VALUES ('commentMaxLinks','1',NULL,1)"),
    ]);
    expect((await json(await post("fan", { content: "新帳號 https://a.test" }))).status).toBe("held");
    await say("other", "先露個臉");
    await env.DB.prepare("UPDATE members SET created_at = ? WHERE id = (SELECT member_id FROM member_identities WHERE external_id = ?)").bind(Date.now() - 10 * 86400_000, String(OTHER)).run();
    expect((await json(await post("other", { content: "一個 https://a.test" }))).status).toBe("visible");
    expect((await json(await post("other", { content: "兩個 https://a.test https://b.test" }))).status).toBe("held");
  });

  it("門檻設 0 天＝規則開著但永遠不攔；沒設才是關", async () => {
    await env.DB.prepare("INSERT INTO community_settings VALUES ('commentNewAccountDays','0',NULL,1)").run();
    expect((await json(await post("fan", { content: "有連結 https://a.test" }))).status).toBe("visible");
  });

  it("24 小時內重複相同內容攔第二則；近 30 天被移除過的人一律先攔", async () => {
    expect((await json(await post("fan", { content: "同一句" }))).status).toBe("visible");
    expect((await json(await post("fan", { content: "同一句" }))).status).toBe("held");
    await env.DB.prepare("UPDATE comments SET status='removed', deleted_at=?, moderated_at=? WHERE content='同一句' AND status='visible'").bind(Date.now(), Date.now()).run();
    expect((await json(await post("fan", { content: "完全不同的話" }))).status).toBe("held");
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

  it("攔下時寫稽核與計數", async () => {
    await env.DB.prepare("INSERT INTO comment_keywords VALUES ('k1','違禁','test',1)").run();
    const id = (await json(await post("fan", { content: "違禁" }))).commentId;
    const a = await env.DB.prepare("SELECT actor_kind, action, reason FROM audit_log WHERE subject_id=?").bind(id).first();
    expect(a).toEqual({ actor_kind: "system", action: "hold", reason: "keyword" });
    const m = await env.DB.prepare("SELECT value FROM ops_metrics WHERE metric='comment_moderation' AND operation='hold' AND outcome='success'").first<{ value: number }>();
    expect(m!.value).toBe(1);
  });
});

describe("被攔的回覆", () => {
  it("被攔的回覆放行時才通知與計數", async () => {
    const root = await say("fan", "頂層");
    await env.DB.prepare("INSERT INTO comment_keywords VALUES ('k1','違禁','test',1)").run();
    const reply = (await json(await post("other", { content: "違禁回覆", rootId: root, parentId: root }))).commentId;
    const notes = () => env.DB.prepare("SELECT COUNT(*) AS n FROM community_notifications WHERE kind='comment_reply'").first<{ n: number }>();
    expect((await notes())!.n).toBe(0);
    expect((await json(await list())).comments[0].replyCount).toBe(0);
    await env.DB.prepare("UPDATE comments SET status='visible' WHERE id=?").bind(reply).run();
    await env.DB.prepare("UPDATE comments SET reply_count = reply_count + 1 WHERE id=?").bind(root).run(); // 放行流程（Task 4）會做這一步
    expect((await notes())!.n).toBe(1);
  });

  it("頂層沒有公開回覆時，本人仍看得到自己被攔的回覆；別人與訪客看不到", async () => {
    const root = await say("fan", "頂層");
    await env.DB.prepare("INSERT INTO comment_keywords VALUES ('k1','違禁','test',1)").run();
    await post("other", { content: "違禁回覆", rootId: root, parentId: root });
    const mine = (await json(await list("other"))).comments[0];
    expect(mine.replyCount).toBe(0);
    expect(mine.replies).toHaveLength(1);
    expect(mine.replies[0]).toMatchObject({ content: "違禁回覆", status: "held" });
    for (const t of [undefined, "fan"]) {
      const top = (await json(await list(t))).comments[0];
      expect(top.replyCount).toBe(0);
      expect(top.replies).toBeUndefined();
    }
  });

  it("不能回覆被攔或被移除的留言", async () => {
    await env.DB.prepare("INSERT INTO comment_keywords VALUES ('k1','違禁','test',1)").run();
    const held = (await json(await post("fan", { content: "違禁" }))).commentId;
    expect((await post("other", { content: "回你", rootId: held })).status).toBe(404);
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

  it("本人刪除照舊連同回覆一起消失；被攔的留言本人也能刪", async () => {
    await env.DB.prepare("INSERT INTO comment_keywords VALUES ('k1','違禁','test',1)").run();
    const held = (await json(await post("fan", { content: "違禁" }))).commentId;
    expect((await del("fan", held)).status).toBe(204);
    expect((await json(await list("fan"))).comments).toHaveLength(0);
    const row = await env.DB.prepare("SELECT status FROM comments WHERE id=?").bind(held).first<{ status: string }>();
    expect(row!.status).toBe("deleted");
  });

  it("被攔或被移除的留言不能按讚；徽章只算公開的留言", async () => {
    await env.DB.prepare("INSERT INTO comment_keywords VALUES ('k1','違禁','test',1)").run();
    const held = (await json(await post("fan", { content: "違禁" }))).commentId;
    expect((await like("other", held)).status).toBe(404);
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM comments WHERE member_id=? AND deleted_at IS NULL AND status='visible'").bind(await memberIdOf(FAN)).first<{ n: number }>();
    expect(n!.n).toBe(0);
  });

  it("作者或審核人刪別人的留言：寫一筆稽核", async () => {
    const id = await say("fan", "普通留言");
    expect((await del("author-token", id)).status).toBe(204);
    const a = await env.DB.prepare("SELECT actor_kind, action FROM audit_log WHERE subject_id=?").bind(id).first<{ actor_kind: string; action: string }>();
    expect(a).toEqual({ actor_kind: "human", action: "delete_by_author" });
  });

  it("本人刪除不寫稽核；刪被攔的回覆不動回覆數", async () => {
    const root = await say("fan", "頂層");
    const own = await say("other", "我的回覆", { rootId: root });
    expect((await del("other", own)).status).toBe(204);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE subject_id=?").bind(own).first<{ n: number }>())!.n).toBe(0);
    await env.DB.prepare("INSERT INTO comment_keywords VALUES ('k1','違禁','test',1)").run();
    const held = (await json(await post("other", { content: "違禁", rootId: root }))).commentId;
    await del("other", held);
    expect((await json(await list())).comments[0].replyCount).toBe(0);
  });
});
