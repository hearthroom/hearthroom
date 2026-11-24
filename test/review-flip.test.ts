import { SELF, createExecutionContext, env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import { workPolicyGateway } from "../src/work-policy";
import { finalizeManagedReview } from "../src/work-publication";
import { HttpError } from "../src/types";
import { legacyPolicyFixture } from "./work-policy-fixture";
import { bearer, identities, makeAgent, makeMember, makeReviewer, ratingBody, resetDb, restoreUpstream, reviewOff, reviewOn, reviewUpstream, rolesOnMainSite } from "./helpers";
import { claim, pendingSubmissionOf, stamp, statusAmong } from "../src/review";
import { GENERAL_RATING, role } from "./helpers";
import { submitHosted } from "../src/hosting";
import { enrollWorkAccess } from "../src/work-policy";
import { startFlip } from "../src/review-flip";
import { opsMetrics } from "../src/ops-metrics";

// 駁回改判為通過（ui-flip-approve.md v20）：管理員對誤駁回的單用同一個送審版本開改判單，由他自己領著走正常核准。
// 作者在通過前什麼都看不到；撤回改判維持原本的駁回、不通知作者。
const AUTHOR = 10001, REVIEWER_A = 20001, REVIEWER_B = 20002, MANAGER = 20003, MANAGER_2 = 20005, AGENT = 20004, FOLLOWER = 30001;
let manager: string, author: string;

beforeEach(async () => {
  await resetDb(); legacyPolicyFixture();
  identities({ author: AUTHOR, "rev-a": REVIEWER_A, "rev-b": REVIEWER_B, mgr: MANAGER, mgr2: MANAGER_2, agent: AGENT });
  rolesOnMainSite({ roleId: "role-1", authorNumId: AUTHOR });
  // 查重要有足夠長的原文才會留下指紋
  reviewUpstream((roleId) => ({ document: { roleName: "星野", userName: "旅人", roleDetailDesc: `${roleId} 是一位在港口城市經營舊書店的店主，`.repeat(40) } }));
  reviewOn();
  author = await makeMember(AUTHOR);
  await makeReviewer(REVIEWER_A); await makeReviewer(REVIEWER_B); await makeAgent(AGENT);
  manager = await makeReviewer(MANAGER);
  const manager2 = await makeReviewer(MANAGER_2);
  await env.DB.prepare("UPDATE reviewers SET role='manager' WHERE member_id IN (?,?)").bind(manager, manager2).run();
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
  const res = await SELF.fetch("https://c.test/v1/cards", { method: "POST", headers: { ...json, ...bearer("author") }, body: JSON.stringify({ roleId: "role-1", ...ratingBody(false), operationId: crypto.randomUUID() }) });
  expect(res.status).toBeLessThan(300);
};
const latestAuthorSubmission = async () => (await env.DB.prepare("SELECT id FROM review_submissions WHERE reopen_of IS NULL AND flip_of IS NULL ORDER BY rowid DESC LIMIT 1").first<{ id: string }>())!.id;
const rejectIt = async (id: string, token = "rev-a") => {
  expect((await act(id, "claim", token)).status).toBe(200);
  expect((await act(id, "stamp", token, { verdict: "reject", reasons: ["other"], note: "內容不足以上架" })).status).toBe(200);
};
/** 一張首次送審就被駁回的卡 */
const rejected = async () => {
  await submit();
  const original = await latestAuthorSubmission();
  await rejectIt(original);
  const card = (await env.DB.prepare("SELECT id FROM cards").first<{ id: number }>())!;
  return { original, cardId: String(card.id) };
};
const flip = (id: string, token: string, body: Record<string, unknown>) =>
  SELF.fetch(`https://c.test/v1/review/${id}/flip`, { method: "POST", headers: { ...json, ...bearer(token) }, body: JSON.stringify(body) });
const started = async (original: string, operationId = crypto.randomUUID()) => {
  const res = await flip(original, "mgr", { operationId, reason: "原審核員看錯了世界書，內容其實足夠" });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
};
const queue = async (token: string, tab?: string) => ((await (await SELF.fetch(`https://c.test/v1/review/queue${tab ? `?tab=${tab}` : ""}`, { headers: bearer(token) })).json()) as { items: any[] }).items;
const authorNotices = async () => (await env.DB.prepare("SELECT event_key, extra FROM community_notifications WHERE member_id=? AND kind='review_result' ORDER BY rowid").bind(author).all<{ event_key: string; extra: string }>()).results;
const metric = async (operation: string, outcome: string) =>
  (await env.DB.prepare("SELECT value FROM ops_metrics WHERE metric='review_flip' AND operation=? AND outcome=?").bind(operation, outcome).first<{ value: number }>())?.value ?? 0;
const versionOf = async (original: string) => (await env.DB.prepare("SELECT submission_id, state FROM hosting_versions v WHERE v.submission_id IN (?, (SELECT id FROM review_submissions WHERE flip_of=?))").bind(original, original).all()).results;
const mine = (id: string) => SELF.fetch(`https://c.test/v1/mine/reviews/${id}`, { headers: bearer("author") });
/** 審核頁核准改判單：AI 不判改判單，定案來源是「無 AI 對照」，帶這次的決定 */
const approveTwoStage = async (id: string, token = "mgr") => act(id, "stamp", token, { finalSource: "human_no_ai", verdict: "approve" });

describe("改判為通過：發起", () => {
  it("限管理員；理由與 operationId 要合法；同一個 operation 重送回同一張單，拿去改別張是衝突", async () => {
    const { original } = await rejected();
    const op = crypto.randomUUID();
    expect(await code(await flip(original, "rev-a", { operationId: op, reason: "誤判" }))).toBe("review_flip_manager_required");
    expect((await flip(original, "author", { operationId: op, reason: "誤判" })).status).toBe(403);
    expect((await flip(original, "mgr", { operationId: "not-a-uuid", reason: "誤判" })).status).toBe(400);
    expect((await flip(original, "mgr", { operationId: op, reason: "   " })).status).toBe(400);
    expect((await flip(original, "mgr", { operationId: op, reason: "理".repeat(501) })).status).toBe(400);
    // 作者在審核員身分檢查就被擋下（跟改判駁回一樣不計），其餘四次記成 denied
    expect(await metric("start", "denied")).toBe(4);

    const id = await started(original, op);
    const replay = await flip(original, "mgr", { operationId: op, reason: "原審核員看錯了世界書，內容其實足夠" });
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual({ id, flipOf: original, replayed: true });
    expect(await code(await flip(original, "mgr", { operationId: crypto.randomUUID(), reason: "再開一次" }))).toBe("review_flip_exists");
    expect(await code(await flip(id, "mgr", { operationId: op, reason: "x" }))).toBe("moderation_conflict");
    expect(await env.DB.prepare("SELECT COUNT(*) n FROM review_submissions WHERE flip_of=?").bind(original).first()).toEqual({ n: 1 });
    expect(await metric("start", "success")).toBe(1);
    expect(await metric("start", "replay")).toBe(1);
    expect(await opsMetrics(env.DB)).toContain('hearthroom_review_flip_total{operation="start",outcome="success"} 1');
    const audit = await env.DB.prepare("SELECT subject_kind, subject_id, action, reason FROM audit_log WHERE operation_id=?").bind(op).first();
    expect(audit).toEqual({ subject_kind: "review_submission", subject_id: original, action: "review_flip_approve", reason: "原審核員看錯了世界書，內容其實足夠" });
  });

  it("改判單用同一個送審版本、由發起人領著；版本列與作者端都還是原本的駁回；查重指紋用快照重建", async () => {
    const { original, cardId } = await rejected();
    const before = await env.DB.prepare("SELECT content_hash, kind, rating, submitted_at FROM review_submissions WHERE id=?").bind(original).first<any>();
    expect(await env.DB.prepare("SELECT COUNT(*) n FROM originality_texts WHERE submission_id=?").bind(original).first()).toEqual({ n: 0 });
    const noticesBefore = await authorNotices();
    const id = await started(original);

    const row = await env.DB.prepare("SELECT status, content_hash, kind, rating, flip_of, flip_by, flip_reason, claimed_by FROM review_submissions WHERE id=?").bind(id).first<any>();
    expect(row).toMatchObject({ status: "pending", content_hash: before.content_hash, kind: before.kind, rating: before.rating, flip_of: original, flip_by: manager, claimed_by: manager });
    expect(await versionOf(original)).toEqual([{ submission_id: original, state: "rejected" }]);
    expect(await env.DB.prepare("SELECT COUNT(*) n FROM review_snapshots WHERE submission_id=?").bind(id).first()).toEqual({ n: 1 });
    const print = await env.DB.prepare("SELECT created_at FROM originality_texts WHERE submission_id=?").bind(id).first<{ created_at: number }>();
    expect(print?.created_at).toBe(before.submitted_at);

    // 作者端：卡片、我的卡片、結果頁、送審重複檢查都跟沒發起改判一樣；沒有任何新通知
    expect(await env.DB.prepare("SELECT status FROM cards WHERE id=?").bind(cardId).first()).toEqual({ status: "rejected" });
    expect((await statusAmong(env.DB, ["role-1"])).get("role-1")).toMatchObject({ status: "rejected", note: "內容不足以上架" });
    expect(((await (await mine(original)).json()) as any).status).toBe("rejected");
    expect((await mine(id)).status).toBe(404);
    expect(await pendingSubmissionOf(env.DB, cardId)).toBeNull();
    expect(await authorNotices()).toEqual(noticesBefore);
  });

  it("原單的快照過了保留期：向 Harbor 讀封存版重做，指紋照樣重建", async () => {
    const { original } = await rejected();
    await env.DB.prepare("DELETE FROM review_snapshots WHERE submission_id=?").bind(original).run();
    const id = await started(original);
    expect(await env.DB.prepare("SELECT COUNT(*) n FROM review_snapshots WHERE submission_id=?").bind(id).first()).toEqual({ n: 1 });
    expect(await env.DB.prepare("SELECT COUNT(*) n FROM originality_texts WHERE submission_id=?").bind(id).first()).toEqual({ n: 1 });
    const detail = await SELF.fetch(`https://c.test/v1/review/${id}/detail`, { headers: bearer("mgr") });
    expect(detail.status).toBe(200);
  });

  it("作者已改稿重送就不能改判（不論新的那張結果），回最新那張的編號", async () => {
    const { original } = await rejected();
    await submit();
    const latest = await latestAuthorSubmission();
    const res = await flip(original, "mgr", { operationId: crypto.randomUUID(), reason: "誤判" });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "review_flip_superseded", latestSubmissionId: latest });
    const detail = (await (await SELF.fetch(`https://c.test/v1/review/${original}/detail`, { headers: bearer("mgr") })).json()) as any;
    expect(detail.submission.flipState).toMatchObject({ canStart: true, supersededBy: { id: latest } });
    expect(await metric("start", "superseded")).toBe(1);
  });

  it("通過的單、重新審核單不能改判", async () => {
    await submit();
    const id = await latestAuthorSubmission();
    expect((await act(id, "claim", "rev-a")).status).toBe(200);
    expect((await act(id, "stamp", "rev-a", { verdict: "approve" })).status).toBe(200);
    expect(await code(await flip(id, "mgr", { operationId: crypto.randomUUID(), reason: "x" }))).toBe("review_flip_not_rejected");
  });
});

