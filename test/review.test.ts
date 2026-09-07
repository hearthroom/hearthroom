import { SELF, createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import worker from "../src/index";
import {
  bearer, grantCalls, identities, makeReviewer, resetDb, restoreUpstream, reviewUpstream, rolesOnMainSite, upstreamHashes,
} from "./helpers";
import { CLAIM_TTL_MS } from "../src/review";

// 審核機器人配好時，提交＝授權＋排隊；審核人領、蓋章、上榜；內容變了重審。
// 測試環境的 wrangler.toml 帶著 REVIEW_BOT_ACCOUNT_NUM_ID，金鑰由這裡塞進 env。
const AUTHOR = 10001;
const REVIEWER_A = 20001;
const REVIEWER_B = 20002;
const STRANGER = 30003;

beforeEach(async () => {
  await resetDb();
  upstreamHashes.clear();
  identities({ "author-token": AUTHOR, "rev-a": REVIEWER_A, "rev-b": REVIEWER_B, "stranger": STRANGER });
  rolesOnMainSite({ roleId: "role-1", authorNumId: AUTHOR }, { roleId: "role-2", authorNumId: AUTHOR });
  reviewUpstream();
  (env as { REVIEW_BOT_KEY?: string }).REVIEW_BOT_KEY = "lsk_test";
});
afterEach(() => {
  restoreUpstream();
  delete (env as { REVIEW_BOT_KEY?: string }).REVIEW_BOT_KEY;
});

const submit = (roleId: string, token = "author-token") =>
  SELF.fetch("https://c.test/v1/cards", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...bearer(token) },
    body: JSON.stringify({ roleId }),
  });
// 榜單有邊緣快取（整個 URL 是鍵）：同一個測試裡多次看榜要換查詢字串，才不會讀到前一次的結果。
let boardSeq = 0;
const board = async () =>
  ((await (await SELF.fetch(`https://c.test/v1/cards?_=${++boardSeq}`)).json()) as { items: { roleId: string }[] }).items;
