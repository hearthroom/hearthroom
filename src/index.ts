import { hostGateway, submitHosted, hostingDecision, beginHostedEdit } from "./hosting";
import { saveCommunityProfile, cleanAvatars } from "./community-profile";
import { bodyLimit } from "hono/body-limit";
import { syncCard, copiesFor, workFor, publishedCopiesFor, distributeCard, type DistributeTarget } from "./card-sync";
import { apiBaseOf as providerApiBase } from "./providers";
import { linkIdentity, unlinkIdentity, connectedMemberId, emptyCommunity } from './connections';
import { saveMemberId } from './members';
import { type Context, Hono } from "hono";
import {
  CARD_NUMBER,
  syncStatement,
  dueForSync,
  getAuthor,
  getCard,
  previewCard,
  listAuthors,
  listCards,
  toAuthor,
  toCard,
  topTags,
  unregister,
  upsertCard,
  registeredAmong,
} from "./cards";
import {
  BEACON_DETAILS, BEACON_EVENTS, clientKind, emit, note, refHostOf, safeSubject, shapeTerm, surfaceOf,
  type EventFields, type Pending,
} from "./analytics";
import { authorLine, renderHead } from "./head";
import { ALIAS_HOSTS, HOST, canonicalUrl, isPlayHost } from "./site";
import { loadMine, type MineFilter } from "./mine";
import { tagNamesFor } from "../shared/tag-catalog";
import { providerOf, isReviewer, memberByHandle, memberNsfw, memberProfile, missingMemberStatements, requireMember, requireReviewer, resolveMember, updateMemberNsfw, viewerAllowsNsfw, memberHiddenTags, updateMemberHiddenTags } from "./members";
import { configuredProviders, hasChat, parseProvider, requireConfigured, DEFAULT_PROVIDER, PROVIDER_NAMES, type ProviderId, reviewEnabled } from "./providers";
import { providerApiBaseFor } from "./providers";
import { WEEKLY_LIMIT, registeredThisWeek } from "./quota";
import {
  CLAIM_TTL_MS, STAMPS_REQUIRED, claim as claimSubmission, createSubmission, getSubmission, listQueue, needsReviewStatements,
  release as releaseSubmission, stamp as stampSubmission,
} from "./review";
import { setCardNsfw, setCardStatus } from "./cards";
import { PUBLIC_HASH_PREFIX, loadSnapshot, publicHash, saveSnapshotStatement, type ReviewSettings } from "./review-snapshot";
import { type Env, HttpError } from "./types";
import { gameRoutes } from "./game";
import { serveSandbox } from "./sandbox";
import { listSaves, putSave, removeSave } from "./saves";
import { commentCard, countTop, deleteComment, listReplies, listTop, postComment, setLike, type Viewer } from "./comments";
import { IMAGE_HOSTS, SVG_WRAP_LIMIT, TOUCH_ICON_SIZE, allowedImageUrl, cardManifest, iconSize, signShortcutKey, svgWrap, verifyShortcutKey } from "./shortcut";
import { upstream, ZONES, type Zone, CREATION_METHOD } from "./upstream";

const app = new Hono<{ Bindings: Env; Variables: { ev: Pending } }>();

/**
 * 埋點：一個請求發一個數據點。
 *
 * 中間件先掛一份空的在 context 上，handler 往裡填只有它知道的東西（結果數、排序鍵、卡片 id），
 * 回來之後補上路由、狀態、耗時、快取命中再發出去。這樣不會重複計數，也拿得到 handler 手上的語義；
 * handler 拋例外時 onError 已經把回應寫好了，這裡照樣發得出去。
 */
app.use("*", async (c, next) => {
  const started = Date.now();
  const ev: Pending = {};
  c.set("ev", ev);
  await next();
  // beacon 端點自己發事件；健康檢查沒有分析價值
  const path = new URL(c.req.url).pathname;
  if (path === "/v1/e" || path === "/v1/health" || path === "/v1/region") return;
  emit(c.env, c.executionCtx, {
    event: ev.event ?? "api",
    from: surfaceOf(c.req.header("X-From")),
    route: c.req.routePath,
    locale: c.req.query("lang") ?? "",
    country: (c.req.raw.cf?.country as string) ?? "",
    client: clientKind(c.req.header("User-Agent")),
    cache: c.res.headers.get("X-Cache") ?? "",
    status: c.res.status,
    durationMs: Date.now() - started,
    outcome: ev.outcome ?? (c.res.status < 400 ? "ok" : "error"),
    ...ev,
  } as EventFields);
});

/**
 * 別名主機（www、搬家前的舊網域）來的一律 301 到正本，路徑與查詢字串原樣帶過去。
 *
 * 掛在埋點中間件之後，所以這些請求照樣進報表（`host_redirect`，`detail` 是來源主機），
 * 看得出還有多少人走舊網址進來——那個數字降到零之前，舊網域不能拔。
 *
 * 用 301 而不是 302：搜尋引擎才會把累積的排名轉過來，瀏覽器與抓取器也才會記住。
 */
/**
 * 沙箱子網域（c<roleId>.hearthroom.club）：只出殼頁與它的 js/css，其餘 404（src/sandbox.ts）。
 * 掛在別名轉向之前：這些主機不是別名，也不該落到主站的路由。
 */
app.use("*", async (c, next) => {
  const served = await serveSandbox(c);
  if (served) {
    note(c, { event: "sandbox_shell", detail: served.status === 200 ? "ok" : String(served.status) });
    return served;
  }
  return next();
});

app.use("*", async (c, next) => {
  const url = new URL(c.req.url);
  if (!ALIAS_HOSTS.includes(url.host)) return next();
  note(c, { event: "host_redirect", detail: url.host, refHost: c.req.header("Referer") ? new URL(c.req.header("Referer")!).host : "" });
  url.host = HOST;
  url.port = "";
  return c.redirect(url.toString(), 301);
});

app.onError((err, c) => {
  const ev = c.get("ev") as Pending | undefined;
  if (err instanceof HttpError) {
    if(c.req.path==='/v1/me/card-sync')console.error('card_sync_failed',{code:err.message.startsWith('sync_')?err.message:'sync_identity_failed',...err.detail});
    if (ev) ev.outcome = err.status === 404 ? "not_found" : err.status === 403 ? "forbidden" : err.status === 502 ? "upstream_error" : "rejected";
    return c.json({ error: err.message, ...(err.detail ? {detail:err.detail} : {}) }, err.status);
  }
  if (ev) ev.outcome = "internal";
  console.error("unhandled error", err);
  return c.json({ error: "internal error" }, 500);
});

const lang = (c: { req: { query: (k: string) => string | undefined; header: (k: string) => string | undefined } }) =>
  c.req.query("lang") || c.req.header("Accept-Language")?.split(",")[0] || "zh";

const clamp = (raw: string | undefined, fallback: number, max: number) => {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.min(Math.floor(n), max) : fallback;
};

/** 轉發作者自己的 token 問上游「你是誰」。用完即棄：不落庫、不進日誌、不進快取。 */
async function requireAuthor(c: { env: Env; req: { header: (k: string) => string | undefined } }) {
  const bearer = c.req.header("Authorization")?.match(/^Bearer\s+(\S+)$/)?.[1];
  if (!bearer) throw new HttpError(401, "missing bearer token");
  return await upstream.fetchMe(c.env, bearer, providerOf(c));
}

app.get("/v1/health", (c) => c.json({ ok: true }));

// 遊戲模式：作者替自己的卡存一份世界配置（src/game.ts）
gameRoutes(app);

/**
 * 前端開頁時問一次「供應商該打哪個網址」。有些地區連不上供應商的主網域，那邊的人改走
 * 對應的閘道（PROVIDER_API_GATEWAYS）；國別是 Cloudflare 邊緣看連線來源判的（`cf.country`；
 * 沒有就看它塞的標頭，測試環境走這條）。回應依來源而異，不能被任何一層快取。
 */
app.get("/v1/region", (c) => {
  const country = ((c.req.raw.cf?.country as string) || c.req.header("cf-ipcountry") || "").toUpperCase();
  const apiBase = providerApiBaseFor(c.env, country);
  return c.json({ country, apiBase }, 200, { "Cache-Control": "no-store" });
});

/**
 * 這個部署接了哪幾家供應商。登入頁照這個列按鈕——前端寫死的話，沒配第二家的部署
 * （包括自架的人）也會看到那顆按鈕，按下去每個請求都 400。
 * 不需要登入：登入頁本來就還沒有身分。
 */
app.get("/v1/providers", (c) =>
  c.json(
    { providers: configuredProviders(c.env).map((id) => ({ id, name: PROVIDER_NAMES[id] })) },
    200,
    { "Cache-Control": "public, max-age=300" },
  ),
);

/**
 * 圖片代抓，只給「匯出成 PNG 卡」用。
 *
 * 匯出要把設定寫進頭像那張 PNG 的 tEXt，所以前端得拿到圖的位元組；而上游的圖片主機沒開
 * CORS，瀏覽器直接 fetch 會被擋，前端只能退回存 JSON。走同源的這條路就沒有 CORS 問題。
 *
 * 只放行上游的圖片主機，不然這就是一個開放代理。回應用 Cache API 快取一天：同一張頭像
 * 被反覆匯出時不必每次都回上游拿。
 */
export const IMAGE_PROXY_HOSTS = IMAGE_HOSTS;
export const imageCache = { namespace: "image" };