describe("改判為通過：處理", () => {
  it("只有發起人能處理：別人領不到、清單上看到有人在看；改判理由只給管理員", async () => {
    const { original } = await rejected();
    const id = await started(original);
    const others = (await queue("rev-b", "new")).find((i) => i.id === id);
    expect(others).toMatchObject({ claim: "other", type: "first", attempt: 1, flip: { mine: false, rejectedAt: expect.any(Number) } });
    expect(others.flip.reason).toBeUndefined();
    const mineItem = (await queue("mgr", "new")).find((i) => i.id === id);
    expect(mineItem).toMatchObject({ claim: "mine", flip: { mine: true, reason: "原審核員看錯了世界書，內容其實足夠" } });
    expect((await queue("mgr", "updates")).find((i) => i.id === id)).toBeUndefined();
    expect(await code(await act(id, "claim", "rev-b"))).toBe("review_flip_initiator_only");
    expect(await code(await act(id, "claim", "mgr2"))).toBe("review_flip_initiator_only");
    // 另一位管理員可以唯讀打開詳情（頁面說明只有發起人能處理）
    const view = (await (await SELF.fetch(`https://c.test/v1/review/${id}/detail`, { headers: bearer("mgr2") })).json()) as any;
    expect(view.submission.flip).toMatchObject({ of: original, mine: false, reasons: ["other"], note: "內容不足以上架" });
    expect((await SELF.fetch(`https://c.test/v1/review/${id}/detail`, { headers: bearer("rev-b") })).status).toBe(409);
    // 不受理、冷凍都不適用改判單
    expect(await code(await act(id, "drop", "rev-b"))).toBe("review_drop_flip");
  });

  it("發起人審改判單：試玩、作者行為、查重都跟一般領著的單一樣；作品管理的歷程帶改判狀態與入口", async () => {
    const { original, cardId } = await rejected();
    const before = (await (await SELF.fetch(`https://c.test/v1/moderation/cards/${cardId}`, { headers: bearer("mgr") })).json()) as any;
    expect(before.reviews.find((r: any) => r.id === original).flip).toEqual({ pendingId: null, approvedId: null, canStart: true });
    const asReviewer = (await (await SELF.fetch(`https://c.test/v1/moderation/cards/${cardId}`, { headers: bearer("rev-a") })).json()) as any;
    expect(asReviewer.reviews.find((r: any) => r.id === original).flip.canStart).toBe(false);

    const id = await started(original);
    await env.DB.prepare("UPDATE review_submissions SET claimed_at=? WHERE id=?").bind(Date.now() - 2 * 3_600_000, id).run();
    const sealed = (await env.DB.prepare("SELECT source_role_id FROM review_submissions WHERE id=?").bind(id).first<{ source_role_id: string }>())!.source_role_id;
    const play = await worker.fetch(new Request(`https://c.test/internal/review/${id}/play-access?accountNumId=${MANAGER}&roleId=${encodeURIComponent(sealed)}`, { headers: { "X-Hosting-Key": "fixture-key" } }), { ...env, HOSTING_SERVICE_KEY: "fixture-key" }, createExecutionContext());
    expect(play.status).toBe(200);
    const other = await worker.fetch(new Request(`https://c.test/internal/review/${id}/play-access?accountNumId=${MANAGER_2}&roleId=${encodeURIComponent(sealed)}`, { headers: { "X-Hosting-Key": "fixture-key" } }), { ...env, HOSTING_SERVICE_KEY: "fixture-key" }, createExecutionContext());
    expect(other.status).toBe(403);
    for (const path of ["detail", "author-activity", "originality", "timeline"]) expect((await SELF.fetch(`https://c.test/v1/review/${id}/${path}`, { headers: bearer("mgr") })).status, path).toBe(200);
    const detail = (await (await SELF.fetch(`https://c.test/v1/review/${id}/detail`, { headers: bearer("mgr") })).json()) as any;
    expect(detail.authorProfile).not.toBeNull();
    expect(detail.submission.flip).toMatchObject({ of: original, mine: true, reason: "原審核員看錯了世界書，內容其實足夠" });
    const timeline = (await (await SELF.fetch(`https://c.test/v1/review/${id}/timeline`, { headers: bearer("mgr") })).json()) as any;
    expect(timeline.items.find((i: any) => i.action === "flip")).toMatchObject({ round: 1, current: true });

    const during = (await (await SELF.fetch(`https://c.test/v1/moderation/cards/${cardId}`, { headers: bearer("mgr") })).json()) as any;
    expect(during.reviews.find((r: any) => r.id === original).flip).toEqual({ pendingId: id, approvedId: null, canStart: false });
    expect(during.reviews.find((r: any) => r.id === id)).toMatchObject({ flipOf: original, note: "原審核員看錯了世界書，內容其實足夠" });
    const duringReviewer = (await (await SELF.fetch(`https://c.test/v1/moderation/cards/${cardId}`, { headers: bearer("rev-a") })).json()) as any;
    expect(duringReviewer.reviews.find((r: any) => r.id === id).note).toBe("");
  });

  it("發起人核准（領取超過 45 分鐘也不逾時）：卡片上架、作者只收到一般的通過通知、追蹤者收到新作通知", async () => {
    const { original, cardId } = await rejected();
    const follower = await makeMember(FOLLOWER);
    await env.DB.prepare("INSERT INTO member_follows VALUES(?,?,?)").bind(follower, author, Date.now()).run();
    const id = await started(original);
    const generation = (await env.DB.prepare("SELECT claim_generation FROM review_submissions WHERE id=?").bind(id).first<{ claim_generation: string }>())!.claim_generation;
    generations.set(id + "mgr", generation);
    await env.DB.prepare("UPDATE review_submissions SET claimed_at=? WHERE id=?").bind(Date.now() - 2 * 3_600_000, id).run();
    expect(await code(await act(id, "stamp", "mgr", { verdict: "reject", reasons: ["other"], note: "x" }))).toBe("review_flip_use_withdraw");
    expect(await code(await act(id, "stamp", "mgr", { finalSource: "human_no_ai", verdict: "reject", reasons: ["other"], note: "x" }))).toBe("review_flip_use_withdraw");

    const res = await approveTwoStage(id);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "approved", cardStatus: "approved" });
    expect(await env.DB.prepare("SELECT status FROM cards WHERE id=?").bind(cardId).first()).toEqual({ status: "approved" });
    expect(await versionOf(original)).toEqual([{ submission_id: id, state: "approved" }]);
    const notices = await authorNotices();
    expect(notices.map((n) => n.event_key)).toEqual([`review:${original}`, `review:${id}`]);
    expect(JSON.parse(notices[1].extra)).toMatchObject({ status: "approved" });
    expect(await env.DB.prepare("SELECT COUNT(*) n FROM community_notifications WHERE kind='followed_work' AND member_id=?").bind(follower).first()).toEqual({ n: 1 });
    expect((await statusAmong(env.DB, ["role-1"])).get("role-1")).toMatchObject({ status: "approved" });
    // 原本那張駁回的結果頁照樣打得開；改判通過後是一張普通的過審單
    expect(((await (await mine(original)).json()) as any).status).toBe("rejected");
    expect(((await (await mine(id)).json()) as any).status).toBe("approved");
    expect(await metric("approve", "success")).toBe(1);

    // 我處理過的：原審核員那一列的目前結果是「已改判為通過」
    const decisions = (await (await SELF.fetch("https://c.test/v1/review/decisions", { headers: bearer("rev-a") })).json()) as any;
    expect(decisions.items.find((i: any) => i.id === original).flip).toEqual({ pendingId: null, approvedId: id, canStart: false });
  });

  it("撤回改判：限發起的管理員；維持原本的駁回、不通知作者；之後可以再發起", async () => {
    const { original, cardId } = await rejected();
    const id = await started(original);
    const withdraw = (token: string) => SELF.fetch(`https://c.test/v1/review/${id}/flip/withdraw`, { method: "POST", headers: { ...json, ...bearer(token) }, body: "{}" });
    expect(await code(await withdraw("rev-a"))).toBe("review_flip_manager_required");
    expect(await code(await withdraw("mgr2"))).toBe("review_flip_initiator_only");
    const noticesBefore = await authorNotices();
    const decisionsBefore = (await (await SELF.fetch("https://c.test/v1/review/decisions", { headers: bearer("rev-a") })).json()) as any;
    expect(decisionsBefore.items.find((i: any) => i.id === original).flip).toEqual({ pendingId: id, approvedId: null, canStart: false });

    expect((await withdraw("mgr")).status).toBe(200);
    expect(await env.DB.prepare("SELECT status FROM review_submissions WHERE id=?").bind(id).first()).toEqual({ status: "rejected" });
    expect(await versionOf(original)).toEqual([{ submission_id: original, state: "rejected" }]);
    expect(await env.DB.prepare("SELECT status FROM cards WHERE id=?").bind(cardId).first()).toEqual({ status: "rejected" });
    expect(await authorNotices()).toEqual(noticesBefore);
    expect(await env.DB.prepare("SELECT 1 FROM review_events WHERE event_key=?").bind("first:" + id).first()).toBeNull();
    expect(await env.DB.prepare("SELECT COUNT(*) n FROM review_snapshots WHERE submission_id=?").bind(id).first()).toEqual({ n: 0 });
    expect((await statusAmong(env.DB, ["role-1"])).get("role-1")).toMatchObject({ status: "rejected", note: "內容不足以上架" });
    expect(await code(await withdraw("mgr"))).toBe("submission already decided");
    expect(await metric("withdraw", "success")).toBe(1);

    // 原審核員那一列回到一般的駁回
    const after = (await (await SELF.fetch("https://c.test/v1/review/decisions", { headers: bearer("rev-a") })).json()) as any;
    expect(after.items.find((i: any) => i.id === original)).toMatchObject({ status: "rejected", flip: { pendingId: null, approvedId: null, canStart: false } });
    const second = await started(original);
    expect(second).not.toBe(id);
  });

  it("改判單待審時作者改稿重送：照常送出，改判單作廢、版本列仍是原本的駁回", async () => {
    const { original, cardId } = await rejected();
    const id = await started(original);
    await submit();
    const latest = await latestAuthorSubmission();
    expect(latest).not.toBe(original);
    expect(await env.DB.prepare("SELECT status FROM review_submissions WHERE id=?").bind(id).first()).toEqual({ status: "superseded" });
    expect(await env.DB.prepare("SELECT state FROM hosting_versions WHERE submission_id=?").bind(original).first()).toEqual({ state: "rejected" });
    expect((await pendingSubmissionOf(env.DB, cardId))?.id).toBe(latest);
    expect(await metric("retire", "superseded")).toBe(1);
    // 新的一張是第二次送審（改判單不算一次送審）
    const item = (await queue("rev-b")).find((i) => i.id === latest);
    expect(item).toMatchObject({ attempt: 2, type: "resubmit" });
  });

  it("AI 審卡員的佇列不含改判單，也不能對它下結論", async () => {
    const KEY = "a".repeat(64);
    const sha = async (v: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v)))].map((b) => b.toString(16).padStart(2, "0")).join("");
    const migration = (env as unknown as { TEST_MIGRATIONS: { name: string; queries: string[] }[] }).TEST_MIGRATIONS.find((m) => m.name.endsWith("_review_ai.sql") || m.name.endsWith("_review_ai"))!;
    for (const q of migration.queries.filter((q) => /_review_agent_identity_guard|system-review-agent/.test(q))) await env.DB.prepare(q).run();
    (env as { REVIEW_AGENT_CONFIG?: string }).REVIEW_AGENT_CONFIG = JSON.stringify({ memberId: "system-review-agent", keySha256: await sha(KEY) });
    try {
      const { original } = await rejected();
      const id = await started(original);
      const items = async (scope: string) => ((await (await SELF.fetch(`https://c.test/v1/review-ai/queue?scope=${scope}`, { headers: { "X-Review-Agent-Key": KEY } })).json()) as { items: { id: string }[] }).items.map((i) => i.id);
      expect(await items("pending")).not.toContain(id);
      expect(await items("recent")).toContain(original);
      expect(await items("recent")).not.toContain(id);
      const write = await SELF.fetch(`https://c.test/v1/review-ai/submissions/${id}/suggestion`, { method: "PUT", headers: { ...json, "X-Review-Agent-Key": KEY }, body: JSON.stringify({ criteriaVersion: "v1", model: "m", verdict: "pass" }) });
      expect(await code(write)).toBe("review_flip_not_for_ai");
      expect(await env.DB.prepare("SELECT COUNT(*) n FROM review_ai_suggestions WHERE submission_id=?").bind(id).first()).toEqual({ n: 0 });
    } finally { delete (env as { REVIEW_AGENT_CONFIG?: string }).REVIEW_AGENT_CONFIG; }
  });
});