const queue = async (token: string) => {
  const res = await SELF.fetch("https://c.test/v1/review/queue", { headers: bearer(token) });
  return { status: res.status, body: (await res.json()) as { items: any[] } };
};
const act = (id: string, action: string, token: string, body?: unknown) =>
  SELF.fetch(`https://c.test/v1/review/${id}/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...bearer(token) },
    body: body ? JSON.stringify(body) : undefined,
  });
const cardStatus = async (roleId: string) =>
  (await env.DB.prepare("SELECT status, reviewed_hash FROM cards WHERE source_role_id = ?").bind(roleId).first<{ status: string; reviewed_hash: string }>())!;

describe("提交", () => {
  it("替作者把卡授權給機器人、記下內容版本、排進佇列；卡不上榜", async () => {
    const res = await submit("role-1");
    expect(res.status).toBe(201);
    expect(((await res.json()) as any).status).toBe("pending");
    expect(grantCalls).toEqual([{ token: "author-token", roleId: "role-1", granteeAccountNumId: 330016 }]);
    expect(await board()).toHaveLength(0);
    const s = await env.DB.prepare("SELECT kind, status, content_hash FROM review_submissions").first<any>();
    expect(s).toMatchObject({ kind: "first", status: "pending", content_hash: "sha256:role-1-v1" });
    // 再送一次是冪等的：不開第二張單
    expect((await submit("role-1")).status).toBe(200);
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM review_submissions").first<{ n: number }>();
    expect(n?.n).toBe(1);
  });

  it("授權失敗就整個提交失敗，不落庫", async () => {
    const { upstream } = await import("../src/upstream");
    upstream.grantShare = async () => { throw new Error("boom"); };
    expect((await submit("role-1")).status).toBe(500);
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM cards").first<{ n: number }>();
    expect(n?.n).toBe(0);
  });

  it("沒配機器人的部署退回登記即上榜", async () => {
    delete (env as { REVIEW_BOT_KEY?: string }).REVIEW_BOT_KEY;
    expect((await submit("role-1")).status).toBe(201);
    expect(grantCalls).toHaveLength(0);
    expect(await board()).toHaveLength(1);
    expect((await cardStatus("role-1")).status).toBe("approved");
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
    expect(await cardStatus("role-1")).toEqual({ status: "approved", reviewed_hash: "sha256:role-1-v1" });
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

  it("審核頁：機器人讀整份設定，帶審核單狀態，不帶作者", async () => {
    reviewUpstream((roleId) => ({ roleId, authorNumId: AUTHOR, document: { roleName: "夜行偵探", jailbreak: "越獄詞" } }));
    await submit("role-1");
    await makeReviewer(REVIEWER_A);
    const id = (await queue("rev-a")).body.items[0].id as string;
    const res = await SELF.fetch(`https://c.test/v1/review/${id}/detail`, { headers: bearer("rev-a") });
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toContain("no-store");
    const body = (await res.json()) as any;
    expect(body.detail.document.jailbreak).toBe("越獄詞");
    expect(body.submission).toMatchObject({ kind: "first", required: 2, claimedByMe: false });
    expect(JSON.stringify(body)).not.toContain(String(AUTHOR));
    expect((await SELF.fetch(`https://c.test/v1/review/${id}/detail`, { headers: bearer("stranger") })).status).toBe(403);
  });

  it("作者收回授權：審核頁回 409，卡離榜、單作廢", async () => {
    await submit("role-1");
    await makeReviewer(REVIEWER_A);
    const id = (await queue("rev-a")).body.items[0].id as string;
    upstreamHashes.set("role-1", "revoked");
    expect((await SELF.fetch(`https://c.test/v1/review/${id}/detail`, { headers: bearer("rev-a") })).status).toBe(409);
    expect((await cardStatus("role-1")).status).toBe("unshared");
    expect((await queue("rev-a")).body.items).toHaveLength(0);
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
  // 直接叫 scheduled：同步是排程跑的，走 fetch 進不去。用真的 env（含測試塞進去的機器人金鑰）。
  const sync = async () => {
    const ctx = createExecutionContext();
    await worker.scheduled({ cron: "17 * * * *", scheduledTime: Date.now(), noRetry() {} } as ScheduledController, env, ctx);
    await waitOnExecutionContext(ctx);
  };

  it("過審後作者改了卡：同步發現雜湊變了 → 離榜、開重審單；重審一章即回榜", async () => {
    await submit("role-1");
    await approve("role-1");
    expect(await board()).toHaveLength(1);

    upstreamHashes.set("role-1", "sha256:role-1-v2");
    await sync();
    expect((await cardStatus("role-1")).status).toBe("needs_review");
    expect(await board()).toHaveLength(0);
    const q = await queue("rev-a");
    expect(q.body.items[0]).toMatchObject({ kind: "re", stamps: { approve: 0, required: 1 } });

    const id = q.body.items[0].id as string;
    await act(id, "claim", "rev-a");
    const res = (await (await act(id, "stamp", "rev-a", { verdict: "approve" })).json()) as any;
    expect(res.cardStatus).toBe("approved");
    expect(await cardStatus("role-1")).toEqual({ status: "approved", reviewed_hash: "sha256:role-1-v2" });
    expect(await board()).toHaveLength(1);
    // 同步再跑一次：版本一致，不再開單
    await sync();
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM review_submissions WHERE status = 'pending'").first<{ n: number }>();
    expect(n?.n).toBe(0);
  });

  it("過審前登記的舊卡：留在榜上，同步不去問機器人（它沒被授權，讀不到不等於作者收回）", async () => {
    delete (env as { REVIEW_BOT_KEY?: string }).REVIEW_BOT_KEY;
    await submit("role-2");
    (env as { REVIEW_BOT_KEY?: string }).REVIEW_BOT_KEY = "lsk_test";
    expect(await cardStatus("role-2")).toEqual({ status: "approved", reviewed_hash: "" });
    // 機器人真的讀不到這張卡
    upstreamHashes.set("role-2", "revoked");
    await sync();
    expect(await cardStatus("role-2")).toEqual({ status: "approved", reviewed_hash: "" });
    expect(await board()).toHaveLength(1);
  });

  it("機器人的金鑰壞了：同步不比對、審核頁回 503，一張卡都不下架", async () => {
    await submit("role-1");
    await approve("role-1");
    const { upstream } = await import("../src/upstream");
    const users = upstream.fetchMe;
    upstream.fetchMe = async (env, token) => {
      if (token === "lsk_test") throw new (await import("../src/types")).HttpError(401, "upstream rejected the token");
      return users(env, token);
    };
    upstreamHashes.set("role-1", "revoked");
    await sync();
    expect((await cardStatus("role-1")).status).toBe("approved");
    expect(await board()).toHaveLength(1);

    await submit("role-2");
    upstreamHashes.set("role-2", "revoked");
    const id = (await queue("rev-a")).body.items[0].id as string;
    expect((await SELF.fetch(`https://c.test/v1/review/${id}/detail`, { headers: bearer("rev-a") })).status).toBe(503);
    expect((await cardStatus("role-2")).status).toBe("pending");
  });

  it("作者在主站收回授權：同步把卡標成 unshared、離榜", async () => {
    await submit("role-1");
    await approve("role-1");
    upstreamHashes.set("role-1", "revoked");
    await sync();
    expect((await cardStatus("role-1")).status).toBe("unshared");
    expect(await board()).toHaveLength(0);
  });
});
