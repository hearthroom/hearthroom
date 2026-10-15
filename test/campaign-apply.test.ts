import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import { bearer, identities, makeMember, makeReviewer, resetDb, restoreUpstream } from "./helpers";

// 申請端：提交、補件重送、我的申請。
const OWNER = 62001, OTHER = 62002, REVIEWER = 62003;
const DAY = 86_400_000;

async function call(path: string, init: { method?: string; token?: string; body?: unknown; raw?: string } = {}) {
  const headers: Record<string, string> = init.token ? bearer(init.token) : {};
  if (init.body !== undefined || init.raw !== undefined) headers["Content-Type"] = "application/json";
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request("https://c.test" + path, {
    method: init.method ?? "GET", headers, body: init.raw ?? (init.body === undefined ? undefined : JSON.stringify(init.body)),
  }), env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}
const json = async (r: Response) => (await r.json()) as any;
const code = async (r: Response) => { const b = await json(r); return `${r.status} ${b.error}${b.field ? ` ${b.field}` : ""}`; };
const op = () => crypto.randomUUID();
const count = async (sql: string, ...b: unknown[]) => (await env.DB.prepare(sql).bind(...b).first<{ n: number }>())!.n;

let owner = "", other = "", reviewer = "";
let campaignId = "";
/** 直接寫一個進行中的活動：昨天開始、9 天後結束、11 天後補件截止。 */
async function campaign(over: { slug?: string; startsAt?: number; endsAt?: number; submitDeadline?: number; status?: string } = {}) {
  const now = Date.now(), id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO campaigns (id, slug, title, starts_at, ends_at, timezone, submit_deadline, payout_deadline, tiers, extra_placement_amount, status, created_by, created_at, updated_at)
     VALUES (?, ?, '{"zh-Hant":"開站分享"}', ?, ?, 'Asia/Taipei', ?, ?, '{"light":500,"original":3000,"guide":5000,"video":10000}', 500, ?, 'test', ?, ?)`,
  ).bind(id, over.slug ?? "launch", over.startsAt ?? now - DAY, over.endsAt ?? now + 9 * DAY, over.submitDeadline ?? now + 11 * DAY, now + 20 * DAY, over.status ?? "active", now, now).run();
  return id;
}
async function evidence(memberId: string, n = 1): Promise<string[]> {
  const ids = Array.from({ length: n }, () => crypto.randomUUID());
  await env.DB.batch(ids.map((id) => env.DB.prepare("INSERT INTO share_evidence (id, member_id, r2_key, sha256, bytes, created_at) VALUES (?, ?, ?, 'h', 1, ?)").bind(id, memberId, `evidence/${id}`, Date.now())));
  return ids;
}
const form = (over: Record<string, unknown> = {}) => ({
  content: { title: "我的卡片介紹" }, platform: "tieba", location: "角色扮演吧", publishedAt: Date.now() - 60_000,
  url: "https://tieba.baidu.com/p/123", note: "", requestedTier: "original", operationId: op(), ...over,
});
const submit = (body: Record<string, unknown>, token = "owner", slug = "launch") => call(`/v1/campaigns/${slug}/placements`, { method: "POST", token, body });
const resubmit = (id: string, body: Record<string, unknown>, token = "owner") => call(`/v1/campaign/placements/${id}`, { method: "PUT", token, body: { operationId: op(), ...body } });
const mine = (token = "owner", slug = "launch") => call(`/v1/me/campaign/contents?campaign=${slug}`, { token });
const metrics = async () => (await call("/metrics")).text();

beforeEach(async () => {
  await resetDb();
  identities({ owner: OWNER, other: OTHER, reviewer: REVIEWER });
  owner = await makeMember(OWNER);
  other = await makeMember(OTHER);
  reviewer = await makeReviewer(REVIEWER);
  campaignId = await campaign();
});
afterEach(() => { restoreUpstream(); vi.restoreAllMocks(); });

describe("提交", () => {
  it("新內容＋截圖：內容、位置、截圖、兩筆稽核同時寫入；收款帳號是登入的公開帳號", async () => {
    const [shot] = await evidence(owner);
    const r = await submit(form({ url: null, evidenceIds: [shot], content: { title: " 我的卡片介紹 " } }));
    expect(r.status).toBe(200);
    const body = await json(r);
    expect(body.content).toMatchObject({ campaignSlug: "launch", title: "我的卡片介紹", cardId: null, approvedTier: null, approvedAmount: 0, paidTotal: 0, payoutState: "none" });
    expect(body.content.shareCode).toMatch(/^[A-Z0-9]{8}$/);
    expect(body.content.placements).toEqual([{
      id: body.placementId, platform: "tieba", location: "角色扮演吧", url: null, publishedAt: expect.any(Number), requestedTier: "original",
      approvedTier: null, reviewStatus: "submitted", reviewReason: null, evidence: [{ id: shot }], createdAt: expect.any(Number),
    }]);
    const row = await env.DB.prepare("SELECT member_id, recipient_account_no, campaign_id FROM share_contents WHERE id = ?").bind(body.content.id).first();
    expect(row).toEqual({ member_id: owner, recipient_account_no: OWNER, campaign_id: campaignId });
    expect(await env.DB.prepare("SELECT placement_id FROM share_evidence WHERE id = ?").bind(shot).first("placement_id")).toBe(body.placementId);
    const audits = (await env.DB.prepare("SELECT subject_kind, subject_id, action, actor_member_id, actor_kind FROM audit_log ORDER BY subject_kind").all()).results;
    expect(audits).toEqual([
      { subject_kind: "share_content", subject_id: body.content.id, action: "create", actor_member_id: owner, actor_kind: "human" },
      { subject_kind: "share_placement", subject_id: body.placementId, action: "submit", actor_member_id: owner, actor_kind: "human" },
    ]);
    expect(await metrics()).toContain('hearthroom_campaign_operations_total{operation="submit",outcome="success"} 1');
  });

  it("沿用既有內容追加位置；別人的內容 404；cardId 必須是存在的卡", async () => {
    const first = await json(await submit(form()));
    const r = await submit(form({ content: undefined, contentId: first.content.id, platform: "qq_group", location: "同好群 123", url: undefined, evidenceIds: await evidence(owner) }));
    expect(r.status).toBe(200);
    const body = await json(r);
    expect(body.content.id).toBe(first.content.id);
    expect(body.content.placements.map((p: any) => p.platform)).toEqual(["tieba", "qq_group"]);
    expect(await count("SELECT count(*) AS n FROM share_contents")).toBe(1);
    expect(await count("SELECT count(*) AS n FROM audit_log WHERE subject_kind = 'share_content'")).toBe(1);

    expect(await code(await submit(form({ content: undefined, contentId: first.content.id }), "other"))).toBe("404 share_content_not_found");
    expect(await code(await submit(form({ content: undefined, contentId: "nope" })))).toBe("404 share_content_not_found");
    // 同一個人在另一個活動的內容也不算
    await campaign({ slug: "second" });
    expect(await code(await submit(form({ content: undefined, contentId: first.content.id }), "owner", "second"))).toBe("404 share_content_not_found");

    expect(await code(await submit(form({ content: { title: "x", cardId: 999999 } })))).toBe("400 share_invalid cardId");
    await env.DB.prepare("INSERT INTO cards (id, source_role_id, author_num_id, registered_at, last_synced_at, provider) VALUES (200001, 'r1', 1, 0, 0, 'harbor')").run();
    const withCard = await json(await submit(form({ content: { title: "x", cardId: 200001 } })));
    expect(withCard.content.cardId).toBe(200001);
  });

  it("活動未開始、已結束、草稿或不存在", async () => {
    await campaign({ slug: "soon", startsAt: Date.now() + DAY });
    await campaign({ slug: "over", startsAt: Date.now() - 10 * DAY, endsAt: Date.now() - DAY });
    await campaign({ slug: "draft", status: "draft" });
    expect(await code(await submit(form(), "owner", "soon"))).toBe("409 campaign_not_open");
    expect(await code(await submit(form(), "owner", "over"))).toBe("409 campaign_not_open");
    expect(await code(await submit(form(), "owner", "draft"))).toBe("404 campaign_not_found");
    expect(await code(await submit(form(), "owner", "missing"))).toBe("404 campaign_not_found");
    expect(await code(await submit(form(), "owner", campaignId))).toBe("404 campaign_not_found");
    expect((await submit(form(), "")).status).toBe(401);
  });

  it("欄位驗證：每個錯誤都指出欄位，什麼都不寫", async () => {
    const now = Date.now();
    const cases: [Record<string, unknown>, string][] = [
      [{ url: null }, "evidence"],
      [{ url: undefined, evidenceIds: [] }, "evidence"],
      [{ url: "javascript:alert(1)" }, "url"],
      [{ url: "ftp://x.test/a" }, "url"],
      [{ url: "not a url" }, "url"],
      [{ url: `https://x.test/${"a".repeat(2000)}` }, "url"],
      [{ platform: "weibo" }, "platform"],
      [{ location: "   " }, "location"],
      [{ location: "x".repeat(201) }, "location"],
      [{ note: "x".repeat(1001) }, "note"],
      [{ requestedTier: "gold" }, "requestedTier"],
      [{ content: { title: "" } }, "title"],
      [{ content: { title: "x".repeat(121) } }, "title"],
      [{ content: undefined }, "content"],
      [{ contentId: "abc" }, "content"],
      [{ publishedAt: now + 6 * 60_000 }, "publishedAt"],
      [{ publishedAt: now - 2 * DAY }, "publishedAt"],
      [{ publishedAt: "yesterday" }, "publishedAt"],
      [{ evidenceIds: "abc" }, "evidenceIds"],
    ];
    for (const [over, field] of cases) expect(await code(await submit(form(over))), JSON.stringify(over)).toBe(`400 share_invalid ${field}`);
    expect((await submit(form({ publishedAt: now + 4 * 60_000 }))).status).toBe(200);
    expect(await code(await submit(form({ evidenceIds: [crypto.randomUUID()] })))).toBe("400 evidence_not_attachable");
    expect(await code(await call("/v1/campaigns/launch/placements", { method: "POST", token: "owner", raw: JSON.stringify(form({ note: "x".repeat(40 * 1024) })) }))).toBe("400 share_invalid body");
    expect(await count("SELECT count(*) AS n FROM share_placements")).toBe(1);
    expect(await count("SELECT count(*) AS n FROM share_contents")).toBe(1);
  });

  it("每人一分鐘最多 6 筆，第 7 筆 429；並發也越不過；別人不受影響", async () => {
    for (let i = 0; i < 5; i++) expect((await submit(form({ url: `https://x.test/${i}` }))).status).toBe(200);
    const both = await Promise.all([submit(form({ url: "https://x.test/a" })), submit(form({ url: "https://x.test/b" }))]);
    expect(both.map((r) => r.status).sort()).toEqual([200, 429]);
    expect(await code(await submit(form()))).toBe("429 campaign_rate_limited");
    expect(await count("SELECT count(*) AS n FROM share_placements")).toBe(6);
    expect(await count("SELECT count(*) AS n FROM share_contents")).toBe(6);
    expect((await submit(form(), "other")).status).toBe(200);
    // 一分鐘前的不算
    await env.DB.prepare("UPDATE share_placements SET created_at = created_at - 61000").run();
    expect((await submit(form())).status).toBe(200);
    expect(await metrics()).toContain('hearthroom_campaign_operations_total{operation="submit",outcome="denied"} 2');
  });

  it("同一個 operationId 重試回原結果、不再寫；並發同一個也只有一筆", async () => {
    const body = form();
    const a = await json(await submit(body));
    const b = await json(await submit({ ...body, url: "https://x.test/changed" }));
    expect(b.placementId).toBe(a.placementId);
    expect(b.content.id).toBe(a.content.id);
    expect(await count("SELECT count(*) AS n FROM share_placements")).toBe(1);
    expect(await count("SELECT count(*) AS n FROM audit_log")).toBe(2);

    const [shot] = await evidence(owner);
    const again = form({ evidenceIds: [shot] });
    const [x, y] = await Promise.all([submit(again), submit(again)]);
    expect([x.status, y.status]).toEqual([200, 200]);
    expect((await json(x)).placementId).toBe((await json(y)).placementId);
    expect(await count("SELECT count(*) AS n FROM share_placements")).toBe(2);
    expect(await count("SELECT count(*) AS n FROM share_contents")).toBe(2);
  });

  it("操作編號只能重送同一種動作、同一個位置；內容稽核的編號用戶端送不出來", async () => {
    const opId = op();
    const a = await json(await submit(form({ operationId: opId })));
    await env.DB.prepare("UPDATE share_placements SET review_status = 'needs_info' WHERE id = ?").bind(a.placementId).run();
    expect(await code(await resubmit(a.placementId, { note: "補", operationId: opId }))).toBe("409 campaign_operation_repeated");
    const b = await json(await submit(form({ url: "https://x.test/b" })));
    await env.DB.prepare("UPDATE share_placements SET review_status = 'needs_info' WHERE id = ?").bind(b.placementId).run();
    const re = op();
    expect((await resubmit(b.placementId, { note: "補", operationId: re })).status).toBe(200);
    await env.DB.prepare("UPDATE share_placements SET review_status = 'needs_info' WHERE id = ?").bind(a.placementId).run();
    expect(await code(await resubmit(a.placementId, { note: "補", operationId: re }))).toBe("409 campaign_operation_repeated");
    expect(await count("SELECT count(*) AS n FROM audit_log WHERE operation_id LIKE '%:content'")).toBe(2);
  });

  it("短碼撞到就重抽", async () => {
    const now = Date.now();
    await env.DB.prepare("INSERT INTO share_contents (id, campaign_id, member_id, recipient_account_no, title, share_code, created_at, updated_at) VALUES ('c0', ?, ?, 1, 't', 'AAAAAAAA', ?, ?)").bind(campaignId, other, now, now).run();
    const real = crypto.getRandomValues.bind(crypto);
    let calls = 0;
    vi.spyOn(crypto, "getRandomValues").mockImplementation(((a: Uint8Array) => (calls++ === 0 ? a.fill(0) : real(a))) as typeof crypto.getRandomValues);
    const r = await submit(form());
    expect(r.status).toBe(200);
    const code8 = (await json(r)).content.shareCode;
    expect(code8).not.toBe("AAAAAAAA");
    expect(calls).toBeGreaterThanOrEqual(2);
  });
});

