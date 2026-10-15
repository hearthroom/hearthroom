import type { Context } from "hono";
import { isReviewAgent, providerOf, requireReviewer } from "./members";
import { upstream } from "./upstream";
import { HttpError, type Env } from "./types";

/** 站方身分的共用閘門：留言審核、運營設定、分享活動都用這一份。 */
type Ctx = Context<{ Bindings: Env }>;

/** 審核人（含 AI 審核帳號）。 */
export async function staff(c: Ctx) {
  const member = await requireReviewer(c, { allowAgent: true });
  const agent = await isReviewAgent(c.env.DB, member.id);
  return { member, agent, kind: agent ? ("ai" as const) : ("human" as const) };
}

export function humanOnly(agent: boolean) {
  if (agent) throw new HttpError(403, "agent_not_allowed");
}

export const bearerOf = (c: Ctx) => c.req.header("Authorization")?.match(/^Bearer\s+(\S+)$/)?.[1];

/** 能不能改運營設定：問供應商這個人是不是本站的應用管理員。問不到就當不是。 */
export async function communityAdmin(c: Ctx): Promise<boolean> {
  const bearer = bearerOf(c);
  if (!bearer) return false;
  try {
    return (await upstream.fetchCommunityStatus(c.env, bearer, providerOf(c)))?.admin === true;
  } catch {
    return false;
  }
}
