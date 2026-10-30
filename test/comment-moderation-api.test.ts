import {approveFixtureResponse} from './hosted-fixture';
import { SELF, env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ratingBody, bearer, identities, makeAgent, makeMember, makeReviewer, resetDb, restoreUpstream, rolesOnMainSite, testHandle } from "./helpers";
import { upstream } from "../src/upstream";

// 審核人（含 AI 審核帳號）處理留言：佇列、放行／移除／駁回／標記、禁言、關鍵詞、運營設定、統計。
const AUTHOR = 10001;
const FAN = 20001;
const OTHER = 20002;
const MOD = 30001;
const AGENT = 30002;
const MOD2 = 30003;

let cardId = "";
beforeEach(async () => {
  await resetDb();
  identities({ "author-token": AUTHOR, "fan": FAN, "other": OTHER, "mod": MOD, "agent": AGENT });
  rolesOnMainSite({ roleId: "role-1", authorNumId: AUTHOR });
  upstream.fetchCommunityStatus = async () => ({ admin: false, featuredUsed: 0, featuredQuota: 50 });
  await makeReviewer(MOD);
  await makeAgent(AGENT);
  await makeMember(FAN);
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
const report = (token: string, id: string, body: Record<string, unknown>) =>
  SELF.fetch(`https://c.test/v1/comments/${id}/report`, { method: "POST", headers: { "Content-Type": "application/json", ...bearer(token) }, body: JSON.stringify(body) });
const decide = (token: string, id: string, action: string, reason = "理由", operationId: string = crypto.randomUUID()) =>
  SELF.fetch(`https://c.test/v1/moderation/comments/${id}/decision`, { method: "POST", headers: { "Content-Type": "application/json", ...bearer(token) }, body: JSON.stringify({ action, reason, operationId }) });
const count = async (sql: string, ...binds: unknown[]) => (await env.DB.prepare(sql).bind(...binds).first<{ n: number }>())!.n;

describe("處理", () => {
  it("放行：清掉標記、離開待審；留言一直公開，回覆數與通知不重複；留稽核", async () => {
    const root = await say("fan", "頂層");
    await env.DB.prepare("INSERT INTO comment_keywords VALUES ('k1','違禁','test',1)").run();
    const reply = (await json(await post("other", { content: "違禁回覆", rootId: root, parentId: root }))).commentId;
    const summary = async () => (await json(await SELF.fetch("https://c.test/v1/moderation/summary", { headers: bearer("mod") }))).comments;
    expect(await summary()).toBe(1);
    expect((await queue("held")).map((i) => i.id)).toEqual([reply]);
    expect((await decide("mod", reply, "release")).status).toBe(200);
    expect(await summary()).toBe(0);
    expect(await queue("held")).toEqual([]);
    expect(await rowOf(reply)).toMatchObject({ status: "visible", hold_reason: null });
    const top = (await json(await list())).comments[0];
    expect(top.replyCount).toBe(1);
    expect(top.replies[0].content).toBe("違禁回覆");
    expect(await count("SELECT COUNT(*) AS n FROM community_notifications WHERE kind='comment_reply'")).toBe(1);
    const a = await env.DB.prepare("SELECT actor_kind, action FROM audit_log WHERE subject_id=? AND action='release'").bind(reply).first();
    expect(a).toEqual({ actor_kind: "human", action: "release" });
  });

  it("沒有標記的留言不能放行", async () => {
    const id = await say("fan", "普通");
    expect((await decide("mod", id, "release")).status).toBe(409);
  });

  it("兩個人同時放行同一則：一個成功一個衝突，回覆數、稽核、通知都只有一次", async () => {
    const root = await say("fan", "頂層");
    await env.DB.prepare("INSERT INTO comment_keywords VALUES ('k1','違禁','test',1)").run();
    const reply = (await json(await post("other", { content: "違禁回覆", rootId: root, parentId: root }))).commentId;
    const codes = (await Promise.all([decide("mod", reply, "release"), decide("mod", reply, "release")])).map((r) => r.status).sort();
    expect(codes).toEqual([200, 409]);
    expect(await count("SELECT reply_count AS n FROM comments WHERE id=?", root)).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM audit_log WHERE subject_id=? AND action='release'", reply)).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM community_notifications WHERE kind='comment_reply'")).toBe(1);
  });

  // 兩個請求是否真的交錯取決於排程，所以多跑幾輪；正確的實作每一輪都過。
  it("同一個操作編號連點放行：只生效一次，第二次什麼都不寫", async () => {
    await env.DB.prepare("INSERT INTO comment_keywords VALUES ('k1','違禁','test',1)").run();
    for (let round = 1; round <= 4; round++) {
      const root = await say("fan", "頂層 " + round);
      const reply = (await json(await post("other", { content: "違禁回覆 " + round, rootId: root, parentId: root }))).commentId;
      const op = crypto.randomUUID();
      const codes = (await Promise.all([decide("mod", reply, "release", "理由", op), decide("mod", reply, "release", "理由", op)])).map((r) => r.status).sort();
      expect(codes).toEqual([200, 409]);
      expect(await count("SELECT reply_count AS n FROM comments WHERE id=?", root)).toBe(1);
      expect(await count("SELECT COUNT(*) AS n FROM audit_log WHERE subject_id=? AND action='release'", reply)).toBe(1);
      expect(await count("SELECT COUNT(*) AS n FROM community_notifications WHERE kind='comment_reply'")).toBe(round);
    }
  });

  it("同一個操作編號連點移除：回覆數只減一次，移除通知只有一則", async () => {
    for (let round = 1; round <= 3; round++) { // 每輪 fan 留兩則，3 輪剛好在每分鐘 6 則的上限內
      const root = await say("fan", "頂層 " + round);
      const reply = await say("other", "回覆 " + round, { rootId: root, parentId: root });
      await say("fan", "再一則 " + round, { rootId: root, parentId: root });
      expect(await count("SELECT reply_count AS n FROM comments WHERE id=?", root)).toBe(2);
      const op = crypto.randomUUID();
      const codes = (await Promise.all([decide("mod", reply, "remove", "廣告", op), decide("mod", reply, "remove", "廣告", op)])).map((r) => r.status).sort();
      expect(codes).toEqual([200, 409]);
      expect(await count("SELECT reply_count AS n FROM comments WHERE id=?", root)).toBe(1);
      expect(await count("SELECT COUNT(*) AS n FROM audit_log WHERE subject_id=? AND action='remove'", reply)).toBe(1);
      expect(await count("SELECT COUNT(*) AS n FROM community_notifications WHERE kind='comment_removed'")).toBe(round);
    }
  });

  it("移除要理由；留言者收到站內通知；未結檢舉一起結案", async () => {
    const id = await say("fan", "廣告");
    await report("other", id, { reason: "spam" });
    expect((await decide("mod", id, "remove", "")).status).toBe(400);
    expect((await decide("mod", id, "remove", "廣告")).status).toBe(200);
    const note = await env.DB.prepare("SELECT kind, delivered FROM community_notifications WHERE event_key=?").bind("removed:" + id).first();
    expect(note).toEqual({ kind: "comment_removed", delivered: 1 });
    const r = await env.DB.prepare("SELECT resolution FROM comment_reports WHERE comment_id=?").bind(id).first<{ resolution: string }>();
    expect(r!.resolution).toBe("removed");
    expect((await decide("mod", id, "release")).status).toBe(409);
    const q = await json(await SELF.fetch("https://c.test/v1/moderation/comments?tab=removed", { headers: bearer("mod") }));
    expect(q.items[0]).toMatchObject({ id, status: "removed", moderationReason: "廣告", reports: { total: 1, byReason: { spam: 1 } }, author: { handle: testHandle(FAN) } });
  });

  it("駁回檢舉：因檢舉達門檻的標記一併清掉，檢舉結案；留言從頭到尾都公開", async () => {
    await env.DB.prepare("INSERT INTO community_settings VALUES ('commentReportFoldThreshold','1',NULL,1)").run();
    const id = await say("fan", "正常的話");
    expect((await report("other", id, { reason: "abuse" })).status).toBe(200);
    expect((await json(await list())).total).toBe(1);
    expect((await json(await SELF.fetch("https://c.test/v1/moderation/comments?tab=held", { headers: bearer("mod") }))).items[0]).toMatchObject({ id, status: "visible", holdReason: "reports", reports: { total: 1, byReason: { abuse: 1 } } });
    expect((await decide("mod", id, "dismiss", "")).status).toBe(400);
    expect(await json(await decide("mod", id, "dismiss", "沒問題"))).toEqual({ id, status: "visible" });
    expect(await rowOf(id)).toMatchObject({ status: "visible", hold_reason: null });
    expect((await json(await list())).total).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM comment_reports WHERE comment_id=? AND resolution='dismissed'", id)).toBe(1);
  });

  it("AI 只能放行或標記；移除、禁言、改設定 403 且什麼都不寫", async () => {
    const id = await say("fan", "看起來可疑");
    expect((await decide("agent", id, "remove")).status).toBe(403);
    expect((await env.DB.prepare("SELECT status FROM comments WHERE id=?").bind(id).first<{ status: string }>())!.status).toBe("visible");
    expect(await json(await decide("agent", id, "flag", "疑似廣告"))).toEqual({ id, status: "visible" });
    expect((await json(await list())).total).toBe(1);
    const q = await json(await SELF.fetch("https://c.test/v1/moderation/comments?tab=held", { headers: bearer("mod") }));
    expect(q.items[0]).toMatchObject({ id, status: "visible", suggestedBy: "ai", holdReason: "ai" });
    const a = await env.DB.prepare("SELECT actor_kind FROM audit_log WHERE subject_id=? AND action='flag'").bind(id).first<{ actor_kind: string }>();
    expect(a!.actor_kind).toBe("ai");
    const handle = (await json(await list("mod"))).comments[0]?.handle ?? testHandle(FAN);
    const mute = await SELF.fetch(`https://c.test/v1/moderation/members/${handle}/comment-mute`, { method: "PUT", headers: { "Content-Type": "application/json", ...bearer("agent") }, body: JSON.stringify({ days: 7, reason: "x", operationId: crypto.randomUUID() }) });
    expect(mute.status).toBe(403);
    expect((await json(mute)).error).toBe("agent_not_allowed");
    const settings = await SELF.fetch("https://c.test/v1/moderation/settings", { method: "PUT", headers: { "Content-Type": "application/json", ...bearer("agent") }, body: JSON.stringify({ settings: { commentMaxLinks: 1 }, operationId: crypto.randomUUID() }) });
    expect(settings.status).toBe(403);
    expect(await count("SELECT COUNT(*) AS n FROM community_settings")).toBe(0);
    const metrics = await (await SELF.fetch("https://c.test/metrics")).text();
    expect(metrics).toContain('hearthroom_comment_moderation_total{action="remove",outcome="denied"} 1');
  });

  it("不能處理自己的留言；非審核人 403", async () => {
    const id = await say("mod", "我自己的");
    expect((await decide("mod", id, "remove", "x")).status).toBe(403);
    expect((await decide("fan", id, "remove", "x")).status).toBe(403);
  });
});