describe("補件重送", () => {
  async function needsInfo() {
    const r = await json(await submit(form()));
    await env.DB.prepare("UPDATE share_placements SET review_status = 'needs_info', review_reason = '請補截圖', reviewed_by = ?, reviewed_kind = 'human', reviewed_at = ? WHERE id = ?").bind(reviewer, Date.now(), r.placementId).run();
    return r.placementId as string;
  }

  it("needs_info 可改並追加截圖：狀態 resubmitted、version+1、寫稽核", async () => {
    const id = await needsInfo();
    const shots = await evidence(owner, 2);
    const r = await resubmit(id, { location: "另一個吧", url: null, evidenceIds: shots, requestedTier: "guide", note: "補上了" });
    expect(r.status).toBe(200);
    const p = (await json(r)).content.placements[0];
    expect(p).toMatchObject({ id, location: "另一個吧", url: null, requestedTier: "guide", reviewStatus: "resubmitted", reviewReason: null });
    expect(p.evidence.map((e: any) => e.id).sort()).toEqual([...shots].sort());
    const row = await env.DB.prepare("SELECT version, note, location_key, platform FROM share_placements WHERE id = ?").bind(id).first();
    expect(row).toEqual({ version: 2, note: "補上了", location_key: "tieba:另一個吧", platform: "tieba" });
    expect(await count("SELECT count(*) AS n FROM audit_log WHERE subject_kind = 'share_placement' AND action = 'resubmit' AND subject_id = ?", id)).toBe(1);
    expect(await metrics()).toContain('hearthroom_campaign_operations_total{operation="resubmit",outcome="success"} 1');
    // 重送後不能再改
    expect(await code(await resubmit(id, { note: "again" }))).toBe("409 share_not_editable");
    expect(await metrics()).toContain('hearthroom_campaign_operations_total{operation="resubmit",outcome="denied"} 1');
  });

  it("拿掉連結又沒有截圖 400；別人的 404；approved 不能改；補件截止後 409", async () => {
    const id = await needsInfo();
    expect(await code(await resubmit(id, { url: null }))).toBe("400 share_invalid evidence");
    expect(await code(await resubmit(id, { url: "javascript:x" }))).toBe("400 share_invalid url");
    expect(await code(await resubmit(id, { note: "x" }, "other"))).toBe("404 share_placement_not_found");
    await env.DB.prepare("UPDATE campaigns SET submit_deadline = ? WHERE id = ?").bind(Date.now() - 1, campaignId).run();
    expect(await code(await resubmit(id, { note: "x" }))).toBe("409 campaign_submit_closed");
    await env.DB.prepare("UPDATE share_placements SET review_status = 'approved', approved_tier = 'original' WHERE id = ?").bind(id).run();
    await env.DB.prepare("UPDATE campaigns SET submit_deadline = ? WHERE id = ?").bind(Date.now() + DAY, campaignId).run();
    expect(await code(await resubmit(id, { note: "x" }))).toBe("409 share_not_editable");
    expect(await env.DB.prepare("SELECT version FROM share_placements WHERE id = ?").bind(id).first("version")).toBe(1);
  });

  it("同一個 operationId 重送只做一次", async () => {
    const id = await needsInfo();
    const body = { operationId: op(), note: "補上了" };
    expect((await resubmit(id, body)).status).toBe(200);
    expect((await resubmit(id, body)).status).toBe(200);
    expect(await env.DB.prepare("SELECT version FROM share_placements WHERE id = ?").bind(id).first("version")).toBe(2);
  });
});

