import type { Context } from "hono";
import { appAdminOf, bearerOf } from "./community-admin";
import { isReviewAgent, providerOf, requireReviewer } from "./members";
import { HttpError, type Env } from "./types";

/** 站方身分的共用閘門：留言審核、運營設定、分享活動都用這一份。應用管理員的判斷本身在 community-admin.ts。 */
type Ctx = Context<{ Bindings: Env }>;

export { bearerOf };

/** 審核人（含 AI 審核帳號）。 */
export async function staff(c: Ctx) {
  const member = await requireReviewer(c, { allowAgent: true });
  const agent = await isReviewAgent(c.env.DB, member.id);
  return { member, agent, kind: agent ? ("ai" as const) : ("human" as const) };
}

export function humanOnly(agent: boolean) {
  if (agent) throw new HttpError(403, "agent_not_allowed");
}

/**
 * 是不是本站應用管理員，問不到就當不是。用在「回答不該因供應商出錯而失敗」的地方：canEdit、看板的點數池、
 * 核准後要不要順手發放（決定已經寫入，不能因為這一問回錯誤）。不吃快取。
 */
export const communityAdmin = (c: Ctx): Promise<boolean> => appAdminOf(c.env, bearerOf(c), providerOf(c)).catch(() => false);

/**
 * 寫活動設定、讀點數池、發放的閘門：不是管理員 403，問不到 503 community_admin_unavailable（不說成沒權限，也不放行）。
 * 每次都問供應商，不吃快取（blogWriterHint 的 KV 快取只管入口顯示）。
 */
export async function requireCommunityAdmin(c: Ctx): Promise<void> {
  if (!(await appAdminOf(c.env, bearerOf(c), providerOf(c)))) throw new HttpError(403, "community_admin_required");
}
