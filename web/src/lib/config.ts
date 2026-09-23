import { apiBaseOf } from "./provider";

/** HarperHarbor API; self-hosted builds use VITE_HARBOR_API_BASE. */
const DEFAULT_API: string = apiBaseOf("harbor");

/** Runtime API base for the active Harper account. */
export let UPSTREAM_API: string = apiBaseOf();

/** 換過供應商之後重新指向那一家；換家的流程要叫一次，否則請求還打在舊的那家。 */
export function useProviderUpstream(): string {
  UPSTREAM_API = apiBaseOf();
  return UPSTREAM_API;
}

/**
 * OAuth resource indicator（RFC 8707）：換到的 token 只對這個資源有效。
 * 這是邏輯識別字，不跟著實際打的網域走：授權伺服器只認這一個字串，同一顆 token 在主網域與
 * 備用網域都有效，切換網域不用重新登入。
 */
export const oauthResource = (): string => `${apiBaseOf()}/open/v1`;

/** 本站自己的 API 與前端同源，所以是相對路徑，不需要處理 CORS。 */
export const COMMUNITY_API = "/v1";

const REGION_KEY = "hr.apiBase";

/** Discard retired regional gateways before any credential-bearing request. */
export async function resolveUpstream(_fetcher:typeof fetch=fetch,_timeoutMs=2500):Promise<string>{
  try{sessionStorage.removeItem(REGION_KEY)}catch{}
  return useProviderUpstream();
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
