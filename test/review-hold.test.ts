import {legacyPolicyFixture} from './work-policy-fixture';
import { SELF, env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ratingBody, bearer, identities, makeReviewer, resetDb, restoreUpstream, reviewOff, reviewOn, reviewUpstream, rolesOnMainSite } from "./helpers";
import { CLAIM_TTL_MS, statusAmong } from "../src/review";

// 冷凍並討論（審核員 2026-11-08）：先把一張卡擋下來討論。冷凍中誰都不能通過或駁回，
// 只有冷凍的人（或管理員，要寫理由）能解凍。冷凍掛在卡上：作者重送新版本照樣冷凍。
const AUTHOR = 10001, REVIEWER_A = 20001, REVIEWER_B = 20002, MANAGER = 20003;

beforeEach(async () => {
  await resetDb();legacyPolicyFixture();
  identities({ "author-token": AUTHOR, "rev-a": REVIEWER_A, "rev-b": REVIEWER_B, "mgr": MANAGER });
  rolesOnMainSite({ roleId: "role-1", authorNumId: AUTHOR });
  reviewUpstream();
  reviewOn();
  await makeReviewer(REVIEWER_A);
  await makeReviewer(REVIEWER_B);
  const mgr = await makeReviewer(MANAGER);
  await env.DB.prepare("UPDATE reviewers SET role='manager' WHERE member_id=?").bind(mgr).run();
});
afterEach(() => { restoreUpstream(); reviewOff(); });

const submit = async () => {
  const pending = await env.DB.prepare("SELECT v.operation_id FROM hosting_versions v JOIN review_submissions s ON s.id=v.submission_id WHERE v.source_role_id='role-1' AND s.status='pending'").first<{ operation_id: string }>();
  return SELF.fetch("https://c.test/v1/cards", { method: "POST", headers: { "Content-Type": "application/json", ...bearer("author-token") }, body: JSON.stringify({ roleId: "role-1", ...ratingBody(false), operationId: pending?.operation_id ?? crypto.randomUUID() }) });
};
const queue = async (token: string) => ((await (await SELF.fetch("https://c.test/v1/review/queue", { headers: bearer(token) })).json()) as { items: any[] }).items;
const generations = new Map<string, string>();
const act = async (id: string, action: string, token: string, body?: unknown) => {
  const res = await SELF.fetch(`https://c.test/v1/review/${id}/${action}`, { method: "POST", headers: { "Content-Type": "application/json", ...bearer(token) }, body: JSON.stringify({ ...((body ?? {}) as object), ...(action === "claim" ? {} : { generation: generations.get(id + token) }) }) });
  if (action === "claim" && res.ok) generations.set(id + token, ((await res.clone().json()) as any).generation);
  return res;
};
const code = async (res: Response) => ((await res.json()) as any).error;
const detail = async (id: string, token: string) => SELF.fetch(`https://c.test/v1/review/${id}/detail`, { headers: bearer(token) });
const pendingId = async () => (await queue("rev-a"))[0].id as string;
const freeze = async () => {
  await submit();
  const id = await pendingId();
  expect((await act(id, "claim", "rev-a")).status).toBe(200);
  expect((await act(id, "hold", "rev-a")).status).toBe(200);
  return id;
};
const metric = async (operation: string, outcome: string) =>
  (await env.DB.prepare("SELECT value FROM ops_metrics WHERE metric='review_hold' AND operation=? AND outcome=?").bind(operation, outcome).first<{ value: number }>())?.value ?? 0;

