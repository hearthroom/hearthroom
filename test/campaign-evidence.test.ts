import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import { attachEvidence, attachFailed, campaignMaintenance } from "../src/campaign-evidence";
import type { Env } from "../src/types";
import { bearer, identities, makeAgent, makeMember, makeReviewer, resetDb, restoreUpstream } from "./helpers";

// 分享活動的私有截圖：上傳、只給本人與審核員讀、掛到位置、排程清理與保留期刪除。
const OWNER = 61001, OTHER = 61002, REVIEWER = 61003, AGENT = 61004;
const DAY = 86_400_000;

type Stored = { body: ArrayBuffer; contentType?: string };
const objects = new Map<string, Stored>();
const bucket = {
  put: vi.fn(async (k: string, v: ArrayBuffer, o?: { httpMetadata?: { contentType?: string } }) => { objects.set(k, { body: v, contentType: o?.httpMetadata?.contentType }); }),
  delete: vi.fn(async (k: string | string[]) => { for (const x of [k].flat()) objects.delete(x); }),
  get: vi.fn(async (k: string) => {
    const o = objects.get(k);
    return o ? { body: new Response(o.body).body, httpMetadata: { contentType: o.contentType } } : null;
  }),
};
const images = { info: vi.fn(async (_s: ReadableStream<Uint8Array>) => ({ format: "image/png", width: 1170, height: 2532, fileSize: 8 }) as unknown) };
const fixture = (over: Record<string, unknown> = {}) => ({ ...env, EVIDENCE: bucket, IMAGES: images, ...over }) as unknown as Env;

async function call(path: string, init: { method?: string; token?: string; form?: FormData } = {}, over: Record<string, unknown> = {}) {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request("https://c.test" + path, { method: init.method ?? "GET", headers: init.token ? bearer(init.token) : {}, body: init.form }), fixture(over), ctx);
  await waitOnExecutionContext(ctx);
  return res;
}
const json = async (r: Response) => (await r.json()) as any;
const count = async (sql: string, ...b: unknown[]) => (await env.DB.prepare(sql).bind(...b).first<{ n: number }>())!.n;
const png = (bytes = 8) => new File([new Uint8Array(bytes).fill(7)], "shot.png", { type: "image/png" });
const upload = (file: File, token = "owner", over: Record<string, unknown> = {}) => {
  const f = new FormData();
  f.set("file", file);
  return call("/v1/campaign/evidence", { method: "POST", token, form: f }, over);
};
const uploaded = async (token = "owner") => (await json(await upload(png(), token))).id as string;

let owner = "", other = "", campaignId = "";
async function placement(memberId: string, payoutDeadline = Date.now() + 30 * DAY, retention = 90): Promise<string> {
  const now = Date.now();
  campaignId ||= crypto.randomUUID();
  await env.DB.prepare("INSERT OR IGNORE INTO campaigns (id, slug, title, created_by, created_at, updated_at) VALUES (?, ?, '{}', 'test', ?, ?)").bind(campaignId, "launch", now, now).run();
  await env.DB.prepare("UPDATE campaigns SET payout_deadline = ?, evidence_retention_days = ? WHERE id = ?").bind(payoutDeadline, retention, campaignId).run();
  const content = crypto.randomUUID(), id = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO share_contents (id, campaign_id, member_id, recipient_account_no, title, share_code, created_at, updated_at) VALUES (?, ?, ?, 1, 't', ?, ?, ?)").bind(content, campaignId, memberId, content.slice(0, 8), now, now),
    env.DB.prepare("INSERT INTO share_placements (id, content_id, platform, location, location_key, published_at, requested_tier, created_at, updated_at) VALUES (?, ?, 'tieba', 'x', 'tieba:x', ?, 'light', ?, ?)").bind(id, content, now, now, now),
  ]);
  return id;
}
const attach = (memberId: string, placementId: string, ids: string[]) => env.DB.batch(attachEvidence(env.DB, memberId, placementId, ids)).catch(attachFailed);
const attachCode = (memberId: string, placementId: string, ids: string[]) => attach(memberId, placementId, ids).then(() => "ok", (e) => `${e.status} ${e.message}`);

beforeEach(async () => {
  await resetDb();
  objects.clear();
  vi.clearAllMocks();
  campaignId = "";
  identities({ owner: OWNER, other: OTHER, reviewer: REVIEWER, agent: AGENT });
  owner = await makeMember(OWNER);
  other = await makeMember(OTHER);
  await makeReviewer(REVIEWER);
  await makeAgent(AGENT);
});
afterEach(() => restoreUpstream());

