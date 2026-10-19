/**
 * 綺夢社伺服器上報給 Harbor 的獎勵事件（AppRewards 技術設計 §10.3；Harper 研發 2026-10-19：share_open 改收 refCode）。
 *   - 分享連結被打開：同一個訪客同一天只算一次；機器人不算；不存 IP 原值，訪客只留匿名雜湊（每週換鑰匙、7 天後清）
 *   - 留言、作者回覆、刪留言、評分、產生分享連結：Harbor 卡片才報，用 Harbor 的公開數字帳號
 *   - 先寫進待送清單，背景送出；沒設應用憑證（B4 前）就留在清單裡，超過 Harbor 收的 48 小時就丟掉並計數
 */
import { env, SELF } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bearer, identities, makeMember, makeReviewer, resetDb, restoreUpstream } from "./helpers";
import { flushRewardEvents, rewardTransport, scriptOf, visitorHash } from "../src/reward-events";
import { opsMetrics } from "../src/ops-metrics";

const json = async (r: Response) => (await r.json()) as any;
const outbox = async () => (await env.DB.prepare("SELECT event_id, type, body, sent_at FROM reward_event_outbox ORDER BY created_at, event_id").all<{ event_id: string; type: string; body: string; sent_at: number | null }>()).results.map((r) => ({ ...r, body: JSON.parse(r.body) }));
const open = (body: Record<string, unknown>, headers: Record<string, string> = {}) =>
  SELF.fetch("https://c.test/v1/share/open", { method: "POST", headers: { "Content-Type": "application/json", "cf-connecting-ip": "203.0.113.9", "User-Agent": "Mozilla/5.0 (iPhone)", ...headers }, body: JSON.stringify({ card: "200009", ...body }) });
const realTransport = { ...rewardTransport };

async function harborCard(id: string, roleId: string, authorNumId: number) {
  await env.DB.prepare("INSERT INTO cards (id, source_role_id, author_num_id, registered_at, last_synced_at, provider) VALUES (?, ?, ?, 0, 0, 'harbor')").bind(id, roleId, authorNumId).run();
}

beforeEach(async () => {
  await resetDb(); identities({ fan: 20001, author: 20002, mod: 30001 });
  // 被分享的卡：帶了卡號就報 workRoleId（選填，首頁的邀請連結沒有卡）
  await env.DB.prepare("INSERT INTO cards (id, source_role_id, author_num_id, registered_at, last_synced_at, provider) VALUES ('200009', 'role-share', 1, 0, 0, 'harbor')").run();
});
afterEach(() => { restoreUpstream(); Object.assign(rewardTransport, realTransport); });

describe("分享連結被打開", () => {
  it("同一個訪客同一天只算一次；只留雜湊，不留 IP", async () => {
    expect((await open({ ref: "ABCD1234" })).status).toBe(204);
    expect((await open({ ref: "ABCD1234" })).status).toBe(204);
    const rows = await outbox();
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe("share_open");
    expect(rows[0].body).toMatchObject({ type: "share_open", refCode: "ABCD1234", workRoleId: "role-share", attrs: { visitorHash: expect.stringMatching(/^[0-9a-f]{32}$/) } });
    expect(rows[0].body.accountNo).toBeUndefined();
    expect(JSON.stringify(rows)).not.toContain("203.0.113.9");
    const stored = await env.DB.prepare("SELECT * FROM share_opens").all();
    expect(JSON.stringify(stored.results)).not.toContain("203.0.113.9");
  });

  it("不同的人各算一次；機器人、格式不對的碼不算", async () => {
    await open({ ref: "ABCD1234" });
    await open({ ref: "ABCD1234" }, { "cf-connecting-ip": "198.51.100.7" });
    await open({ ref: "ABCD1234" }, { "User-Agent": "Discordbot/2.0", "cf-connecting-ip": "192.0.2.1" });
    await open({ ref: "x" });
    expect((await outbox()).length).toBe(2);
    expect(await opsMetrics(env.DB)).toContain('hearthroom_reward_events_total{type="share_open",outcome="dropped"} 2');
  });

  it("沒有卡（首頁的邀請連結）或卡不在 Harbor：照樣報，只是不帶 workRoleId", async () => {
    await SELF.fetch("https://c.test/v1/share/open", { method: "POST", headers: { "Content-Type": "application/json", "cf-connecting-ip": "203.0.113.9", "User-Agent": "Mozilla/5.0" }, body: JSON.stringify({ ref: "ABCD1234" }) });
    await open({ ref: "WXYZ9876", card: "999999" });
    const rows = await outbox();
    expect(rows).toHaveLength(2);
    for (const r of rows) expect(r.body.workRoleId).toBeUndefined();
  });

  it("登入的訪客帶上自己的帳號，讓 Harbor 擋掉分享者本人", async () => {
    await SELF.fetch("https://c.test/v1/share/open", { method: "POST", headers: { ...bearer("fan"), "Content-Type": "application/json", "cf-connecting-ip": "203.0.113.9", "User-Agent": "Mozilla/5.0" }, body: JSON.stringify({ ref: "ABCD1234", card: "200009" }) });
    expect((await outbox())[0].body.attrs.viewerAccountNo).toBe(20001);
  });

  it("訪客雜湊每週換鑰匙：同一個人下週是不同的雜湊", async () => {
    const monday = Date.parse("2026-10-19T04:00:00+08:00");
    const a = await visitorHash(env, "203.0.113.9", "UA", monday - 1);
    const b = await visitorHash(env, "203.0.113.9", "UA", monday + 1);
    const c = await visitorHash(env, "203.0.113.9", "UA", monday + 3 * 86_400_000);
    expect(a).not.toBe(b);
    expect(b).toBe(c);
  });
});