app.get("/v1/image", async (c) => {
  const raw = c.req.query("u") ?? "";
  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    throw new HttpError(400, "invalid image url");
  }
  if (target.protocol !== "https:" || !IMAGE_PROXY_HOSTS.has(target.hostname)) throw new HttpError(403, "image host not allowed");

  const cache = await caches.open(imageCache.namespace);
  const key = new Request(target.toString());
  const hit = await cache.match(key);
  if (hit) return hit;

  const res = await fetch(target.toString(), { headers: { "User-Agent": "Hearthroom/0.1 (image export)" } });
  if (!res.ok) throw new HttpError(502, `image fetch failed with ${res.status}`);
  const type = res.headers.get("content-type") ?? "";
  if (!type.startsWith("image/")) throw new HttpError(502, "not an image");
  const out = new Response(res.body, {
    status: 200,
    headers: {
      "content-type": type,
      "cache-control": "public, max-age=86400",
      "x-content-type-options": "nosniff",
    },
  });
  c.executionCtx.waitUntil(cache.put(key, out.clone()));
  return out;
});

/**
 * 榜單邊緣快取。
 *
 * 榜單對所有人完全一樣，而底層資料每小時才同步一次——同一份 SQL 重算幾千次沒有意義。
 * 命中就是零 DB 查詢。
 *
 * 代價是登記一張卡之後，榜單最多晚 BOARD_TTL 秒才看得到它。可以接受的理由是作者在
 * 自己的工作區立刻就看得到狀態變化（那條路不快取），所以不會覺得操作沒生效。
 *
 * 要做到「登記完榜單立刻更新」，得在寫入時遞增一個代際號並拼進快取鍵——那需要一個
 * 全域強一致的計數器（Durable Object）。等榜單真的大到值得為此加一個元件再說。
 */
const BOARD_TTL = 60;

/** 同 mineCache：Cache API 沒有「全部清掉」，測試靠換命名空間拿乾淨起點。 */
export const boardCache = { namespace: "board" };

/** zone 參數：四區之一、all（不分區）、或沒帶（中文）。 */
function parseZone(raw: string | undefined): Zone | undefined {
  if (raw === "all") return undefined;
  return (ZONES as readonly string[]).includes(raw ?? "") ? (raw as Zone) : "zh";
}

/**
 * 邊緣快取的鍵。供應商必須進去：兩家看的是各自的卡，共用一份快取等於把一家的內容
 * 發給另一家的訪客。標頭不是快取鍵的一部分，所以要塞進網址。
 */
function cacheKeyFor(c: Context<{ Bindings: Env; Variables: { ev: Pending } }>): Request {
  return new Request(c.req.url, { method: "GET", headers: c.req.raw.headers });
}

/** 公開、只讀、對所有人一樣的回應，都走這個邊緣快取。 */
async function cachedJson(c: Context<{ Bindings: Env; Variables: { ev: Pending } }>, ttl: number, compute: () => Promise<unknown>) {
  const cache = await caches.open(boardCache.namespace);
  const key = cacheKeyFor(c);
  const hit = await cache.match(key);
  if (hit) {
    const res = new Response(hit.body, hit);
    res.headers.set("X-Cache", "hit");
    return res;
  }
  const res = c.json(await compute());
  res.headers.set("Cache-Control", `public, max-age=${ttl}`);
  res.headers.set("X-Cache", "miss");
  const stored = res.clone();
  stored.headers.set("X-Cache", "hit");
  c.executionCtx.waitUntil(cache.put(key, stored));
  return res;
}

/** 榜單與搜尋。匿名可讀。 */
/** 榜的種類與各自的窗口。day／week／month 是「上榜時間在窗口內」，hot／new／random 不開窗。top 是 hot 的舊名字。 */
const BOARD_WINDOW: Record<string, number> = { day: 86_400_000, week: 7 * 86_400_000, month: 30 * 86_400_000 };
function parseBoardSort(raw: string | undefined): { sort: "hot" | "new" | "random" | "relevance"; since?: number; key: string } {
  if (raw && raw in BOARD_WINDOW) return { sort: "hot", since: Date.now() - BOARD_WINDOW[raw], key: raw };
  if (raw === "new" || raw === "random" || raw === "relevance") return { sort: raw, key: raw };
  return { sort: "hot", key: "hot" };
}

app.get("/v1/cards", async (c) => {
  // 開了成人內容的人：先驗身分再查資料，回應不進快取、也不從快取拿——
  // 邊緣快取是公開的，一份帶成人內容的回應進了快取就會給下一個沒登入的人。
  const allowNsfw = await viewerAllowsNsfw(c);
  // 只有 GET 而且完全公開，所以整個 URL 就是快取鍵，不必自己組。推薦是隨機的，快取住就不隨機了。
  // 榜單不分供應商（owner 2026-09-17）：X-Provider 只是「我用哪家的帳號」，不進快取鍵也不進查詢。
  const cacheKey = cacheKeyFor(c);
  const cache = await caches.open(boardCache.namespace);
  const hit = allowNsfw || c.req.query("sort") === "random" ? undefined : await cache.match(cacheKey);
  if (hit) {
    // 快取命中一樣是一次瀏覽行為，只是結果數這種東西這條路上沒有
    const q0 = c.req.query("q")?.trim();
    note(c, {
      event: q0 ? "search" : "list",
      sortKey: c.req.query("sort") ?? "hot",
      tag: c.req.query("tag")?.trim() ?? "",
      term: q0 ? shapeTerm(q0) : "",
      subject: c.req.query("author") ?? "",
      zoneScope: c.req.query("zone") === "all" ? "all" : "current",
      offset: clamp(c.req.query("offset"), 0, 10_000),
    });
    const res = new Response(hit.body, hit);
    res.headers.set("X-Cache", "hit");
    return res;
  }
  const { sort, since: sortSince, key: sortKey } = parseBoardSort(c.req.query("sort"));
  const periods: Record<string, number> = { week: 7, month: 30, quarter: 90, year: 365 };
  const period = c.req.query("period");
  const since = period && Object.hasOwn(periods, period) ? Date.now() - periods[period] * 86_400_000 : sortSince;
  const offset = clamp(c.req.query("offset"), 0, 10_000);
  const limit = Math.max(1, clamp(c.req.query("limit"), 24, 100));
  // author 是作者的本站公開 ID（members.handle），不是上游的數字 ID。沒這個人就是空榜。
  const author = c.req.query("author");
  // 語區是榜單的必要條件，不帶就給中文——不做「全部語言混在一起」的總榜。
  // 兩個例外：作者主頁（看一個人的作品時語言不是篩選條件）、搜尋頁明說 zone=all。
  const zone = author ? undefined : parseZone(c.req.query("zone"));
  const authorMemberId = author ? ((await memberByHandle(c.env.DB, author)) ?? "") : undefined;

  const selectedTags = [...new Set((c.req.queries("tag") ?? []).map(t => t.trim()).filter(Boolean))];
  if (selectedTags.length > 60) return c.json({ error: "too_many_tags" }, 400);
  const tagGroups = selectedTags.map(tag => tagNamesFor(tag) ?? [tag]);
  // 看的人不想看的類型（?hide=鍵,鍵）：鍵展開成五語名字後排除；不是鍵的忽略。
  // 明確點了要看的類型（?tag=）永遠贏——分享來的連結、榜單上點的籤，不能因為在隱藏名單裡就變成空榜。
  // 這是查詢字串的一部分，所以回應照常進公開快取（同一組隱藏名單共用一份）。
  const excludeTags = (() => {
    const raw = c.req.query("hide")?.trim();
    if (!raw) return undefined;
    const names = new Set(raw.split(",").flatMap((k) => tagNamesFor(k.trim()) ?? []));
    for (const name of tagGroups.flat()) names.delete(name);
    return names.size ? [...names] : undefined;
  })();
  const { rows, total, hasNext } = await listCards(c.env.DB, {
    zone,
    q: c.req.query("q")?.trim() || undefined,
    tagGroups,
    excludeTags,
    authorMemberId,
    allowNsfw,
    sort,
    since,
    limit,
    offset,
  });
  const l = lang(c);
  const q = c.req.query("q")?.trim();
  // 搜尋與榜單是兩種行為，分開記；結果數只有這裡拿得到（total 有篩選時是 null，中間件讀不到）
  note(c, {
    event: q ? "search" : "list",
    sortKey,
    tag: c.req.query("tag")?.trim() ?? "",
    term: q ? shapeTerm(q) : "",
    subject: author ?? "",
    zoneScope: c.req.query("zone") === "all" ? "all" : "current",
    resultCount: total ?? rows.length,
    offset,
    outcome: rows.length ? "ok" : "empty",
  });
  const res = c.json({ items: rows.map((r) => toCard(r, l)), total, hasNext, limit, offset, sort: sortKey });
  if (allowNsfw) {
    res.headers.set("Cache-Control", "private, no-store");
    res.headers.set("X-Cache", "bypass");
    return res;
  }
  res.headers.set("Cache-Control", `public, max-age=${BOARD_TTL}`);
  res.headers.set("X-Cache", "miss");
  // 放進快取的副本不能帶 X-Cache: miss，否則下一個人會看到錯的標記。
  if (sort !== "random") {
    const stored = res.clone();
    stored.headers.set("X-Cache", "hit");
    c.executionCtx.waitUntil(cache.put(cacheKey, stored));
  }
  return res;
});

/** 這一區最常見的標籤，給榜單的類型篩選列。標籤分佈變得慢，快取久一點。 */
app.get("/v1/tags", (c) =>
  cachedJson(c, 300, async () => {
    const limit = Math.max(1, clamp(c.req.query("limit"), 24, 60));
    const offset = clamp(c.req.query("offset"), 0, 10_000);
    const rows = await topTags(c.env.DB, parseZone(c.req.query("zone")), limit + 1, c.req.query("q")?.trim(), offset);
    return { items: rows.slice(0, limit), hasNext: rows.length > limit, limit, offset };
  }),
);

