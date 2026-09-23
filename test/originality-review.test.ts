import { SELF, env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bearer, identities, makeReviewer, resetDb, restoreUpstream, reviewOff, reviewOn, reviewUpstream, rolesOnMainSite } from "./helpers";
import { originalityReport } from "../src/originality";
import { unregister } from "../src/cards";
import { claim, needsReviewStatements, stamp } from "../src/review";

// 查重：送審時記下角色設定的指紋，審核頁拿新卡去比排隊中與已過審的卡。
const ALICE = 10001;
const BOB = 10002;
const CAROL = 10003;

/** 固定種子的假中文，不同種子之間幾乎不會碰巧連續相同。 */
function prose(seed: number, length = 240): string {
  let x = seed * 2654435761 >>> 0;
  let out = "";
  for (let i = 0; i < length; i++) {
    x = (Math.imul(x ^ (x >>> 15), 2246822507) + 0x6d2b79f5) >>> 0;
    out += String.fromCodePoint(0x4e00 + (x % 6000));
    if (i % 17 === 16) out += "，";
  }
  return out;
}

let persona = { name: "", text: "" };
const writes = (name: string, text: string) => { persona = { name, text }; };

beforeEach(async () => {
  await resetDb();
  identities({ alice: ALICE, bob: BOB, carol: CAROL, "rev-a": 20001, "rev-b": 20002, stranger: 30003 });
  rolesOnMainSite(
    { roleId: "alice-1", authorNumId: ALICE }, { roleId: "alice-2", authorNumId: ALICE },
    { roleId: "bob-1", authorNumId: BOB }, { roleId: "carol-1", authorNumId: CAROL },
  );
  reviewUpstream(() => ({ document: { roleName: persona.name, userName: "{{user}}", roleDetailDesc: persona.text } }));
  reviewOn();
  await makeReviewer(20001);
  await makeReviewer(20002);
});
afterEach(() => { restoreUpstream(); reviewOff(); });

const submit = async (roleId: string, token: string) => {
  const res = await SELF.fetch("https://c.test/v1/cards", {
    method: "POST", headers: { "Content-Type": "application/json", ...bearer(token) },
    body: JSON.stringify({ roleId, nsfw: false, operationId: crypto.randomUUID() }),
  });
  expect(res.ok).toBe(true);
  return (await env.DB.prepare(
    "SELECT s.id, s.card_id FROM review_submissions s JOIN hosting_versions v ON v.submission_id = s.id WHERE v.source_role_id = ? AND s.status = 'pending'",
  ).bind(roleId).first<{ id: string; card_id: string }>())!;
};
const generations = new Map<string, string>();
const act = async (id: string, action: string, token: string, body: Record<string, unknown> = {}) => {
  const res = await SELF.fetch(`https://c.test/v1/review/${id}/${action}`, {
    method: "POST", headers: { "Content-Type": "application/json", ...bearer(token) },
    body: JSON.stringify({ ...body, ...(action === "claim" ? {} : { generation: generations.get(id + token) }) }),
  });
  if (action === "claim" && res.ok) generations.set(id + token, ((await res.clone().json()) as any).generation);
  return res;
};
const decide = async (id: string, verdict: "approve" | "reject") => {
  for (const token of verdict === "approve" ? ["rev-a", "rev-b"] : ["rev-a"]) {
    // 改版重審只要一章，第一章蓋完單子就定案了
    if (!(await act(id, "claim", token)).ok) break;
    expect((await act(id, "stamp", token, { verdict, note: "n" })).status).toBe(200);
  }
};
const check = async (id: string, token = "rev-a") => SELF.fetch(`https://c.test/v1/review/${id}/originality`, { headers: bearer(token) });
const report = async (id: string) => {
  await act(id, "claim", "rev-a");
  const res = await check(id);
  expect(res.status).toBe(200);
  return (await res.json()) as any;
};
const indexed = async (submissionId: string) =>
  (await env.DB.prepare("SELECT COUNT(*) AS n FROM originality_prints p JOIN originality_texts t ON t.id = p.text_id WHERE t.submission_id = ?")
    .bind(submissionId).first<{ n: number }>())!.n;