describe("評分馬上送出", () => {
  it("評分之後跟留言一樣當場送，不等每小時的排程（QA ⚠️20）", async () => {
    await makeMember(20001);
    await harborCard("200001", "role-1", 20002);
    const creds = env as unknown as { HARBOR_REWARDS_CLIENT_ID: string; HARBOR_REWARDS_CLIENT_SECRET: string };
    creds.HARBOR_REWARDS_CLIENT_ID = "cid"; creds.HARBOR_REWARDS_CLIENT_SECRET = "sec";
    const sent: string[] = [];
    rewardTransport.token = async () => "app-token";
    rewardTransport.send = async (_env, _t, events) => { sent.push(...events.map((e) => e.type)); return { ok: true, status: 200, results: events.map((e) => ({ eventId: e.eventId, status: "accepted" as const })) }; };
    try {
      await SELF.fetch("https://c.test/v1/cards/200001/score", { method: "PUT", headers: { ...bearer("fan"), "Content-Type": "application/json" }, body: JSON.stringify({ score: 4 }) });
      await vi.waitFor(() => expect(sent).toContain("rating_set"));
    } finally { creds.HARBOR_REWARDS_CLIENT_ID = ""; creds.HARBOR_REWARDS_CLIENT_SECRET = ""; }
  });
});

describe("產生分享連結：託管後的卡", () => {
  it("網頁送託管後的 roleId 也認得，報原卡的 roleId（跟留言、評分一樣）", async () => {
    // 接本機 Harbor 實測（QA ⚠️19）：分享選單送的是 approved_hosted_role_id，以前只比 source_role_id，查不到就默默 204
    await makeMember(20001);
    await harborCard("200077", "role-src", 20002);
    await env.DB.prepare("UPDATE cards SET approved_hosted_role_id = 'role-hosted' WHERE id = 200077").run();
    await SELF.fetch("https://c.test/v1/me/share/created", { method: "POST", headers: { ...bearer("fan"), "Content-Type": "application/json" }, body: JSON.stringify({ roleId: "role-hosted" }) });
    const sent = (await outbox()).filter((e) => e.type === "share_link_created");
    expect(sent).toHaveLength(1);
    expect(sent[0].body).toMatchObject({ type: "share_link_created", accountNo: 20001, workRoleId: "role-src" });
  });
});

describe("分享連結被打開：公開端點出錯也不透露", () => {
  it("資料庫寫不進去時照樣回 204，不回 500", async () => {
    await env.DB.prepare("ALTER TABLE share_opens RENAME TO share_opens_gone").run();
    try {
      const r = await open({ ref: "ABCD1234" });
      expect(r.status).toBe(204);
    } finally {
      await env.DB.prepare("ALTER TABLE share_opens_gone RENAME TO share_opens").run();
    }
  });
});

