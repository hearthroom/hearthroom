import { SELF, env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { legacyPolicyFixture } from "./work-policy-fixture";
import { bearer, identities, makeAgent, makeReviewer, ratingBody, resetDb, restoreUpstream, reviewOff, reviewOn, reviewUpstream, rolesOnMainSite } from "./helpers";

// 審核員看得到原作者、同一位作者的其他卡（owner 2026-11-08），以及送審類型：
// 首次送審／更新（過審後改內容）／退回後再送／重新審核（審核員 2026-11-08）。
const AUTHOR = 10001, AUTHOR_ALT = 10009, OTHER = 10077, REVIEWER_A = 20001, MANAGER = 20003, AGENT = 20004, STRANGER = 30003;

beforeEach(async () => {
  await resetDb(); legacyPolicyFixture();
  identities({ author: AUTHOR, "rev-a": REVIEWER_A, mgr: MANAGER, agent: AGENT, stranger: STRANGER });
  rolesOnMainSite({ roleId: "role-1", authorNumId: AUTHOR, authorName: "月光" }, { roleId: "role-2", authorNumId: AUTHOR, authorName: "月光", name: "第二張" });
  reviewUpstream(); reviewOn();
  await makeReviewer(REVIEWER_A); await makeAgent(AGENT);
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
const submit = async (roleId = "role-1") => {
  const pending = await env.DB.prepare("SELECT v.operation_id FROM hosting_versions v JOIN review_submissions s ON s.id=v.submission_id WHERE v.source_role_id=? AND s.status='pending'").bind(roleId).first<{ operation_id: string }>();
  const res = await SELF.fetch("https://c.test/v1/cards", { method: "POST", headers: { ...json, ...bearer("author") }, body: JSON.stringify({ roleId, ...ratingBody(false), operationId: pending?.operation_id ?? crypto.randomUUID() }) });
  expect(res.status).toBeLessThan(300);
};
const pendingOf = async (roleId = "role-1") =>
  (await env.DB.prepare("SELECT s.id FROM review_submissions s JOIN cards c ON c.id=s.card_id WHERE c.source_role_id=? AND s.status='pending' AND s.reopen_of IS NULL").bind(roleId).first<{ id: string }>())!.id;
const decide = async (verdict: "approve" | "reject", roleId = "role-1") => {
  const id = await pendingOf(roleId);
  expect((await act(id, "claim", "rev-a")).status).toBe(200);
  expect((await act(id, "stamp", "rev-a", { verdict, ...(verdict === "reject" ? { note: "設定跟別張卡一樣" } : {}) })).status).toBe(200);
  return id;
};
const queue = async (token = "rev-a") => ((await (await SELF.fetch("https://c.test/v1/review/queue", { headers: bearer(token) })).json()) as { items: any[] }).items;
const detail = async (id: string, token = "rev-a") => SELF.fetch(`https://c.test/v1/review/${id}/detail`, { headers: bearer(token) });
const authorCards = async (id: string, token = "rev-a") => SELF.fetch(`https://c.test/v1/review/${id}/author-cards`, { headers: bearer(token) });
const cardIdOf = async (roleId: string) => String((await env.DB.prepare("SELECT id FROM cards WHERE source_role_id=?").bind(roleId).first<{ id: number }>())!.id);
const authorMember = async () => (await env.DB.prepare("SELECT member_id FROM member_identities WHERE provider='harbor' AND external_id=?").bind(String(AUTHOR)).first<{ member_id: string }>())!.member_id;
/** 直接登記一張卡（同一個人的另一個帳號、或別的作者），狀態與一張定案的單由測試指定 */
const registerCard = async (id: number, roleId: string, authorNumId: number, status: string, opts: { name?: string; rating?: string; verdict?: "approved" | "rejected" } = {}) => {
  await env.DB.prepare("INSERT INTO cards (id, source_role_id, author_num_id, author_name, names, status, rating, registered_at, last_synced_at, provider) VALUES (?, ?, ?, '別名', ?, ?, ?, ?, ?, 'harbor')")
    .bind(id, roleId, authorNumId, JSON.stringify({ zh: opts.name ?? roleId, en: "", ja: "", ko: "" }), status, opts.rating ?? null, Date.now() - id, Date.now()).run();
  if (opts.verdict) await env.DB.prepare("INSERT INTO review_submissions (id, card_id, provider, source_role_id, kind, status, submitted_at, decided_at) VALUES (?, ?, 'harbor', ?, 'first', ?, ?, ?)")
    .bind(`sub-${id}`, id, roleId, opts.verdict, Date.now() - 5000, Date.now() - 4000).run();
};

describe("審核頁看得到原作者", () => {
  it("審核頁帶作者的 Harbor 帳號名稱、數字帳號 ID、本站代號與卡數；回應裡沒有本站成員 ID", async () => {
    await submit("role-1");
    await submit("role-2");
    const id = await pendingOf("role-1");
    expect((await act(id, "claim", "rev-a")).status).toBe(200);
    const res = await detail(id);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    const member = await authorMember();
    const handle = (await env.DB.prepare("SELECT handle FROM members WHERE id=?").bind(member).first<{ handle: string }>())!.handle;
    expect(body.author).toMatchObject({ name: "月光", accountNumId: AUTHOR, handle, cardCount: 2 });
    expect(JSON.stringify(body)).not.toContain(member);
    expect(JSON.stringify(await queue())).not.toContain(member);
  });

  it("一鍵看同一個人的所有卡：含他另一個帳號的卡與各自狀態；別的作者的卡不列", async () => {
    await submit("role-2");
    await decide("approve", "role-2");
    await submit("role-1");
    const member = await authorMember();
    // 同一個人綁的第二個 Harbor 帳號：一張被駁回過、一張成人卡
    await env.DB.prepare("INSERT INTO member_connections (provider, external_id, owner_member_id, linked_at) VALUES ('harbor', ?, ?, 0)").bind(String(AUTHOR_ALT), member).run();
    await registerCard(190001, "alt-1", AUTHOR_ALT, "rejected", { name: "小號的卡", verdict: "rejected" });
    await registerCard(190002, "alt-2", AUTHOR_ALT, "approved", { name: "成人的卡", rating: "R", verdict: "approved" });
    await registerCard(190003, "other-1", OTHER, "approved", { name: "別人的卡", verdict: "approved" });
    const id = await pendingOf("role-1");
    expect((await act(id, "claim", "rev-a")).status).toBe(200);

    const res = await authorCards(id);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: any[]; total: number };
    expect(body.total).toBe(4);
    const byId = new Map(body.items.map((i) => [i.id, i]));
    expect(byId.has("190003")).toBe(false);
    expect(byId.get(await cardIdOf("role-1"))).toMatchObject({ current: true, status: "pending", latest: { id, status: "pending" } });
    expect(byId.get(await cardIdOf("role-2"))).toMatchObject({ current: false, status: "approved", decided: 1, rejected: 0, latest: { status: "approved" } });
    expect(byId.get("190001")).toMatchObject({ name: "小號的卡", status: "rejected", decided: 1, rejected: 1, latest: { id: "sub-190001", status: "rejected" } });
    // 沒驗年齡的審核員看不到成人卡的名稱與封面，卡號與狀態照列
    expect(byId.get("190002")).toMatchObject({ name: null, coverUrl: null, adultHidden: true, status: "approved" });
    expect(JSON.stringify(body)).not.toContain(member);
    // 審核頁的卡數跟清單一致
    expect(((await (await detail(id)).json()) as any).author.cardCount).toBe(4);
  });

  it("跟審核頁同一道門：不是審核員 403、AI 審核帳號 403、沒領 409", async () => {
    await submit("role-1");
    const id = await pendingOf("role-1");
    expect((await authorCards(id, "stranger")).status).toBe(403);
    expect((await authorCards(id, "agent")).status).toBe(403);
    expect((await authorCards(id, "rev-a")).status).toBe(409);
    expect((await act(id, "claim", "rev-a")).status).toBe(200);
    expect((await authorCards(id, "rev-a")).status).toBe(200);
  });

  it("作者端不變：作者讀自己的審核結果拿不到作者資訊與送審類型", async () => {
    await submit("role-1");
    const id = await decide("reject");
    const res = await SELF.fetch(`https://c.test/v1/mine/reviews/${id}`, { headers: bearer("author") });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).not.toHaveProperty("author");
    expect(body).not.toHaveProperty("type");
    expect((await authorCards(id, "author")).status).toBe(403);
  });
});

describe("送審類型", () => {
  const typeInQueue = async (roleId = "role-1") => {
    const id = await pendingOf(roleId);
    return { id, type: (await queue()).find((i) => i.id === id)!.type as string };
  };
  const typeInDetail = async (id: string) => {
    expect((await act(id, "claim", "rev-a")).status).toBe(200);
    const body = (await (await detail(id)).json()) as any;
    expect((await act(id, "release", "rev-a")).status).toBeLessThan(300);
    return body.submission.type as string;
  };

  it("首次送審 → 被駁回後再送 → 通過後改內容再送：清單與審核頁的類型一致", async () => {
    await submit();
    let q = await typeInQueue();
    expect(q.type).toBe("first");
    expect(await typeInDetail(q.id)).toBe("first");
    await decide("reject");

    await submit();
    q = await typeInQueue();
    expect(q.type).toBe("resubmit");
    expect(await typeInDetail(q.id)).toBe("resubmit");
    await decide("approve");

    rolesOnMainSite({ roleId: "role-1", authorNumId: AUTHOR, authorName: "月光", name: "改名了" });
    await submit();
    q = await typeInQueue();
    expect(q.type).toBe("update");
    expect(await typeInDetail(q.id)).toBe("update");
  });

  it("更新被駁回後再送：算退回後再送", async () => {
    await submit();
    await decide("approve");
    rolesOnMainSite({ roleId: "role-1", authorNumId: AUTHOR, authorName: "月光", name: "改名了" });
    await submit();
    await decide("reject");
    rolesOnMainSite({ roleId: "role-1", authorNumId: AUTHOR, authorName: "月光", name: "再改一次" });
    await submit();
    expect((await typeInQueue()).type).toBe("resubmit");
  });

  it("審核員發起的重新審核：類型是 reopen", async () => {
    await submit();
    await decide("approve");
    const res = await SELF.fetch(`https://c.test/v1/moderation/cards/${await cardIdOf("role-1")}/reopen`, { method: "POST", headers: { ...json, ...bearer("mgr") }, body: JSON.stringify({ reason: "疑似盜用他人設定" }) });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    expect((await queue()).find((i) => i.id === id)!.type).toBe("reopen");
    expect(await typeInDetail(id)).toBe("reopen");
  });
});
