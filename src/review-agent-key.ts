import { isReviewAgent } from "./members";
import { bumpOp } from "./ops-metrics";
import { HttpError, type Env } from "./types";

/**
 * 審卡員的固定金鑰（比照部落格機器人 blog-publisher.ts）：不經 Harbor 登入、不會過期，只在 /v1/review-ai/* 的審卡員路由認。
 * 明文只在私有 infra-access；Worker 只存 SHA-256。瀏覽器來源（帶 Origin）一律拒絕。
 * 撤銷：清空 REVIEW_AGENT_CONFIG，或寫 review_agents.revoked_at（兩者任一即失效）。
 */
export async function reviewAgentByKey(env: Env, key: string, origin: string | undefined): Promise<string> {
  try {
    const config = JSON.parse(env.REVIEW_AGENT_CONFIG || "null") as { memberId?: unknown; keySha256?: unknown } | null;
    if (origin !== undefined || !/^[a-f0-9]{64}$/.test(key) || !config || typeof config.memberId !== "string" || !config.memberId
      || typeof config.keySha256 !== "string" || !/^[a-f0-9]{64}$/.test(config.keySha256)) throw new HttpError(403, "review_agent_key_invalid");
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key)));
    const expected = Uint8Array.from(config.keySha256.match(/../g)!, (v) => parseInt(v, 16));
    let difference = 0;
    for (let i = 0; i < digest.length; i++) difference |= digest[i]! ^ expected[i]!;
    if (difference || !(await isReviewAgent(env.DB, config.memberId))) throw new HttpError(403, "review_agent_key_invalid");
    await bumpOp(env.DB, "review_agent_key", "admission", "allow");
    return config.memberId;
  } catch (error) {
    const denied = error instanceof SyntaxError || error instanceof HttpError;
    await bumpOp(env.DB, "review_agent_key", "admission", denied ? "denied" : "error");
    if (denied) throw new HttpError(403, "review_agent_key_invalid");
    throw error;
  }
}
