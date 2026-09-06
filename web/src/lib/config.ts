/**
 * 角色卡來源服務的 API 位址。
 *
 * 預設是主網域；主網域在中國被擋，所以開頁時先問本站 `/v1/region`（Cloudflare 邊緣依連線來源
 * 判國別），中國來源改用備用網域。結果記在這個分頁的 sessionStorage，重新整理不用再問。
 * 自架時改 VITE_LUNATALK_API_BASE 就能指向別的部署。
 */
const DEFAULT_API: string = import.meta.env.VITE_LUNATALK_API_BASE ?? "https://api.lunatalk.ai";

export let UPSTREAM_API: string = DEFAULT_API;

/**
 * OAuth resource indicator（RFC 8707）：換到的 token 只對這個資源有效。
 * 這是邏輯識別字，不跟著實際打的網域走：授權伺服器只認這一個字串，同一顆 token 在主網域與
 * 備用網域都有效，切換網域不用重新登入。
 */
export const OAUTH_RESOURCE = `${DEFAULT_API}/open/v1`;

/** 本站自己的 API 與前端同源，所以是相對路徑，不需要處理 CORS。 */
export const COMMUNITY_API = "/v1";

const REGION_KEY = "hr.apiBase";

/**
 * 問一次該打哪個上游，然後把 UPSTREAM_API 換成答案。問不到（逾時、邊緣沒回）就維持預設，
 * 頁面照常開。呼叫端要在第一個上游請求之前 await 它。
 */
export async function resolveUpstream(fetcher: typeof fetch = fetch, timeoutMs = 2500): Promise<string> {
  try {
    const cached = sessionStorage.getItem(REGION_KEY);
    if (cached && /^https?:\/\//.test(cached)) {
      UPSTREAM_API = cached;
      return cached;
    }
  } catch {
    /* 私密視窗等情況讀不到，往下問 */
  }
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetcher(`${COMMUNITY_API}/region`, { signal: ctrl.signal });
    clearTimeout(timer);
    const data = (await res.json()) as { apiBase?: unknown };
    if (typeof data.apiBase === "string" && /^https?:\/\//.test(data.apiBase)) {
      UPSTREAM_API = data.apiBase.replace(/\/+$/, "");
      try {
        sessionStorage.setItem(REGION_KEY, UPSTREAM_API);
      } catch {
        /* 存不了就下次再問 */
      }
    }
  } catch {
    /* 邊緣沒回：用預設 */
  }
  return UPSTREAM_API;
}

/** 測試用：清掉分頁內記住的答案並回到預設。 */
export function resetUpstreamForTest(): void {
  UPSTREAM_API = DEFAULT_API;
  try {
    sessionStorage.removeItem(REGION_KEY);
  } catch {
    /* ignore */
  }
}
