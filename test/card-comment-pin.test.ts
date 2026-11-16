import {approveFixtureResponse} from './hosted-fixture';
import { SELF, env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ratingBody, bearer, identities, makeReviewer, resetDb, restoreUpstream, rolesOnMainSite } from "./helpers";
import { ADULT_CONSENT_VERSION } from "../shared/adult-consent";

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
const del = (token: string, id: string) => SELF.fetch(`https://c.test/v1/comments/${id}`, { method: "DELETE", headers: bearer(token) });

const pin = (id: string, on = true, token = "author-token", target = cardId) => SELF.fetch(`https://c.test/v1/cards/${target}/comments/${id}/pin`, { method: on ? "PUT" : "DELETE", headers: bearer(token) });

describe("card comment pin", () => {
  it("only the card author can pin visible roots; guests, readers, moderators and foreign comments cannot", async () => {
    const root = await say("fan", "public root");
    expect((await json(await list("author-token"))).comments[0].canPin).toBe(true);
    expect((await json(await list("fan"))).comments[0].canPin).toBe(false);
    expect((await pin(root, true, "")).status).toBe(401);
    expect((await pin(root, true, "fan")).status).toBe(403);
    await makeReviewer(MOD);
    expect((await pin(root, true, "mod")).status).toBe(403);
    const reply = await say("other", "reply", {rootId:root});
    expect((await pin(reply)).status).toBe(404);
    await env.DB.prepare("UPDATE comments SET card_id='foreign' WHERE id=?").bind(root).run();
    expect((await pin(root)).status).toBe(404);
  });

  it("atomically caps at three, is idempotent, audits mutations, counts outcomes and sends one notification", async () => {
    const ids = [];
    for(let i=0;i<4;i++) ids.push(await say("fan", `root ${i}`));
    const responses = await Promise.all(ids.map(id=>pin(id)));
    expect(responses.map(r=>r.status).sort()).toEqual([200,200,200,409]);
    const publicList=await json(await list());
    const pinned=publicList.comments.filter((c:any)=>c.isPinned);
    expect(pinned).toHaveLength(3);
    const id=pinned[0].commentId;
    expect((await pin(id)).status).toBe(200);
    expect((await pin(id,false)).status).toBe(200);
    expect((await pin(id,false)).status).toBe(200);
    expect((await pin(id)).status).toBe(200);
    const notices=await env.DB.prepare("SELECT * FROM community_notifications WHERE kind='comment_pinned'").all();
    expect(notices.results).toHaveLength(3);
    expect(notices.results[0]!.path).toBe(`/cards/${cardId}#comments`);
    expect(notices.results.every((n:any)=>n.delivered===1)).toBe(true);
    // A notification can age out after 30 days; the comment retains its receipt.
    await env.DB.prepare("DELETE FROM community_notifications WHERE kind='comment_pinned'").run();
    await pin(id,false); await pin(id);
    expect((await env.DB.prepare("SELECT * FROM community_notifications WHERE kind='comment_pinned'").all()).results).toHaveLength(0);
    const audits=await env.DB.prepare("SELECT action FROM audit_log WHERE action IN ('pin','unpin') AND subject_kind='comment'").all();
    expect(audits.results).toHaveLength(7);
    const metric=await env.DB.prepare("SELECT outcome,value FROM ops_metrics WHERE metric='comment_pin' AND operation='pin'").all();
    expect(metric.results).toContainEqual({outcome:'limit',value:1});
    const metrics=await import('../src/ops-metrics');
    expect(await metrics.opsMetrics(env.DB)).toContain('hearthroom_comment_pins_total{action="pin",outcome="limit"} 1');
  });

  it("pins first in chronological pin order, preserves all comments across pages and clears pins durably on hidden/deleted", async () => {
    await say("fan", "seed");
    const fan=await env.DB.prepare("SELECT member_id FROM member_identities WHERE external_id=?").bind(String(FAN)).first<{member_id:string}>();
    await env.DB.prepare('DELETE FROM comments').run();
    await env.DB.batch(Array.from({length:45},(_,i)=>env.DB.prepare('INSERT INTO comments(id,card_id,member_id,content,created_at) VALUES(?,?,?,?,?)').bind(`pin-${i}`,cardId,fan!.member_id,`text ${i}`,i)));
    await pin('pin-0'); await pin('pin-1'); await pin('pin-2');
    const pages=await Promise.all([1,2,3].map(p=>list(undefined,p).then(json)));
    expect(pages[0].comments.slice(0,3).map((c:any)=>c.commentId)).toEqual(['pin-0','pin-1','pin-2']);
    const all=pages.flatMap(p=>p.comments.map((c:any)=>c.commentId));
    expect(all).toHaveLength(45);expect(new Set(all).size).toBe(45);
    await env.DB.prepare("UPDATE comments SET hold_reason='reports' WHERE id='pin-0'").run();
    expect((await json(await list())).comments.filter((c:any)=>c.isPinned)).toHaveLength(3);
    await env.DB.prepare("UPDATE comments SET status='removed' WHERE id='pin-0'").run();
    await env.DB.prepare("UPDATE comments SET status='visible' WHERE id='pin-0'").run();
    expect((await json(await list())).comments.filter((c:any)=>c.isPinned)).toHaveLength(2);
    expect((await pin('pin-3')).status).toBe(200);
    await del('author-token','pin-1');
    expect(await env.DB.prepare("SELECT pinned_at FROM comments WHERE id='pin-1'").first()).toEqual({pinned_at:null});
    expect((await pin('pin-4')).status).toBe(200);
  });

  it("skips self notifications and respects notification preferences without leaking private card settings", async () => {
    const own=await say('author-token','own'); await pin(own);
    const id=await say('fan','opted out');
    const member=await env.DB.prepare('SELECT member_id FROM member_identities WHERE external_id=?').bind(String(FAN)).first<{member_id:string}>();
    await env.DB.prepare('INSERT INTO community_preferences(member_id,notifications) VALUES(?,0) ON CONFLICT(member_id) DO UPDATE SET notifications=0').bind(member!.member_id).run();
    await pin(id);
    expect((await env.DB.prepare("SELECT * FROM community_notifications WHERE kind='comment_pinned'").all()).results).toHaveLength(0);
    const body=await json(await list());
    expect(body.comments[0]).not.toHaveProperty('memberId');
    expect(body.comments[0]).not.toHaveProperty('settings');
  });
});