describe("冷凍並討論", () => {
  it("冷凍中誰都不能通過或駁回，冷凍人自己也不行", async () => {
    const id = await freeze();
    // 冷凍後放回領取：別人領得到、讀得到，一起討論
    expect((await act(id, "claim", "rev-b")).status).toBe(200);
    expect((await detail(id, "rev-b")).status).toBe(200);
    const approve = await act(id, "stamp", "rev-b", { verdict: "approve" });
    expect(approve.status).toBe(409);
    expect(await code(approve)).toBe("review_held");
    const reject = await act(id, "stamp", "rev-b", { verdict: "reject", note: "不行" });
    expect(reject.status).toBe(409);
    expect(await code(reject)).toBe("review_held");
    await act(id, "release", "rev-b");
    await act(id, "claim", "rev-a");
    expect(await code(await act(id, "stamp", "rev-a", { verdict: "approve" }))).toBe("review_held");
    const row = await env.DB.prepare("SELECT status FROM review_submissions WHERE id=?").bind(id).first<{ status: string }>();
    expect(row!.status).toBe("pending");
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM review_stamps").first<{ n: number }>())!.n).toBe(0);
  });

  it("資料庫也擋：繞過程式直接寫審核章會失敗", async () => {
    const id = await freeze();
    await act(id, "claim", "rev-b");
    const s = (await env.DB.prepare("SELECT claimed_by, claim_generation FROM review_submissions WHERE id=?").bind(id).first<{ claimed_by: string; claim_generation: string }>())!;
    await expect(env.DB.prepare("INSERT INTO review_stamps (submission_id, member_id, verdict, note, created_at, claim_generation) VALUES (?, ?, 'approve', '', ?, ?)")
      .bind(id, s.claimed_by, Date.now(), s.claim_generation).run()).rejects.toThrow(/review_held/);
  });

  it("要先領著才能冷凍；已經冷凍的不能再冷凍", async () => {
    await submit();
    const id = await pendingId();
    const unclaimed = await act(id, "hold", "rev-a");
    expect(unclaimed.status).toBe(409);
    // 跟蓋章同一道門：沒領就沒有領取代號
    expect(await code(unclaimed)).toBe("claim changed");
    // 領過又放回、拿舊代號來也不行
    await act(id, "claim", "rev-a");
    await act(id, "release", "rev-a");
    expect(await code(await act(id, "hold", "rev-a"))).toBe("claim this submission first");
    expect(await env.DB.prepare("SELECT 1 FROM review_holds").first()).toBeNull();
    await act(id, "claim", "rev-a");
    expect((await act(id, "hold", "rev-a")).status).toBe(200);
    await act(id, "claim", "rev-b");
    expect(await code(await act(id, "hold", "rev-b"))).toBe("review_already_held");
  });

  it("只有冷凍人能解凍，不必先領；解凍後照常審", async () => {
    const id = await freeze();
    await act(id, "claim", "rev-b");
    const other = await act(id, "unhold", "rev-b");
    expect(other.status).toBe(403);
    expect(await code(other)).toBe("review_hold_not_yours");
    // 冷凍人沒領（單子正被 B 領著）也能解凍
    expect((await act(id, "unhold", "rev-a")).status).toBe(200);
    expect((await act(id, "stamp", "rev-b", { verdict: "approve" })).status).toBe(200);
    expect(await metric("hold", "success")).toBe(1);
    expect(await metric("release", "success")).toBe(1);
    expect(await metric("release", "denied")).toBe(1);
  });

  it("管理員能解凍別人的冷凍，但要寫理由", async () => {
    const id = await freeze();
    const noReason = await act(id, "unhold", "mgr");
    expect(noReason.status).toBe(400);
    expect(await code(noReason)).toBe("review_hold_reason_required");
    expect((await act(id, "unhold", "mgr", { reason: "冷凍人已不在審核群" })).status).toBe(200);
    const audit = await env.DB.prepare("SELECT action, reason FROM audit_log WHERE subject_kind='review_hold' ORDER BY created_at, rowid").all<{ action: string; reason: string }>();
    expect(audit.results).toEqual([{ action: "hold", reason: "" }, { action: "release", reason: "冷凍人已不在審核群" }]);
  });

  it("冷凍不過期：領取逾時、放回都不影響", async () => {
    const id = await freeze();
    await env.DB.prepare("UPDATE review_submissions SET claimed_at=? WHERE id=?").bind(Date.now() - CLAIM_TTL_MS * 100, id).run();
    await act(id, "claim", "rev-b");
    expect(await code(await act(id, "stamp", "rev-b", { verdict: "approve" }))).toBe("review_held");
  });

  it("佇列與審核頁標出冷凍與冷凍人；作者那邊照樣是審核中", async () => {
    const id = await freeze();
    const mine = (await queue("rev-a"))[0];
    expect(mine.hold).toMatchObject({ byMe: true, canRelease: true, at: expect.any(Number) });
    const theirs = (await queue("rev-b"))[0];
    expect(theirs.hold).toMatchObject({ byMe: false, canRelease: false, holder: expect.any(String) });
    expect((await queue("mgr"))[0].hold).toMatchObject({ byMe: false, canRelease: true });
    await act(id, "claim", "rev-b");
    const body = (await (await detail(id, "rev-b")).json()) as any;
    expect(body.submission.hold).toMatchObject({ byMe: false, canRelease: false });
    // 冷凍人沒領也能打開審核頁（才找得到解凍）
    expect((await detail(id, "rev-a")).status).toBe(200);

    const author = await statusAmong(env.DB, ["role-1"]);
    expect(author.get("role-1")!.status).toBe("pending");
    expect(JSON.stringify([...author.values()])).not.toMatch(/hold/i);
  });

  it("作者撤銷登記再重新送審：卡號不變，冷凍照樣在", async () => {
    const id = await freeze();
    const card = (await env.DB.prepare("SELECT id FROM cards").first<{ id: number }>())!.id;
    expect((await SELF.fetch("https://c.test/v1/cards/role-1", { method: "DELETE", headers: bearer("author-token") })).status).toBe(204);
    expect((await submit()).status).toBeLessThan(300);
    const next = await pendingId();
    expect(next).not.toBe(id);
    expect((await env.DB.prepare("SELECT id FROM cards").first<{ id: number }>())!.id).toBe(card);
    expect((await queue("rev-b"))[0].hold).toMatchObject({ byMe: false });
    await act(next, "claim", "rev-b");
    expect(await code(await act(next, "stamp", "rev-b", { verdict: "approve" }))).toBe("review_held");
  });

  it("作者重送新版本：冷凍跟著卡走", async () => {
    const id = await freeze();
    await SELF.fetch("https://c.test/v1/cards/role-1/edit", { method: "POST", headers: bearer("author-token") });
    expect((await submit()).status).toBeLessThan(300);
    const next = await pendingId();
    expect(next).not.toBe(id);
    expect((await queue("rev-b"))[0].hold).toMatchObject({ byMe: false });
    await act(next, "claim", "rev-b");
    expect(await code(await act(next, "stamp", "rev-b", { verdict: "approve" }))).toBe("review_held");
    expect((await act(next, "unhold", "rev-a")).status).toBe(200);
    expect((await act(next, "stamp", "rev-b", { verdict: "approve" })).status).toBe(200);
  });
});
