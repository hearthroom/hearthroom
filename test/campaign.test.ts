import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { type Campaign, type PlacementForPay, campaignPhase, canActivate, getCampaign, listCampaigns, locationKey, payoutAmount, saveCampaign, setCampaignStatus } from "../src/campaign";
import { bumpOp, opsMetrics } from "../src/ops-metrics";
import { makeReviewer, resetDb } from "./helpers";

const op = () => crypto.randomUUID();
// 金額只在測試裡出現；程式裡全部讀活動設定
const money = { tiers: { light: 500, original: 3000, guide: 5000, video: 10000 }, extraPlacementAmount: 500 };
const placed = (tier: PlacementForPay["approvedTier"], over: Partial<PlacementForPay> = {}): PlacementForPay => ({ reviewStatus: "approved", approvedTier: tier, countsAsPlacement: true, ...over });

describe("發放金額", () => {
  it("輕量 10 群：一檔加 9 處追加", () => {
    expect(payoutAmount(Array.from({ length: 10 }, () => placed("light")), money, 0)).toEqual({ tier: "light", target: 5000, due: 5000 });
  });
  it("影片＋9 處：取最高檔，其他位置算追加", () => {
    const ps = [placed("video"), ...Array.from({ length: 9 }, () => placed("light"))];
    expect(payoutAmount(ps, money, 0)).toEqual({ tier: "video", target: 14500, due: 14500 });
  });
  it("原創已發 3000，一處升為攻略：只補差額", () => {
    expect(payoutAmount([placed("guide")], money, 3000)).toEqual({ tier: "guide", target: 5000, due: 2000 });
  });
  it("不算位置的核准不加追加；全部未核准是零；已發超過目標不出現負數", () => {
    expect(payoutAmount([placed("light"), placed("light", { countsAsPlacement: false })], money, 0).target).toBe(500);
    expect(payoutAmount([placed(null, { reviewStatus: "submitted" }), placed(null, { reviewStatus: "rejected" })], money, 0)).toEqual({ tier: null, target: 0, due: 0 });
    expect(payoutAmount([placed("light")], money, 3000)).toEqual({ tier: "light", target: 500, due: 0 });
  });
});

describe("位置正規化", () => {
  it("追蹤參數、大小寫、結尾斜線、片段不影響網址的 key", () => {
    const base = locationKey("forum", "x", "https://example.com/t/123?page=2");
    for (const u of [
      "https://example.com/t/123?page=2&utm_source=qq",
      "https://example.com/t/123?fbclid=abc&page=2",
      "https://example.com/t/123?page=2&spm=a.b.c",
      "https://EXAMPLE.com/t/123?page=2",
      "https://www.example.com/t/123/?page=2",
      "https://example.com/t/123?page=2#reply-9",
    ]) expect(locationKey("forum", "x", u)).toBe(base);
    expect(locationKey("tieba", "y", "https://example.com/t/123?page=2")).toBe(base);
  });
  it("沒有網址時看平台加位置名", () => {
    expect(locationKey("qq_group", " Luna 同好群 ", null)).toBe(locationKey("qq_group", "luna  同好群", null));
    expect(locationKey("qq_group", "Ｌｕｎａ 同好群", null)).toBe(locationKey("qq_group", "luna 同好群", null));
    expect(locationKey("tieba", "luna 同好群", null)).not.toBe(locationKey("qq_group", "luna 同好群", null));
    expect(locationKey("forum", "某論壇", "不是網址")).toBe(locationKey("forum", "某論壇", null));
  });
});

const ready: Campaign = {
  id: "c1", slug: "launch", title: { "zh-Hant": "開業分享" }, intro: {}, bannerKey: null, bannerUrl: null,
  startsAt: 100, endsAt: 200, timezone: "Asia/Taipei", submitDeadline: 300, payoutDeadline: 400,
  ...money, flagBurstThreshold: null, evidenceRetentionDays: 90, status: "draft", version: 1, createdAt: 1, updatedAt: 1,
};