describe("我的申請", () => {
  it("只看得到自己的；不回點數池、審核員、Provider 錯誤；理由只在補件／駁回時回；刪除的截圖不列", async () => {
    const shots = await evidence(owner, 2);
    const a = await json(await submit(form({ evidenceIds: shots })));
    await submit(form(), "other");
    await env.DB.prepare("UPDATE share_placements SET review_status = 'approved', approved_tier = 'original', review_reason = '內部備註', reviewed_by = ?, reviewed_kind = 'human', reviewed_at = 1 WHERE id = ?").bind(reviewer, a.placementId).run();
    await env.DB.prepare("UPDATE share_evidence SET purged_at = 1 WHERE id = ?").bind(shots[0]).run();
    await env.DB.prepare("INSERT INTO share_payouts (id, content_id, amount, target_total, status, error, provider_entry_id, requested_by, created_at, updated_at) VALUES ('p1', ?, 3000, 3000, 'failed', 'pool_exhausted_upstream', 'entry-x', ?, 1, 1)").bind(a.content.id, reviewer).run();
    const r = await mine();
    expect(r.headers.get("Cache-Control")).toBe("private, no-store");
    const text = await r.text();
    for (const leak of [reviewer, "pool", "內部備註", "pool_exhausted_upstream", "entry-x", "reviewedBy", "recipient"]) expect(text).not.toContain(leak);
    const { items } = JSON.parse(text);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: a.content.id, approvedTier: "original", approvedAmount: 3000, paidTotal: 0, payoutState: "processing" });
    expect(items[0].placements[0].evidence).toEqual([{ id: shots[1] }]);
    expect(items[0].placements[0].reviewReason).toBeNull();
    await env.DB.prepare("UPDATE share_placements SET review_status = 'rejected', approved_tier = NULL WHERE id = ?").bind(a.placementId).run();
    expect((await json(await mine())).items[0].placements[0].reviewReason).toBe("內部備註");
    expect((await mine("", "launch")).status).toBe(401);
    expect((await json(await mine("owner", "missing"))).items).toEqual([]);
  });

  it("發放狀態依序判斷", async () => {
    const a = await json(await submit(form()));
    const cid = a.content.id;
    const state = async () => (await json(await mine())).items[0];
    const pay = (id: string, status: string, amount: number, at: number) =>
      env.DB.prepare("INSERT INTO share_payouts (id, content_id, amount, target_total, status, requested_by, created_at, updated_at) VALUES (?, ?, ?, 3000, ?, 'x', ?, ?)").bind(id, cid, amount, status, at, at).run();
    const set = (id: string, status: string) => env.DB.prepare("UPDATE share_payouts SET status = ? WHERE id = ?").bind(status, id).run();

    expect((await state()).payoutState).toBe("none");
    await env.DB.prepare("UPDATE share_placements SET review_status = 'approved', approved_tier = 'original' WHERE id = ?").bind(a.placementId).run();
    expect(await state()).toMatchObject({ payoutState: "awaiting", approvedAmount: 3000, paidTotal: 0 });
    await pay("p1", "pending", 3000, 1);
    expect((await state()).payoutState).toBe("processing");
    await set("p1", "blocked_insufficient");
    expect((await state()).payoutState).toBe("queued");
    await set("p1", "failed");
    expect((await state()).payoutState).toBe("processing");
    await pay("p2", "cancelled", 3000, 2);
    expect((await state()).payoutState).toBe("awaiting");
    await pay("p3", "paid", 3000, 3);
    expect(await state()).toMatchObject({ payoutState: "paid", paidTotal: 3000 });
    await pay("p4", "failed", 2000, 4);
    expect((await state()).payoutState).toBe("paid");
    // 升檔後還差 2000
    await env.DB.prepare("UPDATE share_placements SET approved_tier = 'guide' WHERE id = ?").bind(a.placementId).run();
    expect(await state()).toMatchObject({ payoutState: "processing", approvedAmount: 5000 });
    // 唯一的核准位置不算數 → 0
    await env.DB.prepare("UPDATE share_placements SET counts_as_placement = 0 WHERE id = ?").bind(a.placementId).run();
    expect(await state()).toMatchObject({ payoutState: "none", approvedAmount: 0 });
  });
});
