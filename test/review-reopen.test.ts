import { SELF, env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { legacyPolicyFixture } from "./work-policy-fixture";
import { bearer, identities, makeReviewer, makeAgent, ratingBody, resetDb, restoreUpstream, reviewOff, reviewOn, reviewUpstream, rolesOnMainSite, sealedReads } from "./helpers";
import { pendingSubmissionOf, statusAmong } from "../src/review";

// 重新審核（審核員 2026-11-08，卡 100855）：已通過的卡由一位審核員發起，回到待審清單重審。
// 重審期間照常公開；任一審核員可「維持通過」；駁回限管理員，走改判（作者收到駁回說明）；
// 管理員可撤銷；作者只看到「重新審核中」。
const AUTHOR = 10001, REVIEWER_A = 20001, REVIEWER_B = 20002, MANAGER = 20003, AGENT = 20004;

beforeEach(async () => {
  await resetDb(); legacyPolicyFixture();
  identities({ author: AUTHOR, "rev-a": REVIEWER_A, "rev-b": REVIEWER_B, mgr: MANAGER, agent: AGENT });
  rolesOnMainSite({ roleId: "role-1", authorNumId: AUTHOR });
  reviewUpstream(); reviewOn();
  await makeReviewer(REVIEWER_A); await makeReviewer(REVIEWER_B); await makeAgent(AGENT);
  const mgr = await makeReviewer(MANAGER);
  await env.DB.prepare("UPDATE reviewers SET role='manager' WHERE member_id=?").bind(mgr).run();
});
afterEach(() => { restoreUpstream(); reviewOff(); });

const json = { "Content-Type": "application/json" };
const generations = new Map<string, string>();
const act = async (id: string, action: string, token: string, body?: unknown) => {
  const res = await SELF.fetch(`https://c.test/v1/review/${id}/${action}`, { method: "POST", headers: { ...json, ...bearer(token) }, body: JSON.stringify({ ...((body ?? {}) as object), ...(action === "claim" ? {} : { generation: generations.get(id + token) }) }) });
  if (action === "claim" && res.ok) generations.set(id + token, ((await res.clone().json()) as any).generation);
  return res;
};
const code = async (res: Response) => ((await res.json()) as any).error;
const submit = async () => {
  const pending = await env.DB.prepare("SELECT v.operation_id FROM hosting_versions v JOIN review_submissions s ON s.id=v.submission_id WHERE v.source_role_id='role-1' AND s.status='pending'").first<{ operation_id: string }>();
  const res = await SELF.fetch("https://c.test/v1/cards", { method: "POST", headers: { ...json, ...bearer("author") }, body: JSON.stringify({ roleId: "role-1", ...ratingBody(false), operationId: pending?.operation_id ?? crypto.randomUUID() }) });
  expect(res.status).toBeLessThan(300);
};
const latestAuthorSubmission = async () => (await env.DB.prepare("SELECT id FROM review_submissions WHERE reopen_of IS NULL ORDER BY rowid DESC LIMIT 1").first<{ id: string }>())!.id;
const approve = async (id: string, token = "rev-a") => {
  expect((await act(id, "claim", token)).status).toBe(200);
  expect((await act(id, "stamp", token, { verdict: "approve" })).status).toBe(200);
};
/** 一張已發布的卡，回傳卡號與通過的那張單 */
const published = async () => {
  await submit();
  const original = await latestAuthorSubmission();
  await approve(original);
  const card = (await env.DB.prepare("SELECT id, reviewed_hash, approved_version_id FROM cards").first<{ id: number; reviewed_hash: string; approved_version_id: string }>())!;
  return { cardId: String(card.id), original, card };
};
const reopen = (cardId: string, token: string, reason = "疑似盜用他人設定") =>
  SELF.fetch(`https://c.test/v1/moderation/cards/${cardId}/reopen`, { method: "POST", headers: { ...json, ...bearer(token) }, body: JSON.stringify({ reason }) });
const queue = async (token: string) => ((await (await SELF.fetch("https://c.test/v1/review/queue", { headers: bearer(token) })).json()) as { items: any[] }).items;
const board = async () => ((await (await SELF.fetch("https://c.test/v1/cards")).json()) as { items: unknown[] }).items;
const cardRow = async () => (await env.DB.prepare("SELECT status, reviewed_hash, approved_version_id FROM cards").first<{ status: string; reviewed_hash: string; approved_version_id: string | null }>())!;
const metric = async (operation: string, outcome: string) =>
  (await env.DB.prepare("SELECT value FROM ops_metrics WHERE metric='review_reopen' AND operation=? AND outcome=?").bind(operation, outcome).first<{ value: number }>())?.value ?? 0;
const opened = async () => {
  const p = await published();
  const res = await reopen(p.cardId, "rev-a");
  expect(res.status).toBe(201);
  const { id } = (await res.json()) as { id: string };
  return { ...p, id };
};

describe("重新審核：發起", () => {
  it("任一審核員發起，要寫理由；卡回到待審清單、照常公開；作者只看到重新審核中", async () => {
    const { cardId, original, card } = await published();
    expect((await reopen(cardId, "rev-a", "  ")).status).toBe(400);
    expect((await reopen(cardId, "author")).status).toBe(403);
    expect((await reopen(cardId, "agent")).status).toBe(403);
    const res = await reopen(cardId, "rev-a");
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    expect(await code(await reopen(cardId, "rev-b"))).toBe("review_reopen_exists");

    const item = (await queue("rev-b")).find((i) => i.id === id);
    expect(item).toMatchObject({ kind: "re", reopen: true, claim: "free" });
    expect(await board()).toHaveLength(1);
    expect(await cardRow()).toMatchObject({ status: "approved", reviewed_hash: card.reviewed_hash, approved_version_id: card.approved_version_id });
    const row = await env.DB.prepare("SELECT reopen_of, reopen_reason, content_hash FROM review_submissions WHERE id=?").bind(id).first<any>();
    expect(row).toMatchObject({ reopen_of: original, reopen_reason: "疑似盜用他人設定", content_hash: card.reviewed_hash });

    const author = (await statusAmong(env.DB, ["role-1"])).get("role-1")!;
    expect(author).toMatchObject({ status: "approved", reReview: true });
    expect(author.updateStatus).toBeUndefined();
    expect(JSON.stringify(author)).not.toContain("盜用");
    // 作者重送的冪等判定不能把重審單當成自己的待審單
    expect(await pendingSubmissionOf(env.DB, cardId)).toBeNull();

    const audit = await env.DB.prepare("SELECT action, reason FROM audit_log WHERE subject_kind='review_reopen'").all();
    expect(audit.results).toEqual([{ action: "open", reason: "疑似盜用他人設定" }]);
    expect(await metric("open", "success")).toBe(1);
  });

  it("只有已發布的卡能重新審核", async () => {
    await submit();
    const cardId = String((await env.DB.prepare("SELECT id FROM cards").first<{ id: number }>())!.id);
    expect(await code(await reopen(cardId, "rev-a"))).toBe("review_reopen_not_published");
    expect((await reopen("999999", "rev-a")).status).toBe(404);
  });
});

describe("重新審核：審核", () => {
  it("領了看得到完整內容（作者送審時封存的那一版）", async () => {
    const { id } = await opened();
    sealedReads.length = 0;
    await act(id, "claim", "rev-b");
    const res = await SELF.fetch(`https://c.test/v1/review/${id}/detail`, { headers: bearer("rev-b") });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.detail.partial).toBeFalsy();
    expect(body.submission).toMatchObject({ reopen: true, reopenReason: "疑似盜用他人設定" });
    expect(sealedReads).toHaveLength(1);
  });

  it("維持通過：任一審核員；只結束重審單，卡片完全不動，不通知作者", async () => {
    const { id, card } = await opened();
    await act(id, "claim", "rev-b");
    const res = await act(id, "stamp", "rev-b", { verdict: "approve" });
    expect(res.status).toBe(200);
    expect(await env.DB.prepare("SELECT status FROM review_submissions WHERE id=?").bind(id).first()).toEqual({ status: "approved" });
    expect(await cardRow()).toMatchObject({ status: "approved", reviewed_hash: card.reviewed_hash, approved_version_id: card.approved_version_id });
    expect(await env.DB.prepare("SELECT 1 FROM community_notifications WHERE event_key=?").bind("review:" + id).first()).toBeNull();
    expect((await statusAmong(env.DB, ["role-1"])).get("role-1")!.reReview).toBeFalsy();
    expect(await metric("keep", "success")).toBe(1);
  });

  it("駁回限管理員：一般審核員被拒，卡片不動", async () => {
    const { id, card } = await opened();
    await act(id, "claim", "rev-b");
    const res = await act(id, "stamp", "rev-b", { verdict: "reject", note: "盜用" });
    expect(res.status).toBe(403);
    expect(await code(res)).toBe("review_reopen_reject_manager");
    expect(await cardRow()).toMatchObject({ status: "approved", approved_version_id: card.approved_version_id });
    expect(await metric("reject", "denied")).toBe(1);
  });

  it("管理員駁回：走改判，卡下架、作者收到駁回說明，只留一筆改判", async () => {
    const { id, original } = await opened();
    await act(id, "claim", "mgr");
    const res = await act(id, "stamp", "mgr", { verdict: "reject", note: "設定與他人作品雷同" });
    expect(res.status).toBe(200);
    expect(await env.DB.prepare("SELECT status, note FROM review_submissions WHERE id=?").bind(id).first()).toEqual({ status: "rejected", note: "設定與他人作品雷同" });
    expect(await env.DB.prepare("SELECT status, note FROM review_submissions WHERE id=?").bind(original).first()).toEqual({ status: "rejected", note: "設定與他人作品雷同" });
    expect(await cardRow()).toMatchObject({ status: "rejected", approved_version_id: null });
    expect(await board()).toHaveLength(0);
    const notice = await env.DB.prepare("SELECT extra FROM community_notifications WHERE event_key=?").bind("review-correction:" + id).first<{ extra: string }>();
    expect(JSON.parse(notice!.extra)).toMatchObject({ status: "rejected", correction: true, note: "設定與他人作品雷同" });
    expect((await env.DB.prepare("SELECT count(*) AS n FROM review_corrections").first<{ n: number }>())!.n).toBe(1);
    expect(await metric("reject", "success")).toBe(1);
  });

  it("可以接冷凍：冷凍中維持通過與駁回都被擋", async () => {
    const { id } = await opened();
    await act(id, "claim", "rev-a");
    expect((await act(id, "hold", "rev-a")).status).toBe(200);
    await act(id, "claim", "mgr");
    expect(await code(await act(id, "stamp", "mgr", { verdict: "approve" }))).toBe("review_held");
    expect(await code(await act(id, "stamp", "mgr", { verdict: "reject", note: "x" }))).toBe("review_held");
  });
});

