import { Hono, type Context } from "hono";
import { isReviewAgent, memberByHandle, providerOf, requireReviewer } from "./members";
import { readSettings, writeSettings, type CommunitySettings } from "./community-settings";
import { addKeyword, clearMute, conflictOnDuplicate, decide, listKeywords, moderationQueue, moderationStats, removeKeyword, setMute, type Decision } from "./comment-moderation";
import { operationOf } from "./moderation";
import { bumpOp } from "./ops-metrics";
import { upstream } from "./upstream";
import { HttpError, type Env } from "./types";

/**
 * 審核人（含 AI 審核帳號）處理留言。處理邏輯在 comment-moderation.ts；這裡只管身分、參數與回應。
 * 請求大小上限與 Cache-Control 由同前綴的 moderationRoutes 中介層統一處理。
 */
export const commentModerationRoutes = new Hono<{ Bindings: Env }>();
type Ctx = Context<{ Bindings: Env }>;

const DECISIONS: readonly string[] = ["release", "remove", "dismiss", "flag"];

/** 這個請求算哪一種操作（對應 hearthroom_comment_moderation_total 的 action）；讀取不計。 */
async function operationFor(c: Ctx): Promise<string | null> {
  const path = c.req.path;
  if (path.endsWith("/decision")) {
    const action = ((await c.req.json().catch(() => ({}))) as { action?: unknown }).action;
    return typeof action === "string" && DECISIONS.includes(action) ? action : null;
  }
  if (path.endsWith("/comment-mute")) return c.req.method === "PUT" ? "mute" : "unmute";
  if (path.startsWith("/v1/moderation/comment-keywords") && c.req.method !== "GET") return "keyword";
  if (path === "/v1/moderation/settings" && c.req.method === "PUT") return "settings";
  return null;
}

// 成功由各處理函式在寫入後記；被拒與出錯在這裡依狀態碼記，一個地方就涵蓋所有提早拋出的錯。
commentModerationRoutes.use("/v1/moderation/*", async (c, next) => {
  await next();
  if (c.res.status < 400) return;
  const op = await operationFor(c);
  if (op) await bumpOp(c.env.DB, "comment_moderation", op, c.res.status < 500 ? "denied" : "error");
});

async function staff(c: Ctx) {
  const member = await requireReviewer(c, { allowAgent: true });
  const agent = await isReviewAgent(c.env.DB, member.id);
  return { member, agent, kind: agent ? ("ai" as const) : ("human" as const) };
}
function humanOnly(agent: boolean) {
  if (agent) throw new HttpError(403, "agent_not_allowed");
}
const bodyOf = async (c: Ctx) => (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
const reasonOf = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, 2000) : "");
function requiredReason(v: unknown): string {
  const reason = reasonOf(v);
  if (!reason) throw new HttpError(400, "moderation_reason_required");
  return reason;
}
async function targetOf(c: Ctx): Promise<string> {
  const id = await memberByHandle(c.env.DB, c.req.param("handle")!.replace(/^@/, ""));
  if (!id) throw new HttpError(404, "community_member_missing");
  return id;
}

commentModerationRoutes.get("/v1/moderation/comments", async (c) => {
  const s = await staff(c);
  const tab = c.req.query("tab");
  if (tab !== "held" && tab !== "reported" && tab !== "removed") throw new HttpError(400, "invalid_arguments");
  return c.json(await moderationQueue(c.env.DB, s.member.id, tab, Math.max(1, Math.floor(Number(c.req.query("page")) || 1))));
});

commentModerationRoutes.get("/v1/moderation/comments/stats", async (c) => {
  await staff(c);
  return c.json(await moderationStats(c.env.DB, Date.now()));
});

