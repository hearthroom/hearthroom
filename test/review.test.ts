import { SELF, createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import worker from "../src/index";
import {
  bearer, identities, makeReviewer, resetDb, restoreUpstream, reviewOff, reviewOn, reviewUpstream, rolesOnMainSite, settingsReads,
} from "./helpers";
import { CLAIM_TTL_MS } from "../src/review";

// 審核開著時，提交＝本站用作者的 token 讀一次整份設定存成快照＋排隊；審核人領、蓋章、上榜；
// 公開資料變了重審。審核讀取是本站自己的事：沒有供應商的分享介面，也沒有站方持有的金鑰。
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

const submit = (roleId: string, token = "author-token") =>
  SELF.fetch("https://c.test/v1/cards", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...bearer(token) },
    body: JSON.stringify({ roleId, nsfw: false }),
  });
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

describe("提交", () => {
  it("用作者的 token 讀整份設定存成快照、記下公開指紋、排進佇列；卡不上榜", async () => {
    const res = await submit("role-1");
    expect(res.status).toBe(201);
    expect(((await res.json()) as any).status).toBe("pending");
    expect(settingsReads).toEqual([{ token: "author-token", roleId: "role-1", provider: "lunatalk" }]);
    expect(await board()).toHaveLength(0);
    const s = await env.DB.prepare("SELECT kind, status, content_hash FROM review_submissions").first<any>();
    expect(s).toMatchObject({ kind: "first", status: "pending" });
    expect(s.content_hash).toMatch(/^pub1:[0-9a-f]{64}$/);
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

  it("沒開審核的部署退回登記即上榜，也不去讀作者的設定", async () => {
    reviewOff();
    expect((await submit("role-1")).status).toBe(201);
    expect(settingsReads).toHaveLength(0);
    expect(await board()).toHaveLength(1);
    expect((await cardStatus("role-1")).status).toBe("approved");
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
    expect(item.stamps).toEqual({ approve: 0, required: 2 });
    expect(item.claim).toBe("free");
    expect(JSON.stringify(item)).not.toContain(String(AUTHOR));
    expect(item).not.toHaveProperty("author");
  });

  it("初審兩章上榜：領→蓋→放回→另一人領→蓋；同一人不能蓋兩次；沒領不能蓋", async () => {
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
    expect(first).toMatchObject({ status: "pending", cardStatus: "pending", stamps: { approve: 1, required: 2 } });
    expect(await board()).toHaveLength(0);

    // 蓋完自動放回；同一人不能再領
    expect((await act(id, "claim", "rev-a")).status).toBe(409);
    expect((await queue("rev-a")).body.items[0].stampedByMe).toBe(true);

    expect((await act(id, "claim", "rev-b")).status).toBe(200);
    const second = (await (await act(id, "stamp", "rev-b", { verdict: "approve" })).json()) as any;
    expect(second).toMatchObject({ status: "approved", cardStatus: "approved", stamps: { approve: 2, required: 2 } });
    expect(await board()).toHaveLength(1);
    expect(await cardStatus("role-1")).toMatchObject({ status: "approved", reviewed_hash: expect.stringMatching(/^pub1:/) });
    // 上榜＝定案：快照刪掉，本站不留私有設定
    expect(await snapshots()).toBe(0);
    expect((await queue("rev-a")).body.items).toHaveLength(0);
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
    expect(body.detail.document.customInstructions).toBe("自訂指示");
    expect(body.submission).toMatchObject({ kind: "first", required: 2, claimedByMe: true });
    expect(JSON.stringify(body)).not.toContain(String(AUTHOR));
    expect((await SELF.fetch(`https://c.test/v1/review/${id}/detail`, { headers: bearer("stranger") })).status).toBe(403);
    // 審核頁不再回頭問供應商：快照是唯一來源
    expect(settingsReads).toHaveLength(1);
    // 駁回即定案：快照刪掉
    await act(id, "claim", "rev-a");
    expect((await act(id, "stamp", "rev-a", { verdict: "reject", note: "不行" })).status).toBe(200);
    expect(await snapshots()).toBe(0);
  });

  it("排隊中再送一次：快照換成最新送來的那一份", async () => {
    reviewUpstream(() => ({ document: { roleName: "第一版" } }));
    await submit("role-1");
    reviewUpstream(() => ({ document: { roleName: "第二版" } }));
    await submit("role-1");
    await makeReviewer(REVIEWER_A);
    const id = (await queue("rev-a")).body.items[0].id as string;
    await act(id,"claim","rev-a");
    const body = (await (await SELF.fetch(`https://c.test/v1/review/${id}/detail`, { headers: bearer("rev-a") })).json()) as any;
    expect(body.detail.document.roleName).toBe("第二版");
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
    ((await (await SELF.fetch("https://c.test/v1/cards?sort=day")).json()) as { items: { roleId: string }[] }).items.map((i) => i.roleId);

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
    await sync();
    const id = (await queue("rev-a")).body.items[0].id as string;
    await act(id, "claim", "rev-a");
    expect(((await (await act(id, "stamp", "rev-a", { verdict: "approve" })).json()) as any).cardStatus).toBe("approved");
    expect(await registeredAt("role-1")).toBe(listedAt);
    expect(await dayBoard()).toEqual([]);
  });

  it("過審後作者改了訪客看得到的東西：同步發現公開指紋變了 → 離榜、開重審單；重審一章即回榜", async () => {
    await submit("role-1");
    await approve("role-1");
    expect(await board()).toHaveLength(1);
    const approvedHash = (await cardStatus("role-1")).reviewed_hash;
    expect(approvedHash).toMatch(/^pub1:/);
    // 沒改：同步跑幾次都不開單
    await sync();
    expect((await cardStatus("role-1")).status).toBe("approved");

    authorEditsPublicly("role-1", "改名了");
    await sync();
    expect((await cardStatus("role-1")).status).toBe("needs_review");
    expect(await board()).toHaveLength(0);
    const q = await queue("rev-a");
    expect(q.body.items[0]).toMatchObject({ kind: "re", stamps: { approve: 0, required: 1 } });

    // 同步開的單沒有快照（那時沒有作者的 token）：審核人看的是變動後的公開資料
    const id = q.body.items[0].id as string;
    await act(id,"claim","rev-a");
    const detail = (await (await SELF.fetch(`https://c.test/v1/review/${id}/detail`, { headers: bearer("rev-a") })).json()) as any;
    expect(detail.detail).toMatchObject({ partial: true, document: { roleName: "改名了" } });
    expect(JSON.stringify(detail)).not.toContain(String(AUTHOR));

    await act(id, "claim", "rev-a");
    const res = (await (await act(id, "stamp", "rev-a", { verdict: "approve" })).json()) as any;
    expect(res.cardStatus).toBe("approved");
    const after = await cardStatus("role-1");
    expect(after.status).toBe("approved");
    expect(after.reviewed_hash).not.toBe(approvedHash);
    expect(await board()).toHaveLength(1);
    // 同步再跑一次：版本一致，不再開單
    await sync();
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM review_submissions WHERE status = 'pending'").first<{ n: number }>();
    expect(n?.n).toBe(0);
  });

  it("過審前登記的舊卡：留在榜上，同步不比對", async () => {
    reviewOff();
    await submit("role-2");
    reviewOn();
    expect(await cardStatus("role-2")).toEqual({ status: "approved", reviewed_hash: "" });
    authorEditsPublicly("role-2", "改名了");
    await sync();
    expect(await cardStatus("role-2")).toEqual({ status: "approved", reviewed_hash: "" });
    expect(await board()).toHaveLength(1);
  });

  it("舊版本綁的是供應商給的內容雜湊：同步改綁成公開指紋，不重審、不下架", async () => {
    await submit("role-1");
    await approve("role-1");
    await env.DB.prepare("UPDATE cards SET reviewed_hash = 'sha256:legacy-upstream-hash' WHERE source_role_id = 'role-1'").run();
    await sync();
    const row = await cardStatus("role-1");
    expect(row.status).toBe("approved");
    expect(row.reviewed_hash).toMatch(/^pub1:/);
    expect(await board()).toHaveLength(1);
  });
});
