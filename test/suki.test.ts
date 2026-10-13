/**
 * 蘇綺的照顧與召回（設定集「拓麻歌子與 QQ 寵物的枯れた技術水平思考」，2026-10-13）：
 *   - 狀態存在帳號裡，換裝置也在；聊故事（站上的對話紀錄）就算餵她，一天最多加一次好感
 *   - 召回預設關閉，要自己打開；一天以上沒來、在你平常上站的鐘點、一天最多一則
 *   - 召回走既有的通知管線（推播、Discord 私訊照原本的規則送）；有玩過的卡就寄明信片，沒有就說餓了
 *   - 她不會死：兩週以上沒來就不再吵
 */
import { SELF, env } from "cloudflare:test";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { resetDb, identities, bearer, restoreUpstream, rolesOnMainSite, ratingBody } from "./helpers";
import { approveFixtureResponse } from "./hosted-fixture";
import { sukiRecall } from "../src/suki";
import { pushLine } from "../src/community/push";
import { freshState, recallDue, usualHour, visit, localHour } from "../shared/suki-care";

const HOUR = 3_600_000;
const api = (path: string, token = "fan", init: RequestInit = {}) =>
  SELF.fetch(`https://c.test/v1/${path}`, { ...init, headers: { ...bearer(token), "Content-Type": "application/json", ...(init.headers ?? {}) } });
const json = async (r: Response) => await r.json() as any;
const memberId = async (external = "20001") =>
  (await env.DB.prepare("SELECT member_id AS id FROM member_identities WHERE external_id=?").bind(external).first<{ id: string }>())!.id;

beforeEach(async () => { await resetDb(); identities({ fan: 20001, other: 20002 }); });
afterEach(restoreUpstream);

describe("狀態存在帳號裡", () => {
  it("要登入；第一次來建立狀態，換一個人互不相干", async () => {
    expect((await api("me/suki/visit", "", { method: "POST", body: "{}" })).status).toBe(401);
    const first = await json(await api("me/suki/visit", "fan", { method: "POST", body: JSON.stringify({ tzOffset: -480 }) }));
    expect(first.state.streak).toBe(1);
    expect(first.recall).toBe(false);
    const other = await json(await api("me/suki", "other"));
    expect(other.state).toBeNull();
  });

  it("第一次來是簽到 +1；聊過故事再 +1（吃飽）；同一天再來不重複加", async () => {
    await api("me/suki/visit", "fan", { method: "POST", body: JSON.stringify({ tzOffset: -480 }) });
    const id = await memberId();
    await env.DB.prepare("INSERT INTO member_conversations(member_id,provider,role_id,conversation_id,created_at,updated_at) VALUES(?,?,?,?,?,?)")
      .bind(id, "harbor", "r1", "c1", Date.now(), Date.now()).run();
    const fed = await json(await api("me/suki/visit", "fan", { method: "POST", body: JSON.stringify({ tzOffset: -480 }) }));
    expect(fed.news.map((n: any) => n.kind)).toContain("fed");
    expect(fed.state.affection).toBe(2);
    expect(fed.state.fullness).toBe(1);
    const again = await json(await api("me/suki/visit", "fan", { method: "POST", body: JSON.stringify({ tzOffset: -480 }) }));
    expect(again.state.affection).toBe(2);
  });

  it("召回要自己打開，也能關掉", async () => {
    await api("me/suki/visit", "fan", { method: "POST", body: "{}" });
    expect((await json(await api("me/suki", "fan", { method: "PATCH", body: JSON.stringify({ recall: true }) }))).recall).toBe(true);
    expect((await json(await api("me/suki"))).recall).toBe(true);
    expect((await json(await api("me/suki", "fan", { method: "PATCH", body: JSON.stringify({ recall: false }) }))).recall).toBe(false);
    expect((await api("me/suki", "fan", { method: "PATCH", body: JSON.stringify({ recall: "yes" }) })).status).toBe(400);
  });
});