describe("禁言與關鍵詞", () => {
  it("禁言 7 天後不能留言；解除後可以；兩次都有稽核", async () => {
    const handle = testHandle(FAN);
    await say("fan", "先說一句");
    const put = await SELF.fetch(`https://c.test/v1/moderation/members/${handle}/comment-mute`, { method: "PUT", headers: { "Content-Type": "application/json", ...bearer("mod") }, body: JSON.stringify({ days: 7, reason: "洗版", operationId: crypto.randomUUID() }) });
    expect(put.status).toBe(200);
    expect((await post("fan", { content: "還能說？" })).status).toBe(403);
    const delRes = await SELF.fetch(`https://c.test/v1/moderation/members/${handle}/comment-mute`, { method: "DELETE", headers: { "Content-Type": "application/json", ...bearer("mod") }, body: JSON.stringify({ reason: "誤判", operationId: crypto.randomUUID() }) });
    expect(delRes.status).toBe(204);
    expect((await post("fan", { content: "恢復了" })).status).toBe(201);
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE subject_kind='member'").first<{ n: number }>();
    expect(n!.n).toBe(2);
  });

  it("關鍵詞新增後立刻生效", async () => {
    const add = await SELF.fetch("https://c.test/v1/moderation/comment-keywords", { method: "POST", headers: { "Content-Type": "application/json", ...bearer("mod") }, body: JSON.stringify({ pattern: "代儲", operationId: crypto.randomUUID() }) });
    expect(add.status).toBe(200);
    const body = await json(await post("fan", { content: "有人要代儲嗎" }));
    expect(body.status).toBe("visible");
    expect(await rowOf(body.commentId)).toMatchObject({ hold_reason: "keyword" });
  });
});