describe("上傳", () => {
  it("原檔存進私有 bucket，索引列未掛上，回 id／sha256／bytes", async () => {
    const r = await upload(png(8));
    expect(r.status).toBe(200);
    const body = await json(r);
    const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(8).fill(7)))].map((b) => b.toString(16).padStart(2, "0")).join("");
    expect(body).toEqual({ id: expect.any(String), sha256: digest, bytes: 8 });
    expect(bucket.put).toHaveBeenCalledOnce();
    expect(objects.get(`evidence/${body.id}`)?.contentType).toBe("image/png");
    expect(new Uint8Array(objects.get(`evidence/${body.id}`)!.body)).toEqual(new Uint8Array(8).fill(7));
    const row = await env.DB.prepare("SELECT member_id, placement_id, r2_key, sha256, bytes FROM share_evidence WHERE id = ?").bind(body.id).first();
    expect(row).toEqual({ member_id: owner, placement_id: null, r2_key: `evidence/${body.id}`, sha256: digest, bytes: 8 });
    expect(r.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await (await call("/metrics")).text()).toContain('hearthroom_campaign_operations_total{operation="evidence_upload",outcome="success"} 1');
  });

  it("超過 10 MB、空檔、非點陣圖、info() 丟錯、像素過多一律 400；沒綁定 503；訪客 401", async () => {
    const code = async (r: Response) => `${r.status} ${(await json(r)).error}`;
    expect(await code(await upload(png(10 * 1024 * 1024 + 1)))).toBe("400 evidence_invalid");
    expect(await code(await upload(new File([], "e.png", { type: "image/png" })))).toBe("400 evidence_invalid");
    images.info.mockResolvedValueOnce({ format: "image/svg+xml" });
    expect(await code(await upload(png()))).toBe("400 evidence_invalid");
    images.info.mockRejectedValueOnce(new Error("not an image"));
    expect(await code(await upload(png()))).toBe("400 evidence_invalid");
    images.info.mockResolvedValueOnce({ format: "image/jpeg", width: 10000, height: 4001, fileSize: 8 });
    expect(await code(await upload(png()))).toBe("400 evidence_invalid");
    const big = new FormData();
    big.set("file", png(10 * 1024 * 1024 + 20000));
    expect(await code(await call("/v1/campaign/evidence", { method: "POST", token: "owner", form: big }))).toBe("400 evidence_invalid");
    expect(await code(await upload(png(), "owner", { IMAGES: undefined }))).toBe("503 evidence_unavailable");
    expect(await code(await upload(png(), "owner", { EVIDENCE: undefined }))).toBe("503 evidence_unavailable");
    expect((await upload(png(), "")).status).toBe(401);
    expect(bucket.put).not.toHaveBeenCalled();
    expect(await count("SELECT count(*) AS n FROM share_evidence")).toBe(0);
    const metrics = await (await call("/metrics")).text();
    expect(metrics).toContain('hearthroom_campaign_operations_total{operation="evidence_upload",outcome="denied"}');
    expect(metrics).toContain('hearthroom_campaign_operations_total{operation="evidence_upload",outcome="error"}');
  });

  it("存檔失敗不留索引列，回 503", async () => {
    bucket.put.mockRejectedValueOnce(new Error("r2 down"));
    const r = await upload(png());
    expect([r.status, (await json(r)).error]).toEqual([503, "evidence_unavailable"]);
    expect(await count("SELECT count(*) AS n FROM share_evidence")).toBe(0);
  });

  it("每人 24 小時最多 60 張（已刪除的也算），超過 429", async () => {
    const now = Date.now();
    await env.DB.batch(Array.from({ length: 60 }, (_, i) =>
      env.DB.prepare("INSERT INTO share_evidence (id, member_id, r2_key, sha256, bytes, created_at, purged_at) VALUES (?, ?, ?, 'h', 1, ?, ?)").bind(`e${i}`, owner, `evidence/e${i}`, now - 1000, i === 0 ? now : null)));
    const r = await upload(png());
    expect([r.status, (await json(r)).error]).toEqual([429, "evidence_rate_limited"]);
    expect((await upload(png(), "other")).status).toBe(200);
    await env.DB.prepare("UPDATE share_evidence SET created_at = ? WHERE id = 'e0'").bind(now - DAY - 1).run();
    expect((await upload(png())).status).toBe(200);
  });
});