describe("改判為通過：託管作品", () => {
  it("更新被駁回後改判：提交駁回時留下的上架許可，上架新版本", async () => {
    const send = (kind: "minor" | "major" = "minor") => submitHosted(env, { memberId: author, account: AUTHOR, role: role({ roleId: "role-1", authorNumId: AUTHOR }), token: "author", rating: GENERAL_RATING, operationId: crypto.randomUUID(), now: Date.now(), updateKind: kind });
    const sid = async (version: string) => (await env.DB.prepare("SELECT submission_id FROM hosting_versions WHERE version_id=?").bind(version).first<{ submission_id: string }>())!.submission_id;
    const initial = await send();
    const first = await sid(initial.versionId);
    await claim(env.DB, first, "member-20001", Date.now());
    await stamp(env.DB, { submissionId: first, memberId: "member-20001", verdict: "approve", note: "", now: Date.now() }, env);
    await enrollWorkAccess(env, { memberId: author, roleId: "role-1", operationId: crypto.randomUUID(), access: "public", token: "author" });
    const update = await send();
    const original = await sid(update.versionId);
    await claim(env.DB, original, "member-20001", Date.now());
    await stamp(env.DB, { submissionId: original, memberId: "member-20001", verdict: "reject", note: "更新內容有問題", reasons: ["other"], now: Date.now() }, env);
    expect(await env.DB.prepare("SELECT state FROM work_publication_permits WHERE version_id=?").bind(update.versionId).first()).toEqual({ state: "prepared" });
    expect(await env.DB.prepare("SELECT approved_version_id, status FROM cards").first()).toEqual({ approved_version_id: initial.versionId, status: "approved" });

    const { id } = await startFlip(env, { id: original, memberId: manager, operationId: crypto.randomUUID(), reason: "更新其實沒有問題", now: Date.now() });
    // 卡片照常公開舊版；作者端的更新狀態仍是駁回
    expect((await statusAmong(env.DB, ["role-1"])).get("role-1")).toMatchObject({ status: "approved", updateStatus: "rejected" });
    const result = await stamp(env.DB, { submissionId: id, memberId: manager, verdict: "approve", note: "", now: Date.now(), generation: (await env.DB.prepare("SELECT claim_generation g FROM review_submissions WHERE id=?").bind(id).first<{ g: string }>())!.g }, env);
    expect(result.submission.status).toBe("approved");
    expect(await env.DB.prepare("SELECT state FROM work_publication_permits WHERE version_id=?").bind(update.versionId).first()).toEqual({ state: "published" });
    expect(await env.DB.prepare("SELECT approved_version_id, status FROM cards").first()).toEqual({ approved_version_id: update.versionId, status: "approved" });
    expect((await statusAmong(env.DB, ["role-1"])).get("role-1")?.updateStatus).toBeUndefined();
    expect(await metric("approve", "success")).toBe(1);
  });

  it("Harbor 結果不明：改判單留在待審、作者端照舊是駁回；重按就上架。同步衝突：改判單作廢，版本列還給原本的駁回", async () => {
    const send = () => submitHosted(env, { memberId: author, account: AUTHOR, role: role({ roleId: "role-1", authorNumId: AUTHOR }), token: "author", rating: GENERAL_RATING, operationId: crypto.randomUUID(), now: Date.now() });
    const sid = async (version: string) => (await env.DB.prepare("SELECT submission_id FROM hosting_versions WHERE version_id=?").bind(version).first<{ submission_id: string }>())!.submission_id;
    const decide = async (id: string, member: string, verdict: "approve" | "reject") => {
      const g = (await env.DB.prepare("SELECT claimed_by, claim_generation g FROM review_submissions WHERE id=?").bind(id).first<{ claimed_by: string | null; g: string }>())!;
      if (g.claimed_by !== member) await claim(env.DB, id, member, Date.now());
      return stamp(env.DB, { submissionId: id, memberId: member, verdict, note: verdict === "reject" ? "更新內容有問題" : "", reasons: verdict === "reject" ? ["other"] : undefined, now: Date.now() }, env);
    };
    const initial = await send();
    await decide(await sid(initial.versionId), "member-20001", "approve");
    await enrollWorkAccess(env, { memberId: author, roleId: "role-1", operationId: crypto.randomUUID(), access: "public", token: "author" });
    const flipped = async () => {
      const update = await send();
      const original = await sid(update.versionId);
      await decide(original, "member-20001", "reject");
      const { id } = await startFlip(env, { id: original, memberId: manager, operationId: crypto.randomUUID(), reason: "更新其實沒有問題", now: Date.now() });
      return { update, original, id };
    };
    const authorView = async () => ({ ...(await statusAmong(env.DB, ["role-1"])).get("role-1") });

    // 1) Provider 的回覆遺失：改判單仍待審、版本列已轉給它；作者端照舊是駁回，原單的結果頁照樣打得開
    const a = await flipped();
    const viewBefore = await authorView();
    const commit = vi.spyOn(workPolicyGateway, "commit").mockRejectedValueOnce(new Error("Synthetic Provider unavailable"));
    await expect(decide(a.id, manager, "approve")).rejects.toThrow("visibility_sync_pending");
    expect(await env.DB.prepare("SELECT status FROM review_submissions WHERE id=?").bind(a.id).first()).toEqual({ status: "pending" });
    expect(await env.DB.prepare("SELECT submission_id FROM hosting_versions WHERE version_id=?").bind(a.update.versionId).first()).toEqual({ submission_id: a.id });
    expect(await authorView()).toEqual(viewBefore);
    expect(((await (await mine(a.original)).json()) as any).status).toBe("rejected");
    commit.mockRestore();
    // 重按同一個決定：託管核准已記下，直接接續提交（不必再領）
    expect((await stamp(env.DB, { submissionId: a.id, memberId: manager, verdict: "approve", note: "", now: Date.now() }, env)).submission.status).toBe("approved");
    expect(await env.DB.prepare("SELECT approved_version_id FROM cards").first()).toEqual({ approved_version_id: a.update.versionId });

    // 2) 同步衝突（作品已被改成不公開）：改判單作廢，版本列回到原本的駁回單，作者端沒有任何變化
    const b = await flipped();
    const viewB = await authorView();
    vi.spyOn(workPolicyGateway, "commit").mockRejectedValueOnce(new Error("Synthetic Provider unavailable"));
    await expect(decide(b.id, manager, "approve")).rejects.toThrow("visibility_sync_pending");
    const current = await workPolicyGateway.state(env, "harbor", "role-1");
    vi.spyOn(workPolicyGateway, "state").mockResolvedValue({ ...current!, epoch: current!.epoch + 2, access: "private" });
    await expect(finalizeManagedReview(env, b.id)).rejects.toThrow("visibility_operation_conflict");
    vi.restoreAllMocks();
    expect(await env.DB.prepare("SELECT status FROM review_submissions WHERE id=?").bind(b.id).first()).toEqual({ status: "superseded" });
    expect(await env.DB.prepare("SELECT submission_id, state FROM hosting_versions WHERE version_id=?").bind(b.update.versionId).first()).toEqual({ submission_id: b.original, state: "rejected" });
    expect(await authorView()).toEqual(viewB);
    expect(((await (await mine(b.original)).json()) as any).status).toBe("rejected");
  });

  it("重大更新的改判在同步衝突後作廢：預約的更新通知一併清掉，之後的重大更新照常能預約與上架", async () => {
    const send = (kind: "minor" | "major") => submitHosted(env, { memberId: author, account: AUTHOR, role: role({ roleId: "role-1", authorNumId: AUTHOR }), token: "author", rating: GENERAL_RATING, operationId: crypto.randomUUID(), now: Date.now(), updateKind: kind, ...(kind === "major" ? { updateNote: "新增第二章劇情以及全新分支結局" } : {}) });
    const sid = async (version: string) => (await env.DB.prepare("SELECT submission_id FROM hosting_versions WHERE version_id=?").bind(version).first<{ submission_id: string }>())!.submission_id;
    const decide = async (id: string, member: string, verdict: "approve" | "reject") => {
      await claim(env.DB, id, member, Date.now());
      return stamp(env.DB, { submissionId: id, memberId: member, verdict, note: verdict === "reject" ? "更新內容有問題" : "", reasons: verdict === "reject" ? ["other"] : undefined, now: Date.now() }, env);
    };
    const initial = await send("minor");
    await decide(await sid(initial.versionId), "member-20001", "approve");
    await enrollWorkAccess(env, { memberId: author, roleId: "role-1", operationId: crypto.randomUUID(), access: "public", token: "author" });
    const update = await send("major");
    const original = await sid(update.versionId);
    await decide(original, "member-20001", "reject");
    const { id } = await startFlip(env, { id: original, memberId: manager, operationId: crypto.randomUUID(), reason: "更新其實沒有問題", now: Date.now() });
    vi.spyOn(workPolicyGateway, "commit").mockRejectedValueOnce(new HttpError(409, "visibility_operation_conflict"));
    await expect(stamp(env.DB, { submissionId: id, memberId: manager, verdict: "approve", note: "", now: Date.now() }, env)).rejects.toThrow("visibility_operation_conflict");
    vi.restoreAllMocks();
    expect(await env.DB.prepare("SELECT status FROM review_submissions WHERE id=?").bind(id).first()).toEqual({ status: "superseded" });
    expect(await env.DB.prepare("SELECT submission_id, state FROM hosting_versions WHERE version_id=?").bind(update.versionId).first()).toEqual({ submission_id: original, state: "rejected" });
    expect(await env.DB.prepare("SELECT COUNT(*) n FROM card_update_events WHERE state='reserved'").first()).toEqual({ n: 0 });

    // 衝突留下的同步鎖由作品的同步修復處理（不在這張測試的範圍）；這裡直接當它已經修好
    await env.DB.prepare("UPDATE managed_work_access SET sync_state='complete', sync_operation_id=NULL").run();
    const next = await send("major");
    const nextId = await sid(next.versionId);
    expect((await decide(nextId, "member-20001", "approve")).submission.status).toBe("approved");
    expect(await env.DB.prepare("SELECT state FROM card_update_events WHERE version_id=?").bind(next.versionId).first()).toEqual({ state: "published" });
  });

  it("核准前一刻失敗（更新通知預約不到）：版本列還回原單、沒有殘留預約；同一張單重按照常核准", async () => {
    const send = (kind: "minor" | "major") => submitHosted(env, { memberId: author, account: AUTHOR, role: role({ roleId: "role-1", authorNumId: AUTHOR }), token: "author", rating: GENERAL_RATING, operationId: crypto.randomUUID(), now: Date.now(), updateKind: kind, ...(kind === "major" ? { updateNote: "新增第二章劇情以及全新分支結局" } : {}) });
    const sid = async (version: string) => (await env.DB.prepare("SELECT submission_id FROM hosting_versions WHERE version_id=?").bind(version).first<{ submission_id: string }>())!.submission_id;
    const initial = await send("minor");
    const first = await sid(initial.versionId);
    await claim(env.DB, first, "member-20001", Date.now());
    await stamp(env.DB, { submissionId: first, memberId: "member-20001", verdict: "approve", note: "", now: Date.now() }, env);
    const update = await send("major");
    const original = await sid(update.versionId);
    await claim(env.DB, original, "member-20001", Date.now());
    await stamp(env.DB, { submissionId: original, memberId: "member-20001", verdict: "reject", note: "x", reasons: ["other"], now: Date.now() }, env);
    const { id } = await startFlip(env, { id: original, memberId: manager, operationId: crypto.randomUUID(), reason: "誤判", now: Date.now() });
    // 核准時預約更新通知失敗（另一個重大更新剛在冷卻期內發布）：版本列已轉過來，要還回原單
    const work = (await env.DB.prepare("SELECT work_id FROM hosting_versions WHERE version_id=?").bind(update.versionId).first<{ work_id: string }>())!.work_id;
    await env.DB.prepare("INSERT INTO card_update_events(version_id,work_id,state,reserved_at,published_at) VALUES(?,?,'published',?,?)").bind(initial.versionId, work, Date.now(), Date.now()).run();
    await expect(stamp(env.DB, { submissionId: id, memberId: manager, verdict: "approve", note: "", now: Date.now() }, env)).rejects.toThrow("update_notification_cooldown");
    expect(await env.DB.prepare("SELECT submission_id, state FROM hosting_versions WHERE version_id=?").bind(update.versionId).first()).toEqual({ submission_id: original, state: "rejected" });
    expect(await env.DB.prepare("SELECT COUNT(*) n FROM card_update_events WHERE state='reserved'").first()).toEqual({ n: 0 });
    expect(await env.DB.prepare("SELECT status FROM review_submissions WHERE id=?").bind(id).first()).toEqual({ status: "pending" });
    await env.DB.prepare("DELETE FROM card_update_events WHERE version_id=?").bind(initial.versionId).run();
    expect((await stamp(env.DB, { submissionId: id, memberId: manager, verdict: "approve", note: "", now: Date.now() }, env)).submission.status).toBe("approved");
    expect(await env.DB.prepare("SELECT submission_id, state FROM hosting_versions WHERE version_id=?").bind(update.versionId).first()).toEqual({ submission_id: id, state: "approved" });
  });
});