describe("運營設定", () => {
  it("只有應用管理員能改；別的審核人只讀", async () => {
    upstream.fetchCommunityStatus = async (_env, token) => ({ admin: token === "mod", featuredUsed: 0, featuredQuota: 50 });
    identities({ "author-token": AUTHOR, fan: FAN, other: OTHER, mod: MOD, mod2: MOD2 });
    await makeReviewer(MOD2);
    const put = (token: string) => SELF.fetch("https://c.test/v1/moderation/settings", { method: "PUT", headers: { "Content-Type": "application/json", ...bearer(token) }, body: JSON.stringify({ settings: { commentMaxLinks: 1 }, operationId: crypto.randomUUID() }) });
    expect((await put("mod2")).status).toBe(403);
    expect((await put("mod")).status).toBe(200);
    const read = await json(await SELF.fetch("https://c.test/v1/moderation/settings", { headers: bearer("mod2") }));
    expect(read).toEqual({ settings: { commentNewAccountDays: null, commentMaxLinks: 1, commentReportFoldThreshold: null }, canEdit: false });
  });
});

describe("統計與指標", () => {
  it("統計算得出待審與處理時間；/metrics 有固定標籤", async () => {
    await env.DB.prepare("INSERT INTO comment_keywords VALUES ('k1','違禁','test',1)").run();
    const id = (await json(await post("fan", { content: "違禁" }))).commentId;
    let s = await json(await SELF.fetch("https://c.test/v1/moderation/comments/stats", { headers: bearer("mod") }));
    expect(s.held).toBe(1);
    expect(s.holdReasons7d.keyword).toBe(1);
    await decide("mod", id, "release");
    s = await json(await SELF.fetch("https://c.test/v1/moderation/comments/stats", { headers: bearer("mod") }));
    expect(s.held).toBe(0);
    expect(s.medianHandleMs7d).toBeGreaterThanOrEqual(0);
    const metrics = await (await SELF.fetch("https://c.test/metrics")).text();
    expect(metrics).toContain('hearthroom_comment_moderation_total{action="flag",outcome="success"} 1');
    expect(metrics).toContain('hearthroom_comment_moderation_total{action="release",outcome="success"} 1');
  });

  it("標記率：近 7 天新留言中曾被標記的比例（放行過的也算）；近 7 天檢舉數", async () => {
    const stats = async () => json(await SELF.fetch("https://c.test/v1/moderation/comments/stats", { headers: bearer("mod") }));
    expect(await stats()).toMatchObject({ holdRate7d: null, reports7d: 0 });
    await env.DB.prepare("INSERT INTO comment_keywords VALUES ('k1','違禁','test',1)").run();
    const released = (await json(await post("fan", { content: "違禁一" }))).commentId;
    await decide("mod", released, "release"); // 放行後 hold_reason 清空，仍算曾被標記
    const plain = await say("fan", "普通");
    const old = (await json(await post("fan", { content: "違禁二" }))).commentId;
    await env.DB.prepare("UPDATE comments SET created_at = ? WHERE id = ?").bind(Date.now() - 8 * 86_400_000, old).run();
    expect((await report("other", plain, { reason: "spam" })).status).toBe(200);
    expect((await report("mod", plain, { reason: "abuse" })).status).toBe(200);
    await env.DB.prepare("UPDATE comment_reports SET created_at = ? WHERE reporter_member_id = (SELECT member_id FROM member_identities WHERE external_id = ?)").bind(Date.now() - 8 * 86_400_000, String(MOD)).run();
    expect(await stats()).toMatchObject({ holdRate7d: 0.5, reports7d: 1 });
  });

  it("標記率：AI 對已移除的留言再標記一次，不算被標記", async () => {
    const stats = async () => json(await SELF.fetch("https://c.test/v1/moderation/comments/stats", { headers: bearer("mod") }));
    const id = await say("fan", "普通");
    expect((await decide("mod", id, "remove")).status).toBe(200);
    expect((await decide("agent", id, "flag")).status).toBe(200);
    expect(await count("SELECT COUNT(*) AS n FROM audit_log WHERE subject_id = ? AND action = 'flag'", id)).toBe(1);
    expect((await stats()).holdRate7d).toBe(0);
  });
});

