import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { IMAGE_MAX_BYTES, imageErrorAs, storeRasterImage } from "./blog";
import { myContents, resubmitPlacement, submitPlacement } from "./campaign-apply";
import { EVIDENCE_MAX_BYTES, readEvidence, uploadEvidence } from "./campaign-evidence";
import { contentDetail, decidePlacement, reviewQueue } from "./campaign-review";
import { autoPayout, BATCH_MAX, batchPayout, cancelPayout, checkPayout, listPayouts, reconcilePayouts, requestPayout, retryPayout, type Payer } from "./campaign-payout";
import { queuePush } from "./community/push";
import { campaignPhase, getCampaign, listCampaigns, saveCampaign, setCampaignStatus, type Actor, type Campaign, type CampaignInput } from "./campaign";
import { providerOf, requireMember } from "./members";
import { operationOf } from "./moderation";
import { bumpOp } from "./ops-metrics";
import { bearerOf, communityAdmin, humanOnly, staff } from "./staff";
import { upstream } from "./upstream";
import { HttpError, type Env } from "./types";

/**
 * 分享獎勵活動的路由。規則在 campaign.ts；這裡只管身分、參數與回應。
 * 管理：審核人可讀；寫入要真人且 Provider 回報是本站應用管理員。Cache-Control 由 moderationRoutes 統一設成 private, no-store。
 * 公開：只回非草稿活動的摘要與規則，public, max-age=60。
 */
export const campaignRoutes = new Hono<{ Bindings: Env }>();
type Ctx = Context<{ Bindings: Env }>;

const PUBLIC = { "Cache-Control": "public, max-age=60" };
// 五語介紹各最多 20000 字（CJK 一字 3 bytes），moderationRoutes 的 16 KB 不夠，這裡自己設。
const settingsLimit = bodyLimit({ maxSize: 512 * 1024, onError: (c) => c.json({ error: "campaign_invalid", field: "body" }, 400) });

const bodyOf = async (c: Ctx) => {
  const b = await c.req.json().catch(() => null);
  return (b && typeof b === "object" && !Array.isArray(b) ? b : {}) as Record<string, unknown>;
};

// 成功由 campaign.ts 在寫入後記；被拒與出錯在這裡依狀態碼記，一處涵蓋所有提早拋出的錯。讀取不計。
campaignRoutes.use("/v1/moderation/*", async (c, next) => {
  await next();
  if (c.res.status < 400 || c.req.method === "GET" || !c.req.path.startsWith("/v1/moderation/campaigns")) return;
  await bumpOp(c.env.DB, "campaign", "settings", c.res.status < 500 ? "denied" : "error");
});

/** 寫入閘門：審核人、不是 AI 帳號、Provider 說是本站應用管理員。稽核的 actor_kind 因此一律是 human。 */
async function editor(c: Ctx): Promise<Actor> {
  const s = await staff(c);
  humanOnly(s.agent);
  if (!(await communityAdmin(c))) throw new HttpError(403, "community_admin_required");
  return { memberId: s.member.id, kind: "human" };
}

// ---- 公開 ---------------------------------------------------------------------

/** 明列允許的欄位：門檻、保留天數、建立者、橫幅 key、版本與點數池都不在這裡。 */
const summaryView = (c: Campaign, now: number) => ({
  slug: c.slug, title: c.title, phase: campaignPhase(c, now), startsAt: c.startsAt, endsAt: c.endsAt, timezone: c.timezone, bannerUrl: c.bannerUrl,
});
const detailView = (c: Campaign, now: number) => ({
  ...summaryView(c, now), intro: c.intro, submitDeadline: c.submitDeadline, payoutDeadline: c.payoutDeadline, tiers: c.tiers, extraPlacementAmount: c.extraPlacementAmount,
});

campaignRoutes.get("/v1/campaigns", async (c) => {
  const now = Date.now();
  return c.json({ items: (await listCampaigns(c.env.DB, { includeDraft: false })).map((x) => summaryView(x, now)) }, 200, PUBLIC);
});