describe("查重", () => {
  it("抓得到改名、插標點的複製，指出來源卡，不露作者", async () => {
    const original = prose(1);
    writes("艾琳", "艾琳是" + original);
    const first = await submit("alice-1", "alice");
    expect(await indexed(first.id)).toBeGreaterThan(0);
    await decide(first.id, "approve");

    const copied = [...original].map((c, i) => (i % 29 === 0 ? c + "、" : c)).join("");
    writes("露娜", "露娜是" + copied + prose(2, 30));
    const copy = await submit("bob-1", "bob");
    const body = await report(copy.id);
    expect(body.available).toBe(true);
    expect(body.similarity).toBeGreaterThan(0.8);
    expect(body.comparedCards).toBe(1);
    expect(body.sources).toHaveLength(1);
    expect(body.sources[0]).toMatchObject({ cardId: String(first.card_id), status: "approved", earlier: true });
    expect(body.sources[0].segments.length).toBeGreaterThan(0);
    expect(JSON.stringify(body)).not.toContain(String(ALICE));
    expect(JSON.stringify(body)).not.toContain(original.slice(0, 20));
  });

  it("不相干的卡是 0；作者自己的其他卡不算", async () => {
    writes("甲", prose(3));
    const a1 = await submit("alice-1", "alice");
    writes("乙", prose(3));
    const a2 = await submit("alice-2", "alice");
    expect((await report(a2.id))).toMatchObject({ available: true, similarity: 0, comparedCards: 0, sources: [] });
    writes("丙", prose(4));
    const b = await submit("bob-1", "bob");
    expect(await report(b.id)).toMatchObject({ similarity: 0, comparedCards: 2, sources: [] });
    expect(a1.id).not.toBe(a2.id);
  });

  it("排隊中的卡彼此也比得到；駁回的指紋刪掉，不再當來源", async () => {
    const text = prose(5);
    writes("甲", text);
    const bob = await submit("bob-1", "bob");
    writes("乙", text);
    const carol = await submit("carol-1", "carol");
    expect((await report(carol.id)).sources[0]).toMatchObject({ cardId: String(bob.card_id), status: "pending", earlier: true });
    await act(carol.id, "release", "rev-a");

    await decide(bob.id, "reject");
    expect(await indexed(bob.id)).toBe(0);
    await act(carol.id, "claim", "rev-b");
    const again = (await (await check(carol.id, "rev-b")).json()) as any;
    expect(again).toMatchObject({ similarity: 0, sources: [] });
  });

  it("跟審核頁同一道門：要領著才看得到，非審核人擋掉", async () => {
    writes("甲", prose(6));
    const s = await submit("bob-1", "bob");
    expect((await check(s.id)).status).toBe(409);
    expect((await check(s.id, "stranger")).status).toBe(403);
  });

  it("排隊中撤回，指紋跟著刪", async () => {
    writes("甲", prose(7));
    const s = await submit("bob-1", "bob");
    expect(await indexed(s.id)).toBeGreaterThan(0);
    await env.DB.prepare("DELETE FROM review_submissions WHERE id = ?").bind(s.id).run();
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM originality_prints").first<{ n: number }>())!.n).toBe(0);
  });

  it("同一張卡只留最新過審的版本；作者撤下過審卡後仍比得到，標成已撤下", async () => {
    writes("甲", prose(9));
    const v1 = await submit("alice-1", "alice");
    await decide(v1.id, "approve");
    const text = prose(10);
    writes("甲", text);
    const v2 = await submit("alice-1", "alice");
    await decide(v2.id, "approve");
    const rows = await env.DB.prepare("SELECT submission_id FROM originality_texts").all<{ submission_id: string }>();
    expect(rows.results.map((r) => r.submission_id)).toEqual([v2.id]);

    await unregister(env.DB, "alice-1", ALICE, "harbor");
    writes("乙", text);
    const bob = await submit("bob-1", "bob");
    expect((await report(bob.id)).sources[0]).toMatchObject({ cardId: String(v2.card_id), status: "removed" });
  });

  it("來源卡改版過審後，送審先後仍以那張卡第一次進索引的時間為準", async () => {
    const text = prose(12);
    writes("甲", text);
    const v1 = await submit("alice-1", "alice");
    await decide(v1.id, "approve");
    await env.DB.prepare("UPDATE originality_texts SET created_at = created_at - 3600000 WHERE submission_id = ?").bind(v1.id).run();
    writes("乙", text);
    const bob = await submit("bob-1", "bob");
    writes("甲", text + prose(13, 40));
    const v2 = await submit("alice-1", "alice");
    await decide(v2.id, "approve");
    expect((await report(bob.id)).sources[0]).toMatchObject({ cardId: String(v1.card_id), earlier: true });
  });

  it("公開資料變更開的重審單過審，不會清掉這張卡原本的指紋", async () => {
    writes("甲", prose(11));
    const v1 = await submit("alice-1", "alice");
    await decide(v1.id, "approve");
    await env.DB.batch(needsReviewStatements(env.DB, { cardId: v1.card_id, provider: "harbor", roleId: "alice-1", contentHash: "pub1:x", now: Date.now() }));
    const re = (await env.DB.prepare("SELECT id FROM review_submissions WHERE status = 'pending'").first<{ id: string }>())!;
    await claim(env.DB, re.id, "rev-x", Date.now());
    expect((await stamp(env.DB, { submissionId: re.id, memberId: "rev-x", verdict: "approve", note: "", now: Date.now() })).cardStatus).toBe("approved");
    expect(await indexed(v1.id)).toBeGreaterThan(0);
  });

  it("沒有快照的重審單、或角色設定太短，回「無法查重」而不是 0%", async () => {
    const sub = { id: "x", submitted_at: 0 };
    expect(await originalityReport(env.DB, sub, null, "zh")).toEqual({ available: false, reason: "no_snapshot" });
    expect(await originalityReport(env.DB, sub, { partial: true, document: { roleDetailDesc: prose(8) } }, "zh")).toEqual({ available: false, reason: "no_snapshot" });
    expect(await originalityReport(env.DB, sub, { document: { roleDetailDesc: "太短了" } }, "zh")).toEqual({ available: false, reason: "too_short" });
  });
});