const del = (token: string, id: string) => SELF.fetch(`https://c.test/v1/comments/${id}`, { method: "DELETE", headers: bearer(token) });
const queue = async (tab: string) => (await json(await SELF.fetch(`https://c.test/v1/moderation/comments?tab=${tab}`, { headers: bearer("mod") }))).items as any[];
const rowOf = (id: string) => env.DB.prepare("SELECT status, deleted_at, hold_reason, moderation_reason FROM comments WHERE id=?").bind(id).first<any>();

describe("AI 審核帳號只有留言審核的權限", () => {
  it("不能刪別人的留言；看留言時也沒有刪除鍵", async () => {
    const id = await say("fan", "普通留言");
    expect((await json(await list("agent"))).comments[0].canDelete).toBe(false);
    const res = await del("agent", id);
    expect(res.status).toBe(403);
    expect(await rowOf(id)).toMatchObject({ status: "visible", deleted_at: null });
    expect(await count("SELECT COUNT(*) AS n FROM audit_log WHERE subject_id=?", id)).toBe(0);
  });

  it("不能領卡片審核、蓋章、看卡片審核佇列與案件；留言審核照常放行、標記", async () => {
    const agentPost = (path: string, body: unknown) => SELF.fetch(`https://c.test${path}`, { method: "POST", headers: { "Content-Type": "application/json", ...bearer("agent") }, body: JSON.stringify(body) });
    for (const res of [
      await agentPost("/v1/review/s-1/claim", {}),
      await agentPost("/v1/review/s-1/stamp", { verdict: "approve", note: "", generation: "g" }),
      await SELF.fetch("https://c.test/v1/review/queue", { headers: bearer("agent") }),
      await SELF.fetch("https://c.test/v1/moderation/cases", { headers: bearer("agent") }),
    ]) {
      expect(res.status).toBe(403);
      expect((await json(res)).error).toBe("agent_not_allowed");
    }
    await env.DB.prepare("INSERT INTO comment_keywords VALUES ('k1','違禁','test',1)").run();
    const held = (await json(await post("fan", { content: "違禁" }))).commentId;
    expect((await decide("agent", held, "release")).status).toBe(200);
    const id = await say("fan", "看起來可疑");
    expect((await decide("agent", id, "flag", "疑似廣告")).status).toBe(200);
    expect((await SELF.fetch("https://c.test/v1/review/queue", { headers: bearer("mod") })).status).toBe(200);
  });
});