describe("重新審核：撤銷與失效", () => {
  it("管理員可撤銷（要寫理由）；一般審核員不行", async () => {
    const { id } = await opened();
    const withdraw = (token: string, reason?: string) => SELF.fetch(`https://c.test/v1/review/${id}/withdraw`, { method: "POST", headers: { ...json, ...bearer(token) }, body: JSON.stringify({ reason }) });
    expect((await withdraw("rev-a", "發錯了")).status).toBe(403);
    expect(await code(await withdraw("mgr"))).toBe("review_reopen_reason_required");
    expect((await withdraw("mgr", "已確認是原作者本人")).status).toBe(200);
    expect(await env.DB.prepare("SELECT status FROM review_submissions WHERE id=?").bind(id).first()).toEqual({ status: "superseded" });
    expect((await queue("rev-a")).find((i) => i.id === id)).toBeUndefined();
    const audit = await env.DB.prepare("SELECT action, reason FROM audit_log WHERE subject_kind='review_reopen' ORDER BY created_at, rowid").all();
    expect(audit.results).toEqual([{ action: "open", reason: "疑似盜用他人設定" }, { action: "withdraw", reason: "已確認是原作者本人" }]);
  });

  it("重審期間作者送了新版本、新版本先通過：重審單自動作廢，過審版本不被舊單改回", async () => {
    const { id } = await opened();
    await SELF.fetch("https://c.test/v1/cards/role-1/edit", { method: "POST", headers: bearer("author") });
    await submit();
    const next = await latestAuthorSubmission();
    expect((await queue("rev-a")).map((i) => i.id).sort()).toEqual([id, next].sort());
    await approve(next, "rev-b");
    const now = await cardRow();
    expect(await env.DB.prepare("SELECT status FROM review_submissions WHERE id=?").bind(id).first()).toEqual({ status: "superseded" });
    expect((await queue("rev-a")).find((i) => i.id === id)).toBeUndefined();
    expect(now.reviewed_hash).toBe(await env.DB.prepare("SELECT content_hash FROM review_submissions WHERE id=?").bind(next).first("content_hash"));
  });

  it("一般改判已經把原單駁回：重審單跟著作廢", async () => {
    const { id, original } = await opened();
    const res = await SELF.fetch(`https://c.test/v1/review/${original}/correction`, { method: "POST", headers: { ...json, ...bearer("mgr") }, body: JSON.stringify({ operationId: crypto.randomUUID(), note: "改判" }) });
    expect(res.status).toBe(200);
    expect(await env.DB.prepare("SELECT status FROM review_submissions WHERE id=?").bind(id).first()).toEqual({ status: "superseded" });
  });
});
