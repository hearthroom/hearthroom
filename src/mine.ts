import { registeredAmong } from "./cards";
import type { Env } from "./types";
import { type MyRole, upstream } from "./upstream";

/**
 * 作者自己的卡片清單。
 *
 * 這一頁要拼兩份資料，而它們的新鮮度要求完全不同：
 *
 *   1. 「我有哪些卡」——住在上游，跨網域、沒有 CDN、回應肥大。這是慢的那一半，
 *      而且作者的卡不會每秒變，所以值得快取。
 *   2. 「哪些已經登記在本站」——住在自己的 D1，快，而且**使用者正在操作它**
 *      （按下登記／取消登記）。這一半永遠即時查，絕不快取。
 *
 * 把慢而穩的那半快取、把快而變動的那半保持即時，是這裡唯一重要的設計決定：
 * 使用者按下按鈕之後看到的狀態一定是對的，同時又不必每次都等上游。
 */

/**
 * 邊緣快取的命名空間。Cache API 沒有「列出所有鍵」也就沒有「全部清掉」，
 * 所以測試靠換一個命名空間來拿到乾淨的起點。
 */
export const mineCache = { namespace: "mine" };

/** 邊緣快取的存活時間。夠短到作者在上游改了名字很快就會反映，夠長到連點分頁不會打穿。 */
const EDGE_TTL_SECONDS = 60;

/**
 * 快取鍵用**驗證過的**數字 ID，絕不用 token 或任何請求帶進來的值。
 *
 * 這是這段程式碼唯一會造成嚴重事故的地方：鍵只要混進可被偽造的輸入，
 * 就會把一個人的卡片清單送給另一個人。identity 先驗證、鍵在伺服器端組出來，
 * 兩件事都不能省。
 */
const cacheKey = (accountNumId: number, page: number, pageSize: number) =>
  new Request(`https://personae.internal/me/${accountNumId}/roles?p=${page}&n=${pageSize}`);

export interface MinePage {
  items: (MyRole & { registered: boolean })[];
  total: number;
  page: number;
  pageSize: number;
  hasNext: boolean;
}

export interface MineResult {
  body: MinePage;
  /** 上游那一半是從哪來的。回應會帶成 X-Cache 標頭，部署後用 curl 就能驗快取有沒有生效。 */
  source: "hit" | "miss" | "bypass";
}

export async function loadMine(
  env: Env,
  bearer: string,
  accountNumId: number,
  opts: { page: number; pageSize: number; fresh: boolean },
): Promise<MineResult> {
  const key = cacheKey(accountNumId, opts.page, opts.pageSize);
  const cache = await caches.open(mineCache.namespace);

  let roles: Awaited<ReturnType<typeof upstream.fetchMyRoles>> | null = null;
  let source: MineResult["source"] = "bypass";

  if (!opts.fresh) {
    const cached = await cache.match(key);
    if (cached) {
      roles = (await cached.json()) as typeof roles;
      source = "hit";
    } else {
      source = "miss";
    }
  }

  if (!roles) {
    roles = await upstream.fetchMyRoles(env, bearer, opts.page, opts.pageSize);
    // 快取的是上游那一份原始清單，不含登記狀態——登記狀態下面才查，才不會連同被凍住。
    await cache.put(
      key,
      new Response(JSON.stringify(roles), {
        headers: { "Content-Type": "application/json", "Cache-Control": `max-age=${EDGE_TTL_SECONDS}` },
      }),
    );
  }

  const registered = await registeredAmong(env.DB, roles.items.map((r) => r.roleId));

  return {
    source,
    body: {
      items: roles.items.map((r) => ({ ...r, registered: registered.has(r.roleId) })),
      total: roles.total,
      page: opts.page,
      pageSize: opts.pageSize,
      hasNext: roles.hasNext,
    },
  };
}