describe("AI 的建議只在待審時出現", () => {
  it("AI 標記一則已經被規則標記的留言：待審佇列看得到 AI 建議與理由，原本的標記原因保留", async () => {
    await env.DB.prepare("INSERT INTO comment_keywords VALUES ('k1','違禁','test',1)").run();
    const id = (await json(await post("fan", { content: "違禁" }))).commentId;
    expect(await json(await decide("agent", id, "flag", "像是廣告"))).toEqual({ id, status: "visible" });
    expect((await queue("held"))[0]).toMatchObject({ id, holdReason: "keyword", suggestedBy: "ai", moderationReason: "像是廣告" });
  });

  it("AI 標記後被放行，之後又因檢舉達門檻被標記：不再顯示 AI 建議；放行與駁回都清掉標記原因", async () => {
    const id = await say("fan", "正常的話");
    await decide("agent", id, "flag", "疑似廣告");
    expect((await decide("mod", id, "release")).status).toBe(200);
    expect(await rowOf(id)).toMatchObject({ status: "visible", hold_reason: null, moderation_reason: null });
    await env.DB.prepare("INSERT INTO community_settings VALUES ('commentReportFoldThreshold','1',NULL,1)").run();
    expect((await report("other", id, { reason: "spam" })).status).toBe(200);
    expect((await queue("held"))[0]).toMatchObject({ id, holdReason: "reports", suggestedBy: null, moderationReason: null });
    expect((await decide("mod", id, "dismiss", "沒問題")).status).toBe(200);
    expect(await rowOf(id)).toMatchObject({ status: "visible", hold_reason: null, moderation_reason: null });
  });
});