describe("啟用條件", () => {
  it("每個缺漏回對應欄位；全部合法才能啟用", () => {
    expect(canActivate(ready)).toEqual({ ok: true });
    const cases: [Partial<Campaign>, string][] = [
      [{ startsAt: null }, "startsAt"],
      [{ endsAt: null }, "endsAt"],
      [{ timezone: null }, "timezone"],
      [{ timezone: "Mars/Olympus" }, "timezone"],
      [{ startsAt: 200 }, "endsAt"],
      [{ submitDeadline: 150 }, "submitDeadline"],
      [{ payoutDeadline: 250 }, "payoutDeadline"],
      [{ tiers: { light: 500, original: 3000, guide: 5000 } }, "tiers.video"],
      [{ tiers: { ...money.tiers, original: 1.5 } }, "tiers.original"],
      [{ tiers: { ...money.tiers, light: 0 } }, "tiers.light"],
      [{ extraPlacementAmount: null }, "extraPlacementAmount"],
    ];
    for (const [over, field] of cases) expect(canActivate({ ...ready, ...over })).toEqual({ ok: false, field });
  });
});

describe("活動階段", () => {
  it("草稿、未開始、進行中、已過結束時間、已結束", () => {
    expect(campaignPhase(ready, 150)).toBe("draft");
    const active = { ...ready, status: "active" as const };
    expect(campaignPhase(active, 99)).toBe("upcoming");
    expect(campaignPhase(active, 100)).toBe("open");
    expect(campaignPhase(active, 200)).toBe("ended");
    expect(campaignPhase({ ...active, status: "ended" }, 150)).toBe("ended");
  });
});

