import { countByAuthor, listCards, toCard, registeredAmong } from "./cards";
import { searchForm } from "./search-text";
import { resolveMember } from "./members";
import { type ProviderId, DEFAULT_PROVIDER } from "./providers";
import { quotaFor, type Quota } from "./quota";
import { type CardStatus, statusAmong } from "./review";
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
const cacheKey = (provider: ProviderId, accountNumId: number, page: number, pageSize: number, q: string) =>
  new Request(`https://personae.internal/me/${provider}/${accountNumId}/roles?p=${page}&n=${pageSize}&q=${encodeURIComponent(q)}`);

/** 已上架的卡最多幾張一起拿來比對關鍵字（作者每週只能送審幾張，實際遠少於這個數）。 */
const LISTED_SEARCH_LIMIT = 1000;
/** 「已提交」那組一次最多替幾張卡逐張問草稿現在的內容版本（＝網頁一頁的張數）。 */
const DRAFT_CHECK_LIMIT = 24;
export interface MinePage {
  /** registered＝本站有這張卡的登記（不論審到哪）；status 只在 registered 時有；note 是最近一次駁回的說明。 */
  items: (Omit<MyRole, "contentHash"> & { registered: boolean; status?: CardStatus; updateStatus?: string; note?: string; nsfw?: boolean; draftChanged?: boolean })[];
  /** 符合條件的卡一共幾張（翻頁用）。全部／未上架由上游算；已上架由本站的庫算。 */
  total: number | null;
  /** 已登記幾張。**全域**的數字，不是這一頁數出來的——見 countByAuthor。 */
  registeredTotal: number;
  /** 這週的登記額度：上限、已用、週的起訖（UTC 週一到下週一）。見 quota.ts。 */
  quota: Quota;
  page: number;
  pageSize: number;
  hasNext: boolean;
}

type ReviewState = { status: CardStatus; updateStatus?: string; approvedHash?: string };
/**
 * 這張卡比不比得出「改了沒送審」：已發布、記得過審那一版的內容版本（cards.approved_content_hash），
 * 而且沒有新版在審（已經送了，不是忘了送）、新版也沒剛被退回（卡上已經有退回說明）。
 */
const comparable = (s: ReviewState | undefined): s is ReviewState & { approvedHash: string } =>
  !!s && s.status === "approved" && !!s.approvedHash && s.updateStatus !== "pending" && s.updateStatus !== "rejected";