describe("留言被刪掉時檢舉一起結案", () => {
  it("留言者刪掉被檢舉的頂層：頂層與回覆的檢舉都結案，統計不再算它們", async () => {
    const root = await say("fan", "頂層");
    const reply = await say("author-token", "回覆", { rootId: root });
    await report("other", root, { reason: "spam" });
    await report("other", reply, { reason: "abuse" });
    expect((await json(await SELF.fetch("https://c.test/v1/moderation/comments/stats", { headers: bearer("mod") }))).openReports).toBe(2);
    expect((await del("fan", root)).status).toBe(204);
    expect(await count("SELECT COUNT(*) AS n FROM comment_reports WHERE resolved_at IS NOT NULL AND resolution='deleted'")).toBe(2);
    expect((await json(await SELF.fetch("https://c.test/v1/moderation/comments/stats", { headers: bearer("mod") }))).openReports).toBe(0);
  });

  it("統計只算還看得到的留言上的未結檢舉", async () => {
    const id = await say("fan", "留言");
    await report("other", id, { reason: "spam" });
    await env.DB.prepare("UPDATE comments SET status='removed', deleted_at=1 WHERE id=?").bind(id).run();
    expect((await json(await SELF.fetch("https://c.test/v1/moderation/comments/stats", { headers: bearer("mod") }))).openReports).toBe(0);
  });
});

describe("刪除只生效一次", () => {
  // 後到的那一個若在刪除完成後才讀，看到的是「已經不在」（404）；真的交錯時是衝突（409）。兩種都不能是 500。
  it("兩個請求同時刪同一則回覆：一個成功、另一個回已不在或衝突，回覆數只減一次、稽核只有一筆", async () => {
    for (let round = 1; round <= 3; round++) {
      const root = await say("fan", "頂層 " + round);
      const reply = await say("other", "回覆 " + round, { rootId: root });
      await say("author-token", "再一則 " + round, { rootId: root });
      const codes = (await Promise.all([del("mod", reply), del("mod", reply)])).map((r) => r.status).sort();
      expect(codes[0]).toBe(204);
      expect([404, 409]).toContain(codes[1]);
      expect(await count("SELECT reply_count AS n FROM comments WHERE id=?", root)).toBe(1);
      expect(await count("SELECT COUNT(*) AS n FROM audit_log WHERE subject_id=?", reply)).toBe(1);
    }
  });
});