describe("活動設定", () => {
  let admin = "";
  const actor = () => ({ memberId: admin, kind: "human" as const });
  const input = { slug: "launch", title: { "zh-Hant": "開業分享" }, intro: { "zh-Hant": "分享就有點數" }, bannerKey: "blog/abc.webp", startsAt: 100, endsAt: 200, timezone: "Asia/Taipei", submitDeadline: 300, payoutDeadline: 400, ...money };
  const audits = (id: string) => env.DB.prepare("SELECT action, before_json, after_json FROM audit_log WHERE subject_kind='campaign' AND subject_id=? ORDER BY created_at").bind(id).all<{ action: string; before_json: string; after_json: string }>().then((r) => r.results);
  beforeEach(async () => {
    await resetDb();
    admin = await makeReviewer(60001);
  });

  it("建立與修改各留一筆稽核，含改前改後", async () => {
    const c = await saveCampaign(env.DB, input, actor(), op(), 10);
    expect(c).toMatchObject({ slug: "launch", status: "draft", version: 1, bannerUrl: "/v1/blog/images/abc.webp", evidenceRetentionDays: 90, tiers: money.tiers });
    const v2 = await saveCampaign(env.DB, { ...input, id: c.id, expectedVersion: 1, title: { "zh-Hant": "改名" } }, actor(), op(), 20);
    expect(v2.version).toBe(2);
    const log = await audits(c.id);
    expect(log.map((a) => a.action)).toEqual(["create", "update"]);
    expect(JSON.parse(log[1]!.before_json).title).toEqual({ "zh-Hant": "開業分享" });
    expect(JSON.parse(log[1]!.after_json).title).toEqual({ "zh-Hant": "改名" });
    expect((await getCampaign(env.DB, "launch"))?.id).toBe(c.id);
    expect((await getCampaign(env.DB, c.id))?.slug).toBe("launch");
    await expect(saveCampaign(env.DB, input, actor(), op(), 30)).rejects.toMatchObject({ status: 409, message: "campaign_slug_taken" });
    expect(await opsMetrics(env.DB)).toContain('hearthroom_campaign_operations_total{operation="settings",outcome="success"} 2');
  });

  it("池不足（insufficient）只在活動指標合法", async () => {
    await bumpOp(env.DB, "campaign", "payout", "insufficient");
    // @ts-expect-error 部落格指標沒有 insufficient
    await bumpOp(env.DB, "blog", "save", "insufficient");
    const text = await opsMetrics(env.DB);
    expect(text).toContain('hearthroom_campaign_operations_total{operation="payout",outcome="insufficient"} 1');
    expect(text).not.toMatch(/hearthroom_blog_operations_total\{[^}]*insufficient/);
  });

  it("版本衝突回 409 帶目前版本；同一個操作編號重試回現況、不新增稽核", async () => {
    const c = await saveCampaign(env.DB, input, actor(), op(), 10);
    await saveCampaign(env.DB, { ...input, id: c.id, expectedVersion: 1, intro: {} }, actor(), op(), 20);
    await expect(saveCampaign(env.DB, { ...input, id: c.id, expectedVersion: 1 }, actor(), op(), 30)).rejects.toMatchObject({ status: 409, message: "campaign_version_conflict", extra: { version: 2 } });
    const id = op();
    const v3 = await saveCampaign(env.DB, { ...input, id: c.id, expectedVersion: 2, slug: "launch-2" }, actor(), id, 40);
    const again = await saveCampaign(env.DB, { ...input, id: c.id, expectedVersion: 2, slug: "launch-2" }, actor(), id, 50);
    expect(again).toEqual(v3);
    expect(await audits(c.id)).toHaveLength(3);
  });

  it("儲存時檢查欄位：時區、檔位鍵與金額", async () => {
    await expect(saveCampaign(env.DB, { ...input, timezone: "Nowhere/City" }, actor(), op(), 10)).rejects.toMatchObject({ status: 400, message: "campaign_invalid", extra: { field: "timezone" } });
    await expect(saveCampaign(env.DB, { ...input, tiers: { light: 500, gold: 1 } as never }, actor(), op(), 10)).rejects.toMatchObject({ status: 400, extra: { field: "tiers" } });
    await expect(saveCampaign(env.DB, { ...input, tiers: { light: -1 } }, actor(), op(), 10)).rejects.toMatchObject({ status: 400, extra: { field: "tiers" } });
    await expect(saveCampaign(env.DB, { ...input, title: { en: "no zh" } }, actor(), op(), 10)).rejects.toMatchObject({ status: 400, extra: { field: "title" } });
    const partial = await saveCampaign(env.DB, { slug: "draft-only", title: { "zh-Hant": "草稿" }, tiers: { light: 1 } }, actor(), op(), 10);
    expect(partial).toMatchObject({ startsAt: null, timezone: null, tiers: { light: 1 }, extraPlacementAmount: null });
  });

  it("草稿 → 進行中 → 已結束；結束後不能再啟用；設定不全不能啟用", async () => {
    const half = await saveCampaign(env.DB, { slug: "half", title: { "zh-Hant": "半成品" } }, actor(), op(), 5);
    await expect(setCampaignStatus(env.DB, half.id, "active", actor(), op(), 6)).rejects.toMatchObject({ status: 400, message: "campaign_invalid", extra: { field: "startsAt" } });
    const c = await saveCampaign(env.DB, input, actor(), op(), 10);
    const on = await setCampaignStatus(env.DB, c.id, "active", actor(), op(), 20);
    expect(on).toMatchObject({ status: "active", version: 2 });
    const off = await setCampaignStatus(env.DB, c.id, "ended", actor(), op(), 30);
    expect(off).toMatchObject({ status: "ended", version: 3 });
    await expect(setCampaignStatus(env.DB, c.id, "active", actor(), op(), 40)).rejects.toMatchObject({ status: 409, message: "campaign_ended" });
    expect((await audits(c.id)).map((a) => a.action)).toEqual(["create", "activate", "end"]);
    expect((await listCampaigns(env.DB, { includeDraft: false })).map((x) => x.slug)).toEqual(["launch"]);
    expect(await listCampaigns(env.DB, { includeDraft: true })).toHaveLength(2);
  });
});
