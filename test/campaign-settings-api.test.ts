import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import { cleanAvatars } from "../src/community-profile";
import { upstream } from "../src/upstream";
import type { Env } from "../src/types";
import { appAdmins, bearer, identities, makeAgent, makeMember, makeReviewer, resetDb, restoreUpstream } from "./helpers";

// 活動設定 API：審核人可讀、應用管理員可寫、AI 帳號不能寫；公開 API 只給摘要與規則；點數池唯讀轉出 Provider 的值。
const ADMIN = 70001, MOD = 70002, AGENT = 70003, MEMBER = 70004;

const objects = new Map<string, ArrayBuffer>();
const bucket = {
  put: vi.fn(async (k: string, v: ArrayBuffer) => { objects.set(k, v); }),
  delete: vi.fn(async (k: string) => { objects.delete(k); }),
  get: vi.fn(async (k: string) => (objects.has(k) ? { body: objects.get(k) } : null)),
};
const images = {
  info: vi.fn(async (_s: ReadableStream<Uint8Array>) => ({ format: "image/png", width: 3000, height: 2000, fileSize: 8 })),
  input: vi.fn(() => ({ transform: () => ({ output: async () => ({ response: () => new Response("converted-webp") }) }) })),
};
const fixture = (over: Record<string, unknown> = {}) => ({ ...env, AVATARS: bucket, IMAGES: images, ...over }) as unknown as Env;

async function call(path: string, init: { method?: string; token?: string; body?: unknown; form?: FormData } = {}, over: Record<string, unknown> = {}) {
  const headers: Record<string, string> = init.token ? bearer(init.token) : {};
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request("https://c.test" + path, {
    method: init.method ?? "GET", headers, body: init.form ?? (init.body === undefined ? undefined : JSON.stringify(init.body)),
  }), fixture(over), ctx);
  await waitOnExecutionContext(ctx);
  return res;
}
const json = async (r: Response) => (await r.json()) as any;
const op = () => crypto.randomUUID();
const count = async (sql: string, ...b: unknown[]) => (await env.DB.prepare(sql).bind(...b).first<{ n: number }>())!.n;

const DAY = 86_400_000;
const T0 = Date.now() - DAY;
const complete = (over: Record<string, unknown> = {}) => ({
  slug: "launch", title: { "zh-Hant": "開站分享" }, intro: { "zh-Hant": "分享就有點數" },
  startsAt: T0, endsAt: T0 + 10 * DAY, timezone: "Asia/Taipei", submitDeadline: T0 + 12 * DAY, payoutDeadline: T0 + 20 * DAY,
  tiers: { light: 500, original: 3000, guide: 5000, video: 10000 }, extraPlacementAmount: 500, flagBurstThreshold: 7, evidenceRetentionDays: 45,
  ...over,
});
const create = (token: string, body: Record<string, unknown> = complete()) => call("/v1/moderation/campaigns", { method: "POST", token, body: { ...body, operationId: op() } });
const save = (token: string, id: string, body: Record<string, unknown>) => call(`/v1/moderation/campaigns/${id}`, { method: "PUT", token, body: { ...body, operationId: op() } });
const status = (token: string, id: string, s: string) => call(`/v1/moderation/campaigns/${id}/status`, { method: "POST", token, body: { status: s, operationId: op() } });

beforeEach(async () => {
  await resetDb();
  objects.clear();
  vi.clearAllMocks();
  identities({ admin: ADMIN, mod: MOD, agent: AGENT, member: MEMBER });
  appAdmins("admin", "agent");
  await makeReviewer(ADMIN);
  await makeReviewer(MOD);
  await makeAgent(AGENT);
  await makeMember(MEMBER);
});
afterEach(() => {
  restoreUpstream();
  vi.unstubAllGlobals();
});