describe("被標記的回覆的通知", () => {
  it("發表時就通知；放行不再通知第二次", async () => {
    const root = await say("fan", "頂層");
    await env.DB.prepare("INSERT INTO comment_keywords VALUES ('k1','違禁','test',1)").run();
    const reply = (await json(await post("other", { content: "違禁回覆", rootId: root, parentId: root }))).commentId;
    const created = await count("SELECT created_at AS n FROM comments WHERE id=?", reply);
    expect(await count("SELECT created_at AS n FROM community_notifications WHERE kind='comment_reply'")).toBe(created);
    await decide("mod", reply, "release");
    expect(await count("SELECT COUNT(*) AS n FROM community_notifications WHERE kind='comment_reply'")).toBe(1);
  });
});

describe("禁言的回應帶到期時間", () => {
  it("限期禁言回到期時間；永久禁言回 null", async () => {
    const handle = testHandle(FAN);
    const mute = (days: number | null) => SELF.fetch(`https://c.test/v1/moderation/members/${handle}/comment-mute`, { method: "PUT", headers: { "Content-Type": "application/json", ...bearer("mod") }, body: JSON.stringify({ days, reason: "洗版", operationId: crypto.randomUUID() }) });
    const until = (await json(await mute(7))).until as number;
    let res = await post("fan", { content: "還能說？" });
    expect(res.status).toBe(403);
    expect(await json(res)).toEqual({ error: "comment_muted", until });
    await mute(null);
    res = await post("fan", { content: "還能說？" });
    expect(await json(res)).toEqual({ error: "comment_muted", until: null });
  });
});

describe("留言列表告訴被禁言的人", () => {
  it("被禁言的本人在列表上拿到到期時間（永久是 null）；別人與訪客沒有這個欄位", async () => {
    const handle = testHandle(FAN);
    const mute = (days: number | null) => SELF.fetch(`https://c.test/v1/moderation/members/${handle}/comment-mute`, { method: "PUT", headers: { "Content-Type": "application/json", ...bearer("mod") }, body: JSON.stringify({ days, reason: "洗版", operationId: crypto.randomUUID() }) });
    expect("mutedUntil" in (await json(await list("fan")))).toBe(false);
    const until = (await json(await mute(7))).until as number;
    expect((await json(await list("fan"))).mutedUntil).toBe(until);
    expect("mutedUntil" in (await json(await list("other")))).toBe(false);
    expect("mutedUntil" in (await json(await list()))).toBe(false);
    await mute(null);
    expect((await json(await list("fan"))).mutedUntil).toBeNull();
  });
});

describe("待審分頁", () => {
  it("依原因篩選；不認得的原因 400", async () => {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO comment_keywords VALUES ('k1','違禁','test',1)"),
      env.DB.prepare("INSERT INTO community_settings VALUES ('commentMaxLinks','0',NULL,1)"),
    ]);
    const keyword = await say("fan", "違禁");
    const links = await say("fan", "看 https://a.test");
    const ids = async (q: string) => ((await json(await SELF.fetch(`https://c.test/v1/moderation/comments?tab=held${q}`, { headers: bearer("mod") }))).items as any[]).map((i) => i.id).sort();
    expect(await ids("")).toEqual([keyword, links].sort());
    expect(await ids("&reason=keyword")).toEqual([keyword]);
    expect(await ids("&reason=too_many_links")).toEqual([links]);
    expect((await SELF.fetch("https://c.test/v1/moderation/comments?tab=held&reason=duplicate", { headers: bearer("mod") })).status).toBe(400);
  });

  it("有標記又被檢舉的留言只在待審出現，被檢舉分頁不重複列", async () => {
    await env.DB.prepare("INSERT INTO comment_keywords VALUES ('k1','違禁','test',1)").run();
    const flagged = await say("fan", "違禁");
    const plain = await say("fan", "普通");
    await report("other", flagged, { reason: "spam" });
    await report("other", plain, { reason: "spam" });
    expect((await queue("held")).map((i) => i.id)).toEqual([flagged]);
    expect((await queue("reported")).map((i) => i.id)).toEqual([plain]);
  });
});