describe("改判為通過：發起人不再是管理員", () => {
  it("任何現任管理員或擁有者可以接手（領取）或撤回；發起人還是管理員時別人不行", async () => {
    const { original } = await rejected();
    const id = await started(original);
    expect(await code(await act(id, "claim", "mgr2"))).toBe("review_flip_initiator_only");
    await env.DB.prepare("UPDATE reviewers SET role='reviewer' WHERE member_id=?").bind(manager).run();
    const queued = (await queue("mgr2")).find((i) => i.id === id);
    expect(queued.claim).toBe("free");
    expect(queued.flip).toMatchObject({ mine: false, canTakeOver: true });
    expect((await act(id, "claim", "mgr2")).status).toBe(200);
    expect(await env.DB.prepare("SELECT flip_by, claimed_by FROM review_submissions WHERE id=?").bind(id).first()).toEqual({ flip_by: "member-20005", claimed_by: "member-20005" });
    // 原發起人降為一般審核員後也領不回來
    expect(await code(await act(id, "claim", "mgr"))).toBe("review_flip_initiator_only");
  });

  it("發起人被撤銷審核資格：別的管理員可以直接撤回改判", async () => {
    const { original } = await rejected();
    const id = await started(original);
    const withdraw = (token: string) => SELF.fetch(`https://c.test/v1/review/${id}/flip/withdraw`, { method: "POST", headers: { ...json, ...bearer(token) }, body: "{}" });
    expect(await code(await withdraw("mgr2"))).toBe("review_flip_initiator_only");
    await env.DB.prepare("UPDATE reviewers SET revoked_at=? WHERE member_id=?").bind(Date.now(), manager).run();
    expect((await withdraw("mgr2")).status).toBe(200);
    expect(await env.DB.prepare("SELECT status FROM review_submissions WHERE id=?").bind(id).first()).toEqual({ status: "rejected" });
  });

  it("發起人降成一般審核員：還領著改判單也不能定案，要等其他管理員接手", async () => {
    const { original } = await rejected();
    const id = await started(original);
    generations.set(id + "mgr", (await env.DB.prepare("SELECT claim_generation FROM review_submissions WHERE id=?").bind(id).first<{ claim_generation: string }>())!.claim_generation);
    await env.DB.prepare("UPDATE reviewers SET role='reviewer' WHERE member_id=?").bind(manager).run();
    expect(await code(await act(id, "stamp", "mgr", { finalSource: "human_no_ai", verdict: "approve" }))).toBe("review_flip_manager_required");
    expect(await code(await act(id, "stamp", "mgr", { verdict: "approve" }))).toBe("review_flip_manager_required");
    expect(await env.DB.prepare("SELECT status FROM review_submissions WHERE id=?").bind(id).first()).toEqual({ status: "pending" });
  });
});

