import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { IMAGE_MAX_BYTES, imageErrorAs, storeRasterImage } from "./blog";
import { EVIDENCE_MAX_BYTES, readEvidence, uploadEvidence } from "./campaign-evidence";
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

/** 點數池：Provider 的值原樣轉出，只給真人應用管理員。這家 Provider 沒有點數池時回 configured:false。 */
campaignRoutes.get("/v1/moderation/campaign-pool", async (c) => {
  humanOnly((await staff(c)).agent);
  if (!(await communityAdmin(c))) throw new HttpError(403, "community_admin_required");
  return c.json((await upstream.fetchCampaignPool(c.env, bearerOf(c)!, providerOf(c))) ?? { configured: false });
});