commentModerationRoutes.post("/v1/moderation/comments/:id/decision", async (c) => {
  const s = await staff(c);
  const b = await bodyOf(c);
  const action = b.action as Decision;
  if (!DECISIONS.includes(action)) throw new HttpError(400, "invalid_arguments");
  if (s.agent && action !== "release" && action !== "flag") throw new HttpError(403, "agent_not_allowed");
  if (!s.agent && action === "flag") throw new HttpError(400, "invalid_arguments");
  const reason = action === "release" ? reasonOf(b.reason) : requiredReason(b.reason);
  return c.json(await decide(c.env.DB, { commentId: c.req.param("id"), actorId: s.member.id, actorKind: s.kind, action, reason, operationId: operationOf(b.operationId), now: Date.now() }));
});

commentModerationRoutes.put("/v1/moderation/members/:handle/comment-mute", async (c) => {
  const s = await staff(c);
  humanOnly(s.agent);
  const b = await bodyOf(c);
  if (b.days !== 7 && b.days !== 30 && b.days !== null) throw new HttpError(400, "invalid_arguments");
  const reason = requiredReason(b.reason);
  const operationId = operationOf(b.operationId);
  return c.json(await setMute(c.env.DB, { memberId: await targetOf(c), days: b.days, reason, actorId: s.member.id, operationId, now: Date.now() }));
});

commentModerationRoutes.delete("/v1/moderation/members/:handle/comment-mute", async (c) => {
  const s = await staff(c);
  humanOnly(s.agent);
  const b = await bodyOf(c);
  const reason = requiredReason(b.reason);
  const operationId = operationOf(b.operationId);
  await clearMute(c.env.DB, { memberId: await targetOf(c), reason, actorId: s.member.id, operationId, now: Date.now() });
  return c.body(null, 204);
});

commentModerationRoutes.get("/v1/moderation/comment-keywords", async (c) => {
  humanOnly((await staff(c)).agent);
  return c.json({ items: await listKeywords(c.env.DB) });
});
commentModerationRoutes.post("/v1/moderation/comment-keywords", async (c) => {
  const s = await staff(c);
  humanOnly(s.agent);
  const b = await bodyOf(c);
  await addKeyword(c.env.DB, { pattern: b.pattern, actorId: s.member.id, operationId: operationOf(b.operationId), now: Date.now() });
  return c.json({ items: await listKeywords(c.env.DB) });
});
commentModerationRoutes.delete("/v1/moderation/comment-keywords/:id", async (c) => {
  const s = await staff(c);
  humanOnly(s.agent);
  const b = await bodyOf(c);
  await removeKeyword(c.env.DB, { id: c.req.param("id"), actorId: s.member.id, operationId: operationOf(b.operationId), now: Date.now() });
  return c.json({ items: await listKeywords(c.env.DB) });
});

/** 能不能改運營設定：問供應商這個人是不是本站的應用管理員。問不到就當不是。 */
async function communityAdmin(c: Ctx): Promise<boolean> {
  const bearer = c.req.header("Authorization")?.match(/^Bearer\s+(\S+)$/)?.[1];
  if (!bearer) return false;
  try {
    return (await upstream.fetchCommunityStatus(c.env, bearer, providerOf(c)))?.admin === true;
  } catch {
    return false;
  }
}

commentModerationRoutes.get("/v1/moderation/settings", async (c) => {
  const s = await staff(c);
  return c.json({ settings: await readSettings(c.env.DB), canEdit: !s.agent && (await communityAdmin(c)) });
});
commentModerationRoutes.put("/v1/moderation/settings", async (c) => {
  const s = await staff(c);
  humanOnly(s.agent);
  if (!(await communityAdmin(c))) throw new HttpError(403, "community_admin_required");
  const b = await bodyOf(c);
  const patch = b.settings;
  if (typeof patch !== "object" || patch === null || Array.isArray(patch)) throw new HttpError(400, "invalid_arguments");
  const operationId = operationOf(b.operationId);
  const settings = await conflictOnDuplicate(() => writeSettings(c.env.DB, patch as Partial<CommunitySettings>, { memberId: s.member.id, kind: "human" }, operationId, Date.now()));
  await bumpOp(c.env.DB, "comment_moderation", "settings", "success");
  return c.json({ settings, canEdit: true });
});