/** 已發布、有修改還沒送審：草稿現在的版本跟過審那一版不同。任一邊不知道就不標，不猜；只回旗標，版本本身不往前端送。 */
const draftChanged = (s: ReviewState | undefined, current: string | undefined) => comparable(s) && !!current && current !== s.approvedHash;

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
  opts: { page: number; pageSize: number; fresh: boolean; filter: MineFilter; provider?: ProviderId; q?: string },
): Promise<MineResult> {
  const provider: ProviderId = opts.provider ?? DEFAULT_PROVIDER;
  // 已登記張數與本週額度只看是誰，跟下面讀清單互不相依：一起問，不一趟接一趟（每趟 D1 約 40 ms）
  const counted = Promise.all([countByAuthor(env.DB, accountNumId, provider), quotaFor(env.DB, accountNumId, Date.now(), provider)]);

  // 「已登記」整組直接從本站的庫出：那是完整的一組，翻頁也對，而且不必問上游。
  // 走上游那條路的話，篩的只會是「這一頁裡已登記的」——作者卡多的時候差很多。
  if (opts.filter === "listed") {
    // 作者條件是本站成員 id（0005 起）；第一次來就建成員，跟登記那條路一致
    const [memberId, [registeredTotal, quota]] = await Promise.all([resolveMember(env.DB, provider, accountNumId, Date.now()), counted]);
    const q = opts.q ?? "";
    const offset = (opts.page - 1) * opts.pageSize;
    let rows: Awaited<ReturnType<typeof listCards>>["rows"];
    let hasNext: boolean;
    let total: number;
    if (q) {
      // 有關鍵字：這位作者已上架的卡整組拿來，繁簡都轉成同一種寫法再比（本站的全文索引不認繁簡）。
      // 一位作者已上架的卡受每週額度限制，不會多到撐不住。
      const all = await listCards(env.DB, { provider, authorMemberId: memberId, sort: "new", limit: LISTED_SEARCH_LIMIT, offset: 0, anyStatus: true, allowNsfw: true });
      const needle = searchForm(q);
      const matched = all.rows.filter((row) => searchForm(`${row.names} ${row.summaries}`).includes(needle));
      total = matched.length;
      rows = matched.slice(offset, offset + opts.pageSize);
      hasNext = offset + opts.pageSize < total;
    } else {
      ({ rows, hasNext } = await listCards(env.DB, {
        provider,
        authorMemberId: memberId,
        sort: "new",
        limit: opts.pageSize,
        offset,
        // 作者要看到自己每一張登記過的卡，包括待審、被駁回、離榜重審中的。
        anyStatus: true,
        allowNsfw: true,
      }));
      total = registeredTotal;
    }
    const notes = await statusAmong(env.DB, rows.map((r) => r.source_role_id));
    // 這一組不經上游清單、拿不到草稿現在的版本：只替已發布、記得過審版本的卡逐張問。
    // 一張一個對外請求，Worker 一次執行最多 50 個（見 syncBatch 的 SUBREQUEST_BUDGET）；API 的 pageSize 可到 100，
    // 所以最多問 DRAFT_CHECK_LIMIT 張（網頁一頁就是這麼多），超過的那幾張這次不標。
    const checked = rows.map((r) => r.source_role_id).filter((id) => comparable(notes.get(id))).slice(0, DRAFT_CHECK_LIMIT);
    const current = checked.length ? await upstream.fetchContentHashes(env, bearer, checked, provider) : new Map<string, string>();
    return {
      source: "bypass",
      body: {
        items: rows.map((row) => {
          const card = toCard(row, "zh");
          return {
            roleId: row.source_role_id,
            zone: card.zone as MyRole["zone"],
            name: card.name,
            summary: card.summary,
            avatarUrl: card.avatarUrl,
            backgroundUrl: card.backgroundUrl,
            // 上游的可見性不在本站的庫裡，而畫面上也不顯示它。
            visibility: "",
            talkNum: card.talkNum,
            registered: true,
            status: row.status as CardStatus,
            updateStatus: notes.get(row.source_role_id)?.updateStatus,
            note: notes.get(row.source_role_id)?.note ?? "",
            nsfw: card.nsfw,
            ...(draftChanged(notes.get(row.source_role_id), current.get(row.source_role_id)) ? { draftChanged: true } : {}),
          };
        }),
        total,
        registeredTotal,
        quota,
        page: opts.page,
        pageSize: opts.pageSize,
        hasNext,
      },
    };
  }

  const key = cacheKey(provider, accountNumId, opts.page, opts.pageSize, opts.q ?? "");
  const listed = (async () => {
    const cache = await caches.open(mineCache.namespace);
    if (!opts.fresh) {
      const cached = await cache.match(key);
      if (cached) return { roles: (await cached.json()) as Awaited<ReturnType<typeof upstream.fetchMyRoles>>, source: "hit" as const };
    }
    const roles = await upstream.fetchMyRoles(env, bearer, opts.page, opts.pageSize, provider, opts.q ?? "");
    // 快取的是上游那一份原始清單，不含登記狀態——登記狀態下面才查，才不會連同被凍住。
    await cache.put(
      key,
      new Response(JSON.stringify(roles), {
        headers: { "Content-Type": "application/json", "Cache-Control": `max-age=${EDGE_TTL_SECONDS}` },
      }),
    );
    return { roles, source: (opts.fresh ? "bypass" : "miss") as MineResult["source"] };
  })();
  // 上游清單（或它的快取）與張數、額度同時問
  const [[registeredTotal, quota], { roles, source }] = await Promise.all([counted, listed]);

  const ids = roles.items.map((r) => r.roleId);
  const [registered, statuses] = await Promise.all([registeredAmong(env.DB, ids, provider), statusAmong(env.DB, ids)]);
  const items = roles.items
    .map(({ contentHash, ...r }) => {
      const s = statuses.get(r.roleId);
      return {
        ...r, registered: registered.has(r.roleId),
        ...(s ? { status: s.status, updateStatus: s.updateStatus, note: s.note, nsfw: s.nsfw } : {}),
        ...(draftChanged(s, contentHash) ? { draftChanged: true } : {}),
      };
    })
    // 「還沒登記」是把這一頁裡已登記的挑掉。已登記的那組另有完整來源（見上面），
    // 這一組沒有——要全域篩就得把作者所有的頁都抓回來，每次看一頁都付那個代價不值得。
    .filter((r) => (opts.filter === "unlisted" ? !r.registered : true));

  return {
    source,
    body: {
      items,
      total: roles.total,
      registeredTotal,
      quota,
      page: opts.page,
      pageSize: opts.pageSize,
      hasNext: roles.hasNext,
    },
  };
}