describe("權限", () => {
  it("非審核人一律 403；AI 帳號寫入 403 agent_not_allowed；不是應用管理員的審核人只讀", async () => {
    const writes: [string, string][] = [
      ["POST", "/v1/moderation/campaigns"], ["PUT", "/v1/moderation/campaigns/x"], ["POST", "/v1/moderation/campaigns/x/status"], ["POST", "/v1/moderation/campaigns/banner"],
    ];
    for (const [method, path] of [...writes, ["GET", "/v1/moderation/campaigns"], ["GET", "/v1/moderation/campaign-pool"]] as [string, string][]) {
      const r = await call(path, { method, token: "member", body: method === "GET" ? undefined : { operationId: op() } });
      expect([path, r.status]).toEqual([path, 403]);
      expect(r.headers.get("Cache-Control")).toBe("private, no-store");
    }
    for (const [method, path] of writes) {
      const agent = await call(path, { method, token: "agent", body: { operationId: op() } });
      expect([path, agent.status, (await json(agent)).error]).toEqual([path, 403, "agent_not_allowed"]);
      const mod = await call(path, { method, token: "mod", body: { operationId: op() } });
      expect([path, mod.status, (await json(mod)).error]).toEqual([path, 403, "community_admin_required"]);
    }
    const read = await call("/v1/moderation/campaigns", { token: "mod" });
    expect(read.status).toBe(200);
    expect(await json(read)).toEqual({ items: [], canEdit: false });
    expect((await json(await call("/v1/moderation/campaigns", { token: "admin" }))).canEdit).toBe(true);
    expect((await json(await call("/v1/moderation/campaigns", { token: "agent" }))).canEdit).toBe(false);
    expect(await count("SELECT COUNT(*) AS n FROM campaigns")).toBe(0);
    const metrics = await (await call("/metrics")).text();
    expect(metrics).toContain('hearthroom_campaign_operations_total{operation="settings",outcome="denied"}');
  });

  it("問不到供應商：寫入 503 community_admin_unavailable、不寫入；列表照常讀，canEdit 是 false", async () => {
    upstream.fetchCommunityStatus = async () => { throw new Error("offline"); };
    const r = await create("admin", { slug: "launch", title: { "zh-Hant": "開站分享" } });
    expect([r.status, (await json(r)).error]).toEqual([503, "community_admin_unavailable"]);
    expect(await count("SELECT COUNT(*) AS n FROM campaigns")).toBe(0);
    expect(await json(await call("/v1/moderation/campaigns", { token: "admin" }))).toEqual({ items: [], canEdit: false });
  });
});

describe("建立、修改、啟用、結束", () => {
  it("管理員走完整生命週期；版本衝突 409；設定不完整不能啟用；每次寫入一筆稽核", async () => {
    const draft = await create("admin", { slug: "launch", title: { "zh-Hant": "開站分享" } });
    expect(draft.status).toBe(200);
    const c = await json(draft);
    expect(c).toMatchObject({ slug: "launch", status: "draft", version: 1 });

    const bad = await status("admin", c.id, "active");
    expect(bad.status).toBe(400);
    expect(await json(bad)).toMatchObject({ error: "campaign_invalid", field: "startsAt" });

    const saved = await save("admin", c.id, { ...complete(), expectedVersion: 1 });
    expect(saved.status).toBe(200);
    expect((await json(saved)).version).toBe(2);
    const stale = await save("admin", c.id, { ...complete({ title: { "zh-Hant": "舊版" } }), expectedVersion: 1 });
    expect(stale.status).toBe(409);
    expect(await json(stale)).toMatchObject({ error: "campaign_version_conflict", version: 2 });

    expect((await status("admin", c.id, "bogus")).status).toBe(400);
    const active = await status("admin", c.id, "active");
    expect(active.status).toBe(200);
    expect(await json(active)).toMatchObject({ status: "active", version: 3 });
    const ended = await status("admin", c.id, "ended");
    expect(await json(ended)).toMatchObject({ status: "ended", version: 4 });

    const actions = await env.DB.prepare("SELECT action, actor_kind FROM audit_log WHERE subject_kind = 'campaign' AND subject_id = ? ORDER BY created_at, rowid").bind(c.id).all();
    expect(actions.results).toEqual([
      { action: "create", actor_kind: "human" }, { action: "update", actor_kind: "human" }, { action: "activate", actor_kind: "human" }, { action: "end", actor_kind: "human" },
    ]);
    const list = await json(await call("/v1/moderation/campaigns", { token: "mod" }));
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({ id: c.id, status: "ended", flagBurstThreshold: 7, evidenceRetentionDays: 45 });
    const metrics = await (await call("/metrics")).text();
    expect(metrics).toContain('hearthroom_campaign_operations_total{operation="settings",outcome="success"} 4');
  });

  it("壞的 operationId 400；同一個操作編號重送只寫一次", async () => {
    expect((await call("/v1/moderation/campaigns", { method: "POST", token: "admin", body: { ...complete(), operationId: "bad" } })).status).toBe(400);
    const id = op();
    const a = await json(await call("/v1/moderation/campaigns", { method: "POST", token: "admin", body: { ...complete(), operationId: id } }));
    const b = await json(await call("/v1/moderation/campaigns", { method: "POST", token: "admin", body: { ...complete(), operationId: id } }));
    expect(b.id).toBe(a.id);
    expect(await count("SELECT COUNT(*) AS n FROM campaigns")).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM audit_log WHERE subject_kind = 'campaign'")).toBe(1);
  });

  it("五語長介紹超過審核路由的 16 KB 也存得進去", async () => {
    const long = "分".repeat(20000);
    const r = await create("admin", complete({ slug: "long", intro: { "zh-Hant": long, "zh-Hans": long, ja: long } }));
    expect(r.status).toBe(200);
    expect((await json(r)).intro.ja).toHaveLength(20000);
  });

  it("設定本體超過上限 400 campaign_invalid（field: body），算 denied；設定以外的活動審核路由仍受 16 KB 上限", async () => {
    const huge = { ...complete(), intro: { "zh-Hant": "x".repeat(600 * 1024) }, operationId: op() };
    const r = await call("/v1/moderation/campaigns", { method: "POST", token: "admin", body: huge });
    expect(r.status).toBe(400);
    expect(await json(r)).toEqual({ error: "campaign_invalid", field: "body" });
    const metrics = await (await call("/metrics")).text();
    expect(metrics).toContain('hearthroom_campaign_operations_total{operation="settings",outcome="denied"} 1');
    expect(metrics).not.toContain('outcome="error"');
    const capped = await call("/v1/moderation/campaign/payouts", { method: "POST", token: "admin", body: { pad: "x".repeat(17000) } });
    // 審核路由的 16 KB 上限拋的是 Hono 的 HTTPException(413)，app.onError 不認得，現況會變成 500；沒被上限擋到的話這條路是 404。
    expect(capped.status).toBe(500);
    expect(await json(capped)).toEqual({ error: "internal error" });
  });
});