describe("召回", () => {
  /** 固定在下午一點（tz 0）：平常的鐘點落在白天，不會被挪到晚上九點 */
  const AT = Date.UTC(2026, 9, 13, 13);
  /** 建一個「上次來是 hoursAgo 小時前、平常這個鐘點上站」的人 */
  async function absent(hoursAgo: number, recall = true, now = AT) {
    await api("me/suki/visit", "fan", { method: "POST", body: JSON.stringify({ tzOffset: 0 }) });
    const id = await memberId();
    const s = freshState(now - hoursAgo * HOUR);
    s.hours = Array(24).fill(0); s.hours[localHour(now, 0)] = 5;
    await env.DB.prepare("UPDATE suki_states SET state=?,recall=?,tz_offset=0,last_seen=?,last_recall=0 WHERE member_id=?")
      .bind(JSON.stringify(s), recall ? 1 : 0, now - hoursAgo * HOUR, id).run();
    return id;
  }
  const notices = (id: string) => env.DB.prepare("SELECT kind,path,card_id,extra FROM community_notifications WHERE member_id=?").bind(id).all<{ kind: string; path: string; card_id: number | null; extra: string }>();

  it("一天沒來、在平常的鐘點：寄一則「餓了」；同一天再跑不重複", async () => {
    const now = AT;
    const id = await absent(26, true, now);
    expect(await sukiRecall(env, now)).toBe(1);
    expect(await sukiRecall(env, now + 60_000)).toBe(0);
    const rows = (await notices(id)).results;
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("suki_recall");
    expect(JSON.parse(rows[0].extra).variant).toBe("hungry");
  });

  it("玩過、在榜上的卡：寄明信片，帶那張卡、點了開那張卡", async () => {
    identities({ fan: 20001, author: 10001 });
    rolesOnMainSite({ roleId: "postcard-role", authorNumId: 10001 });
    const r = await approveFixtureResponse(await SELF.fetch("https://c.test/v1/cards", { method: "POST", headers: { ...bearer("author"), "Content-Type": "application/json" }, body: JSON.stringify({ operationId: crypto.randomUUID(), roleId: "postcard-role", ...ratingBody(false) }) }));
    const cardId = (await json(r)).id as string;
    const num = (await env.DB.prepare("SELECT cn.num AS num FROM cards c JOIN card_numbers cn ON cn.provider=c.provider AND cn.source_role_id=c.source_role_id WHERE c.id=?").bind(cardId).first<{ num: number }>())!.num;
    const id = await absent(26, true, AT);
    await env.DB.prepare("INSERT INTO member_conversations(member_id,provider,role_id,conversation_id,created_at,updated_at) VALUES(?,?,?,?,?,?)")
      .bind(id, "harbor", "postcard-role", "conv-1", AT - 30 * HOUR, AT - 30 * HOUR).run();
    expect(await sukiRecall(env, AT)).toBe(1);
    const [row] = (await notices(id)).results;
    expect(JSON.parse(row.extra).variant).toBe("postcard");
    expect(String(row.card_id)).toBe(cardId);
    expect(row.path).toBe(`/cards/${num}`);
  });

  it("沒打開召回、剛來過、兩週以上沒來：都不寄", async () => {
    const now = AT;
    let id = await absent(26, false, now);
    expect(await sukiRecall(env, now)).toBe(0);
    await resetDb(); identities({ fan: 20001 });
    id = await absent(3, true, now);
    expect(await sukiRecall(env, now)).toBe(0);
    await resetDb(); identities({ fan: 20001 });
    id = await absent(15 * 24, true, now);
    expect(await sukiRecall(env, now)).toBe(0);
    expect((await notices(id)).results).toHaveLength(0);
  });

  it("推播與私訊的文字是她的口吻，明信片帶卡名", () => {
    const hungry = pushLine({ kind: "suki_recall", extra: JSON.stringify({ variant: "hungry" }), actor_name: null, actor_handle: null, card_names: null }, "zh-Hant");
    const postcard = pushLine({ kind: "suki_recall", extra: JSON.stringify({ variant: "postcard" }), actor_name: null, actor_handle: null, card_names: JSON.stringify({ zh: "雨夜的舊書店", en: "", ja: "", ko: "" }) }, "zh-Hant");
    expect(hungry).not.toBe(pushLine({ kind: "unknown", extra: null, actor_name: null, actor_handle: null, card_names: null }, "zh-Hant"));
    expect(postcard).toContain("雨夜的舊書店");
  });

  it("/metrics 記下寄了幾則", async () => {
    const now = AT;
    await absent(26, true, now);
    await sukiRecall(env, now);
    const text = await (await SELF.fetch("https://c.test/metrics")).text();
    expect(text).toMatch(/hearthroom_suki_operations_total\{operation="recall",outcome="sent"\} 1/);
  });
});

describe("算法", () => {
  it("平常的鐘點：取來最多次的；沒資料或平常都在深夜，就晚上九點", () => {
    const s = freshState(0);
    expect(usualHour(s)).toBe(21);
    s.hours[13] = 3; s.hours[22] = 1;
    expect(usualHour(s)).toBe(13);
    s.hours = Array(24).fill(0); s.hours[2] = 9;
    expect(usualHour(s)).toBe(21);
  });
  it("離上一則不到 20 小時不寄；不是平常的鐘點不寄", () => {
    const now = Date.UTC(2026, 9, 13, 21);
    const s = freshState(0);
    expect(recallDue(s, now - 26 * HOUR, 0, now, 0)).toBe(true);
    expect(recallDue(s, now - 26 * HOUR, now - 5 * HOUR, now, 0)).toBe(false);
    expect(recallDue(s, now - 26 * HOUR, 0, now + HOUR, 0)).toBe(false);
  });
  it("連續天數跨本地日期算，不是跨 UTC", () => {
    const tpe = -480;
    const a = visit(null, Date.UTC(2026, 9, 13, 15, 30), null, tpe);
    const b = visit(a.state, Date.UTC(2026, 9, 13, 16, 30), null, tpe);
    expect(b.state.streak).toBe(2);
  });
});
