import { type Context, Hono } from "hono";
import {
  syncStatement,
  dueForSync,
  getAuthor,
  getCard,
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
import { ALIAS_HOSTS, HOST, canonicalUrl } from "./site";
import { loadMine, type MineFilter } from "./mine";
import { tagNamesFor } from "../shared/tag-catalog";
import { isReviewer, memberByHandle, memberProfile, missingMemberStatements, requireMember, requireReviewer, resolveMember } from "./members";
import { DEFAULT_PROVIDER, type ProviderId, reviewBotOf } from "./providers";
import { WEEKLY_LIMIT, recordRegistration, registeredThisWeek } from "./quota";
import {
  STAMPS_REQUIRED, claim as claimSubmission, createSubmission, getSubmission, listQueue, needsReviewStatements,
  release as releaseSubmission, stamp as stampSubmission,
} from "./review";
import { setCardStatus } from "./cards";
import { type Env, HttpError } from "./types";
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
    if (ev) ev.outcome = err.status === 404 ? "not_found" : err.status === 403 ? "forbidden" : err.status === 502 ? "upstream_error" : "rejected";
    return c.json({ error: err.message }, err.status);
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
  return await upstream.fetchMe(c.env, bearer);
}

app.get("/v1/health", (c) => c.json({ ok: true }));

/**
 * 前端開頁時問一次「上游該打哪個網域」。主網域在中國被擋，那邊的人改走備用網域；
 * 國別是 Cloudflare 邊緣看連線來源判的（`cf.country`；沒有就看它塞的標頭，測試環境走這條）。
 * 回應依來源而異，不能被任何一層快取。
 */
app.get("/v1/region", (c) => {
  const country = ((c.req.raw.cf?.country as string) || c.req.header("cf-ipcountry") || "").toUpperCase();
  const alt = c.env.LUNATALK_API_BASE_CN;
  const apiBase = country === "CN" && alt ? alt : c.env.LUNATALK_API_BASE;
  return c.json({ country, apiBase }, 200, { "Cache-Control": "no-store" });
});

/**
 * 圖片代抓，只給「匯出成 PNG 卡」用。
 *
 * 匯出要把設定寫進頭像那張 PNG 的 tEXt，所以前端得拿到圖的位元組；而上游的圖片主機沒開
 * CORS，瀏覽器直接 fetch 會被擋，前端只能退回存 JSON。走同源的這條路就沒有 CORS 問題。
 *
 * 只放行上游的圖片主機，不然這就是一個開放代理。回應用 Cache API 快取一天：同一張頭像
 * 被反覆匯出時不必每次都回上游拿。
 */
export const IMAGE_PROXY_HOSTS = new Set(["objects.lunatalk.ai", "cdn.lunatalk.ai"]);
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