/** 作者榜：按作品在本站的合計排。 */
app.get("/v1/authors", (c) =>
  cachedJson(c, BOARD_TTL, async () => {
    const sortParam = c.req.query("sort");
    const sort = sortParam === "cards" || sortParam === "hot" ? sortParam : "talk";
    const limit = Math.max(1, clamp(c.req.query("limit"), 24, 100));
    const offset = clamp(c.req.query("offset"), 0, 10_000);
    const { rows, hasNext } = await listAuthors(c.env.DB, {
      zone: parseZone(c.req.query("zone")),
      q: c.req.query("q")?.trim() || undefined,
      sort, limit, offset,
    });
    return { items: rows.map(toAuthor), hasNext, limit, offset, sort };
  }),
);

/**
 * 作者看自己還沒上榜的卡：卡片頁對別人是 404，但作者從「我的角色卡」點封面進來不該掉進死路
 *（玩家回報 2026-09-17）。帶著 token、而且卡真是他的，就把卡片頁的資料給他，附上審核狀態；
 * 本站還沒有這張卡的列（沒提交過）就從上游的公開資料拼一份預覽。
 * 回 null 表示「不是作者本人」，呼叫端照舊 404——對外不透露這張卡存不存在。
 */
async function ownCardView(c: Context<{ Bindings: Env; Variables: { ev: Pending } }>, id: string, row: Awaited<ReturnType<typeof getCard>>) {
  const bearer = c.req.header("Authorization")?.match(/^Bearer\s+(\S+)$/)?.[1];
  if (!bearer) return null;
  const provider = providerOf(c);
  const me = await upstream.fetchMe(c.env, bearer, provider).catch(() => null);
  if (!me) return null;
  if (row) return row.author_num_id === me.accountNumId ? { ...toCard(row, lang(c)), status: row.status } : null;
  // 卡號查不到就是沒這張卡；只有上游的卡片 ID 才值得去上游問
  if (CARD_NUMBER.test(id)) return null;
  const role = await (provider==='harbor'?hostGateway.read(c.env,bearer,id):upstream.fetchRole(c.env,id,provider)).catch(() => null);
  if (!role || role.authorNumId !== me.accountNumId) return null;
  return previewCard(role, lang(c), provider);
}

app.get("/v1/cards/:id", async (c) => {
  const row = await getCard(c.env.DB, c.req.param("id"),providerOf(c));
  // 還沒過審、被駁回、離榜重審中的卡對外都不存在；作者在「我的卡片」看得到狀態。
  if (!row || row.status !== "approved") {
    // 作者本人例外：給他看，但不算一次瀏覽、不進任何快取
    const own = await ownCardView(c, c.req.param("id"), row);
    if (own) return c.json(own, 200, { "Cache-Control": "private, no-store" });
    throw new HttpError(404, "card not found");
  }
  // 成人內容：沒開（或沒登入、沒驗年齡）的人拿不到內容，但要知道「這是成人內容、要登入／驗年齡」
  // 才能引導（owner 2026-09-08 改成 Steam 式的門，不是 404）。403 只透露這一件事，內容一個欄位都不給。
  const allowNsfw = row.nsfw === 1 ? await viewerAllowsNsfw(c) : false;
  if (row.nsfw === 1 && !allowNsfw) throw new HttpError(403, "adult_content");
  // 卡片瀏覽只在這裡記一次。HTML 殼那條路（page_html）多半是抓取器，卡片頁替作者發的
  // 「其他作品」副請求則是 /v1/cards?author=，兩者都不算一次瀏覽，否則分母會被灌水三倍。
  // 對話頁為了換 manifest 也讀這一條（view=0）：那不是一次瀏覽，卡片頁已經記過、從主畫面圖示直接進來的更不是
  if (c.req.query("view") !== "0") note(c, { event: "card_view", subject: row.source_role_id, zoneScope: "current" });
  // 過了成人門的人拿一把「加到主畫面」的鑰匙：manifest 與圖示是瀏覽器抓的，帶不了登入（src/shortcut.ts）
  const secret = c.env.SHORTCUT_SECRET;
  const shortcutKey = allowNsfw && secret ? await signShortcutKey(secret, row.id) : undefined;
  return c.json({ ...toCard(row, lang(c)), ...(shortcutKey ? { shortcutKey } : {}) }, 200, allowNsfw ? { "Cache-Control": "private, no-store" } : {});
});

/**
 * 把一張卡加到主畫面：卡片專屬的 manifest 與圖示。設計見 src/shortcut.ts。
 *
 * 兩條路都是瀏覽器自己抓的（沒有 Authorization）：不在榜一律 404；成人內容要帶有效的鑰匙（?k=），
 * 沒有就 404。快取期短：名字與頭像每小時同步一次，圖示另有自己的 Cache API 快取。
 */
async function shortcutCard(c: Context<{ Bindings: Env; Variables: { ev: Pending } }>) {
  const row = await getCard(c.env.DB, c.req.param("id") ?? "");
  if (!row || row.status !== "approved") throw new HttpError(404, "card not found");
  const key = c.req.query("k");
  if (row.nsfw === 1 && !(await verifyShortcutKey(c.env.SHORTCUT_SECRET, row.id, key))) throw new HttpError(404, "card not found");
  return { row, key: row.nsfw === 1 ? key : undefined };
}

app.get("/v1/cards/:id/manifest.webmanifest", async (c) => {
  const { row, key } = await shortcutCard(c);
  return c.json(cardManifest(row, lang(c), key, { playApp: isPlayHost(requestHost(c)) }), 200, {
    "Content-Type": "application/manifest+json; charset=utf-8",
    // 快取期要短：瀏覽器安裝與更新檢查都讀這份，改了顯示模式（例如全螢幕）拿到一小時前的舊版就裝錯
    "Cache-Control": key ? "private, no-store" : "public, max-age=60",
  });
});

/**
 * 請求打到哪個主機。注意本機 wrangler dev 會把網址與 Host 都改寫成第一條路由的主機（hearthroom.club），
 * 要驗卡片 App 網域得另起一個 `wrangler dev --host play.hearthroom.club` 的實例。
 */
const requestHost = (c: { req: { url: string; header: (k: string) => string | undefined } }): string =>
  c.req.header("host") ?? new URL(c.req.url).host;

/**
 * 站台自己的 manifest 在卡片 App 網域上不存在：那裡若裝得了範圍是「/」的站台 App，所有卡片 App
 * 就又被它罩住（Android 的已安裝判定看範圍）。主站照舊由資源層出檔。
 */
app.get("/manifest.webmanifest", async (c) => {
  if (isPlayHost(requestHost(c))) throw new HttpError(404, "not on this host");
  return c.env.ASSETS.fetch(c.req.raw);
});

export const iconCache = { namespace: "card-icon" };

// icon-192.png／icon-512.png 給 manifest（退路可以是 SVG）；touch-icon.png 給 iOS（退路是原圖）
app.get("/v1/cards/:id/:file{(icon-[0-9]+|touch-icon)\\.png}", async (c) => {
  const { row } = await shortcutCard(c);
  const file = c.req.param("file");
  const raster = file === "touch-icon.png";
  const size = raster ? TOUCH_ICON_SIZE : iconSize(file.slice("icon-".length, -".png".length));
  const src = allowedImageUrl(row.avatar_url);
  // 沒頭像（或頭像不在放行主機上）：退回站台自己的圖示，至少還裝得起來
  const siteIcon = () => c.redirect(new URL(`/icons/icon-${size >= 512 ? 512 : 192}.png`, c.req.url).toString(), 302);
  if (!src) return siteIcon();

  const cache = await caches.open(iconCache.namespace);
  const key = new Request(`https://icon.invalid/${row.id}/${size}/${raster ? "raw" : "any"}?src=${encodeURIComponent(src.toString())}`);
  const hit = await cache.match(key);
  if (hit) return hit;

  const res = await fetch(src.toString(), { headers: { "User-Agent": "Hearthroom/0.1 (home screen icon)" } });
  if (!res.ok) return siteIcon();
  const type = (res.headers.get("content-type") ?? "").split(";")[0].trim();
  if (!type.startsWith("image/")) return siteIcon();
  const bytes = await res.arrayBuffer();

  const headers = { "cache-control": "public, max-age=86400", "x-content-type-options": "nosniff" };
  let out: Response | null = null;
  // 1. Images 綁定：裁成正方形、轉 PNG。帳號沒開 Images 時這裡會丟錯，往下退。
  if (c.env.IMAGES) {
    try {
      const png = await c.env.IMAGES.input(new Blob([bytes]).stream()).transform({ width: size, height: size, fit: "cover" }).output({ format: "image/png" });
      out = new Response(await png.response().arrayBuffer(), { status: 200, headers: { ...headers, "content-type": "image/png" } });
    } catch { out = null; }
  }
  // 2. 本來就是 PNG：原樣給。3. 其他格式：包一層 SVG（要原圖的 raster=1 除外）。
  if (!out && (type === "image/png" || raster)) out = new Response(bytes, { status: 200, headers: { ...headers, "content-type": type } });
  if (!out && bytes.byteLength <= SVG_WRAP_LIMIT) out = new Response(svgWrap(bytes, type, size), { status: 200, headers: { ...headers, "content-type": "image/svg+xml" } });
  if (!out) return siteIcon();
  c.executionCtx.waitUntil(cache.put(key, out.clone()));
  return out;
});

/**
 * 作者自己的卡片清單（含尚未登記的）。
 *
 * 這條路刻意收到伺服器端而不是讓前端直接打上游：只有在這裡才有地方放邊緣快取，
 * 也才能把回應裁成畫面真的需要的欄位。細節見 src/mine.ts。
 */
