import { countByAuthor, listCards, toCard, registeredAmong } from "./cards";
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
  /** 作者一共有幾張卡。這個數字只有上游知道，「已登記」那條路不問上游，所以是 null。 */
  total: number | null;
  /** 已登記幾張。**全域**的數字，不是這一頁數出來的——見 countByAuthor。 */
  registeredTotal: number;
  page: number;
  pageSize: number;
  hasNext: boolean;
}

/** 要看哪一組：全部、已登記、還沒登記。 */
export type MineFilter = "all" | "listed" | "unlisted";

export interface MineResult {
  body: MinePage;
  /** 上游那一半是從哪來的。回應會帶成 X-Cache 標頭，部署後用 curl 就能驗快取有沒有生效。 */
  source: "hit" | "miss" | "bypass";
}

export async function loadMine(
  env: Env,
  bearer: string,
  accountNumId: number,
  opts: { page: number; pageSize: number; fresh: boolean; filter: MineFilter },
): Promise<MineResult> {
  const registeredTotal = await countByAuthor(env.DB, accountNumId);

  // 「已登記」整組直接從本站的庫出：那是完整的一組，翻頁也對，而且不必問上游。
  // 走上游那條路的話，篩的只會是「這一頁裡已登記的」——作者卡多的時候差很多。
  if (opts.filter === "listed") {
    const { rows, hasNext } = await listCards(env.DB, {
      authorNumId: accountNumId,
      sort: "new",
      limit: opts.pageSize,
      offset: (opts.page - 1) * opts.pageSize,
    });
    return {
      source: "bypass",
      body: {
        items: rows.map((row) => {
          const card = toCard(row, "zh");
          return {
            roleId: card.roleId,
            zone: card.zone as MyRole["zone"],
            name: card.name,
            summary: card.summary,
            avatarUrl: card.avatarUrl,
            // 上游的可見性不在本站的庫裡，而畫面上也不顯示它。
            visibility: "",
            talkNum: card.talkNum,
            registered: true,
          };
        }),
        total: null,
        registeredTotal,
        page: opts.page,
        pageSize: opts.pageSize,
        hasNext,
      },
    };
  }

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
  const items = roles.items
    .map((r) => ({ ...r, registered: registered.has(r.roleId) }))
    // 「還沒登記」是把這一頁裡已登記的挑掉。已登記的那組另有完整來源（見上面），
    // 這一組沒有——要全域篩就得把作者所有的頁都抓回來，每次看一頁都付那個代價不值得。
    .filter((r) => (opts.filter === "unlisted" ? !r.registered : true));

  return {
    source,
    body: {
      items,
      total: roles.total,
      registeredTotal,
      page: opts.page,
      pageSize: opts.pageSize,
      hasNext: roles.hasNext,
    },
  };
}