describe("截圖只給本人與審核員", () => {
  it("本人讀 200 不寫稽核；其他成員、訪客、不存在一律 404；審核員與 AI 讀 200 各寫一筆稽核", async () => {
    const id = await uploaded();
    const mine = await call(`/v1/campaign/evidence/${id}`, { token: "owner" });
    expect(mine.status).toBe(200);
    expect(mine.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mine.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(mine.headers.get("Content-Disposition")).toBe("inline");
    expect(mine.headers.get("Content-Type")).toBe("image/png");
    expect(new Uint8Array(await mine.arrayBuffer())).toEqual(new Uint8Array(8).fill(7));
    expect(await count("SELECT count(*) AS n FROM audit_log WHERE subject_kind = 'share_evidence'")).toBe(0);

    for (const [token, path] of [["other", id], ["", id], ["owner", crypto.randomUUID()], ["reviewer", crypto.randomUUID()]]) {
      const r = await call(`/v1/campaign/evidence/${path}`, { token });
      expect([token, r.status, (await json(r)).error]).toEqual([token, 404, "evidence_not_found"]);
      expect(r.headers.get("Cache-Control")).toBe("private, no-store");
    }

    for (const token of ["reviewer", "agent"]) expect((await call(`/v1/campaign/evidence/${id}`, { token })).status).toBe(200);
    const audits = (await env.DB.prepare("SELECT subject_id, actor_kind, action, operation_id FROM audit_log WHERE subject_kind = 'share_evidence' ORDER BY actor_kind").all()).results;
    expect(audits).toMatchObject([{ subject_id: id, actor_kind: "ai", action: "evidence_view" }, { subject_id: id, actor_kind: "human", action: "evidence_view" }]);
    expect(audits[0].operation_id).not.toBe(audits[1].operation_id);
    const metrics = await (await call("/metrics")).text();
    expect(metrics).toContain('hearthroom_campaign_operations_total{operation="evidence_view",outcome="success"} 3');
    expect(metrics).toContain('hearthroom_campaign_operations_total{operation="evidence_view",outcome="denied"} 4');
  });

  it("別人的截圖不能掛、已掛的不能再掛、每個位置最多 6 張、超過 24 小時的不能掛", async () => {
    const mine = await placement(owner);
    const theirs = await uploaded("other");
    expect(await attachCode(owner, mine, [theirs])).toBe("400 evidence_not_attachable");
    expect(await count("SELECT count(*) AS n FROM share_evidence WHERE placement_id IS NOT NULL")).toBe(0);

    const ids: string[] = [];
    for (let i = 0; i < 7; i++) ids.push(await uploaded());
    // 一張不符，整批都不掛
    expect(await attachCode(owner, mine, [ids[0], theirs])).toBe("400 evidence_not_attachable");
    expect(await count("SELECT count(*) AS n FROM share_evidence WHERE placement_id IS NOT NULL")).toBe(0);
    expect(await attachCode(owner, mine, ids.slice(0, 5))).toBe("ok");
    expect(await attachCode(owner, await placement(owner), [ids[0]])).toBe("400 evidence_not_attachable");
    expect(await attachCode(owner, mine, ids.slice(5, 7))).toBe("400 evidence_not_attachable");
    expect(await attachCode(owner, mine, [ids[5]])).toBe("ok");
    expect(await attachCode(owner, mine, [ids[6]])).toBe("400 evidence_not_attachable");
    expect(await count("SELECT count(*) AS n FROM share_evidence WHERE placement_id = ?", mine)).toBe(6);
    expect(() => attachEvidence(env.DB, owner, mine, [ids[6], ids[6]])).toThrow("evidence_not_attachable");
    expect(attachEvidence(env.DB, owner, mine, [])).toEqual([]);

    await env.DB.prepare("UPDATE share_evidence SET created_at = ? WHERE id = ?").bind(Date.now() - DAY - 1, ids[6]).run();
    expect(await attachCode(owner, await placement(owner), [ids[6]])).toBe("400 evidence_not_attachable");
  });
});

describe("排程清理", () => {
  it("刪掉超過 24 小時未掛上的截圖（物件與索引列），留下未過期的與已掛上的", async () => {
    const [stale, fresh, attached] = [await uploaded(), await uploaded(), await uploaded()];
    await attach(owner, await placement(owner), [attached]);
    await env.DB.prepare("UPDATE share_evidence SET created_at = ? WHERE id IN (?, ?)").bind(Date.now() - DAY - 1, stale, attached).run();
    const ctx = createExecutionContext();
    await worker.scheduled({ cron: "17 * * * *", scheduledTime: Date.now(), noRetry() {} } as ScheduledController, fixture(), ctx);
    await waitOnExecutionContext(ctx);
    expect((await env.DB.prepare("SELECT id FROM share_evidence ORDER BY id").all()).results.map((r) => r.id).sort()).toEqual([fresh, attached].sort());
    expect([...objects.keys()].sort()).toEqual([`evidence/${fresh}`, `evidence/${attached}`].sort());
  });

  it("物件刪除失敗就留到下次", async () => {
    const stale = await uploaded();
    await env.DB.prepare("UPDATE share_evidence SET created_at = ? WHERE id = ?").bind(Date.now() - DAY - 1, stale).run();
    bucket.delete.mockRejectedValueOnce(new Error("r2 down"));
    await campaignMaintenance(fixture(), Date.now());
    expect(await count("SELECT count(*) AS n FROM share_evidence")).toBe(1);
    await campaignMaintenance(fixture(), Date.now());
    expect(await count("SELECT count(*) AS n FROM share_evidence")).toBe(0);
  });

  it("保留期到了：刪物件、填 purged_at、讀取回 410、系統稽核 purge 只寫一筆", async () => {
    const id = await uploaded(), keep = await uploaded();
    const deadline = Date.now() - 10 * DAY;
    await attach(owner, await placement(owner, deadline, 5), [id]);
    await attach(owner, await placement(owner, deadline, 5), [keep]);

    bucket.delete.mockRejectedValueOnce(new Error("r2 down"));
    await campaignMaintenance(fixture(), Date.now());
    expect(await count("SELECT count(*) AS n FROM share_evidence WHERE purged_at IS NOT NULL")).toBe(0);

    await campaignMaintenance(fixture(), Date.now());
    await campaignMaintenance(fixture(), Date.now());
    expect(await count("SELECT count(*) AS n FROM share_evidence WHERE purged_at IS NOT NULL")).toBe(2);
    expect(objects.size).toBe(0);
    for (const token of ["owner", "reviewer"]) {
      const r = await call(`/v1/campaign/evidence/${id}`, { token });
      expect([token, r.status, (await json(r)).error]).toEqual([token, 410, "evidence_purged"]);
    }
    expect((await call(`/v1/campaign/evidence/${id}`, { token: "other" })).status).toBe(404);
    const purges = (await env.DB.prepare("SELECT subject_id, actor_member_id, actor_kind, operation_id FROM audit_log WHERE action = 'purge' ORDER BY subject_id").all()).results;
    expect(purges).toEqual([id, keep].sort().map((x) => ({ subject_id: x, actor_member_id: null, actor_kind: "system", operation_id: `purge-${x}` })));
    expect(await (await call("/metrics")).text()).toContain('hearthroom_campaign_operations_total{operation="purge",outcome="success"} 2');
  });

  it("保留期還沒到、沒設發獎截止的活動都不刪", async () => {
    const id = await uploaded();
    await attach(owner, await placement(owner, Date.now(), 90), [id]);
    await campaignMaintenance(fixture(), Date.now() + 89 * DAY);
    await env.DB.prepare("UPDATE campaigns SET payout_deadline = NULL").run();
    await campaignMaintenance(fixture(), Date.now() + 1000 * DAY);
    expect(await count("SELECT count(*) AS n FROM share_evidence WHERE purged_at IS NOT NULL")).toBe(0);
    expect(objects.size).toBe(1);
  });
});

// Vite 在轉譯時展開 import.meta.glob；型別只補這一個成員，不引入整份 vite/client。
declare global {
  interface ImportMeta { glob<T>(pattern: string, options: { query: string; import: string; eager: true }): Record<string, T> }
}

describe("私有 bucket 的唯一入口", () => {
  it("src/ 裡只有 campaign-evidence.ts 讀 env.EVIDENCE", () => {
    const sources = import.meta.glob<string>("../src/**/*.ts", { query: "?raw", import: "default", eager: true });
    expect(Object.keys(sources).length).toBeGreaterThan(20);
    const readers = Object.entries(sources).filter(([, text]) => /\.EVIDENCE\b/.test(text)).map(([path]) => path);
    expect(readers).toEqual(["../src/campaign-evidence.ts"]);
  });
});