app.get("/v1/me/cards", async (c) => {
  const bearer = c.req.header("Authorization")?.match(/^Bearer\s+(\S+)$/)?.[1];
  if (!bearer) throw new HttpError(401, "missing bearer token");

  const page = Math.max(1, clamp(c.req.query("page"), 1, 500));
  const pageSize = Math.max(1, clamp(c.req.query("pageSize"), 24, 100));
  // 前端改過卡之後會帶 fresh=1：它知道自己剛寫過，比任何 TTL 都準。
  const fresh = c.req.query("fresh") === "1";
  const filterParam = c.req.query("filter");
  const filter: MineFilter = filterParam === "listed" || filterParam === "unlisted" ? filterParam : "all";

  const provider = providerOf(c);
  const me = await upstream.fetchMe(c.env, bearer, provider);
  const { body, source } = await loadMine(c.env, bearer, me.accountNumId, { page, pageSize, fresh, filter, provider });

  note(c, { event: "mine_view", resultCount: body.items.length, offset: (page - 1) * pageSize, detail: filter });
  c.header("X-Cache", source);
  // 這是私人資料：可以放進使用者自己的瀏覽器，但任何共用快取都不准碰。
  c.header("Cache-Control", "private, no-store");
  const items = await Promise.all(body.items.map(async item => {
    const work = await workFor(c.env.DB, provider, item.roleId);
    return {...item, provider, workId:work?.id, sourceProvider:work?.source_provider, sourceRoleId:work?.source_role_id};
  }));
  return c.json({...body, items});
});

/** 作者主頁。這裡只認得他登記過的卡——本站看不到、也不該看到他的其他作品。 */
/**
 * 公開作者頁：網址是本站的公開 ID，不是上游的數字 ID。
 * 一個成員之後可能把卡關聯到多家供應商，作者頁把各家的卡合在一起看，並說明支援哪些供應商。
 * 不是「由哪家提供」——卡是作者的，供應商只是能玩它的地方（owner 2026-09-08）。
 */
app.get("/v1/authors/:handle", async (c) => {
  const handle = c.req.param("handle");
  const memberId = await memberByHandle(c.env.DB, handle);
  const allowNsfw = await viewerAllowsNsfw(c);
  const author = memberId ? await getAuthor(c.env.DB, memberId, allowNsfw) : null;
  if (!author) throw new HttpError(404, "author has no registered cards");
  note(c, { event: "author_view", subject: handle, resultCount: author.card_count });
  if (allowNsfw) c.header("Cache-Control", "private, no-store");
  return c.json({
    handle: author.handle,
    name: author.author_name,
    avatar: author.author_avatar,
    bio: author.bio,
    cardCount: author.card_count,
    talkTotal: author.talk_total ?? 0,
    joinedAt: author.joined_at,
    providers: author.providers,
  });
});

/**
 * 登入者在本站的身分：公開 ID、加入時間、連結了哪些供應商帳號、是不是審核人。
 * 第一次呼叫就建成員——所以登入後前端立刻問一次，「我的」頁才有 ID 可顯示。
 */
app.post('/v1/me/card-sync', async (c) => {
 const member=await requireMember(c);
 const b=await c.req.json<{sourceProvider:string;sourceRoleId:string;sourceToken:string;targetProvider:string;targetToken:string;publish?:boolean;updatePublished?:boolean;recreateMissing?:boolean}>();
 if(!b || typeof b.sourceProvider!=='string' || !b.sourceProvider.trim() || typeof b.targetProvider!=='string' || !b.targetProvider.trim() || typeof b.sourceRoleId!=='string' || !b.sourceRoleId || b.sourceRoleId.length>200 || [b.sourceToken,b.targetToken].some(t=>typeof t!=='string'||!t||t.length>16384) || (b.publish!==undefined && typeof b.publish!=='boolean') || (b.updatePublished!==undefined && typeof b.updatePublished!=='boolean') || (b.recreateMissing!==undefined && typeof b.recreateMissing!=='boolean'))throw new HttpError(400,'sync_proof_required');
 const sourceProvider=requireConfigured(c.env,parseProvider(b.sourceProvider));
 const targetProvider=requireConfigured(c.env,parseProvider(b.targetProvider));
 const profile=await memberProfile(c.env.DB,member.id);
 const identity=async(provider:ProviderId,token:string)=> {
  try{return await upstream.fetchMe(c.env,token,provider);}
  catch(e){throw new HttpError(e instanceof HttpError?e.status:502,e instanceof HttpError&&e.status===401?'sync_authorization_expired':'sync_identity_failed',{provider,step:'identity'});}
 };
 const source=await identity(sourceProvider,b.sourceToken);
 const target=await identity(targetProvider,b.targetToken);
 for(const [provider,account] of [[sourceProvider,source.accountNumId],[targetProvider,target.accountNumId]] as const) {
  if(!profile?.identities.some(x=>x.provider===provider&&x.externalId===account))throw new HttpError(403,'sync_account_not_connected');
 }
 const result=await syncCard(c.env,{memberId:member.id,sourceProvider,sourceRoleId:b.sourceRoleId,sourceAccount:source.accountNumId,sourceToken:b.sourceToken,targetProvider,targetAccount:target.accountNumId,targetToken:b.targetToken,publish:b.publish===true,updatePublished:b.updatePublished===true,recreateMissing:b.recreateMissing===true});
 note(c,{event:'card_sync',detail:result.status});
 return c.json(result,200,{'Cache-Control':'no-store'});
});
app.get('/v1/me/card-copies/:roleId',async(c)=>{
 const member=await requireMember(c);const provider=providerOf(c);const bearer=c.req.header('Authorization')!.slice(7);
 // Ownership is checked by the upstream even for a card not registered in the community.
 const r=await fetch(`${providerApiBase(c.env,provider)}/open/v1/role/detail?roleId=${encodeURIComponent(c.req.param('roleId'))}`,{headers:{Authorization:`Bearer ${bearer}`},signal:AbortSignal.timeout(20000)});
 if(!r.ok)throw new HttpError(404,'card not found');const role=await r.json() as {accountNumId:number};
 if(role.accountNumId!==member.externalId)throw new HttpError(403,'not the author of this card');
 return c.json({copies:await copiesFor(c.env.DB,provider,c.req.param('roleId'))},200,{'Cache-Control':'no-store'});
});
app.get('/v1/cards/:roleId/platforms',async(c)=>{
 const provider=providerOf(c);const roleId=c.req.param('roleId');
 const base=await getCard(c.env.DB,roleId,provider);
 if(!base||base.status!=='approved')throw new HttpError(404,'card not registered');
 if(base.nsfw && !await viewerAllowsNsfw(c))throw new HttpError(403,'nsfw_gated');
 if(base.approved_version_id && base.approved_hosted_role_id) {
  const decision=await hostingDecision(c.env.DB,base.approved_version_id);
  return c.json({platforms:decision.status==='approved'?[{provider:base.provider,roleId:base.approved_hosted_role_id,playable:hasChat(base.provider as ProviderId)}]:[]},200,{'Cache-Control':'no-store'});
 }
 const candidates=[{provider,roleId},...(await copiesFor(c.env.DB,provider,roleId)).filter(x=>x.roleId && ['source','synced','pending','published'].includes(x.status)).map(x=>({provider:x.provider as ProviderId,roleId:x.roleId as string}))];
 const platforms=[];
 for(const x of candidates.filter((x,i,all)=>all.findIndex(y=>y.provider===x.provider&&y.roleId===x.roleId)===i)) {try {await upstream.fetchRole(c.env,x.roleId,x.provider);platforms.push({...x,playable:hasChat(x.provider)});}catch{ /* Never advertise an inaccessible copy as playable. */ }}
 return c.json({platforms},200,{'Cache-Control':'no-store'});
});

app.post('/v1/me/connections/preview', async (c) => {
  const member = await requireMember(c);
  const body = await c.req.json<{provider?: string; token?: string}>();
  if (!body || typeof body.provider !== 'string' || !body.provider.trim() || typeof body.token !== 'string' || !body.token || body.token.length > 16384) throw new HttpError(400, 'connection_proof_required');
  const provider = requireConfigured(c.env, parseProvider(body.provider));
  const target = await upstream.fetchMe(c.env, body.token, provider);
  const targetId = await connectedMemberId(c.env.DB, provider, target.accountNumId);
  const sourceProfile = (await memberProfile(c.env.DB, member.id))!;
  const targetProfile = targetId ? await memberProfile(c.env.DB, targetId) : null;
  if (targetId && targetId !== member.id) {
    if (!await emptyCommunity(c.env.DB,targetId)) throw new HttpError(409,'connection_target_not_empty');
    const drafts=await upstream.fetchMyRoles(c.env,body.token,1,1,provider);
    if (drafts.items.length || drafts.hasNext) throw new HttpError(409,'connection_target_not_empty');
  }
  const summary = (profile: typeof targetProfile) => profile ? {handle: profile.handle, memberSince: profile.memberSince} : null;
  return c.json({
    source: {...summary(sourceProfile), provider: member.provider, name: sourceProfile.displayName},
    target: {...summary(targetProfile), provider, name: target.nickName || PROVIDER_NAMES[provider]},
  }, 200, {'Cache-Control': 'no-store'});
});
app.post("/v1/me/connections", async (c) => {
  const member = await requireMember(c);
  const body = await c.req.json<{ provider?: string; token?: string; keepHandle?: string; sourceHandle?: string; targetHandle?: string | null }>();
  if (!body || typeof body.provider !== 'string' || !body.provider.trim() || typeof body.token !== 'string' || !body.token || body.token.length > 16384) throw new HttpError(400, 'connection_proof_required');
  const provider = requireConfigured(c.env, parseProvider(body.provider));
  const target = await upstream.fetchMe(c.env, body.token, provider);
  const targetId = await connectedMemberId(c.env.DB, provider, target.accountNumId);
  const sourceProfile = (await memberProfile(c.env.DB, member.id))!;
  const targetProfile = targetId ? await memberProfile(c.env.DB, targetId) : null;
  if (targetProfile && targetId !== member.id && !body.keepHandle) throw new HttpError(409, 'connection_choice_required');
  if (body.keepHandle && (body.sourceHandle !== sourceProfile.handle || body.targetHandle !== (targetProfile?.handle ?? null))) throw new HttpError(409, 'connection_preview_changed');
  if (body.keepHandle && body.keepHandle !== sourceProfile.handle) throw new HttpError(400, 'connection_choice_invalid');
  if(targetId && targetId!==member.id) {
    if(!await emptyCommunity(c.env.DB,targetId))throw new HttpError(409,'connection_target_not_empty');
    const drafts=await upstream.fetchMyRoles(c.env,body.token,1,1,provider);
    if(drafts.items.length || drafts.hasNext)throw new HttpError(409,'connection_target_not_empty');
  }
  await linkIdentity(c.env.DB, member, provider, target.accountNumId, Date.now());
  return c.json(await memberProfile(c.env.DB, member.id), 200, { 'Cache-Control': 'no-store' });
});
app.delete('/v1/me/connections/:provider', async (c) => {
  const member = await requireMember(c);
  await unlinkIdentity(c.env.DB, member, parseProvider(c.req.param('provider')));
  return c.json(await memberProfile(c.env.DB, member.id), 200, { 'Cache-Control': 'no-store' });
});

