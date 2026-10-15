import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import { pushLine, PUSH_LOCALES } from "../src/community/push";
import { upstream } from "../src/upstream";
import { appAdmins, bearer, identities, makeAgent, makeMember, makeReviewer, resetDb, restoreUpstream, testHandle } from "./helpers";

// 審核端：佇列、內容明細（重複標示）、決定與通知。
const OWNER = 63001, OTHER = 63002, REVIEWER = 63003, AGENT = 63004, MEMBER = 63005;
const DAY = 86_400_000;

async function call(path: string, init: { method?: string; token?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = init.token ? bearer(init.token) : {};
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request("https://c.test" + path, { method: init.method ?? "GET", headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) }), env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}
const json = async (r: Response) => (await r.json()) as any;
const code = async (r: Response) => { const b = await json(r); return `${r.status} ${b.error}${b.field ? ` ${b.field}` : ""}`; };
const op = () => crypto.randomUUID();
const count = async (sql: string, ...b: unknown[]) => (await env.DB.prepare(sql).bind(...b).first<{ n: number }>())!.n;
const metrics = async () => (await call("/metrics")).text();

let owner = "", other = "", reviewer = "", campaignId = "";
async function campaign(over: { slug?: string; submitDeadline?: number; burst?: number | null } = {}) {
  const now = Date.now(), id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO campaigns (id, slug, title, starts_at, ends_at, timezone, submit_deadline, payout_deadline, tiers, extra_placement_amount, flag_burst_threshold, status, created_by, created_at, updated_at)
     VALUES (?, ?, '{"zh-Hant":"開站分享"}', ?, ?, 'Asia/Taipei', ?, ?, '{"light":500,"original":3000,"guide":5000,"video":10000}', 500, ?, 'active', 'test', ?, ?)`,
  ).bind(id, over.slug ?? "launch", now - 5 * DAY, now + 9 * DAY, over.submitDeadline ?? now + 11 * DAY, now + 20 * DAY, over.burst === undefined ? null : over.burst, now, now).run();
  return id;
}
async function content(memberId: string, accountNo: number, cId = campaignId) {
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO share_contents (id, campaign_id, member_id, recipient_account_no, title, share_code, created_at, updated_at) VALUES (?, ?, ?, ?, '介紹', ?, ?, ?)")
    .bind(id, cId, memberId, accountNo, id.slice(0, 8).toUpperCase(), Date.now(), Date.now()).run();
  return id;
}
async function placement(contentId: string, over: { key?: string; createdAt?: number; status?: string; approvedTier?: string | null; requestedTier?: string } = {}) {
  const id = crypto.randomUUID(), at = over.createdAt ?? Date.now();
  await env.DB.prepare(
    `INSERT INTO share_placements (id, content_id, platform, location, location_key, published_at, url, requested_tier, approved_tier, review_status, created_at, updated_at)
     VALUES (?, ?, 'tieba', '角色扮演吧', ?, ?, 'https://tieba.baidu.com/p/1', ?, ?, ?, ?, ?)`,
  ).bind(id, contentId, over.key ?? `url:${id}`, at - 60_000, over.requestedTier ?? "original", over.approvedTier ?? null, over.status ?? "submitted", at, at).run();
  return id;
}
async function shot(memberId: string, placementId: string | null, sha: string) {
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO share_evidence (id, member_id, placement_id, r2_key, sha256, bytes, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)").bind(id, memberId, placementId, `evidence/${id}`, sha, Date.now()).run();
  return id;
}
const queue = (q = "", token = "reviewer") => call(`/v1/moderation/campaign/placements${q}`, { token });
const detail = (id: string, token = "reviewer") => call(`/v1/moderation/campaign/contents/${id}`, { token });
const decide = (id: string, body: Record<string, unknown>, token = "reviewer") =>
  call(`/v1/moderation/campaign/placements/${id}/decision`, { method: "POST", token, body: { expectedVersion: 1, operationId: op(), ...body } });
const row = (id: string) => env.DB.prepare("SELECT review_status, approved_tier, counts_as_placement, review_reason, reviewed_by, reviewed_kind, version FROM share_placements WHERE id = ?").bind(id).first<any>();
const notes = (memberId: string) => env.DB.prepare("SELECT event_key, kind, path, extra FROM community_notifications WHERE member_id = ? ORDER BY created_at, event_key").bind(memberId).all<any>().then((r) => r.results);

beforeEach(async () => {
  await resetDb();
  identities({ owner: OWNER, other: OTHER, reviewer: REVIEWER, agent: AGENT, member: MEMBER });
  // 真人核准後會問 Provider 是不是應用管理員（是才自動發放）；這裡的審核員都不是，也不打真的網路。
  appAdmins();
  owner = await makeMember(OWNER);
  other = await makeMember(OTHER);
  await makeMember(MEMBER);
  reviewer = await makeReviewer(REVIEWER);
  await makeAgent(AGENT);
  campaignId = await campaign();
});
afterEach(() => { restoreUpstream(); vi.restoreAllMocks(); });

describe("佇列", () => {
  it("只有審核員（含 AI 帳號）看得到；預設待審與重送合併、舊的在前；可依狀態與活動篩選", async () => {
    const c = await content(owner, OWNER);
    const now = Date.now();
    const a = await placement(c, { createdAt: now - 3000 });
    const b = await placement(c, { createdAt: now - 2000, status: "resubmitted" });
    const n = await placement(c, { createdAt: now - 1000, status: "needs_info" });
    expect((await queue("", "member")).status).toBe(403);
    expect((await queue("", "")).status).toBe(401);
    const r = await queue();
    expect(r.status).toBe(200);
    expect(r.headers.get("Cache-Control")).toBe("private, no-store");
    const body = await json(r);
    expect(body.total).toBe(2);
    expect(body.items.map((x: any) => x.id)).toEqual([a, b]);
    expect(body.items[0]).toMatchObject({
      contentId: c, contentTitle: "介紹", campaignSlug: "launch", applicant: { handle: testHandle(OWNER) }, platform: "tieba", requestedTier: "original",
      reviewStatus: "submitted", version: 1, evidenceCount: 0, flags: { duplicateLocation: false, duplicateImage: false, burst: false },
    });
    expect(JSON.stringify(body)).not.toContain(owner);
    expect((await json(await queue("?status=needs_info", "agent"))).items.map((x: any) => x.id)).toEqual([n]);
    expect(await code(await queue("?status=bogus"))).toBe("400 share_invalid status");
    await campaign({ slug: "second" });
    expect((await json(await queue("?campaign=second"))).items).toEqual([]);
    expect((await json(await queue("?campaign=launch"))).items).toHaveLength(2);
  });

  it("重複位置：同一份內容裡相同 location_key 才算；別人的內容同一個位置不算", async () => {
    const c = await content(owner, OWNER), d = await content(other, OTHER);
    const a = await placement(c, { key: "url:x.test/1" });
    const b = await placement(c, { key: "url:x.test/1" });
    const lone = await placement(c, { key: "url:x.test/2" });
    const elsewhere = await placement(d, { key: "url:x.test/2" });
    const flags = Object.fromEntries((await json(await queue())).items.map((x: any) => [x.id, x.flags.duplicateLocation]));
    expect(flags).toEqual({ [a]: true, [b]: true, [lone]: false, [elsewhere]: false });
  });

  it("重複截圖：同雜湊、已掛在別的位置（跨內容跨人）才算；沒掛上的或不同雜湊不算", async () => {
    const c = await content(owner, OWNER), d = await content(other, OTHER);
    const a = await placement(c), b = await placement(d), unique = await placement(c), loose = await placement(c);
    await shot(owner, a, "same");
    await shot(other, b, "same");
    await shot(owner, unique, "solo");
    await shot(owner, loose, "orphan");
    await shot(other, null, "orphan");
    const flags = Object.fromEntries((await json(await queue())).items.map((x: any) => [x.id, x.flags.duplicateImage]));
    expect(flags).toEqual({ [a]: true, [b]: true, [unique]: false, [loose]: false });
  });

  it("大量提交：前 24 小時內本人的提交數達門檻才標（門檻 N 標第 N+1 筆）；沒設門檻不標", async () => {
    const now = Date.now();
    const c = await content(owner, OWNER);
    const old = await placement(c, { createdAt: now - 2 * DAY });
    const p1 = await placement(c, { createdAt: now - 3000 });
    const p2 = await placement(c, { createdAt: now - 2000 });
    const p3 = await placement(c, { createdAt: now - 1000 });
    const burst = async () => Object.fromEntries((await json(await queue())).items.map((x: any) => [x.id, x.flags.burst]));
    expect(await burst()).toEqual({ [old]: false, [p1]: false, [p2]: false, [p3]: false });
    await env.DB.prepare("UPDATE campaigns SET flag_burst_threshold = 2").run();
    expect(await burst()).toEqual({ [old]: false, [p1]: false, [p2]: false, [p3]: true });
  });
});

describe("內容明細", () => {
  it("位置、截圖、重複明細（只有對方內容 id 與 handle）、計算結果、發放紀錄與申請人的其他內容", async () => {
    const c = await content(owner, OWNER), d = await content(other, OTHER), mine2 = await content(owner, OWNER);
    const a = await placement(c, { key: "k", status: "approved", approvedTier: "original" });
    const b = await placement(c, { key: "k" });
    const theirs = await placement(d);
    const s = await shot(owner, a, "same");
    await shot(other, theirs, "same");
    await env.DB.batch([
      env.DB.prepare("INSERT INTO share_payouts (id, content_id, amount, target_total, status, requested_by, created_at, updated_at) VALUES ('pay-1', ?, 1000, 3000, 'paid', ?, 1, 1)").bind(c, reviewer),
      env.DB.prepare("INSERT INTO share_payouts (id, content_id, amount, target_total, status, requested_by, created_at, updated_at) VALUES ('pay-2', ?, 700, 700, 'paid', ?, 1, 1)").bind(mine2, reviewer),
    ]);
    expect((await detail(c, "member")).status).toBe(403);
    expect(await code(await detail("nope"))).toBe("404 share_content_not_found");
    const r = await detail(c, "agent");
    expect(r.status).toBe(200);
    const body = await json(r);
    expect(body.content).toMatchObject({ id: c, campaignSlug: "launch", title: "介紹", applicant: { handle: testHandle(OWNER) } });
    expect(body.payout).toEqual({ tier: "original", target: 3000, due: 2000 });
    expect(body.paidTotal).toBe(1000);
    expect(body.payouts).toEqual([expect.objectContaining({ id: "pay-1", amount: 1000, status: "paid" })]);
    expect(body.history).toEqual([expect.objectContaining({ id: mine2, paidTotal: 700 })]);
    const pa = body.placements.find((p: any) => p.id === a), pb = body.placements.find((p: any) => p.id === b);
    expect(pa.evidence).toEqual([{ id: s, purged: false }]);
    expect(pa.duplicates).toEqual({ location: [b], image: [{ contentId: d, handle: testHandle(OTHER) }] });
    expect(pa.flags).toEqual({ duplicateLocation: true, duplicateImage: true, burst: false });
    expect(pb.duplicates).toEqual({ location: [a], image: [] });
    const text = JSON.stringify(body);
    for (const secret of [owner, other, reviewer, String(OWNER), String(OTHER)]) expect(text).not.toContain(secret);
  });
});

describe("決定", () => {
  let c = "", p = "";
  beforeEach(async () => { c = await content(owner, OWNER); p = await placement(c, { requestedTier: "original" }); });

  it("真人核准：沒給檔位用申請的檔位；稽核一筆；通知一筆；payout 為 null；只有審核員能決定", async () => {
    expect((await decide(p, { decision: "approve" }, "member")).status).toBe(403);
    const r = await decide(p, { decision: "approve" });
    expect(r.status).toBe(200);
    const body = await json(r);
    expect(body).toEqual({ placement: expect.objectContaining({ id: p, reviewStatus: "approved", approvedTier: "original", countsAsPlacement: true, reviewedKind: "human", version: 2 }), payout: null });
    expect(await row(p)).toMatchObject({ review_status: "approved", approved_tier: "original", reviewed_by: reviewer, reviewed_kind: "human", version: 2 });
    const audit = await env.DB.prepare("SELECT actor_member_id, actor_kind, action, before_json, after_json FROM audit_log WHERE subject_kind = 'share_placement' AND subject_id = ?").bind(p).all<any>();
    expect(audit.results).toHaveLength(1);
    expect(audit.results[0]).toMatchObject({ actor_member_id: reviewer, actor_kind: "human", action: "decide" });
    expect(JSON.parse(audit.results[0].before_json)).toMatchObject({ reviewStatus: "submitted", approvedTier: null, version: 1 });
    expect(JSON.parse(audit.results[0].after_json)).toMatchObject({ reviewStatus: "approved", approvedTier: "original", version: 2 });
    expect(await notes(owner)).toEqual([{ event_key: `share:${p}:2:share_approved`, kind: "share_approved", path: "/me/campaign", extra: null }]);
    expect(await metrics()).toContain('hearthroom_campaign_operations_total{operation="decide",outcome="success"} 1');
  });

  it("拒絕要理由；通知帶理由；已拒絕不能再改", async () => {
    expect(await code(await decide(p, { decision: "reject" }))).toBe("400 share_invalid reason");
    expect(await code(await decide(p, { decision: "reject", reason: "x".repeat(501) }))).toBe("400 share_invalid reason");
    // 長度以字元（code point）計：500 個 emoji 可以
    expect(await code(await decide(p, { decision: "reject", reason: "😀".repeat(501) }))).toBe("400 share_invalid reason");
    expect(await code(await decide(p, { decision: "maybe" }))).toBe("400 share_invalid decision");
    expect(await code(await decide(p, { decision: "approve", tier: "gold" }))).toBe("400 share_invalid tier");
    expect(await code(await decide(p, { decision: "approve", expectedVersion: "1" }))).toBe("400 share_invalid expectedVersion");
    expect((await decide(p, { decision: "reject", reason: " 連結打不開 " })).status).toBe(200);
    expect(await row(p)).toMatchObject({ review_status: "rejected", approved_tier: null, review_reason: "連結打不開", version: 2 });
    const [n] = await notes(owner);
    expect(n).toMatchObject({ kind: "share_rejected", path: "/me/campaign" });
    expect(JSON.parse(n.extra)).toEqual({ reason: "連結打不開" });
    expect(await code(await decide(p, { decision: "approve", expectedVersion: 2 }))).toBe("409 share_already_decided");
    expect((await decide(await placement(c), { decision: "reject", reason: "😀".repeat(500) })).status).toBe(200);
    expect(await metrics()).toContain('hearthroom_campaign_operations_total{operation="decide",outcome="denied"}');
  });

  it("退回補件：通知帶理由；補件截止後不能再退回", async () => {
    expect((await decide(p, { decision: "needs_info", reason: "請補截圖" })).status).toBe(200);
    expect(await row(p)).toMatchObject({ review_status: "needs_info", review_reason: "請補截圖", version: 2 });
    const [n] = await notes(owner);
    expect(n).toMatchObject({ event_key: `share:${p}:2:share_needs_info`, kind: "share_needs_info" });
    expect(JSON.parse(n.extra)).toEqual({ reason: "請補截圖" });

    await env.DB.prepare("UPDATE campaigns SET submit_deadline = ?").bind(Date.now() - 1000).run();
    const q = await placement(c);
    expect(await code(await decide(q, { decision: "needs_info", reason: "請補" }))).toBe("409 campaign_submit_closed");
    expect((await decide(q, { decision: "approve" })).status).toBe(200);
  });

  it("已核准只能再核准改檔位或是否算位置；改檔位寫稽核、不再通知；不能改成拒絕", async () => {
    expect((await decide(p, { decision: "approve" })).status).toBe(200);
    expect(await code(await decide(p, { decision: "reject", reason: "改主意", expectedVersion: 2 }))).toBe("409 share_already_decided");
    expect(await code(await decide(p, { decision: "needs_info", reason: "補", expectedVersion: 2 }))).toBe("409 share_already_decided");
    const r = await decide(p, { decision: "approve", tier: "guide", countsAsPlacement: false, reason: "其實是攻略", expectedVersion: 2 });
    expect(r.status).toBe(200);
    expect(await row(p)).toMatchObject({ review_status: "approved", approved_tier: "guide", counts_as_placement: 0, version: 3 });
    const audit = await env.DB.prepare("SELECT reason, before_json, after_json FROM audit_log WHERE subject_id = ? AND action = 'decide' ORDER BY created_at DESC, rowid DESC LIMIT 1").bind(p).first<any>();
    expect(audit.reason).toBe("其實是攻略");
    expect(JSON.parse(audit.before_json)).toMatchObject({ approvedTier: "original", countsAsPlacement: true });
    expect(JSON.parse(audit.after_json)).toMatchObject({ approvedTier: "guide", countsAsPlacement: false });
    expect((await notes(owner)).map((n: any) => n.kind)).toEqual(["share_approved"]);
    // 再改一次沒給理由：保留上一次的理由；審核欄位是最後一位決定者
    expect((await decide(p, { decision: "approve", countsAsPlacement: true, expectedVersion: 3 }, "agent")).status).toBe(200);
    expect(await row(p)).toMatchObject({ review_reason: "其實是攻略", reviewed_kind: "ai", counts_as_placement: 1, version: 4 });
  });

  it("並發兩個決定只有一個生效：另一個 409 帶目前版本；稽核與通知各一筆", async () => {
    // 兩個都是核准（已核准再核准也合法）：只有版本條件擋得住第二個
    const [x, y] = await Promise.all([decide(p, { decision: "approve", tier: "light" }), decide(p, { decision: "approve", tier: "guide" })]);
    const statuses = [x.status, y.status].sort();
    expect(statuses).toEqual([200, 409]);
    const loser = x.status === 409 ? x : y;
    expect(await json(loser)).toEqual({ error: "share_version_conflict", version: 2 });
    expect(await count("SELECT count(*) AS n FROM audit_log WHERE subject_id = ? AND action = 'decide'", p)).toBe(1);
    expect(await count("SELECT count(*) AS n FROM community_notifications WHERE member_id = ?", owner)).toBe(1);
    // 舊版本號的決定也是衝突
    expect(await json(await decide(p, { decision: "approve" }))).toEqual({ error: "share_version_conflict", version: 2 });
  });

  it("同一個操作編號重送回目前狀態不重寫；拿去決定別的位置或別種操作是衝突", async () => {
    const id = op();
    const first = await decide(p, { decision: "approve", operationId: id });
    const again = await decide(p, { decision: "approve", operationId: id });
    expect(again.status).toBe(200);
    expect(await json(again)).toEqual(await json(first));
    expect(await count("SELECT count(*) AS n FROM audit_log WHERE subject_id = ?", p)).toBe(1);
    const q = await placement(c);
    expect(await code(await decide(q, { decision: "approve", operationId: id }))).toBe("409 campaign_operation_repeated");
    // 同時送兩次同一個編號：只寫一次
    const id2 = op(), q2 = await placement(c);
    const both = await Promise.all([decide(q2, { decision: "approve", operationId: id2 }), decide(q2, { decision: "approve", operationId: id2 })]);
    expect(both.map((r) => r.status)).toEqual([200, 200]);
    expect(await count("SELECT count(*) AS n FROM audit_log WHERE subject_id = ?", q2)).toBe(1);
  });

  it("AI 帳號核准：reviewed_kind=ai、稽核記 AI 的理由、payout 永遠 null（停在待發放）", async () => {
    const r = await decide(p, { decision: "approve", reason: "截圖與連結一致" }, "agent");
    expect(r.status).toBe(200);
    expect((await json(r)).payout).toBeNull();
    expect(await row(p)).toMatchObject({ review_status: "approved", reviewed_kind: "ai" });
    expect(await env.DB.prepare("SELECT actor_kind, reason FROM audit_log WHERE subject_id = ?").bind(p).first()).toEqual({ actor_kind: "ai", reason: "截圖與連結一致" });
    expect(await count("SELECT count(*) AS n FROM share_payouts")).toBe(0);
  });

  it("關閉通知的人不收；審核員不能決定自己的申請", async () => {
    await env.DB.prepare("INSERT INTO community_preferences (member_id, notifications) VALUES (?, 0)").bind(owner).run();
    expect((await decide(p, { decision: "needs_info", reason: "補" })).status).toBe(200);
    expect(await notes(owner)).toEqual([]);
    const self = await placement(await content(reviewer, REVIEWER));
    expect(await code(await decide(self, { decision: "approve" }))).toBe("403 share_self_review");
    // 收款帳號是審核員自己的 Harbor 帳號：連結過來的帳號，或解除連結前留在原成員下的內容
    await env.DB.prepare("INSERT INTO member_connections (provider, external_id, owner_member_id, linked_at) VALUES ('harbor', ?, ?, ?)").bind(String(OTHER), reviewer, Date.now()).run();
    const linked = await placement(await content(other, OTHER));
    expect(await code(await decide(linked, { decision: "approve" }))).toBe("403 share_self_review");
    const unlinked = await placement(await content(other, REVIEWER));
    expect(await code(await decide(unlinked, { decision: "approve" }))).toBe("403 share_self_review");
    expect(await code(await decide(unlinked, { decision: "approve" }, "agent"))).not.toBe("403 share_self_review");
    expect(await code(await decide("nope", { decision: "approve" }))).toBe("404 share_placement_not_found");
  });

  it("決定路由不會被算進留言審核的指標", async () => {
    expect((await decide(p, { decision: "reject", action: "remove" })).status).toBe(400);
    expect(await metrics()).not.toContain('hearthroom_comment_moderation_total{action="remove"');
  });
});

describe("通知文案", () => {
  const KINDS = ["share_needs_info", "share_approved", "share_rejected", "share_paid", "share_queued"];
  const BANNED = /\bAPI\b|pool|tier|點數池|点数池/i;

  it("推播五語都有、不是通用句、不含內部詞", () => {
    for (const locale of PUSH_LOCALES) {
      const generic = pushLine({ kind: "unknown_kind", extra: null, actor_name: null, actor_handle: null, card_names: null }, locale);
      const lines = KINDS.map((kind) => pushLine({ kind, extra: JSON.stringify({ reason: "理由" }), actor_name: null, actor_handle: null, card_names: null }, locale));
      expect(new Set(lines).size, locale).toBe(KINDS.length);
      for (const line of lines) {
        expect(line, locale).not.toBe(generic);
        expect(line, locale).not.toMatch(BANNED);
      }
    }
    expect(pushLine({ kind: "share_approved", extra: null, actor_name: null, actor_handle: null, card_names: null }, "zh-Hant")).toBe("你的分享申請通過了");
  });

  it("站內通知五語都有對應文字、不含內部詞", () => {
    // 型別宣告在 campaign-evidence.test.ts（import.meta.glob 只補這一個成員）。
    const files = import.meta.glob<string>("../web/src/locales/*.json", { query: "?raw", import: "default", eager: true });
    const dicts = Object.fromEntries(Object.entries(files).map(([path, raw]) => [path.replace(/^.*\/|\.json$/g, ""), JSON.parse(raw) as Record<string, string>]));
    expect(Object.keys(dicts).sort()).toEqual(["en", "ja", "ko", "zh-Hans", "zh-Hant"]);
    for (const [locale, dict] of Object.entries(dicts)) {
      for (const kind of KINDS) {
        const text = dict[`community.notices.${kind}`];
        expect(text, `${locale} ${kind}`).toBeTruthy();
        expect(text).not.toMatch(BANNED);
      }
    }
    expect(dicts["zh-Hant"]!["community.notices.share_queued"]).toBe("分享獎勵排隊發放中");
  });
});