describe("公開資訊", () => {
  it("看不到草稿；不帶門檻、保留天數、建立者、橫幅 key、版本；快取 60 秒", async () => {
    await create("admin", complete({ slug: "hidden" }));
    const live = await json(await create("admin", complete()));
    await status("admin", live.id, "active");

    const list = await call("/v1/campaigns");
    expect(list.status).toBe(200);
    expect(list.headers.get("Cache-Control")).toBe("public, max-age=60");
    const items = (await json(list)).items;
    expect(items).toEqual([{ slug: "launch", title: { "zh-Hant": "開站分享" }, phase: "open", startsAt: T0, endsAt: T0 + 10 * DAY, timezone: "Asia/Taipei", bannerUrl: null }]);

    const one = await call("/v1/campaigns/launch");
    expect(one.status).toBe(200);
    expect(one.headers.get("Cache-Control")).toBe("public, max-age=60");
    const detail = await json(one);
    expect(detail).toEqual({
      slug: "launch", title: { "zh-Hant": "開站分享" }, phase: "open", startsAt: T0, endsAt: T0 + 10 * DAY, timezone: "Asia/Taipei", bannerUrl: null,
      intro: { "zh-Hant": "分享就有點數" }, submitDeadline: T0 + 12 * DAY, payoutDeadline: T0 + 20 * DAY,
      tiers: { light: 500, original: 3000, guide: 5000, video: 10000 }, extraPlacementAmount: 500,
    });
    for (const leaked of ["id", "flagBurstThreshold", "evidenceRetentionDays", "createdBy", "bannerKey", "version", "status", "balance"]) expect(Object.keys(detail)).not.toContain(leaked);

    for (const path of ["/v1/campaigns/hidden", "/v1/campaigns/nope", `/v1/campaigns/${live.id}`]) {
      const r = await call(path);
      expect([path, r.status, (await json(r)).error]).toEqual([path, 404, "campaign_not_found"]);
    }
  });
});