app.put("/v1/me/profile", bodyLimit({maxSize: 2 * 1024 * 1024 + 16384, onError: c => c.json({error:"avatar_invalid"},400)}), async c => {
  const member = await requireMember(c);
  const profile = await saveCommunityProfile(c.env, member.id, c.req.raw);
  return c.json({...profile, reviewer: await isReviewer(c.env.DB, member.id)}, 200, {"Cache-Control":"no-store"});
});

app.get('/v1/avatars/:handle/:file',async c=>{
 const handle=c.req.param('handle'), file=c.req.param('file');
 if(!/^[a-z]{8}$/.test(handle)||!/^[-a-f0-9]{36}\.webp$/.test(file))throw new HttpError(404,'avatar not found');
 const key=`${handle}/${file}`;
 if(!await c.env.DB.prepare('SELECT 1 FROM members WHERE handle=? AND avatar_key=?').bind(handle,key).first())throw new HttpError(404,'avatar not found');
 const image=await c.env.AVATARS?.get(key);
 if(!image)throw new HttpError(404,'avatar not found');
 return new Response(image.body,{headers:{'Content-Type':'image/webp','Cache-Control':'public, max-age=300','X-Content-Type-Options':'nosniff'}});
});

app.get("/v1/me", async (c) => {
  const member = await requireMember(c);
  const profile = await memberProfile(c.env.DB, member.id);
  if (!profile) throw new HttpError(404, "member not found");
  return c.json({ ...profile, reviewer: await isReviewer(c.env.DB, member.id) }, 200, { "Cache-Control": "no-store" });
});

/**
 * 本站的個人設定，兩樣，各自可單獨送：
 *   - showNsfw 成人內容開關。開要驗年齡：沒驗過要帶生日（YYYY-MM-DD）且滿 18；生日只看一眼、不落庫、不寫日誌。
 *     未滿 18 回 403 underage，什麼都不存。關只關開關，驗證留著。
 *   - hiddenTags 不想看的類型：完整清單（目錄鍵），整份換掉。
 * 兩樣都沒給回 400。已部署的舊客戶端只送 showNsfw，照樣能用。回應永遠是三樣齊的現況。
 */
app.post("/v1/me/settings", async (c) => {
  const member = await requireMember(c);
  const body = (await c.req.json().catch(() => ({}))) as { showNsfw?: unknown; birthdate?: unknown; hiddenTags?: unknown };
  if (typeof body.showNsfw !== "boolean" && body.hiddenTags === undefined) throw new HttpError(400, "showNsfw_required");
  let hiddenTags: string[];
  if (body.hiddenTags !== undefined) {
    hiddenTags = await updateMemberHiddenTags(c.env.DB, member.id, body.hiddenTags);
    note(c, { event: "settings", detail: "hidden_tags" });
  } else {
    hiddenTags = await memberHiddenTags(c.env.DB, member.id);
  }
  let nsfw: { showNsfw: boolean; ageVerified: boolean };
  if (typeof body.showNsfw === "boolean") {
    const birthdate = typeof body.birthdate === "string" ? body.birthdate : undefined;
    nsfw = await updateMemberNsfw(c.env.DB, member.id, { showNsfw: body.showNsfw, birthdate }, Date.now());
    note(c, { event: "settings", detail: nsfw.showNsfw ? "nsfw_on" : "nsfw_off" });
  } else {
    const current = await memberNsfw(c.env.DB, member.id);
    nsfw = { showNsfw: current.showNsfw && current.ageVerifiedAt !== null, ageVerified: current.ageVerifiedAt !== null };
  }
  return c.json({ ...nsfw, hiddenTags }, 200, { "Cache-Control": "no-store" });
});

/**
 * 沙箱卡的存檔（sdk.save.*）：舞台代作者腳本讀寫，每個成員每張卡最多 10 個 key、單值 64 KB。
 * 讀回整包（殼進頁時預載）；寫與刪各一個 key。錯誤碼：key_invalid、value_too_large、saves_full。
 */
app.get("/v1/me/cards/:roleId/saves", async (c) => {
  const member = await requireMember(c);
  const saves = await listSaves(c.env.DB, await saveMemberId(c.env.DB, member), c.req.param("roleId"));
  return c.json({ saves }, 200, { "Cache-Control": "no-store" });
});

app.put("/v1/me/cards/:roleId/saves/:key", async (c) => {
  const member = await requireMember(c);
  const body = (await c.req.json().catch(() => null)) as { value?: unknown } | null;
  if (!body || typeof body !== "object" || !("value" in body)) throw new HttpError(400, "value_required");
  await putSave(c.env.DB, await saveMemberId(c.env.DB, member), c.req.param("roleId"), c.req.param("key"), body.value, Date.now());
  note(c, { event: "card_save", detail: "set" });
  return c.json({ ok: true }, 200, { "Cache-Control": "no-store" });
});

app.delete("/v1/me/cards/:roleId/saves/:key", async (c) => {
  const member = await requireMember(c);
  await removeSave(c.env.DB, await saveMemberId(c.env.DB, member), c.req.param("roleId"), c.req.param("key"));
  note(c, { event: "card_save", detail: "remove" });
  return c.json({ ok: true }, 200, { "Cache-Control": "no-store" });
});

/**
 * 留言：本站自己的資料（src/comments.ts）。供應商不參與——哪一家登入的都是本站成員，
 * 同一張卡底下是同一串留言。讀不用登入；寫、讚、刪要登入。
 *
 * 成人內容的卡：留言區跟卡片頁同一道門，沒過門的人連留言也讀不到。
 */
async function commentViewer(c: Context<{ Bindings: Env; Variables: { ev: Pending } }>): Promise<Viewer> {
  if (!c.req.header("Authorization")) return { memberId: null, moderator: false };
  try {
    const member = await requireMember(c);
    return { memberId: member.id, moderator: await isReviewer(c.env.DB, member.id) };
  } catch (err) {
    // 讀留言不該因為 token 過期就整個失敗：當成訪客
    if (err instanceof HttpError && err.status === 401) return { memberId: null, moderator: false };
    throw err;
  }
}
async function commentCardFor(c: Context<{ Bindings: Env; Variables: { ev: Pending } }>) {
  const card = await commentCard(c.env.DB, c.req.param("id") ?? "");
  if (card.nsfw && !(await viewerAllowsNsfw(c))) throw new HttpError(403, "adult_content");
  return card;
}
const pageOf = (raw: string | undefined) => Math.min(500, Math.max(1, Math.floor(Number(raw)) || 1));

app.get("/v1/cards/:id/comments", async (c) => {
  const card = await commentCardFor(c);
  const res = await listTop(c.env.DB, card, await commentViewer(c), pageOf(c.req.query("page")));
  return c.json(res, 200, { "Cache-Control": "private, no-store" });
});

app.get("/v1/cards/:id/comments/count", async (c) => {
  const card = await commentCardFor(c);
  return c.json({ count: await countTop(c.env.DB, card.id) }, 200, { "Cache-Control": "private, no-store" });
});

app.get("/v1/cards/:id/comments/:rootId/replies", async (c) => {
  const card = await commentCardFor(c);
  const res = await listReplies(c.env.DB, card, c.req.param("rootId"), await commentViewer(c), pageOf(c.req.query("page")));
  return c.json(res, 200, { "Cache-Control": "private, no-store" });
});

app.post("/v1/cards/:id/comments", async (c) => {
  const member = await requireMember(c);
  const card = await commentCardFor(c);
  const body = (await c.req.json().catch(() => ({}))) as { content?: unknown; parentId?: unknown; rootId?: unknown };
  const created = await postComment(c.env.DB, { card, memberId: member.id, content: body.content, parentId: body.parentId, rootId: body.rootId, now: Date.now() });
  note(c, { event: "comment_create", subject: card.id, detail: body.rootId || body.parentId ? "reply" : "root" });
  return c.json(created, 201);
});

app.delete("/v1/comments/:id", async (c) => {
  const member = await requireMember(c);
  await deleteComment(c.env.DB, c.req.param("id"), { memberId: member.id, moderator: await isReviewer(c.env.DB, member.id) }, Date.now());
  return c.body(null, 204);
});

app.put("/v1/comments/:id/like", async (c) => {
  const member = await requireMember(c);
  await setLike(c.env.DB, c.req.param("id"), member.id, true, Date.now());
  return c.body(null, 204);
});

app.delete("/v1/comments/:id/like", async (c) => {
  const member = await requireMember(c);
  await setLike(c.env.DB, c.req.param("id"), member.id, false, Date.now());
  return c.body(null, 204);
});