campaignRoutes.get("/v1/campaigns/:slug", async (c) => {
  const slug = c.req.param("slug");
  const campaign = await getCampaign(c.env.DB, slug);
  // getCampaign 也認 id；公開網址只認 slug。
  if (!campaign || campaign.slug !== slug || campaign.status === "draft") return c.json({ error: "campaign_not_found" }, 404, PUBLIC);
  return c.json(detailView(campaign, Date.now()), 200, PUBLIC);
});

// ---- 截圖（私有）--------------------------------------------------------------

// 所有回應（含錯誤）都不快取；上傳記 evidence_upload、讀取記 evidence_view，依狀態碼分成功／被拒／出錯。
campaignRoutes.use("/v1/campaign/evidence/*", async (c, next) => {
  await next();
  c.header("Cache-Control", "private, no-store");
  const s = c.res.status;
  await bumpOp(c.env.DB, "campaign", c.req.method === "POST" ? "evidence_upload" : "evidence_view", s < 400 ? "success" : s < 500 ? "denied" : "error");
});

campaignRoutes.post("/v1/campaign/evidence", bodyLimit({ maxSize: EVIDENCE_MAX_BYTES + 16384, onError: (c) => c.json({ error: "evidence_invalid" }, 400) }), async (c) => {
  const member = await requireMember(c);
  const form = await c.req.formData().catch(() => {
    throw new HttpError(400, "evidence_invalid");
  });
  return c.json(await uploadEvidence(c.env, member.id, form.get("file"), Date.now()));
});

campaignRoutes.get("/v1/campaign/evidence/:id", async (c) => {
  // 訪客跟別人一樣回 404，不回 401：不透露這張截圖存在。
  const viewer = c.req.header("Authorization") ? (await requireMember(c)).id : null;
  const obj = await readEvidence(c.env, viewer, c.req.param("id"), Date.now());
  return new Response(obj.body, {
    headers: { "Content-Type": obj.httpMetadata?.contentType ?? "application/octet-stream", "X-Content-Type-Options": "nosniff", "Content-Disposition": "inline" },
  });
});

// ---- 申請（本人）---------------------------------------------------------------

// 不在 /v1/moderation 底下，沒有那邊的 16 KB 上限，自己設；說明最多 1000 字，32 KB 綽綽有餘。
const applyLimit = bodyLimit({ maxSize: 32 * 1024, onError: (c) => c.json({ error: "share_invalid", field: "body" }, 400) });
const PRIVATE = { "Cache-Control": "private, no-store" };

// 提交、重送與審核決定依狀態碼記成功／被拒／出錯（重送原結果也算成功）。
const applyMetric = (operation: "submit" | "resubmit" | "decide") => async (c: Ctx, next: () => Promise<void>) => {
  await next();
  c.header("Cache-Control", "private, no-store");
  const s = c.res.status;
  await bumpOp(c.env.DB, "campaign", operation, s < 400 ? "success" : s < 500 ? "denied" : "error");
};

campaignRoutes.post("/v1/campaigns/:slug/placements", applyMetric("submit"), applyLimit, async (c) => {
  const member = await requireMember(c);
  const b = await bodyOf(c);
  return c.json(await submitPlacement(c.env.DB, member, c.req.param("slug"), b, operationOf(b.operationId), Date.now()));
});

campaignRoutes.put("/v1/campaign/placements/:id", applyMetric("resubmit"), applyLimit, async (c) => {
  const member = await requireMember(c);
  const b = await bodyOf(c);
  return c.json(await resubmitPlacement(c.env.DB, member, c.req.param("id"), b, operationOf(b.operationId), Date.now()));
});

campaignRoutes.get("/v1/me/campaign/contents", async (c) => {
  const member = await requireMember(c);
  return c.json({ items: await myContents(c.env.DB, member.id, { slug: c.req.query("campaign") || undefined }) }, 200, PRIVATE);
});

