/** 角色卡來源服務的 API 位址。自架時改這裡就能指向別的部署。 */
export const UPSTREAM_API = import.meta.env.VITE_LUNATALK_API_BASE ?? "https://api.lunatalk.ai";

/** OAuth resource indicator（RFC 8707）：換到的 token 只對這個資源有效。 */
export const OAUTH_RESOURCE = `${UPSTREAM_API}/open/v1`;

/** 本站自己的 API 與前端同源，所以是相對路徑，不需要處理 CORS。 */
export const COMMUNITY_API = "/v1";