/**
 * 登記一張卡。
 *
 * 作者只送 roleId，內容一概不收——先確認這張卡真是他的，再由公開資料填滿所有欄位。
 *
 * 為什麼非得問上游一次：「這張卡是我寫的」這個事實只存在於上游，本地怎麼算都變不
 * 出來，任何在客戶端推導的方案都可偽造。但這不需要特權，轉發使用者自己授權的
 * token 就夠。
 */
app.post("/v1/cards", async (c) => {
  const bearer = c.req.header("Authorization")?.match(/^Bearer\s+(\S+)$/)?.[1] ?? "";
  const me = await requireAuthor(c);
  const body = (await c.req.json().catch(() => ({}))) as { roleId?: unknown; nsfw?: unknown; distribute?: unknown; operationId?: unknown };
  const roleId = typeof body.roleId === "string" ? body.roleId.trim() : "";
  if (!roleId) throw new HttpError(400, "roleId is required");
  // 作者提交時必須宣告是不是成人內容（owner 2026-09-08）；沒宣告不收
  if (typeof body.nsfw !== "boolean") throw new HttpError(400, "nsfw_required");
  const nsfw = body.nsfw;

  const provider = providerOf(c);
  const hosted = provider === "harbor" && !!c.env.HOSTING_SERVICE_KEY;
  const role = hosted ? await hostGateway.read(c.env,bearer,roleId) : await upstream.fetchRole(c.env, roleId, provider);
  if (role.authorNumId !== me.accountNumId) throw new HttpError(403, "not the author of this card");
  // 登記的人一定是成員：作者頁與卡片上的作者連結都靠成員的公開 ID
  const memberId = await resolveMember(c.env.DB, provider, me.accountNumId, Date.now());
  // 登記即分發：其他已登入渠道的 token 隨登記一起送來，登記成功後在背景同步過去（不等它）。
  const distribute: DistributeTarget[] = [];
  for (const item of Array.isArray(body.distribute) ? body.distribute : []) {
    const target = item as { provider?: unknown; token?: unknown };
    if (typeof target?.provider !== "string" || typeof target?.token !== "string" || !target.token || target.token.length > 16384) throw new HttpError(400, "sync_proof_required");
    const targetProvider = requireConfigured(c.env, parseProvider(target.provider));
    if (targetProvider !== provider) distribute.push({ provider: targetProvider, token: target.token });
  }
  // 榜單只收在本站建的卡。作者在主站建的卡不是這裡的東西——「我的卡片」也不會列它，
  // 這條是防直接打 API 的那一手。
  if (role.creationMethod !== CREATION_METHOD) throw new HttpError(403, "only cards created on this site can be listed");

  const mapped = await workFor(c.env.DB, provider, roleId);
  if (mapped && (mapped.source_provider !== provider || mapped.source_role_id !== roleId)) throw new HttpError(409, 'publication_use_original');

  // 每週額度（見 quota.ts）。已經在榜上的卡再送一次是「刷新」，不佔額度；
  // 這週登記過又撤掉的同一張卡再登也不佔——它已經算過了。
  const now = Date.now();
  const existing = await getCard(c.env.DB, roleId, provider);
  if (!existing) {
    const thisWeek = await registeredThisWeek(c.env.DB, me.accountNumId, now, provider);
    if (!thisWeek.has(`${provider}:${roleId}`) && thisWeek.size >= WEEKLY_LIMIT) {
      note(c, { event: "register", subject: roleId, detail: "quota" });
      throw new HttpError(403, "weekly_quota_exceeded");
    }
  }

  if (hosted) {
    if (!reviewEnabled(c.env)) throw new HttpError(503,"hosting_review_required");
    const operationId=typeof body.operationId==='string'?body.operationId:'';
    if(!/^[0-9a-f-]{36}$/i.test(operationId))throw new HttpError(400,'hosting_operation_required');
    const receipt=await submitHosted(c.env,{memberId,account:me.accountNumId,role,token:bearer,nsfw,operationId,now});
    const row=(await getCard(c.env.DB,roleId,provider))!;
    note(c,{event:"register",detail:"submitted"});
    return c.json({...toCard(row,lang(c)),status:row.status,versionId:receipt.versionId},existing?200:201,{'Cache-Control':'private, no-store'});
  }

  // 審核：作者提交＝同意本站用他自己的 token 讀一次整份設定，存成這張單的快照給審核人看
  // （前端在按下之前已經明說）。讀不到就整個提交失敗——審核人什麼都看不到，排進佇列也只是卡住。
  // 內容版本記的是公開指紋：排程同步匿名就能比對，過審後訪客看得到的東西變了就重審。
  // 沒開審核的部署退回「登記即上榜」。
  const reviewing = reviewEnabled(c.env);
  let contentHash = "";
  let settings: ReviewSettings | null = null;
  if (reviewing) {
    settings = await upstream.readForReview(c.env, bearer, roleId, provider);
    contentHash = await publicHash(role);
  }

  const { id, created } = await upsertCard(c.env.DB, role, now, { status: reviewing ? "pending" : "approved", provider, nsfw, recordRegistration: true });
  // 宣告跟著最新一次提交走；在榜的卡改了宣告視同內容變了（下面重審）
  const declarationChanged = !!existing && (existing.nsfw === 1) !== nsfw;
  if (existing && declarationChanged) await setCardNsfw(c.env.DB, id, nsfw);

  let detail = created ? "new" : "again";
  if (reviewing && settings) {
    // 在榜的卡再送一次只是刷新；被駁回、離榜重審、被收回授權的卡再送＝重新排隊。
    // 在榜但改了分級宣告：跟改內容一樣要重審，不能過審後把「成人」改成「一般」就直接生效。
    // 過過審的走重審（一章），從沒過過的走初審（兩章）。
    const current = existing?.status ?? "pending";
    if (created || current === "rejected" || current === "needs_review" || current === "unshared" || (current === "approved" && declarationChanged)) {
      const kind = existing?.reviewed_hash ? "re" : "first";
      if (!created) await setCardStatus(c.env.DB, id, kind === "re" ? "needs_review" : "pending");
      const sub = await createSubmission(c.env.DB, { cardId: id, provider, roleId, kind, contentHash, now, nsfw });
      await saveSnapshotStatement(c.env.DB, sub.id, settings, now).run();
      detail = created ? "submitted" : "resubmitted";
    } else if (current === "pending") {
      // 還在排隊：單子照舊；改了宣告的話 createSubmission 會把單上的宣告更新成最新的
      const sub = await createSubmission(c.env.DB, { cardId: id, provider, roleId, kind: existing?.reviewed_hash ? "re" : "first", contentHash, now, nsfw });
      // 還在排隊：快照換成最新送來的這一份，審核人看到的是作者現在的設定
      await c.env.DB.batch([
        saveSnapshotStatement(c.env.DB, sub.id, settings, now),
        c.env.DB.prepare("UPDATE review_submissions SET content_hash = ? WHERE id = ? AND status = 'pending'").bind(contentHash, sub.id),
      ]);
      detail = "queued";
    }
  }
  const row = await getCard(c.env.DB, id);
  note(c, { event: "register", subject: roleId, detail });
  if (distribute.length) {
    c.executionCtx.waitUntil(distributeCard(c.env, memberId, { provider, roleId, account: me.accountNumId, token: bearer }, distribute));
  }
  return c.json(row ? { ...toCard(row, lang(c)), status: row.status, distributing: distribute.map((t) => t.provider) } : { id }, created ? 201 : 200);
});

app.post('/v1/cards/:roleId/edit',async(c)=>{
 const me=await requireAuthor(c);
 if(providerOf(c)!=='harbor')throw new HttpError(400,'hosting_provider_unsupported');
 if(!c.env.HOSTING_SERVICE_KEY)throw new HttpError(503,'hosting_unavailable');
 const memberId=await resolveMember(c.env.DB,'harbor',me.accountNumId,Date.now());
 const result=await beginHostedEdit(c.env.DB,memberId,c.req.param('roleId'),Date.now());
 note(c,{event:'register',detail:result.resubmit?'review_superseded':'draft_edit'});
 return c.json(result,200,{'Cache-Control':'private, no-store'});
});

app.get('/v1/hosting/versions/:versionId/decision',async(c)=>{
 c.header('Cache-Control','no-store');
 return c.json(await hostingDecision(c.env.DB,c.req.param('versionId')));
});

// ---- 社群審核 ----------------------------------------------------------------
//
// 共享佇列、領取、蓋章。誰能審由 reviewers 表決定（初期站方手動登記，見 scripts/grant-reviewer.mjs）。
// 佇列與詳情都不帶作者身分（盲審）。詳情是作者送審當下本站替這張單存的快照，定案就刪；
// 同步開的重審單沒有快照（那時手上沒有作者的 token），審核人看的是變動後的公開資料。

app.get("/v1/review/me", async (c) => {
  const member = await requireMember(c);
  return c.json({ reviewer: await isReviewer(c.env.DB, member.id) }, 200, { "Cache-Control": "private, no-store" });
});

app.get("/v1/review/queue", async (c) => {
  const member = await requireReviewer(c);
  const items = await listQueue(c.env.DB, member.id, Date.now(), lang(c));
  note(c, { event: "review_queue", resultCount: items.length });
  return c.json({ items, claimTtlMs: 45 * 60 * 1000 }, 200, { "Cache-Control": "private, no-store" });
});

app.post("/v1/review/:id/claim", async (c) => {
  const member = await requireReviewer(c);
  // 審核人也是人：宣告為成人內容的單，要驗過年齡才能領。看的是驗證，不是展示開關——審核是職責，不是偏好。
  const pending = await getSubmission(c.env.DB, c.req.param("id"));
  if (pending.nsfw === 1 && (await memberNsfw(c.env.DB, member.id)).ageVerifiedAt === null) {
    throw new HttpError(403, "age_verification_required");
  }
  const s = await claimSubmission(c.env.DB, c.req.param("id"), member.id, Date.now());
  note(c, { event: "review_claim", subject: s.source_role_id });
  return c.json({ id: s.id, claimedAt: s.claimed_at });
});