// ---- 管理 ---------------------------------------------------------------------

campaignRoutes.get("/v1/moderation/campaigns", async (c) => {
  const s = await staff(c);
  const items = await listCampaigns(c.env.DB, { includeDraft: true });
  return c.json({ items, canEdit: !s.agent && (await communityAdmin(c)) });
});

campaignRoutes.post("/v1/moderation/campaigns/banner", bodyLimit({ maxSize: IMAGE_MAX_BYTES + 16384, onError: (c) => c.json({ error: "campaign_image_invalid" }, 400) }), async (c) => {
  await editor(c);
  const form = await c.req.formData().catch(() => {
    throw new HttpError(400, "campaign_image_invalid");
  });
  const stored = await storeRasterImage(c.env, form.get("file"), Date.now()).catch(imageErrorAs("campaign"));
  await bumpOp(c.env.DB, "campaign", "settings", "success");
  return c.json(stored);
});

campaignRoutes.post("/v1/moderation/campaigns", settingsLimit, async (c) => {
  const actor = await editor(c);
  const { id: _, expectedVersion: __, operationId, ...input } = await bodyOf(c);
  return c.json(await saveCampaign(c.env.DB, input as CampaignInput, actor, operationOf(operationId), Date.now()));
});

campaignRoutes.put("/v1/moderation/campaigns/:id", settingsLimit, async (c) => {
  const actor = await editor(c);
  const { operationId, ...input } = await bodyOf(c);
  return c.json(await saveCampaign(c.env.DB, { ...(input as CampaignInput), id: c.req.param("id") }, actor, operationOf(operationId), Date.now()));
});

campaignRoutes.post("/v1/moderation/campaigns/:id/status", settingsLimit, async (c) => {
  const actor = await editor(c);
  const b = await bodyOf(c);
  if (b.status !== "active" && b.status !== "ended") throw new HttpError(400, "campaign_invalid", undefined, { field: "status" });
  return c.json(await setCampaignStatus(c.env.DB, c.req.param("id"), b.status, actor, operationOf(b.operationId), Date.now()));
});

// ---- 審核（審核員與 AI 帳號）----------------------------------------------------
// 請求大小受 moderationRoutes 的 16 KB 上限；actor_kind 一律由 staff() 推出。

campaignRoutes.get("/v1/moderation/campaign/placements", async (c) => {
  await staff(c);
  const page = Math.max(1, Math.floor(Number(c.req.query("page")) || 1));
  return c.json(await reviewQueue(c.env.DB, { status: c.req.query("status") || undefined, slug: c.req.query("campaign") || undefined, page }));
});

campaignRoutes.get("/v1/moderation/campaign/contents/:id", async (c) => {
  await staff(c);
  return c.json(await contentDetail(c.env.DB, c.req.param("id")));
});

campaignRoutes.post("/v1/moderation/campaign/placements/:id/decision", applyMetric("decide"), async (c) => {
  const s = await staff(c);
  const b = await bodyOf(c);
  const op = operationOf(b.operationId);
  const result = await decidePlacement(c.env.DB, c.req.param("id")!, { memberId: s.member.id, kind: s.kind }, b, op, Date.now());
  // 真人應用管理員核准就直接發；AI 帳號與一般審核員的核准停在待發放。
  const paid = b.decision === "approve" && result.placement.reviewStatus === "approved" && !s.agent && (await communityAdmin(c))
    ? await autoPayout(payerOf(c, s.member.id), result.placement.id, op) : { payout: null };
  queuePush(c);
  return c.json({ ...result, ...paid });
});

// ---- 發放（只有真人應用管理員）-----------------------------------------------------
// 請求大小受 moderationRoutes 的 16 KB 上限。令牌只交給 Provider，不落地、不進日誌。

const payerOf = (c: Ctx, memberId: string): Payer => ({ env: c.env, bearer: bearerOf(c)!, provider: providerOf(c), memberId, now: Date.now });