describe("給作者的說明的內部字詞檢查只管作者看得到的字", () => {
  it("通過時的補充說明作者看不到，不擋；改判駁回（含重新審核駁回）的說明會給作者，要擋", async () => {
    await submit();
    const id = await latestAuthorSubmission();
    expect((await act(id, "claim", "rev-a")).status).toBe(200);
    expect((await act(id, "stamp", "rev-a", { verdict: "approve", note: "同裝置有 3 個帳號，先放行觀察" })).status).toBe(200);
    const res = await SELF.fetch(`https://c.test/v1/review/${id}/correction`, { method: "POST", headers: { ...json, ...bearer("mgr") }, body: JSON.stringify({ operationId: crypto.randomUUID(), note: "同一裝置有好幾個帳號" }) });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "author_note_internal", terms: ["裝置", "帳號"] });
  });

  it("通過附建議時的補充說明會給作者：作者結果頁讀得到；沒附建議的不會", async () => {
    await submit();
    const id = await latestAuthorSubmission();
    expect((await act(id, "claim", "rev-a")).status).toBe(200);
    expect((await act(id, "stamp", "rev-a", { verdict: "approve", suggestions: ["other"], note: "開場可以多一個要玩家回應的問題。" })).status).toBe(200);
    expect(await (await mine(id)).json()).toMatchObject({ status: "approved", suggestions: ["other"], note: "開場可以多一個要玩家回應的問題。" });
  });
});


describe("作者結果頁：還沒定案的單不帶說明", () => {
  it("通過附建議寫了說明，但託管同步還沒完成（單子仍是待審）：作者先打開也看不到說明", async () => {
    await submit();
    const id = await latestAuthorSubmission();
    await env.DB.prepare("UPDATE review_submissions SET note='再補一點開場的選項' WHERE id=?").bind(id).run();
    const res = await mine(id);
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).note).toBeNull();
  });
});