/** 公開、只讀、對所有人一樣的回應，都走這個邊緣快取。 */
async function cachedJson(c: Context<{ Bindings: Env; Variables: { ev: Pending } }>, ttl: number, compute: () => Promise<unknown>) {
  const cache = await caches.open(boardCache.namespace);
  const hit = await cache.match(c.req.raw);
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
  c.executionCtx.waitUntil(cache.put(c.req.raw, stored));
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
  // 只有 GET 而且完全公開，所以整個 URL 就是快取鍵，不必自己組。推薦是隨機的，快取住就不隨機了。
  const cache = await caches.open(boardCache.namespace);
  const hit = c.req.query("sort") === "random" ? undefined : await cache.match(c.req.raw);
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
  const { sort, since, key: sortKey } = parseBoardSort(c.req.query("sort"));
  const offset = clamp(c.req.query("offset"), 0, 10_000);
  const limit = Math.max(1, clamp(c.req.query("limit"), 24, 100));
  // author 是作者的本站公開 ID（members.handle），不是上游的數字 ID。沒這個人就是空榜。
  const author = c.req.query("author");
  // 語區是榜單的必要條件，不帶就給中文——不做「全部語言混在一起」的總榜。
  // 兩個例外：作者主頁（看一個人的作品時語言不是篩選條件）、搜尋頁明說 zone=all。
  const zone = author ? undefined : parseZone(c.req.query("zone"));
  const authorMemberId = author ? ((await memberByHandle(c.env.DB, author)) ?? "") : undefined;

  const { rows, total, hasNext } = await listCards(c.env.DB, {
    zone,
    q: c.req.query("q")?.trim() || undefined,
    tags: (() => { const raw = c.req.query("tag")?.trim(); return raw ? (tagNamesFor(raw) ?? [raw]) : undefined; })(),
    authorMemberId,
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
  res.headers.set("Cache-Control", `public, max-age=${BOARD_TTL}`);
  res.headers.set("X-Cache", "miss");
  // 放進快取的副本不能帶 X-Cache: miss，否則下一個人會看到錯的標記。
  if (sort !== "random") {
    const stored = res.clone();
    stored.headers.set("X-Cache", "hit");
    c.executionCtx.waitUntil(cache.put(c.req.raw, stored));
  }
  return res;
});

/** 這一區最常見的標籤，給榜單的類型篩選列。標籤分佈變得慢，快取久一點。 */
app.get("/v1/tags", (c) =>
  cachedJson(c, 300, async () => ({
    items: await topTags(c.env.DB, parseZone(c.req.query("zone")), Math.max(1, clamp(c.req.query("limit"), 24, 60))),
  })),
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

app.get("/v1/cards/:id", async (c) => {
  const row = await getCard(c.env.DB, c.req.param("id"));
  // 還沒過審、被駁回、離榜重審中的卡對外都不存在；作者在「我的卡片」看得到狀態。
  if (!row || row.status !== "approved") throw new HttpError(404, "card not found");
  // 卡片瀏覽只在這裡記一次。HTML 殼那條路（page_html）多半是抓取器，卡片頁替作者發的
  // 「其他作品」副請求則是 /v1/cards?author=，兩者都不算一次瀏覽，否則分母會被灌水三倍。
  note(c, { event: "card_view", subject: row.source_role_id, zoneScope: "current" });
  return c.json(toCard(row, lang(c)));
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

  const me = await upstream.fetchMe(c.env, bearer);
  const { body, source } = await loadMine(c.env, bearer, me.accountNumId, { page, pageSize, fresh, filter });

  note(c, { event: "mine_view", resultCount: body.items.length, offset: (page - 1) * pageSize, detail: filter });
  c.header("X-Cache", source);
  // 這是私人資料：可以放進使用者自己的瀏覽器，但任何共用快取都不准碰。
  c.header("Cache-Control", "private, no-store");
  return c.json(body);
});

/** 作者主頁。這裡只認得他登記過的卡——本站看不到、也不該看到他的其他作品。 */
/**
 * 公開作者頁：網址是本站的公開 ID，不是上游的數字 ID。
 * 一個成員之後可能把卡關聯到多家供應商，作者頁把各家的卡合在一起看，並說明可以在哪些供應商遊玩。
 * 不是「由哪家提供」——卡是作者的，供應商只是能玩它的地方（owner 2026-09-08）。
 */
app.get("/v1/authors/:handle", async (c) => {
  const handle = c.req.param("handle");
  const memberId = await memberByHandle(c.env.DB, handle);
  const author = memberId ? await getAuthor(c.env.DB, memberId) : null;
  if (!author) throw new HttpError(404, "author has no registered cards");
  note(c, { event: "author_view", subject: handle, resultCount: author.card_count });
  return c.json({
    handle: author.handle,
    name: author.author_name,
    avatar: author.author_avatar,
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
app.get("/v1/me", async (c) => {
  const member = await requireMember(c);
  const profile = await memberProfile(c.env.DB, member.id);
  if (!profile) throw new HttpError(404, "member not found");
  return c.json({ ...profile, reviewer: await isReviewer(c.env.DB, member.id) }, 200, { "Cache-Control": "no-store" });
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
  const body = (await c.req.json().catch(() => ({}))) as { roleId?: unknown };
  const roleId = typeof body.roleId === "string" ? body.roleId.trim() : "";
  if (!roleId) throw new HttpError(400, "roleId is required");

  const role = await upstream.fetchRole(c.env, roleId);
  if (role.authorNumId !== me.accountNumId) throw new HttpError(403, "not the author of this card");
  // 登記的人一定是成員：作者頁與卡片上的作者連結都靠成員的公開 ID
  await resolveMember(c.env.DB, DEFAULT_PROVIDER, me.accountNumId, Date.now());
  // 榜單只收在本站建的卡。作者在主站建的卡不是這裡的東西——「我的卡片」也不會列它，
  // 這條是防直接打 API 的那一手。
  if (role.creationMethod !== CREATION_METHOD) throw new HttpError(403, "only cards created on this site can be listed");

  // 每週額度（見 quota.ts）。已經在榜上的卡再送一次是「刷新」，不佔額度；
  // 這週登記過又撤掉的同一張卡再登也不佔——它已經算過了。
  const now = Date.now();
  const existing = await getCard(c.env.DB, roleId);
  if (!existing) {
    const thisWeek = await registeredThisWeek(c.env.DB, me.accountNumId, now);
    if (!thisWeek.has(roleId) && thisWeek.size >= WEEKLY_LIMIT) {
      note(c, { event: "register", subject: roleId, detail: "quota" });
      throw new HttpError(403, "weekly_quota_exceeded");
    }
  }

  // 審核：作者提交＝把這張卡的「可閱讀詳情」授權給本站的審核機器人（用作者自己的 token，
  // 這是他的意思表示；前端在按下之前已經明說機器人能讀什麼），再記下提交當下的內容版本。
  // 授權失敗就整個提交失敗——沒有授權，審核人什麼都看不到，排進佇列也只是卡住。
  // 沒配機器人的部署退回「登記即上榜」。
  const bot = reviewBotOf(c.env);
  let contentHash = "";
  if (bot) {
    await upstream.grantShare(c.env, bearer, roleId, bot.accountNumId);
    contentHash = (await upstream.fetchContentHash(c.env, bot.key, roleId)).content;
  }

  const { id, created } = await upsertCard(c.env.DB, role, now, { status: bot ? "pending" : "approved", provider: DEFAULT_PROVIDER });
  if (created) await recordRegistration(c.env.DB, me.accountNumId, roleId, now);

  let detail = created ? "new" : "again";
  if (bot) {
    // 在榜的卡再送一次只是刷新；被駁回、離榜重審、被收回授權的卡再送＝重新排隊。
    // 過過審的走重審（一章），從沒過過的走初審（兩章）。
    const current = existing?.status ?? "pending";
    if (created || current === "rejected" || current === "needs_review" || current === "unshared") {
      const kind = existing?.reviewed_hash ? "re" : "first";
      if (!created) await setCardStatus(c.env.DB, id, kind === "re" ? "needs_review" : "pending");
      await createSubmission(c.env.DB, { cardId: id, provider: DEFAULT_PROVIDER, roleId, kind, contentHash, now });
      detail = created ? "submitted" : "resubmitted";
    } else if (current === "pending") {
      detail = "queued";
    }
  }
  const row = await getCard(c.env.DB, id);
  note(c, { event: "register", subject: roleId, detail });
  return c.json(row ? { ...toCard(row, lang(c)), status: row.status } : { id }, created ? 201 : 200);
});

// ---- 社群審核 ----------------------------------------------------------------
//
// 共享佇列、領取、蓋章。誰能審由 reviewers 表決定（初期站方手動登記，見 scripts/grant-reviewer.mjs）。
// 佇列與詳情都不帶作者身分（盲審）。詳情是本站的審核機器人拿自己的金鑰去主站讀作者授權過的
// 那份設定，轉給審核人；不落庫、不快取。

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
  const bot = reviewBotOf(c.env);
  if (!bot) throw new HttpError(503, "review bot is not configured");
  let detail: Record<string, unknown>;
  try {
    detail = await upstream.fetchSharedDetail(c.env, bot.key, s.source_role_id);
  } catch (err) {
    // 作者收回了授權：卡片離榜、單子作廢，審核人看到的是「作者已收回」而不是一個 401。
    // 但先確認是這張卡讀不到、不是機器人的金鑰壞了——金鑰壞了每張卡都 401，那不能拿來下架。
    if (err instanceof HttpError && err.status === 401) {
      try {
        await upstream.fetchMe(c.env, bot.key);
      } catch {
        throw new HttpError(503, "review bot key rejected by upstream");
      }
      await c.env.DB.batch([
        c.env.DB.prepare("UPDATE cards SET status = 'unshared' WHERE id = ?").bind(s.card_id),
        c.env.DB.prepare("UPDATE review_submissions SET status = 'rejected', decided_at = ?, note = 'unshared' WHERE id = ? AND status = 'pending'").bind(Date.now(), s.id),
      ]);
      throw new HttpError(409, "the author has revoked access to this card");
    }
    throw err;
  }
  // 盲審：作者的公開 ID 不進審核頁。上游客戶端已經拿掉一次，這裡再擋一次——兩層之間任何一層換了實作都不會漏。
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
  await unregister(c.env.DB, c.req.param("id"), me.accountNumId);
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
  let bot = reviewBotOf(env);
  // 先確認機器人的金鑰還活著（一個子請求）。金鑰被撤、換錯、帳號被停用時，上游對每張卡都回 401，
  // 不擋的話整輪會把所有綁了版本的卡當成「作者收回授權」全部下架——這一輪就不比對，只記一行。
  if (bot) {
    try {
      await upstream.fetchMe(env, bot.key);
    } catch (err) {
      console.error("review bot key rejected by upstream; skipping content checks this run", { error: String(err) });
      bot = null;
    }
  }
  // 有審核機器人時每張卡要打兩次上游（公開資料＋內容雜湊），一輪能處理的卡就減半，
  // 否則後半批全部撞到子請求上限、整輪靜默失敗。
  const perCard = bot ? 2 : 1;
  const budget = SUBREQUEST_BUDGET - (bot ? 1 : 0);
  const limit = Math.max(1, Math.min(Number(env.SYNC_BATCH_SIZE) || 50, Math.floor(budget / perCard)));
  const batch = await dueForSync(env.DB, limit);
  const concurrency = Math.max(1, Number(env.SYNC_CONCURRENCY) || 6);
  let ok = 0;
  let failed = 0;
  let delisted = 0;
  const now = Date.now();

  const writes: D1PreparedStatement[] = [];
  const authorsSeen = new Map<string, { provider: ProviderId; externalId: number }>();

  await pooled(batch, concurrency, async (row) => {
    try {
      const role = await upstream.fetchRole(env, row.source_role_id);
      // 榜單只收在本站建的卡。登記那條路早就這樣擋，但規則之前登記進來的主站老卡還在榜上
      // （owner 2026-09-07：189 張要下架）——同步時看到來源不對就撤掉，之後也不會再有漏網的。
      // 讀得到但來源不對才撤；讀不到走下面的 catch，保留。
      if (role.creationMethod !== CREATION_METHOD) {
        writes.push(env.DB.prepare("DELETE FROM cards WHERE id = ?").bind(row.id));
        delisted++;
        console.log("delisted: not created on this site", { roleId: row.source_role_id, creationMethod: role.creationMethod });
        return;
      }
      writes.push(syncStatement(env.DB, row.id, row.talk_num, role, now));
      // 作者一定要有成員列（公開 ID 從那裡來）。0005 之前登記、之後沒再登入過的作者會缺——
      // 先記下來，迴圈外一次查、缺的併進同一批寫入（D1 呼叫也算子請求，迴圈裡逐張查會吃掉上游的額度）。
      authorsSeen.set(`${row.provider}:${role.authorNumId}`, { provider: row.provider as ProviderId, externalId: role.authorNumId });
      // 在榜的卡順手比對內容版本：作者過審後改了卡就要重審（owner 2026-09-07）。
      // 過審前登記的舊卡 reviewed_hash 是空的，而且作者從沒授權過機器人——機器人讀不到它，
      // 讀不到不是「作者收回了」。這些卡留在榜上不比對，等作者下次提交時才授權並綁上版本。
      if (bot && row.status === "approved" && row.reviewed_hash) {
        try {
          const hashes = await upstream.fetchContentHash(env, bot.key, row.source_role_id);
          if (hashes.content !== row.reviewed_hash) {
            writes.push(...needsReviewStatements(env.DB, { cardId: row.id, provider: row.provider, roleId: row.source_role_id, contentHash: hashes.content, now }));
          }
        } catch (err) {
          // 作者收回了授權（上游 401/403）：離榜。其餘錯誤當暫時性的，下一輪再比。
          if (err instanceof HttpError && err.status === 401) {
            writes.push(env.DB.prepare("UPDATE cards SET status = 'unshared' WHERE id = ?").bind(row.id));
          }
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
    const card = toCard(row, l);
    const res = renderHead(shell, {
      lang: locale, title: `${card.name} · ${SITE_NAME}`, description: card.summary, image: card.avatarUrl, url: self, type: "profile",
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
    ctx.waitUntil(
      syncBatch(env).then((r) => {
        console.log("sync done", r);
        emit(env, ctx, { event: "sync", resultCount: r.ok, status: r.failed, durationMs: r.ms, client: "server", outcome: r.failed ? "partial" : "ok" });
      }),
    );
  },
};