/** 發放閘門：審核人 → 不是 AI 帳號 → Provider 說是本站應用管理員。真正的授權仍由 Provider 判斷。 */
async function payer(c: Ctx): Promise<Payer> {
  const s = await staff(c);
  humanOnly(s.agent);
  if (!(await communityAdmin(c))) throw new HttpError(403, "community_admin_required");
  return payerOf(c, s.member.id);
}

// 送出的結果（成功／池不足／被拒／不知道）在 campaign-payout.ts 記；這裡補記提早被擋下的請求。
campaignRoutes.use("/v1/moderation/campaign/*", async (c, next) => {
  await next();
  if (c.req.method === "GET" || c.res.status < 400 || !/\/payouts?(\/|$)/.test(c.req.path)) return;
  const operation = /\/payouts\/(reconcile|[^/]+\/check)$/.test(c.req.path) ? "reconcile" : "payout";
  await bumpOp(c.env.DB, "campaign", operation, c.res.status < 500 ? "denied" : "error");
});

campaignRoutes.get("/v1/moderation/campaign/payouts", async (c) => {
  await payer(c);
  const page = Math.max(1, Math.floor(Number(c.req.query("page")) || 1));
  return c.json(await listPayouts(c.env.DB, { status: c.req.query("status") || undefined, slug: c.req.query("campaign") || undefined, page }));
});

campaignRoutes.post("/v1/moderation/campaign/contents/:id/payout", async (c) => {
  const x = await payer(c);
  const b = await bodyOf(c);
  const result = await requestPayout(x, c.req.param("id"), operationOf(b.operationId));
  queuePush(c);
  return c.json(result);
});

campaignRoutes.post("/v1/moderation/campaign/payouts/batch", async (c) => {
  const x = await payer(c);
  const b = await bodyOf(c);
  const ids = b.contentIds;
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > BATCH_MAX || ids.some((v) => typeof v !== "string" || !v) || new Set(ids).size !== ids.length) {
    throw new HttpError(400, "share_invalid", undefined, { field: "contentIds" });
  }
  const result = await batchPayout(x, ids as string[], operationOf(b.operationId));
  queuePush(c);
  return c.json(result);
});

campaignRoutes.post("/v1/moderation/campaign/payouts/reconcile", async (c) => {
  const result = await reconcilePayouts(await payer(c));
  queuePush(c);
  return c.json(result);
});

campaignRoutes.post("/v1/moderation/campaign/payouts/:id/retry", async (c) => {
  const x = await payer(c);
  const b = await bodyOf(c);
  const result = await retryPayout(x, c.req.param("id"), operationOf(b.operationId));
  queuePush(c);
  return c.json(result);
});

campaignRoutes.post("/v1/moderation/campaign/payouts/:id/cancel", async (c) => {
  const x = await payer(c);
  const b = await bodyOf(c);
  const reason = typeof b.reason === "string" ? b.reason.trim() : "";
  if (!reason || [...reason].length > 500) throw new HttpError(400, "share_invalid", undefined, { field: "reason" });
  return c.json(await cancelPayout(x, c.req.param("id"), reason, operationOf(b.operationId)));
});

campaignRoutes.post("/v1/moderation/campaign/payouts/:id/check", async (c) => {
  const result = await checkPayout(await payer(c), c.req.param("id"));
  queuePush(c);
  return c.json(result);
});

/** 點數池：Provider 的值原樣轉出，只給真人應用管理員。這家 Provider 沒有點數池時回 configured:false。 */
campaignRoutes.get("/v1/moderation/campaign-pool", async (c) => {
  humanOnly((await staff(c)).agent);
  if (!(await communityAdmin(c))) throw new HttpError(403, "community_admin_required");
  return c.json((await upstream.fetchCampaignPool(c.env, bearerOf(c)!, providerOf(c))) ?? { configured: false });
});