describe("點數池", () => {
  it("只給應用管理員；Provider 的值原樣轉出；Provider 沒有這條路時回 configured:false", async () => {
    const pool = { balance: 120000, paidTotal: 3000, enabled: true, usageScope: "agent_only" as const, validityDays: 30, maxPayout: 20000, configured: true, updatedAt: "2026-10-15T00:00:00Z" };
    let seen = "";
    upstream.fetchCampaignPool = async (_env, token) => { seen = token; return pool; };
    expect((await call("/v1/moderation/campaign-pool", { token: "mod" })).status).toBe(403);
    expect((await call("/v1/moderation/campaign-pool", { token: "agent" })).status).toBe(403);
    const r = await call("/v1/moderation/campaign-pool", { token: "admin" });
    expect(r.status).toBe(200);
    expect(r.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await json(r)).toEqual(pool);
    expect(seen).toBe("admin");
    upstream.fetchCampaignPool = async () => null;
    expect(await json(await call("/v1/moderation/campaign-pool", { token: "admin" }))).toEqual({ configured: false });
  });

  describe("fetchCampaignPool 的 HTTP 形狀", () => {
    const stub = (res: () => Response | Promise<Response>) => {
      const calls: { url: string; init?: RequestInit }[] = [];
      vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => { calls.push({ url: String(url), init }); return res(); });
      return calls;
    };

    it("帶操作者令牌打 /open/v1/campaign-pool，有逾時；未設定的值轉成 null", async () => {
      const calls = stub(() => Response.json({ balance: 0, paidTotal: 0, enabled: false, usageScope: "", validityDays: null, maxPayout: 0, configured: false, updatedAt: null }));
      expect(await upstream.fetchCampaignPool(env, "tok-1", "harbor")).toEqual({ balance: 0, paidTotal: 0, enabled: false, usageScope: null, validityDays: null, maxPayout: null, configured: false, updatedAt: null });
      expect(calls[0]!.url).toBe(`${env.PROVIDER_API_BASE_HARBOR}/open/v1/campaign-pool`);
      const headers = calls[0]!.init!.headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer tok-1");
      expect(headers["User-Agent"]).toContain("Personae");
      expect(calls[0]!.init!.signal).toBeInstanceOf(AbortSignal);
    });

    it("401/403 → 403 community_admin_required；404 → null；500、壞本體與逾時 → 502 campaign_pool_unavailable", async () => {
      for (const s of [401, 403]) {
        stub(() => Response.json({ error: "forbidden" }, { status: s }));
        await expect(upstream.fetchCampaignPool(env, "t", "harbor")).rejects.toMatchObject({ status: 403, message: "community_admin_required" });
      }
      stub(() => new Response("{}", { status: 404 }));
      expect(await upstream.fetchCampaignPool(env, "t", "harbor")).toBeNull();
      stub(() => Response.json({ error: "temporarily_unavailable" }, { status: 500 }));
      await expect(upstream.fetchCampaignPool(env, "t", "harbor")).rejects.toMatchObject({ status: 502, message: "campaign_pool_unavailable" });
      stub(() => new Response("not json", { status: 200 }));
      await expect(upstream.fetchCampaignPool(env, "t", "harbor")).rejects.toMatchObject({ status: 502, message: "campaign_pool_unavailable" });
      stub(() => { throw new DOMException("The operation timed out.", "TimeoutError"); });
      await expect(upstream.fetchCampaignPool(env, "t", "harbor")).rejects.toMatchObject({ status: 502, message: "campaign_pool_unavailable" });
    });
  });
});

describe("橫幅", () => {
  const upload = (token: string, file: File, over: Record<string, unknown> = {}) => { const f = new FormData(); f.set("file", file); return call("/v1/moderation/campaigns/banner", { method: "POST", token, form: f }, over); };
  const png = () => new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], "a.png", { type: "image/png" });

  it("非圖片 400 campaign_image_invalid；沒有圖片服務 503 campaign_image_unavailable", async () => {
    const bad = await upload("admin", new File(["<svg/>"], "a.svg", { type: "image/svg+xml" }));
    expect([bad.status, (await json(bad)).error]).toEqual([400, "campaign_image_invalid"]);
    const down = await upload("admin", png(), { IMAGES: undefined });
    expect([down.status, (await json(down)).error]).toEqual([503, "campaign_image_unavailable"]);
  });

  it("活動引用的橫幅不會被清掉，也一直讀得到；沒引用的照常清", async () => {
    const used = await json(await upload("admin", png()));
    const orphan = await json(await upload("admin", png()));
    expect(used.key).toMatch(/^blog\/[-a-f0-9]{36}\.webp$/);
    const c = await json(await create("admin", complete({ bannerKey: used.key })));
    expect(c.bannerUrl).toBe(used.url);
    await env.DB.prepare("UPDATE avatar_cleanup SET delete_after = 0").run();
    await cleanAvatars(fixture());
    expect(objects.has(used.key)).toBe(true);
    expect(objects.has(orphan.key)).toBe(false);
    expect((await call(used.url)).status).toBe(200);
  });
});