app.post("/v1/review/:id/release", async (c) => {
  const member = await requireReviewer(c);
  await releaseSubmission(c.env.DB, c.req.param("id"), member.id);
  return c.body(null, 204);
});

app.post("/v1/review/:id/stamp", async (c) => {
  const member = await requireReviewer(c);
  const body = (await c.req.json().catch(() => ({}))) as { verdict?: unknown; note?: unknown };
  const verdict = body.verdict === "approve" || body.verdict === "reject" ? body.verdict : null;
  if (!verdict) throw new HttpError(400, "verdict must be approve or reject");
  const noteText = typeof body.note === "string" ? body.note : "";
  if (verdict === "reject" && !noteText.trim()) throw new HttpError(400, "a rejection needs a note for the author");
  const result = await stampSubmission(c.env.DB, { submissionId: c.req.param("id"), memberId: member.id, verdict, note: noteText, now: Date.now() });
  note(c, { event: "review_stamp", subject: result.submission.source_role_id, detail: verdict === "reject" ? "reject" : result.cardStatus === "approved" ? "approved" : "approve" });
  return c.json({
    id: result.submission.id,
    status: result.submission.status,
    cardStatus: result.cardStatus,
    stamps: { approve: result.approvals, required: result.required },
  });
});

/** 審核人讀整份設定。要先領著這張單：沒領就沒在看，不該讀得到別人的卡。 */
app.get("/v1/review/:id/detail", async (c) => {
  const member = await requireReviewer(c);
  const s = await getSubmission(c.env.DB, c.req.param("id"));

  if(s.status!=='pending'||s.claimed_by!==member.id||s.claimed_at===null||Date.now()-s.claimed_at>=CLAIM_TTL_MS)throw new HttpError(409,'claim this submission first');
  if(s.nsfw===1&&(await memberNsfw(c.env.DB,member.id)).ageVerifiedAt===null)throw new HttpError(403,'age_verification_required');
  let detail = await loadSnapshot(c.env.DB, s.id);
  if(!detail&&s.content_hash.startsWith('version:'))throw new HttpError(404,'snapshot not found');
  if (!detail) {
    // 沒有快照：同步發現公開資料變了而開的重審單。變的就是公開資料，審核人看現在的公開版本。
    const role = await upstream.fetchRole(c.env, s.source_role_id, s.provider as ProviderId);
    detail = {
      partial: true,
      document: {
        roleName: role.names.zh || role.names.en || role.names.ja || role.names.ko, roleDesc: role.summaries.zh || role.summaries.en || role.summaries.ja || role.summaries.ko,
        roleAvatar: role.avatarUrl ?? "", roleBackground: role.backgroundUrl ?? "", roleTag: JSON.stringify(role.tags),
        userName: "", roleDetailDesc: "", roleType: "", roleSex: "", roleSpeech: "", language: "", talkExample: "", roleOutputContract: "",
      },
      greetings: { welcome: role.welcome, alternates: [], prologue: [] },
      worldbook: null, worldbookAvailable: false,
      authorAsset: { rules: [], mountTrigger: "", mountLayer: "", pageMode: "classic", status: "", version: 0 },
      hashes: { card: "", welcome: "", worldbook: "", authorAsset: "", content: s.content_hash },
      costProfile: { personaChars: 0, worldbookEntryCount: 0, worldbookEnabledCount: 0, worldbookConstantCount: 0, worldbookChars: 0, worldbookConstantChars: 0, estimatedConstantTokens: 0, estimatedMaxTokens: 0 },
    };
  }
  // 盲審：作者的公開 ID 不進審核頁。快照本來就不含，這裡再擋一次——組快照的那一層換了實作也不會漏。
  delete detail.authorNumId;
  const stamps = await c.env.DB
    .prepare("SELECT verdict, note, created_at FROM review_stamps WHERE submission_id = ? ORDER BY created_at ASC")
    .bind(s.id)
    .all<{ verdict: string; note: string; created_at: number }>();
  note(c, { event: "review_detail", subject: s.source_role_id, detail: s.kind });
  return c.json(
    {
      submission: {
        id: s.id, kind: s.kind, status: s.status, contentHash: s.content_hash, submittedAt: s.submitted_at,
        nsfw: s.nsfw === 1,
        claimedByMe: s.claimed_by === member.id, required: STAMPS_REQUIRED[s.kind],
        stamps: stamps.results.map((st) => ({ verdict: st.verdict, note: st.note, at: st.created_at })),
      },
      card: { id: s.card_id, roleId: s.source_role_id },
      detail,
    },
    200,
    { "Cache-Control": "private, no-store" },
  );
});

/** 作者自己撤銷登記。這是作品離開榜單的唯一途徑。 */
app.delete("/v1/cards/:id", async (c) => {
  const me = await requireAuthor(c);
  await unregister(c.env.DB, c.req.param("id"), me.accountNumId, providerOf(c));
  note(c, { event: "unregister", subject: c.req.param("id") });
  return c.body(null, 204);
});

/**
 * 前端的事件回報。
 *
 * 只收服務端看不到的那幾件事：外連 CTA 點擊、分享走了哪條路、登入流程、前端錯誤。
 * 頁面瀏覽不走這裡——看榜單就會打 /v1/cards、看卡片就會打 /v1/cards/:id，那才是行為信號。
 *
 * 這是全站唯一不需要登入就能寫入的端點，所以三道門：同源、事件白名單、批量上限。
 * 任何一道沒過都靜默回 204——不給刷的人任何「我被擋了」的回饋，也不佔回應體頻寬。
 * 這裡的數字天生可偽造，只能看趨勢，永遠不進排序、榜單或結算。
 */
const BEACON_MAX = 20;

app.post("/v1/e", async (c) => {
  const origin = c.req.header("Origin");
  if (origin) {
    try {
      if (new URL(origin).host !== new URL(c.req.url).host) return c.body(null, 204);
    } catch {
      return c.body(null, 204);
    }
  }
  const body = (await c.req.json().catch(() => null)) as unknown;
  if (!Array.isArray(body)) return c.body(null, 204);
  const country = (c.req.raw.cf?.country as string) ?? "";
  const client = clientKind(c.req.header("User-Agent"));
  for (const raw of body.slice(0, BEACON_MAX)) {
    const item = (raw ?? {}) as Record<string, unknown>;
    const event = String(item.event ?? "");
    if (!BEACON_EVENTS.has(event)) continue;
    const detail = String(item.detail ?? "");
    emit(c.env, c.executionCtx, {
      event,
      from: surfaceOf(typeof item.from === "string" ? item.from : undefined),
      route: typeof item.route === "string" ? item.route : "",
      locale: typeof item.locale === "string" ? item.locale.slice(0, 16) : "",
      country,
      subject: safeSubject(item.subject),
      detail: BEACON_DETAILS.has(detail) ? detail : "",
      outcome: item.ok === false ? "error" : "ok",
      client: client === "bot" ? "bot" : "beacon",
    });
  }
  return c.body(null, 204);
});

/**
 * 有界並發。
 *
 * 開 limit 個工作者共用一個游標，各自取下一筆做完再取——所以慢的那幾筆不會拖住
 * 其他人，總時間趨近「總量 ÷ 並發數」而不是總量的線性和。
 *
 * 游標的 cursor++ 在 JS 的單執行緒事件迴圈裡是原子的，不需要鎖。
 */
async function pooled<T>(items: T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      await work(items[cursor++]!);
    }
  });
  await Promise.all(workers);
}

/**
 * 每小時同步一批：名稱、封面、作者資料與熱度信號都重新拉一次。
 * 作者在上游改了卡或換了圖，這裡下一輪自動跟上，不必回來重新登記。
 *
 * 並發而不是串行：每張卡要一次跨網域往返，串起來跑的話總時間隨卡量線性成長，
 * 撞到 Worker 的執行時間上限之後，那一批後面的卡整輪都不會同步——而且不會報錯，
 * 只是榜單悄悄停在舊值。並發上限刻意壓在個位數：目標是「明顯更快」，
 * 不是把上游打滿。
 */
/** Worker 一次執行最多 50 個對外請求（見 wrangler.toml SYNC_BATCH_SIZE 的說明）；留兩個餘裕。 */
const SUBREQUEST_BUDGET = 48;

