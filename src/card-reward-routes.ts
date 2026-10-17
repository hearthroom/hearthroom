import { Hono, type Context } from "hono";
import { BATCH_MAX, batchReward, cancelReward, getRewardCampaign, listDue, listRewards, myProgress, reconcileRewards, requestReward, retryReward, type Payer } from "./card-reward";
import { providerOf, requireMember } from "./members";
import { operationOf } from "./moderation";
import { bumpOp } from "./ops-metrics";
import { quotaForMember, WEEKLY_LIMIT } from "./quota";
import { bearerOf, humanOnly, requireCommunityAdmin, staff } from "./staff";
import { HttpError, type Env } from "./types";

/**
 * 發卡獎勵（創作季）的路由。規則在 card-reward.ts；這裡只管身分、參數與回應。
 * 公開：活動設定（public, max-age=60）。作者：自己的進度。後台發放：真人且 Provider 回報是本站應用管理員。
 */
export const cardRewardRoutes = new Hono<{ Bindings: Env }>();
type Ctx = Context<{ Bindings: Env }>;

const PUBLIC = { "Cache-Control": "public, max-age=60" };
const PRIVATE = { "Cache-Control": "private, no-store" };

const bodyOf = async (c: Ctx) => {
  const b = await c.req.json().catch(() => null);
  return (b && typeof b === "object" && !Array.isArray(b) ? b : {}) as Record<string, unknown>;
};
const pageOf = (c: Ctx) => Math.max(1, Math.floor(Number(c.req.query("page")) || 1));

export const payerOf = (c: Ctx, memberId: string): Payer => ({ env: c.env, bearer: bearerOf(c), provider: providerOf(c), memberId, now: Date.now });

/** 發放閘門：審核人 → 不是 AI 帳號 → Provider 說是本站應用管理員。真正的授權仍由 Provider 判斷。 */
async function payer(c: Ctx): Promise<Payer> {
  const s = await staff(c);
  humanOnly(s.agent);
  await requireCommunityAdmin(c);
  return payerOf(c, s.member.id);
}

const publicView = (k: NonNullable<Awaited<ReturnType<typeof getRewardCampaign>>>) => ({
  kind: "card_reward", slug: k.slug, title: k.title, startsAt: k.startsAt, endsAt: k.endsAt, payoutDeadline: k.payoutDeadline,
  reward: k.reward, weeklyLimit: k.weeklyLimit, normalWeeklyLimit: WEEKLY_LIMIT,
});

async function activeCampaign(c: Ctx) {
  const k = await getRewardCampaign(c.env.DB, c.req.param("slug")!);
  if (!k || k.status !== "active") throw new HttpError(404, "campaign_not_found");
  return k;
}

cardRewardRoutes.get("/v1/card-rewards/:slug", async (c) => c.json(publicView(await activeCampaign(c)), 200, PUBLIC));

cardRewardRoutes.get("/v1/card-rewards/:slug/me", async (c) => {
  const k = await activeCampaign(c);
  const member = await requireMember(c);
  const quota = await quotaForMember(c.env.DB, member.id, Date.now());
  return c.json({ quota, ...(await myProgress(c.env.DB, member.id, k)) }, 200, PRIVATE);
});

// ---- 發放（只有真人應用管理員）-----------------------------------------------------

// 送出的結果在 card-reward.ts 記；這裡補記提早被擋下的請求。
cardRewardRoutes.use("/v1/moderation/card-rewards/*", async (c, next) => {
  await next();
  c.header("Cache-Control", "private, no-store");
  if (c.req.method === "GET" || c.res.status < 400) return;
  await bumpOp(c.env.DB, "card_reward", /\/reconcile$/.test(c.req.path) ? "reconcile" : "payout", c.res.status < 500 ? "denied" : "error");
});

cardRewardRoutes.get("/v1/moderation/card-rewards/due", async (c) => {
  await payer(c);
  return c.json(await listDue(c.env.DB, pageOf(c), Date.now()));
});

cardRewardRoutes.get("/v1/moderation/card-rewards/list", async (c) => {
  await payer(c);
  return c.json(await listRewards(c.env.DB, { status: c.req.query("status") || undefined, page: pageOf(c) }));
});

const cardIdOf = (v: unknown) => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isSafeInteger(n) || n <= 0) throw new HttpError(400, "card_reward_invalid", undefined, { field: "cardId" });
  return n;
};

cardRewardRoutes.post("/v1/moderation/card-rewards/cards/:cardId/pay", async (c) => {
  const x = await payer(c);
  const b = await bodyOf(c);
  return c.json(await requestReward(x, cardIdOf(c.req.param("cardId")), operationOf(b.operationId)));
});

cardRewardRoutes.post("/v1/moderation/card-rewards/batch", async (c) => {
  const x = await payer(c);
  const b = await bodyOf(c);
  const ids = b.cardIds;
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > BATCH_MAX || new Set(ids).size !== ids.length) throw new HttpError(400, "card_reward_invalid", undefined, { field: "cardIds" });
  return c.json(await batchReward(x, ids.map(cardIdOf), operationOf(b.operationId)));
});

cardRewardRoutes.post("/v1/moderation/card-rewards/reconcile", async (c) => c.json(await reconcileRewards(await payer(c))));

cardRewardRoutes.post("/v1/moderation/card-rewards/:id/retry", async (c) => {
  const x = await payer(c);
  const b = await bodyOf(c);
  return c.json(await retryReward(x, c.req.param("id"), operationOf(b.operationId)));
});

cardRewardRoutes.post("/v1/moderation/card-rewards/:id/cancel", async (c) => {
  const x = await payer(c);
  const b = await bodyOf(c);
  const reason = typeof b.reason === "string" ? b.reason.trim() : "";
  if (!reason || [...reason].length > 500) throw new HttpError(400, "card_reward_invalid", undefined, { field: "reason" });
  return c.json(await cancelReward(x, c.req.param("id"), reason, operationOf(b.operationId)));
});
