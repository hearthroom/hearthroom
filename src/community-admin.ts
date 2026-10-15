import { isReviewAgent } from "./members";
import type { ProviderId } from "./providers";
import { HttpError, type Env } from "./types";
import { upstream } from "./upstream";

/**
 * 本站應用的管理資格只有一個來源：供應商那邊的應用團隊（owner／admin）。
 * 運營設定、發點數、寫部落格都問這裡，本站不另養一份管理員名單。
 */

/** 這個令牌的主人是不是本站應用的 owner／admin。問不到就拋 503，不當成「不是」：寫入被擋時才說得清楚原因。 */
export async function appAdminOf(env: Env, bearer: string, provider: ProviderId): Promise<boolean> {
  if (!bearer) return false;
  try {
    return (await upstream.fetchCommunityStatus(env, bearer, provider))?.admin === true;
  } catch {
    throw new HttpError(503, "community_admin_unavailable");
  }
}

export const bearerOf = (c: { req: { header: (k: string) => string | undefined } }) =>
  c.req.header("Authorization")?.match(/^Bearer\s+(\S+)$/)?.[1] ?? "";

/** 能寫官方部落格：應用 owner／admin，而且不是 AI 審核帳號（AI 帳號的令牌也可能屬於管理員）。每次寫入都問，不吃快取。 */
export async function canWriteBlog(env: Env, memberId: string, bearer: string, provider: ProviderId): Promise<boolean> {
  if (await isReviewAgent(env.DB, memberId)) return false;
  return appAdminOf(env, bearer, provider);
}

const HINT_TTL = 3600;
/**
 * 畫面要不要放部落格入口：同一個判斷，結果記在 KV 一小時。每個登入的人開頁都會問一次審核摘要，
 * 不快取就是每次開頁都多一趟供應商。只管入口顯示；真正的寫入照樣每次問（canWriteBlog）。問不到就先不放入口、不記。
 */
export async function blogWriterHint(env: Env, memberId: string, bearer: string, provider: ProviderId): Promise<boolean> {
  const key = `blog-writer:${provider}:${memberId}`;
  const cached = await env.CACHE?.get(key).catch(() => null);
  if (cached === "1" || cached === "0") return cached === "1";
  try {
    const ok = await canWriteBlog(env, memberId, bearer, provider);
    await env.CACHE?.put(key, ok ? "1" : "0", { expirationTtl: HINT_TTL }).catch(() => {});
    return ok;
  } catch {
    return false;
  }
}
