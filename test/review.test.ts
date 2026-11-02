import {legacyPolicyFixture} from './work-policy-fixture';
import { SELF, createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import worker from "../src/index";
import { ratingBody,
  bearer, identities, makeReviewer, resetDb, restoreUpstream, reviewOff, reviewOn, reviewUpstream, rolesOnMainSite, sealedReads, settingsReads,
} from "./helpers";
import { CLAIM_TTL_MS } from "../src/review";

// 審核開著時，提交＝本站用作者的 token 讀一次整份設定存成快照＋排隊；審核人領、蓋章、上榜；
// 修改草稿後須明確送審新版本；公開版保留到新版本核准。
const AUTHOR = 10001;
const REVIEWER_A = 20001;
const REVIEWER_B = 20002;
const STRANGER = 30003;

beforeEach(async () => {
  await resetDb();legacyPolicyFixture();
  identities({ "author-token": AUTHOR, "rev-a": REVIEWER_A, "rev-b": REVIEWER_B, "stranger": STRANGER });
  rolesOnMainSite({ roleId: "role-1", authorNumId: AUTHOR }, { roleId: "role-2", authorNumId: AUTHOR });
  reviewUpstream();
  reviewOn();
});
afterEach(() => {
  restoreUpstream();
  reviewOff();
});

/** 作者在供應商那邊改了訪客看得到的東西（這裡改名字）。 */
const authorEditsPublicly = (roleId: string, name: string) =>
  rolesOnMainSite(...["role-1", "role-2"].map((id) => ({ roleId: id, authorNumId: AUTHOR, ...(id === roleId ? { name } : {}) })));
const snapshots = async () => (await env.DB.prepare("SELECT COUNT(*) AS n FROM review_snapshots").first<{ n: number }>())!.n;

const submit = async (roleId:string, token="author-token") => {
 const pending=await env.DB.prepare("SELECT v.operation_id FROM hosting_versions v JOIN review_submissions s ON s.id=v.submission_id WHERE v.source_role_id=? AND s.status='pending'").bind(roleId).first<{operation_id:string}>();
 return SELF.fetch("https://c.test/v1/cards",{method:"POST",headers:{"Content-Type":"application/json",...bearer(token)},body:JSON.stringify({roleId,...ratingBody(false),operationId:pending?.operation_id??crypto.randomUUID()})});
};
// 同一個網址重讀，確認審核狀態變更會讓暖快取立即失效。
const board = async () =>
  ((await (await SELF.fetch("https://c.test/v1/cards")).json()) as { items: { roleId: string }[] }).items;
const queue = async (token: string) => {
  const res = await SELF.fetch("https://c.test/v1/review/queue", { headers: bearer(token) });
  return { status: res.status, body: (await res.json()) as { items: any[] } };
};
const generations=new Map<string,string>();
const act = async (id:string, action:string, token:string, body?:unknown) => {
 const res=await SELF.fetch(`https://c.test/v1/review/${id}/${action}`,{method:'POST',headers:{'Content-Type':'application/json',...bearer(token)},body:JSON.stringify({...((body??{}) as object),...(action==='claim'?{}:{generation:generations.get(id+token)})})});
 if(action==='claim'&&res.ok)generations.set(id+token,(await res.clone().json() as any).generation);
 return res;
};

const cardStatus = async (roleId: string) =>
  (await env.DB.prepare("SELECT status, reviewed_hash FROM cards WHERE source_role_id = ?").bind(roleId).first<{ status: string; reviewed_hash: string }>())!;

describe("審核副本不在本站", () => {
  // 本站（Cloudflare D1）單列只有 2 MB；大型世界卡的完整設定存不下。完整內容留在 Harbor 的封存版，
  // 審核時直接讀；本站只存查重要用的原文（角色描述、名字）與統計數字。
  it("本站只存查重原文，審核頁的完整內容向 Harbor 封存版讀", async () => {
    reviewUpstream((roleId) => ({ roleId, document: { roleName: "夜行偵探", userName: "助手", roleDetailDesc: "角色描述原文", customInstructions: "自訂指示" }, worldbooks: [{ name: "世界書", entries: [{ content: "世界書條目".repeat(800), isConstant:true }] }] }));
    const receipt = await (await submit("role-1")).json() as any;
    const stored = (await env.DB.prepare("SELECT detail FROM review_snapshots").first<{ detail: string }>())!.detail;
    const { loadSnapshot } = await import("../src/review-snapshot");
    const slim = await loadSnapshot(env.DB, (await env.DB.prepare("SELECT submission_id FROM review_snapshots").first<{ submission_id: string }>())!.submission_id) as any;
    expect(slim.document).toEqual({ roleName: "夜行偵探", userName: "助手", roleDetailDesc: "角色描述原文" });
    expect(slim.worldbooks).toBeUndefined();
    expect(stored).not.toContain("世界書條目");
    await makeReviewer(REVIEWER_A);
    const id = (await queue("rev-a")).body.items[0].id as string;
    await act(id, "claim", "rev-a");
    const body = await (await SELF.fetch(`https://c.test/v1/review/${id}/detail`, { headers: bearer("rev-a") })).json() as any;
    expect(body.detail.document.customInstructions).toBe("自訂指示");
    expect(body.detail.worldbooks[0].entries[0].content).toBe("世界書條目".repeat(800));
    expect(sealedReads).toEqual([{ roleId: "frozen-" + receipt.versionId, provider: "harbor" }]);
  });
});

describe("提交", () => {
  it("用作者的 token 讀整份設定存成快照、綁定封存版本、排進佇列；卡不上榜", async () => {
    const res = await submit("role-1");
    expect(res.status).toBe(201);
    const receipt=await res.json() as any;
    expect(receipt.status).toBe("pending");
    expect(settingsReads).toEqual([{token:"author-token",roleId:"role-1",provider:"harbor"},{ token: "author-token", roleId: "frozen-"+receipt.versionId, provider: "harbor" }]);
    expect(await board()).toHaveLength(0);
    const s = await env.DB.prepare("SELECT kind, status, content_hash FROM review_submissions").first<any>();
    expect(s).toMatchObject({ kind: "first", status: "pending" });
    expect(s.content_hash).toMatch(/^version:[0-9a-f-]{36}$/);
    expect(await snapshots()).toBe(1);
    // 再送一次是冪等的：不開第二張單，快照也還是一份
    expect((await submit("role-1")).status).toBe(200);
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM review_submissions").first<{ n: number }>();
    expect(n?.n).toBe(1);
    expect(await snapshots()).toBe(1);
  });

  it("讀不到設定就整個提交失敗，不落庫", async () => {
    const { upstream } = await import("../src/upstream");
    upstream.readForReview = async () => { throw new Error("boom"); };
    expect((await submit("role-1")).status).toBe(503);
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM cards").first<{ n: number }>();
    expect(n?.n).toBe(0);
  });

  it("沒開審核時拒絕提交，不再直接上榜", async () => {
    reviewOff();
    expect((await submit("role-1")).status).toBe(503);
    expect(settingsReads).toHaveLength(0);
    expect(await board()).toHaveLength(0);
  });

  it("作者撤銷登記：排隊中的單與快照一起消失", async () => {
    await submit("role-1");
    expect(await snapshots()).toBe(1);
    expect((await SELF.fetch("https://c.test/v1/cards/role-1", { method: "DELETE", headers: bearer("author-token") })).status).toBe(204);
    expect(await snapshots()).toBe(0);
  });
});

describe("審核佇列", () => {
  it("不是審核人 → 403；審核人看得到佇列但看不到作者", async () => {
    await submit("role-1");
    expect((await queue("stranger")).status).toBe(403);
    await makeReviewer(REVIEWER_A);
    const q = await queue("rev-a");
    expect(q.status).toBe(200);
    expect(q.body.items).toHaveLength(1);
    const item = q.body.items[0];
    expect(item.card.name).toBe("夜行偵探");
    expect(item.stamps).toEqual({ approve: 0, required: 1 });
    expect(item.claim).toBe("free");
    expect(JSON.stringify(item)).not.toContain(String(AUTHOR));
    expect(item).not.toHaveProperty("author");
  });

  it("初審一章上榜：領→蓋即定案；沒領不能蓋；別人領著不能搶", async () => {
    await submit("role-1");
    await makeReviewer(REVIEWER_A);
    await makeReviewer(REVIEWER_B);
    const id = (await queue("rev-a")).body.items[0].id as string;

    // 沒領就蓋 → 409
    expect((await act(id, "stamp", "rev-a", { verdict: "approve" })).status).toBe(409);

    expect((await act(id, "claim", "rev-a")).status).toBe(200);
    // 別人領著 → 409
    expect((await act(id, "claim", "rev-b")).status).toBe(409);
    expect((await queue("rev-b")).body.items[0].claim).toBe("other");

    const first = (await (await act(id, "stamp", "rev-a", { verdict: "approve" })).json()) as any;
    expect(first).toMatchObject({ status: "approved", cardStatus: "approved", stamps: { approve: 1, required: 1 } });
    expect(await board()).toHaveLength(1);
    expect(await cardStatus("role-1")).toMatchObject({ status: "approved", reviewed_hash: expect.stringMatching(/^version:/) });
    // 上榜＝定案：快照刪掉，本站不留私有設定
    expect(await snapshots()).toBe(0);
    expect((await queue("rev-a")).body.items).toHaveLength(0);
    // 定案後不能再領、再蓋
    expect((await act(id, "claim", "rev-a")).status).toBe(409);
    expect((await act(id, "stamp", "rev-b", { verdict: "approve" })).status).toBe(409);
  });

  it("審核時改標籤：只改這一版，過審後上榜；作者再編輯送審就用作者自己的標籤", async () => {
    await submit("role-1");
    await makeReviewer(REVIEWER_A);
    await makeReviewer(REVIEWER_B);
    const id = (await queue("rev-a")).body.items[0].id as string;
    const tags = (sid: string, token: string, body: unknown) => act(sid, "tags", token, body);

    // 沒領不能改；不是審核人不能改
    expect((await tags(id, "rev-a", { tags: ["推理", "倫理"] })).status).toBe(409);
    expect((await tags(id, "author-token", { tags: ["倫理"] })).status).toBe(403);
    await act(id, "claim", "rev-a");
    // 別人領著不能改
    expect((await tags(id, "rev-b", { tags: ["倫理"] })).status).toBe(409);
    expect((await tags(id, "rev-a", { tags: "倫理" })).status).toBe(400);

    const res = await tags(id, "rev-a", { tags: [" 推理 ", "倫理", "倫理"] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ tags: ["推理", "倫理"], fandom: "" });
    // 審核頁讀到的是改過的標籤
    const detail = (await (await SELF.fetch(`https://c.test/v1/review/${id}/detail`, { headers: bearer("rev-a") })).json()) as any;
    expect(detail.card.tags).toEqual(["推理", "倫理"]);

    await act(id, "stamp", "rev-a", { verdict: "approve" });
    const listed = async () => ((await (await SELF.fetch("https://c.test/v1/cards")).json()) as { items: { tags: string[] }[] }).items;
    expect((await listed())[0].tags).toEqual(["推理", "倫理"]);
    const event = await env.DB.prepare("SELECT action, reason, before_value, after_value FROM moderation_events WHERE source_role_id='role-1'").first();
    expect(event).toMatchObject({ action: "tags", reason: "review", before_value: JSON.stringify(["推理"]), after_value: JSON.stringify(["推理", "倫理"]) });
    // 定案後不能再改；不留站方覆蓋值
    expect((await tags(id, "rev-a", { tags: ["推理"] })).status).toBe(410);
    expect(await env.DB.prepare("SELECT tags_override FROM moderation_state WHERE source_role_id='role-1'").first()).toBeNull();

    // 作者編輯後重新送審：新版本是作者自己的標籤，過審後榜上跟著換
    await SELF.fetch("https://c.test/v1/cards/role-1/edit", { method: "POST", headers: bearer("author-token") });
    await submit("role-1");
    const next = (await queue("rev-b")).body.items[0].id as string;
    await act(next, "claim", "rev-b");
    const reviewed = (await (await SELF.fetch(`https://c.test/v1/review/${next}/detail`, { headers: bearer("rev-b") })).json()) as any;
    expect(reviewed.card.tags).toEqual(["推理"]);
    await act(next, "stamp", "rev-b", { verdict: "approve" });
    expect((await listed())[0].tags).toEqual(["推理"]);
  });

  it("蓋過章的審核人回頭看：不必再領，唯讀；定案後只剩公開資料，仍不帶作者；沒蓋過的人看不到", async () => {
    reviewUpstream((roleId) => ({ roleId, authorNumId: AUTHOR, document: { roleName: "夜行偵探", customInstructions: "自訂指示" } }));
    await submit("role-1");
    await makeReviewer(REVIEWER_A);
    await makeReviewer(REVIEWER_B);
    const id = (await queue("rev-a")).body.items[0].id as string;
    const detail = (who: string) => SELF.fetch(`https://c.test/v1/review/${id}/detail`, { headers: bearer(who) });

    // 還在等的單（例如重審前的舊單）：蓋過章的人不必領就看得到完整快照
    await env.DB.prepare("INSERT INTO review_stamps (submission_id, member_id, verdict, note, created_at) VALUES (?, ?, 'approve', '', ?)")
      .bind(id, `member-${REVIEWER_A}`, Date.now()).run();
    const pending = await detail("rev-a");
    expect(pending.status).toBe(200);
    const pendingBody = (await pending.json()) as any;
    expect(pendingBody.submission).toMatchObject({ status: "pending", claimedByMe: false, stampedByMe: true });
    expect(pendingBody.detail.document.customInstructions).toBe("自訂指示");
    expect((await detail("rev-b")).status).toBe(409);
    await env.DB.prepare("DELETE FROM review_stamps WHERE submission_id = ?").bind(id).run();

    await act(id, "claim", "rev-a");
    expect((await act(id, "stamp", "rev-a", { verdict: "approve" })).status).toBe(200);
    const closed = await detail("rev-a");
    expect(closed.status).toBe(200);
    const body = (await closed.json()) as any;
    expect(body.submission).toMatchObject({ status: "approved", stampedByMe: true, claimedByMe: false });
    expect(body.submission.stamps).toHaveLength(1);
    expect(body.detail).toMatchObject({ partial: true, closed: true });
    expect(body.detail.document.roleName).toBe("夜行偵探");
    expect(body.detail.document.customInstructions).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain(String(AUTHOR));
    // 沒蓋過章的審核人：定案的單照舊看不到
    expect((await detail("rev-b")).status).toBe(410);
  });

  it("任何一個駁回即駁回，駁回要附說明，作者在我的卡片看得到", async () => {
    await submit("role-1");
    await makeReviewer(REVIEWER_A);
    const id = (await queue("rev-a")).body.items[0].id as string;
    await act(id, "claim", "rev-a");
    expect((await act(id, "stamp", "rev-a", { verdict: "reject" })).status).toBe(400);
    const res = await act(id, "stamp", "rev-a", { verdict: "reject", note: "世界書會把點數燒光" });
    expect(((await res.json()) as any).cardStatus).toBe("rejected");
    expect((await cardStatus("role-1")).status).toBe("rejected");

    const mine = (await (await SELF.fetch("https://c.test/v1/me/cards?filter=listed", { headers: bearer("author-token") })).json()) as any;
    expect(mine.items[0]).toMatchObject({ roleId: "role-1", registered: true, status: "rejected", note: "世界書會把點數燒光" });

    // 作者修好再送：重新排隊（從沒過過審 → 仍是初審）
    expect((await submit("role-1")).status).toBe(200);
    expect((await cardStatus("role-1")).status).toBe("pending");
    const again = await env.DB.prepare("SELECT kind FROM review_submissions WHERE status = 'pending'").first<{ kind: string }>();
    expect(again?.kind).toBe("first");
  });

  it("領了逾時自動放回", async () => {
    await submit("role-1");
    await makeReviewer(REVIEWER_A);
    await makeReviewer(REVIEWER_B);
    const id = (await queue("rev-a")).body.items[0].id as string;
    await act(id, "claim", "rev-a");
    await env.DB.prepare("UPDATE review_submissions SET claimed_at = ? WHERE id = ?").bind(Date.now() - CLAIM_TTL_MS - 1, id).run();
    expect((await queue("rev-b")).body.items[0].claim).toBe("free");
    expect((await act(id, "claim", "rev-b")).status).toBe(200);
    // 原本領的人逾時後不能再蓋
    expect((await act(id, "stamp", "rev-a", { verdict: "approve" })).status).toBe(409);
  });

  it("審核頁：看的是送審當下的快照，帶審核單狀態，不帶作者；定案後快照就刪", async () => {
    reviewUpstream((roleId) => ({ roleId, authorNumId: AUTHOR, document: { roleName: "夜行偵探", customInstructions: "自訂指示" } }));
    await submit("role-1");
    await makeReviewer(REVIEWER_A);
    const id = (await queue("rev-a")).body.items[0].id as string;
    expect((await SELF.fetch(`https://c.test/v1/review/${id}/detail`, { headers: bearer("rev-a") })).status).toBe(409);
    await act(id,"claim","rev-a");
    const res = await SELF.fetch(`https://c.test/v1/review/${id}/detail`, { headers: bearer("rev-a") });
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toContain("no-store");
    const body = (await res.json()) as any;
    expect(body.card.id).toBe("100001");
    expect(body.detail.document.customInstructions).toBe("自訂指示");
    expect(body.submission).toMatchObject({ kind: "first", required: 1, claimedByMe: true, stampedByMe: false });
    expect(JSON.stringify(body)).not.toContain(String(AUTHOR));
    expect((await SELF.fetch(`https://c.test/v1/review/${id}/detail`, { headers: bearer("stranger") })).status).toBe(403);
    // 審核頁不再回頭問供應商：快照是唯一來源
    expect(settingsReads).toHaveLength(2);
    // 駁回即定案：快照刪掉
    await act(id, "claim", "rev-a");
    expect((await act(id, "stamp", "rev-a", { verdict: "reject", note: "不行" })).status).toBe(200);
    expect(await snapshots()).toBe(0);
  });

  it("排隊中重試同一操作：仍是原本不可變的快照", async () => {
    reviewUpstream(() => ({ document: { roleName: "第一版" } }));
    await submit("role-1");
    reviewUpstream(() => ({ document: { roleName: "第二版" } }));
    await submit("role-1");
    await makeReviewer(REVIEWER_A);
    const id = (await queue("rev-a")).body.items[0].id as string;
    await act(id,"claim","rev-a");
    const body = (await (await SELF.fetch(`https://c.test/v1/review/${id}/detail`, { headers: bearer("rev-a") })).json()) as any;
    expect(body.detail.document.roleName).toBe("第一版");
  });
});

describe("內容版本", () => {
  async function approve(roleId: string) {
    await makeReviewer(REVIEWER_A);
    await makeReviewer(REVIEWER_B);
    const id = (await queue("rev-a")).body.items.find((i: any) => i.card.roleId === roleId).id as string;
    for (const t of ["rev-a", "rev-b"]) {
      await act(id, "claim", t);
      await act(id, "stamp", t, { verdict: "approve" });
    }
  }
  // 直接叫 scheduled：同步是排程跑的，走 fetch 進不去。
  const sync = async () => {
    const ctx = createExecutionContext();
    await worker.scheduled({ cron: "17 * * * *", scheduledTime: Date.now(), noRetry() {} } as ScheduledController, env, ctx);
    await waitOnExecutionContext(ctx);
  };

  const DAY = 86_400_000;
  const registeredAt = async (roleId: string) =>
    (await env.DB.prepare("SELECT registered_at FROM cards WHERE source_role_id = ?").bind(roleId).first<{ registered_at: number }>())!.registered_at;
  const dayBoard = async () =>
    ((await (await SELF.fetch("https://c.test/v1/cards?sort=day")).json()) as { items: { sourceRoleId: string }[] }).items.map((i) => i.sourceRoleId);

  it("昨天送審、今天才過審：上榜時間是過審那一刻，進日榜而不是直接落到週榜", async () => {
    await submit("role-1");
    // 登記在兩天前；日榜的 24 小時窗口早就滑過登記時間
    await env.DB.prepare("UPDATE cards SET registered_at = ? WHERE source_role_id = ?").bind(Date.now() - 2 * DAY, "role-1").run();
    const before = Date.now();
    await approve("role-1");
    expect(await registeredAt("role-1")).toBeGreaterThanOrEqual(before);
    expect(await dayBoard()).toEqual(["role-1"]);
  });

  it("重審過關不算重新上榜：上榜時間不動", async () => {
    await submit("role-1");
    await approve("role-1");
    const listedAt = Date.now() - 3 * DAY;
    await env.DB.prepare("UPDATE cards SET registered_at = ? WHERE source_role_id = ?").bind(listedAt, "role-1").run();
    authorEditsPublicly("role-1", "改名了");
    await submit("role-1");
    const id = (await queue("rev-a")).body.items[0].id as string;
    await act(id, "claim", "rev-a");
    expect(((await (await act(id, "stamp", "rev-a", { verdict: "approve" })).json()) as any).cardStatus).toBe("approved");
    expect(await registeredAt("role-1")).toBe(listedAt);
    expect(await dayBoard()).toEqual([]);
  });

  it("草稿改動與排程不改公開版本，新版核准後才切換", async () => {
    await submit("role-1"); await approve("role-1");
    const before=await cardStatus("role-1");
    const publicBefore=await board();
    authorEditsPublicly("role-1", "改名了");
    await sync();
    expect(await cardStatus("role-1")).toEqual(before);
    expect((await queue("rev-a")).body.items).toHaveLength(0);
    expect((await board()).map(({syncedAt,...card}:any)=>card)).toEqual(publicBefore.map(({syncedAt,...card}:any)=>card));
    const response=await submit("role-1"); expect(response.status).toBe(200);
    const receipt=await response.json() as any;
    expect(await cardStatus("role-1")).toEqual(before);
    expect((await board()).map(({syncedAt,...card}:any)=>card)).toEqual(publicBefore.map(({syncedAt,...card}:any)=>card));
    const q=await queue("rev-a");
    expect(q.body.items[0]).toMatchObject({kind:"re",stamps:{approve:0,required:1}});
    const id=q.body.items[0].id;
    await act(id,"claim","rev-a");
    expect((await act(id,"stamp","rev-a",{verdict:"approve"})).status).toBe(200);
    expect((await cardStatus("role-1")).reviewed_hash).toBe("version:"+receipt.versionId);
    expect((await board())[0]).toMatchObject({roleId:"frozen-"+receipt.versionId,name:"改名了"});
    await sync();
    expect((await queue("rev-a")).body.items).toHaveLength(0);
  });

  it("同步不採用草稿內容指紋，也不改寫已核准版本", async () => {
    await submit("role-1"); await approve("role-1");
    const approved=await cardStatus("role-1");
    authorEditsPublicly("role-1", "另一份草稿");
    await sync();
    expect(await cardStatus("role-1")).toEqual(approved);
    expect(await board()).toHaveLength(1);
  });
});

describe("第幾次送審", () => {
  // 審核人回報：卡被退後重送，審的人只能靠記。佇列與審核頁標出這是同一張卡第幾次送審，
  // 以及上一次的結果。作者撤回、沒人看過的單（superseded）不算一次送審。
  const pendingId = async () => (await queue("rev-a")).body.items[0].id as string;
  const detail = async (id: string) =>
    (await (await SELF.fetch(`https://c.test/v1/review/${id}/detail`, { headers: bearer("rev-a") })).json()) as any;
  const decide = async (verdict: "approve" | "reject", note = "") => {
    const id = await pendingId();
    await act(id, "claim", "rev-a");
    expect((await act(id, "stamp", "rev-a", { verdict, ...(note ? { note } : {}) })).status).toBe(200);
    return id;
  };

  it("首送是第 1 次、沒有上次；被退後重送是第 2 次、帶上次退件原因；再退再送是第 3 次", async () => {
    await makeReviewer(REVIEWER_A);
    await submit("role-1");
    expect((await queue("rev-a")).body.items[0].attempt).toBe(1);
    const firstId = await pendingId();
    await act(firstId, "claim", "rev-a");
    expect((await detail(firstId)).submission).toMatchObject({ attempt: 1, previous: null });
    await act(firstId, "stamp", "rev-a", { verdict: "reject", note: "世界書會把點數燒光" });
    const first = (await env.DB.prepare("SELECT submitted_at, decided_at FROM review_submissions WHERE id = ?").bind(firstId).first<any>())!;

    await submit("role-1");
    const second = (await queue("rev-a")).body.items[0];
    expect(second.attempt).toBe(2);
    await act(second.id, "claim", "rev-a");
    expect((await detail(second.id)).submission).toMatchObject({
      attempt: 2,
      previous: { status: "rejected", note: "世界書會把點數燒光", submittedAt: first.submitted_at, decidedAt: first.decided_at },
    });
    await act(second.id, "stamp", "rev-a", { verdict: "reject", note: "開場白還是空的" });

    await submit("role-1");
    const third = (await queue("rev-a")).body.items[0];
    expect(third.attempt).toBe(3);
    await act(third.id, "claim", "rev-a");
    expect((await detail(third.id)).submission).toMatchObject({ attempt: 3, previous: { status: "rejected", note: "開場白還是空的" } });

    // 回頭看第二張（已定案）：算的是它自己之前的，不是最新的
    expect((await detail(second.id)).submission).toMatchObject({ attempt: 2, previous: { status: "rejected", note: "世界書會把點數燒光" } });
  });

  it("過審後改內容再送審：第 2 次，上次結果是通過", async () => {
    await makeReviewer(REVIEWER_A);
    await submit("role-1");
    await decide("approve");
    authorEditsPublicly("role-1", "改名了");
    await submit("role-1");
    const item = (await queue("rev-a")).body.items[0];
    expect(item).toMatchObject({ kind: "re", attempt: 2 });
    await act(item.id, "claim", "rev-a");
    expect((await detail(item.id)).submission).toMatchObject({ attempt: 2, previous: { status: "approved", note: "" } });
  });

  it("沒人看過就被取代的單不算一次送審；別張卡的歷史不算進來", async () => {
    await makeReviewer(REVIEWER_A);
    await submit("role-2");
    await decide("reject", "別張卡的退件");
    await submit("role-1");
    await env.DB.prepare("UPDATE review_submissions SET status = 'superseded' WHERE source_role_id <> 'role-2' AND status = 'pending'").run();
    // 被取代的那張留在歷史裡；作者再送一次
    await env.DB.prepare(
      "INSERT INTO review_submissions (id, card_id, provider, source_role_id, kind, status, content_hash, submitted_at) SELECT 'again', card_id, provider, source_role_id, kind, 'pending', content_hash, submitted_at + 1 FROM review_submissions WHERE status = 'superseded'",
    ).run();
    const items = (await queue("rev-a")).body.items;
    expect(items.find((i: any) => i.id === "again").attempt).toBe(1);
  });
});

describe("審核工具第一批：字數門檻、結果、搜尋", () => {
  // 唯一的硬性標準是有效字數（shared/review-length.ts，超過 3,000 字＝至少 3,001）。送審時已擋，
  // 審核端再擋一次：門檻上線前就在排隊的單、舊頁面或直接打 API 都不能讓未達標的版本過審。
  const exactly = (n: number) => () => ({ document: { roleName: "夜行偵探", roleDetailDesc: "字".repeat(n) }, worldbooks: [] });
  const detail = async (id: string, who = "rev-a") =>
    (await (await SELF.fetch(`https://c.test/v1/review/${id}/detail`, { headers: bearer(who) })).json()) as any;
  const decisions = async (q?: string, who = "rev-a") => {
    const res = await SELF.fetch(`https://c.test/v1/review/decisions${q === undefined ? "" : `?q=${encodeURIComponent(q)}`}`, { headers: bearer(who) });
    return { status: res.status, body: (await res.json()) as { items: any[]; nextCursor: number | null } };
  };
  const metric = async (outcome: string) =>
    (await env.DB.prepare("SELECT value FROM ops_metrics WHERE metric='review_length' AND operation='stamp' AND outcome=?").bind(outcome).first<{ value: number }>())?.value ?? 0;

  it("佇列帶送審當下的有效字數；3,001 可以通過", async () => {
    reviewUpstream(exactly(3001));
    await makeReviewer(REVIEWER_A);
    await submit("role-1");
    const item = (await queue("rev-a")).body.items[0];
    expect(item.reviewLength).toEqual({ total: 3001, required: 3001, remaining: 0, eligible: true });
    await act(item.id, "claim", "rev-a");
    expect((await act(item.id, "stamp", "rev-a", { verdict: "approve" })).status).toBe(200);
    expect(await metric("eligible")).toBe(1);
  });

  it("3,000 字（差 1）不能通過，可以駁回；伺服器回字數與差額", async () => {
    await makeReviewer(REVIEWER_A);
    await submit("role-1");
    const id = (await queue("rev-a")).body.items[0].id as string;
    // 門檻上線前送審、還在排隊的單：記下的是當時的字數
    await env.DB.prepare("UPDATE review_submissions SET review_length_total = 3000 WHERE id = ?").bind(id).run();
    expect((await queue("rev-a")).body.items[0].reviewLength).toEqual({ total: 3000, required: 3001, remaining: 1, eligible: false });
    await act(id, "claim", "rev-a");
    const refused = await act(id, "stamp", "rev-a", { verdict: "approve" });
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({ error: "review_length_insufficient", detail: { reviewLength: { total: 3000, required: 3001, remaining: 1, eligible: false } } });
    expect(await metric("insufficient")).toBe(1);
    expect((await env.DB.prepare("SELECT status, claimed_by FROM review_submissions WHERE id = ?").bind(id).first<any>())).toMatchObject({ status: "pending", claimed_by: `member-${REVIEWER_A}` });
    expect((await act(id, "stamp", "rev-a", { verdict: "reject", note: "有效字數不足" })).status).toBe(200);
  });

  it("沒記字數的舊單：用快照裡的統計擋；快照也沒有就不擋（算不出來交給審核員判斷）", async () => {
    await makeReviewer(REVIEWER_A);
    await submit("role-1");
    const id = (await queue("rev-a")).body.items[0].id as string;
    await env.DB.prepare("UPDATE review_submissions SET review_length_total = NULL WHERE id = ?").bind(id).run();
    const { encodeSnapshot } = await import("../src/review-snapshot");
    const replace = async (record: Record<string, unknown>) => {
      await env.DB.prepare("DELETE FROM review_snapshots WHERE submission_id = ?").bind(id).run();
      await env.DB.prepare("INSERT INTO review_snapshots (submission_id, detail, created_at) VALUES (?, ?, ?)").bind(id, await encodeSnapshot(record as any), Date.now()).run();
    };
    await replace({ slim: true, document: { roleDetailDesc: "" }, reviewLength: { persona: 3000, constantWorldbook: 0, total: 3000, required: 3001, remaining: 1, eligible: false, welcome: 0 }, hashes: {} });
    expect((await queue("rev-a")).body.items[0].reviewLength).toBeNull();
    await act(id, "claim", "rev-a");
    expect((await act(id, "stamp", "rev-a", { verdict: "approve" })).status).toBe(400);
    await replace({ slim: true, document: { roleDetailDesc: "" }, hashes: {} });
    expect((await act(id, "stamp", "rev-a", { verdict: "approve" })).status).toBe(200);
    expect(await metric("unknown")).toBe(1);
  });

  it("審核頁算出字數時補記到審核單，佇列下次就看得到", async () => {
    await makeReviewer(REVIEWER_A);
    await submit("role-1");
    const id = (await queue("rev-a")).body.items[0].id as string;
    await env.DB.prepare("UPDATE review_submissions SET review_length_total = NULL WHERE id = ?").bind(id).run();
    await act(id, "claim", "rev-a");
    const total = (await detail(id)).detail.reviewLength.total as number;
    expect((await queue("rev-a")).body.items[0].reviewLength).toMatchObject({ total });
  });

  it("審核頁的每一章標出是不是我蓋的（結果卡用），不帶審核員身分", async () => {
    await makeReviewer(REVIEWER_A);
    await makeReviewer(REVIEWER_B);
    await submit("role-1");
    const id = (await queue("rev-a")).body.items[0].id as string;
    await env.DB.prepare("INSERT INTO review_stamps (submission_id, member_id, verdict, note, created_at) VALUES (?, ?, 'approve', '開場很好', ?)")
      .bind(id, `member-${REVIEWER_B}`, Date.now()).run();
    await act(id, "claim", "rev-a");
    expect((await detail(id)).submission.stamps).toEqual([expect.objectContaining({ verdict: "approve", note: "開場很好", mine: false })]);
    await act(id, "stamp", "rev-a", { verdict: "reject", note: "設定太少" });
    const decided = await detail(id);
    expect(decided.submission.stamps.map((s: any) => [s.note, s.mine])).toEqual([["開場很好", false], ["設定太少", true]]);
    expect(JSON.stringify(decided)).not.toContain(`member-${REVIEWER_B}`);
  });

  describe("我處理過的：搜尋", () => {
    const decide = async (roleId: string, name: string) => {
      authorEditsPublicly(roleId, name);
      await submit(roleId);
      const item = (await queue("rev-a")).body.items[0];
      await act(item.id, "claim", "rev-a");
      expect((await act(item.id, "stamp", "rev-a", { verdict: "reject", note: "x" })).status).toBe(200);
      return item;
    };

    it("卡名部分比對、不分大小寫；純數字是卡號精確比對；沒有符合就是空清單", async () => {
      await makeReviewer(REVIEWER_A);
      await makeReviewer(REVIEWER_B);
      const night = await decide("role-1", "Night Detective");
      const moon = await decide("role-2", "月下100%");
      expect((await decisions()).body.items).toHaveLength(2);
      expect((await decisions("detect")).body.items.map((i: any) => i.id)).toEqual([night.id]);
      expect((await decisions("月下")).body.items.map((i: any) => i.id)).toEqual([moon.id]);
      // % 與 _ 是字面字元，不是萬用字元
      expect((await decisions("100%")).body.items.map((i: any) => i.id)).toEqual([moon.id]);
      expect((await decisions("_")).body.items).toEqual([]);
      expect((await decisions(String(night.card.id))).body.items.map((i: any) => i.id)).toEqual([night.id]);
      expect((await decisions(String(night.card.id).slice(0, -1) || "0")).body.items).toEqual([]);
      expect((await decisions("沒有這張")).body).toEqual({ items: [], nextCursor: null });
      // 只搜自己的紀錄
      expect((await decisions("detect", "rev-b")).body.items).toEqual([]);
      // 空白當沒有條件
      expect((await decisions("  ")).body.items).toHaveLength(2);
    });
  });
});