describe("留言、評分與分享連結", () => {
  it("在 Harbor 卡片留言：報留言與字數；作者回覆再多報一筆", async () => {
    await makeMember(20001); await makeMember(20002);
    await harborCard("200001", "role-1", 20002);
    const top = await json(await SELF.fetch("https://c.test/v1/cards/200001/comments", { method: "POST", headers: { ...bearer("fan"), "Content-Type": "application/json" }, body: JSON.stringify({ content: "很好玩的卡 nice" }) }));
    await SELF.fetch("https://c.test/v1/cards/200001/comments", { method: "POST", headers: { ...bearer("author"), "Content-Type": "application/json" }, body: JSON.stringify({ content: "謝謝", rootId: top.commentId }) });
    const types = (await outbox()).map((r) => [r.type, r.body.accountNo]);
    expect(types).toEqual(expect.arrayContaining([["comment_posted", 20001], ["comment_posted", 20002], ["author_reply", 20002]]));
    const first = (await outbox()).find((r) => r.type === "comment_posted" && r.body.accountNo === 20001)!;
    expect(first.body).toMatchObject({ workRoleId: "role-1", attrs: { commentId: top.commentId, textUnits: 9, script: "cjk" } });
  });

  it("刪留言報 comment_removed；評分報 rating_set", async () => {
    await makeMember(20001); await makeMember(20002);
    await harborCard("200001", "role-1", 20002);
    const top = await json(await SELF.fetch("https://c.test/v1/cards/200001/comments", { method: "POST", headers: { ...bearer("fan"), "Content-Type": "application/json" }, body: JSON.stringify({ content: "留言" }) }));
    await SELF.fetch(`https://c.test/v1/comments/${top.commentId}`, { method: "DELETE", headers: bearer("fan") });
    await SELF.fetch("https://c.test/v1/cards/200001/score", { method: "PUT", headers: { ...bearer("fan"), "Content-Type": "application/json" }, body: JSON.stringify({ score: 5 }) });
    const rows = await outbox();
    expect(rows.find((r) => r.type === "comment_removed")?.body).toMatchObject({ accountNo: 20001, attrs: { commentId: top.commentId } });
    expect(rows.find((r) => r.type === "rating_set")?.body).toMatchObject({ accountNo: 20001, workRoleId: "role-1", attrs: {} });
  });

  it("產生分享連結：要登入，只認 Harbor 上登記過的卡", async () => {
    await makeMember(20001);
    await harborCard("200001", "role-1", 20002);
    expect((await SELF.fetch("https://c.test/v1/me/share/created", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ roleId: "role-1" }) })).status).toBe(401);
    expect((await SELF.fetch("https://c.test/v1/me/share/created", { method: "POST", headers: { ...bearer("fan"), "Content-Type": "application/json" }, body: JSON.stringify({ roleId: "nope" }) })).status).toBe(204);
    await SELF.fetch("https://c.test/v1/me/share/created", { method: "POST", headers: { ...bearer("fan"), "Content-Type": "application/json" }, body: JSON.stringify({ roleId: "role-1" }) });
    await SELF.fetch("https://c.test/v1/me/share/created", { method: "POST", headers: { ...bearer("fan"), "Content-Type": "application/json" }, body: JSON.stringify({ roleId: "role-1" }) });
    const rows = (await outbox()).filter((r) => r.type === "share_link_created");
    expect(rows).toHaveLength(1);
    expect(rows[0].body).toMatchObject({ accountNo: 20001, workRoleId: "role-1", attrs: {} });
  });
});

describe("待審的留言", () => {
  it("被擋下待審的不報；審核放行之後才報", async () => {
    await makeMember(20001); await makeMember(20002); await makeReviewer(30001);
    await harborCard("200001", "role-1", 20002);
    await env.DB.prepare("INSERT INTO comment_keywords VALUES ('k1','違禁','test',1)").run();
    const held = await json(await SELF.fetch("https://c.test/v1/cards/200001/comments", { method: "POST", headers: { ...bearer("fan"), "Content-Type": "application/json" }, body: JSON.stringify({ content: "違禁的留言" }) }));
    expect(held.status).toBe("held");
    expect((await outbox()).filter((r) => r.type === "comment_posted")).toHaveLength(0);
    const res = await SELF.fetch(`https://c.test/v1/moderation/comments/${held.commentId}/decision`, { method: "POST", headers: { ...bearer("mod"), "Content-Type": "application/json" }, body: JSON.stringify({ action: "release", reason: "ok", operationId: crypto.randomUUID() }) });
    expect(res.status).toBe(200);
    const posted = (await outbox()).filter((r) => r.type === "comment_posted");
    expect(posted).toHaveLength(1);
    expect(posted[0].body).toMatchObject({ accountNo: 20001, workRoleId: "role-1", attrs: { commentId: held.commentId, textUnits: 5 } });
  });
});

describe("訪客雜湊的鑰匙", () => {
  it("沒設鑰匙就不算（跨 isolate 的雜湊對不上，會把人數灌大）", async () => {
    const secret = (env as { SHARE_VISITOR_SECRET?: string }).SHARE_VISITOR_SECRET;
    (env as { SHARE_VISITOR_SECRET?: string }).SHARE_VISITOR_SECRET = undefined;
    try {
      await open({ ref: "ABCD1234" });
      expect(await outbox()).toHaveLength(0);
      expect(await opsMetrics(env.DB)).toContain('hearthroom_reward_events_total{type="share_open",outcome="dropped"} 1');
    } finally { (env as { SHARE_VISITOR_SECRET?: string }).SHARE_VISITOR_SECRET = secret; }
  });
});

