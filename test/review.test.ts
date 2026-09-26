import { SELF, createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import worker from "../src/index";
import {
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
  await resetDb();
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
 return SELF.fetch("https://c.test/v1/cards",{method:"POST",headers:{"Content-Type":"application/json",...bearer(token)},body:JSON.stringify({roleId,nsfw:false,operationId:pending?.operation_id??crypto.randomUUID()})});
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
    reviewUpstream((roleId) => ({ roleId, document: { roleName: "夜行偵探", userName: "助手", roleDetailDesc: "角色描述原文", customInstructions: "自訂指示" }, worldbooks: [{ name: "世界書", entries: [{ content: "世界書條目" }] }] }));
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
    expect(body.detail.worldbooks[0].entries[0].content).toBe("世界書條目");
    expect(sealedReads).toEqual([{ roleId: "frozen-" + receipt.versionId, provider: "harbor" }]);
  });
});

describe("提交", () => {
  it("用作者的 token 讀整份設定存成快照、綁定封存版本、排進佇列；卡不上榜", async () => {
    const res = await submit("role-1");
    expect(res.status).toBe(201);
    const receipt=await res.json() as any;
    expect(receipt.status).toBe("pending");
    expect(settingsReads).toEqual([{ token: "author-token", roleId: "frozen-"+receipt.versionId, provider: "harbor" }]);
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
    expect((await submit("role-1")).status).toBe(500);
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

  it("審核時改標籤：領著的審核人直接改對，過審後榜上是改過的標籤，留下稽核紀錄", async () => {
    await submit("role-1");
    await makeReviewer(REVIEWER_A);
    await makeReviewer(REVIEWER_B);
    const id = (await queue("rev-a")).body.items[0].id as string;
    const tags = (token: string, body: unknown) => act(id, "tags", token, body);

    // 沒領不能改；不是審核人不能改
    expect((await tags("rev-a", { tags: ["推理", "倫理"] })).status).toBe(409);
    expect((await tags("author-token", { tags: ["倫理"] })).status).toBe(403);
    await act(id, "claim", "rev-a");
    // 別人領著不能改
    expect((await tags("rev-b", { tags: ["倫理"] })).status).toBe(409);
    expect((await tags("rev-a", { tags: "倫理" })).status).toBe(400);

    const res = await tags("rev-a", { tags: [" 推理 ", "倫理", "倫理"] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ tags: ["推理", "倫理"] });
    // 審核頁讀到的是改過的標籤
    const detail = (await (await SELF.fetch(`https://c.test/v1/review/${id}/detail`, { headers: bearer("rev-a") })).json()) as any;
    expect(detail.card.tags).toEqual(["推理", "倫理"]);

    await act(id, "stamp", "rev-a", { verdict: "approve" });
    const listed = (await (await SELF.fetch("https://c.test/v1/cards")).json()) as { items: { tags: string[] }[] };
    expect(listed.items[0].tags).toEqual(["推理", "倫理"]);
    const event = await env.DB.prepare("SELECT action, before_value, after_value FROM moderation_events WHERE source_role_id='role-1'").first<{ action: string; before_value: string; after_value: string }>();
    expect(event).toMatchObject({ action: "tags", before_value: JSON.stringify(["推理"]), after_value: JSON.stringify(["推理", "倫理"]) });
    // 定案後不能再改
    expect((await tags("rev-a", { tags: ["推理"] })).status).toBe(410);
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
    expect(settingsReads).toHaveLength(1);
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
    expect(await board()).toEqual(publicBefore);
    const response=await submit("role-1"); expect(response.status).toBe(200);
    const receipt=await response.json() as any;
    expect(await cardStatus("role-1")).toEqual(before);
    expect(await board()).toEqual(publicBefore);
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