export async function syncBatch(env: Env): Promise<{ ok: number; failed: number; delisted: number; ms: number }> {
  const started = Date.now();
  let spent = 0; // 這一輪已經用掉的子請求
  // 比對內容版本用的是同一次匿名讀取算出來的公開指紋，不多花子請求。
  const reviewing = reviewEnabled(env);
  const limit = Math.max(1, Math.min(Number(env.SYNC_BATCH_SIZE) || 50, SUBREQUEST_BUDGET));
  const batch = await dueForSync(env.DB, limit);
  // 已發布到另一家的副本：熱度加總（owner 2026-09-17）。一次查完整批，D1 也算子請求。
  const copies = await publishedCopiesFor(env.DB, batch);
  const concurrency = Math.max(1, Number(env.SYNC_CONCURRENCY) || 6);
  let ok = 0;
  let failed = 0;
  let delisted = 0;
  const now = Date.now();

  const writes: D1PreparedStatement[] = [];
  const authorsSeen = new Map<string, { provider: ProviderId; externalId: number }>();

  await pooled(batch, concurrency, async (row) => {
    try {
      const provider = row.provider as ProviderId;
      spent++;
      if(row.reviewed_hash.startsWith('version:')&&!row.approved_hosted_role_id){
        writes.push(env.DB.prepare('UPDATE cards SET last_synced_at=? WHERE id=?').bind(now,row.id));return;
      }
      const role = { ...(await upstream.fetchRole(env, row.approved_hosted_role_id ?? row.source_role_id, provider)) };
      const fingerprint = await publicHash(role);
      // 榜單只收在本站建的卡。登記那條路早就這樣擋，但規則之前登記進來的主站老卡還在榜上
      // （owner 2026-09-07：189 張要下架）——同步時看到來源不對就撤掉，之後也不會再有漏網的。
      // 讀得到但來源不對才撤；讀不到走下面的 catch，保留。
      if (!row.approved_version_id && role.creationMethod !== CREATION_METHOD) {
        writes.push(env.DB.prepare("DELETE FROM cards WHERE id = ?").bind(row.id));
        delisted++;
        console.log("delisted: not created on this site", { roleId: row.source_role_id, creationMethod: role.creationMethod });
        return;
      }
      // 副本的對話數加進來；預算內才抓，抓不到就這一輪少算它（下一輪再補）。
      for (const copy of copies.get(`${provider}:${row.source_role_id}`) ?? []) {
        if (spent >= SUBREQUEST_BUDGET) break;
        spent++;
        try {
          const twin = await upstream.fetchRole(env, copy.roleId, copy.provider);
          role.talkNum += twin.talkNum;
          role.followNum += twin.followNum;
        } catch {
          /* 副本暫時讀不到：來源的數字照樣寫 */
        }
      }
      writes.push(syncStatement(env.DB, row.id, row.talk_num, role, now));
      // 作者一定要有成員列（公開 ID 從那裡來）。0005 之前登記、之後沒再登入過的作者會缺——
      // 先記下來，迴圈外一次查、缺的併進同一批寫入（D1 呼叫也算子請求，迴圈裡逐張查會吃掉上游的額度）。
      authorsSeen.set(`${row.provider}:${role.authorNumId}`, { provider: row.provider as ProviderId, externalId: role.authorNumId });
      // 在榜的卡順手比對內容版本：作者過審後改了訪客看得到的東西就要重審（owner 2026-09-07）。
      // 指紋要在加總副本熱度之前算——它只看這張卡自己的公開欄位。
      // 舊版本綁的是供應商給的內容雜湊（沒有前綴）：那個比不了，這一輪改綁成公開指紋，不重審。
      // 過審前登記的舊卡 reviewed_hash 是空的：留在榜上不比對，等作者下次提交才綁上版本。
      if (!row.approved_version_id && reviewing && row.status === "approved" && row.reviewed_hash) {
        if (!row.reviewed_hash.startsWith(PUBLIC_HASH_PREFIX)) {
          writes.push(env.DB.prepare("UPDATE cards SET reviewed_hash = ? WHERE id = ?").bind(fingerprint, row.id));
        } else if (fingerprint !== row.reviewed_hash) {
          writes.push(...needsReviewStatements(env.DB, { cardId: row.id, provider: row.provider, roleId: row.source_role_id, contentHash: fingerprint, now }));
        }
      }
      ok++;
    } catch (err) {
      // 單張卡失敗不能拖垮整批（上游可能剛好在重啟）。下一輪它仍排在最前面。
      // 讀不到一律當成暫時性的（服務重啟、網路抖動都會這樣）：保留，下一輪重試。
      // 不因為一次讀不到就刪掉作者的登記——那個代價遠大於榜單短暫顯示舊資料。
      failed++;
      console.error("sync failed", { roleId: row.source_role_id, error: String(err) });
    }
  });

  // 缺成員列的作者補上（一次查詢；id 與公開 ID 在這裡產生，寫入併進下面那一批）。
  writes.push(...(await missingMemberStatements(env.DB, [...authorsSeen.values()], now)));

  // 一次寫完而不是邊抓邊寫：D1 是單寫者，一筆一個往返的話寫入會蓋掉並發抓取的收益。
  // 代價是整批一起成功或一起失敗——對同步來說可以接受，下一輪本來就會重跑。
  if (writes.length) await env.DB.batch(writes);

  return { ok, failed, delisted, ms: Date.now() - started };
}

/**
 * 卡片頁與作者頁的 HTML：把分享預覽寫進 <head>，其餘照 SPA 的 index.html。
 *
 * 只有 wrangler.toml 裡 run_worker_first 列出的路徑會進到這裡；其他路徑直接由
 * 靜態資源層回應，不經過 Worker。找不到的卡回 404 狀態，但內容仍是 index.html——
 * 前端會畫自己的 404 頁，而抓取器與搜尋引擎得到正確的狀態碼。
 */
const PAGE = /^(?:\/(zh-Hans|en|ja|ko))?\/(cards|authors)\/([^/]+)$/;
const SITE_NAME = "Hearthroom";
const PAGE_TTL = 60;

/**
 * 靜態檔：先問資源層（當前版），找不到才回退到 ASSET_ARCHIVE（舊部署的 hash 檔，deploy 時歸檔、30 天到期）。
 *
 * 為什麼要有這一層：頁面按路由懶載入，每次部署 hash 都變，資源層只留當前版。部署前就開著的分頁
 * 點到還沒載入的頁面就拿到 404，路由靜默失敗，使用者看到的是「按鈕沒反應」。hash 檔的內容永遠不變，
 * 把舊的給舊頁面是安全的；index.html 不進歸檔，新開與重新整理永遠是當前版。
 */
app.get("/assets/*", async (c) => {
  const current = await c.env.ASSETS.fetch(c.req.raw);
  // 資源層配了 single-page-application：找不到檔不是 404，是 200 的 index.html。對 /assets/* 來說
  // 那就是「找不到」——一份 HTML 冒充 JS 正是瀏覽器報 dynamically imported module 失敗的原因。
  const missing = current.status === 404 || (current.headers.get("content-type") ?? "").includes("text/html");
  if (!missing) return current;
  const key = new URL(c.req.url).pathname;
  const archived = await c.env.ASSET_ARCHIVE.getWithMetadata<{ contentType?: string }>(key, "arrayBuffer");
  // 兩邊都沒有：回真正的 404，別再把 index.html 當 JS 交出去
  if (!archived.value) return new Response("not found", { status: 404 });
  note(c, { event: "asset_archive_hit" });
  return new Response(archived.value, {
    headers: {
      "content-type": archived.metadata?.contentType ?? "application/octet-stream",
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
});

app.get("*", async (c) => {
  const url = new URL(c.req.url);
  const m = url.pathname.match(PAGE);
  // 不是要注入的頁面就原樣交回資源層——靜態檔給檔案本身，其餘走它的 SPA 回退。
  // 一律回殼的話，/assets/x.js 會拿到一份 HTML，整站直接掛。
  if (!m) {
    const passthrough = await c.env.ASSETS.fetch(c.req.raw);
    note(c, { event: "page_html", refHost: refHostOf(c.req.header("Referer"), url.host), detail: "page" });
    return passthrough;
  }
  // 用 "/" 而不是 "/index.html"：資源層預設會把後者 301 到前者。
  // 不轉發原請求的 headers：If-None-Match 是對 /cards/x 那份內容的驗證器，拿去驗殼會拿到 304，
  // 卡改了名字也永遠回「沒變」。
  const shell = await c.env.ASSETS.fetch(new Request(new URL("/", url).toString()));
  if (!shell.ok) return shell;
  const locale = m[1] ?? "zh-Hant";
  const l = locale.startsWith("zh") ? "zh" : locale;
  const self = canonicalUrl(url);

  note(c, {
    event: "page_html",
    refHost: refHostOf(c.req.header("Referer"), url.host),
    locale,
    subject: m[3] ?? "",
    detail: m[2],
  });
  if (m[2] === "cards") {
    let id: string;
    try { id = decodeURIComponent(m[3]!); } catch { return new Response(shell.body, { status: 404, headers: shell.headers }); }
    const row = await getCard(c.env.DB, id);
    if (!row || row.status !== "approved") return new Response(shell.body, { status: 404, headers: shell.headers });
    // 成人內容不做分享預覽（抓取器沒有身分）：回沒有卡片資訊的殼，讓前端畫登入／驗年齡的門
    if (row.nsfw === 1) return new Response(shell.body, { status: 200, headers: shell.headers });
    const card = toCard(row, l);
    // 用卡號開的頁（/cards/123）：canonical 仍指卡片 ID 那個網址，一張卡在搜尋引擎眼裡只有一個地址
    const canonical = id === row.source_role_id ? self : canonicalUrl(new URL(url.pathname.replace(/[^/]+$/, encodeURIComponent(row.source_role_id)), url));
    const res = renderHead(shell, {
      lang: locale, title: `${card.name} · ${SITE_NAME}`, description: card.summary, image: card.avatarUrl, url: canonical, type: "profile",
    });
    res.headers.set("Cache-Control", `public, max-age=${PAGE_TTL}`);
    return res;
  }
  const memberId = await memberByHandle(c.env.DB, m[3]!);
  const author = memberId ? await getAuthor(c.env.DB, memberId) : null;
  if (!author) return new Response(shell.body, { status: 404, headers: shell.headers });
  const res = renderHead(shell, {
    lang: locale, title: `${author.author_name} · ${SITE_NAME}`, description: authorLine(locale, author.card_count, author.talk_total ?? 0), image: author.author_avatar || null, url: self, type: "profile",
  });
  res.headers.set("Cache-Control", `public, max-age=${PAGE_TTL}`);
  return res;
});

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(cleanAvatars(env));
    ctx.waitUntil(
      syncBatch(env).then((r) => {
        console.log("sync done", r);
        emit(env, ctx, { event: "sync", resultCount: r.ok, status: r.failed, durationMs: r.ms, client: "server", outcome: r.failed ? "partial" : "ok" });
      }),
    );
  },
};