describe("送出", () => {
  it("應用沒開獎勵或權限不對（403／404）：留著重試，不丟；格式不對（400）才不重送", async () => {
    await open({ ref: "ABCD1234" });
    const creds = { ...env, HARBOR_REWARDS_CLIENT_ID: "cid", HARBOR_REWARDS_CLIENT_SECRET: "sec" };
    let tokens = 0;
    rewardTransport.token = async () => { tokens++; return "app-token"; };
    rewardTransport.send = async () => ({ ok: false, status: 404 });
    expect(await flushRewardEvents(creds, Date.now())).toMatchObject({ retry: 1, rejected: 0 });
    rewardTransport.send = async () => ({ ok: false, status: 400 });
    expect(await flushRewardEvents(creds, Date.now() + 3_600_000)).toMatchObject({ rejected: 1 });
    expect(tokens).toBe(2);
  });

  it("沒設應用憑證：留在清單裡，不送", async () => {
    await open({ ref: "ABCD1234" });
    let called = 0;
    rewardTransport.send = async () => { called++; return { ok: true, status: 200 }; };
    expect(await flushRewardEvents({ ...env, HARBOR_REWARDS_CLIENT_ID: undefined, HARBOR_REWARDS_CLIENT_SECRET: undefined }, Date.now())).toMatchObject({ sent: 0 });
    expect(called).toBe(0);
    expect((await outbox())[0].sent_at).toBeNull();
  });

  it("Harbor 逐筆回結果：收下與重複算送出，不收的算 rejected，都不再送", async () => {
    await open({ ref: "ABCD1234" });
    await open({ ref: "ABCD1234" }, { "cf-connecting-ip": "198.51.100.7" });
    const creds = { ...env, HARBOR_REWARDS_CLIENT_ID: "cid", HARBOR_REWARDS_CLIENT_SECRET: "sec" };
    rewardTransport.token = async () => "app-token";
    rewardTransport.send = async (_e, _t, events) => ({ ok: true, status: 200, results: [{ eventId: events[0].eventId, status: "accepted" }, { eventId: events[1].eventId, status: "rejected_invalid" }] });
    expect(await flushRewardEvents(creds, Date.now())).toMatchObject({ sent: 1, rejected: 1 });
    expect((await outbox()).every((r) => r.sent_at)).toBe(true);
  });

  it("有憑證：一批送出、記下送出時間；Harbor 暫時不通就留著重試", async () => {
    await open({ ref: "ABCD1234" });
    await open({ ref: "ABCD1234" }, { "cf-connecting-ip": "198.51.100.7" });
    const creds = { ...env, HARBOR_REWARDS_CLIENT_ID: "cid", HARBOR_REWARDS_CLIENT_SECRET: "sec" };
    rewardTransport.token = async () => "app-token";
    rewardTransport.send = async () => ({ ok: false, status: 503 });
    expect(await flushRewardEvents(creds, Date.now())).toMatchObject({ sent: 0, retry: 2 });
    let batch: unknown[] = [];
    rewardTransport.send = async (_env, token, events) => { expect(token).toBe("app-token"); batch = events; return { ok: true, status: 200 }; };
    expect(await flushRewardEvents(creds, Date.now() + 10 * 60_000)).toMatchObject({ sent: 2 });
    expect(batch).toHaveLength(2);
    expect((batch[0] as { eventId: string }).eventId).toMatch(/^share_open:/);
    expect((await outbox()).every((r) => r.sent_at)).toBe(true);
    expect(await opsMetrics(env.DB)).toContain('hearthroom_reward_events_total{type="share_open",outcome="sent"} 2');
  });

  it("超過 Harbor 收的時間窗就丟掉並計數，不無限重試", async () => {
    await open({ ref: "ABCD1234" });
    rewardTransport.send = async () => ({ ok: true, status: 200 });
    const later = Date.now() + 48 * 3_600_000;
    expect(await flushRewardEvents({ ...env, HARBOR_REWARDS_CLIENT_ID: "cid", HARBOR_REWARDS_CLIENT_SECRET: "sec" }, later)).toMatchObject({ expired: 1, sent: 0 });
    expect(await opsMetrics(env.DB)).toContain('hearthroom_reward_events_total{type="share_open",outcome="expired"} 1');
  });
});

describe("留言的文字種類", () => {
  it("中日韓字多就是 cjk，其餘 latin", () => {
    expect(scriptOf("很好玩的卡 nice")).toBe("cjk");
    expect(scriptOf("這張卡")).toBe("cjk");
    expect(scriptOf("this card is great 好")).toBe("latin");
    expect(scriptOf("재밌어요")).toBe("cjk");
  });
});
