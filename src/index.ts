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
} from "./cards";
import {
  BEACON_DETAILS, BEACON_EVENTS, clientKind, emit, note, refHostOf, safeSubject, shapeTerm, surfaceOf,
  type EventFields, type Pending,
} from "./analytics";
import { authorLine, renderHead } from "./head";
import { HOST, LEGACY_HOSTS } from "./site";
import { loadMine, type MineFilter } from "./mine";
import { type Env, HttpError } from "./types";
import { upstream, ZONES, type Zone } from "./upstream";

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
  if (path === "/v1/e" || path === "/v1/health") return;
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
 * 搬家：舊主機來的一律 301 到新家，路徑、查詢字串、雜湊全部原樣帶過去。
 *
 * 掛在埋點中間件之後，所以這些請求照樣進報表（`legacy_redirect`），看得出還有多少人
 * 走舊網址進來——那個數字降到零之前，舊網域不能拔。
 *
 * 用 301 而不是 302：搜尋引擎才會把累積的排名轉過來，瀏覽器與抓取器也才會記住。
 */
app.use("*", async (c, next) => {
  const url = new URL(c.req.url);
  if (!LEGACY_HOSTS.includes(url.host)) return next();
  note(c, { event: "legacy_redirect", detail: url.host, refHost: c.req.header("Referer") ? new URL(c.req.header("Referer")!).host : "" });
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
app.get("/v1/cards", async (c) => {
  // 只有 GET 而且完全公開，所以整個 URL 就是快取鍵，不必自己組。
  const cache = await caches.open(boardCache.namespace);
  const hit = await cache.match(c.req.raw);
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
  const sortParam = c.req.query("sort");
  const sort = sortParam === "new" || sortParam === "top" || sortParam === "relevance" ? sortParam : "hot";
  const offset = clamp(c.req.query("offset"), 0, 10_000);
  const limit = Math.max(1, clamp(c.req.query("limit"), 24, 100));
  const author = c.req.query("author");
  // 語區是榜單的必要條件，不帶就給中文——不做「全部語言混在一起」的總榜。
  // 兩個例外：作者主頁（看一個人的作品時語言不是篩選條件）、搜尋頁明說 zone=all。
  const zone = author ? undefined : parseZone(c.req.query("zone"));

  const { rows, total, hasNext } = await listCards(c.env.DB, {
    zone,
    q: c.req.query("q")?.trim() || undefined,
    tag: c.req.query("tag")?.trim() || undefined,
    authorNumId: author ? Number(author) : undefined,
    sort,
    limit,
    offset,
  });
  const l = lang(c);
  const q = c.req.query("q")?.trim();
  // 搜尋與榜單是兩種行為，分開記；結果數只有這裡拿得到（total 有篩選時是 null，中間件讀不到）
  note(c, {
    event: q ? "search" : "list",
    sortKey: sort,
    tag: c.req.query("tag")?.trim() ?? "",
    term: q ? shapeTerm(q) : "",
    subject: author ?? "",
    zoneScope: c.req.query("zone") === "all" ? "all" : "current",
    resultCount: total ?? rows.length,
    offset,
    outcome: rows.length ? "ok" : "empty",
  });
  const res = c.json({ items: rows.map((r) => toCard(r, l)), total, hasNext, limit, offset, sort });
  res.headers.set("Cache-Control", `public, max-age=${BOARD_TTL}`);
  res.headers.set("X-Cache", "miss");
  // 放進快取的副本不能帶 X-Cache: miss，否則下一個人會看到錯的標記。
  const stored = res.clone();
  stored.headers.set("X-Cache", "hit");
  c.executionCtx.waitUntil(cache.put(c.req.raw, stored));
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
  if (!row) throw new HttpError(404, "card not found");
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
app.get("/v1/authors/:accountNumId", async (c) => {
  const id = Number(c.req.param("accountNumId"));
  if (!Number.isSafeInteger(id) || id <= 0) throw new HttpError(400, "invalid author id");
  const author = await getAuthor(c.env.DB, id);
  if (!author) throw new HttpError(404, "author has no registered cards");
  note(c, { event: "author_view", subject: String(id), resultCount: author.card_count });
  return c.json({
    accountNumId: author.author_num_id,
    name: author.author_name,
    avatar: author.author_avatar,
    cardCount: author.card_count,
    talkTotal: author.talk_total ?? 0,
    joinedAt: author.joined_at,
  });
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
  const me = await requireAuthor(c);
  const body = (await c.req.json().catch(() => ({}))) as { roleId?: unknown };
  const roleId = typeof body.roleId === "string" ? body.roleId.trim() : "";
  if (!roleId) throw new HttpError(400, "roleId is required");

  const role = await upstream.fetchRole(c.env, roleId);
  if (role.authorNumId !== me.accountNumId) throw new HttpError(403, "not the author of this card");

  const { id, created } = await upsertCard(c.env.DB, role, Date.now());
  const row = await getCard(c.env.DB, id);
  note(c, { event: "register", subject: roleId, detail: created ? "new" : "again" });
  return c.json(row ? toCard(row, lang(c)) : { id }, created ? 201 : 200);
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
async function syncBatch(env: Env): Promise<{ ok: number; failed: number; ms: number }> {
  const started = Date.now();
  const batch = await dueForSync(env.DB, Math.max(1, Number(env.SYNC_BATCH_SIZE) || 50));
  const concurrency = Math.max(1, Number(env.SYNC_CONCURRENCY) || 6);
  let ok = 0;
  let failed = 0;
  const now = Date.now();

  const writes: D1PreparedStatement[] = [];

  await pooled(batch, concurrency, async (row) => {
    try {
      const role = await upstream.fetchRole(env, row.source_role_id);
      writes.push(syncStatement(env.DB, row.id, row.talk_num, role, now));
      ok++;
    } catch (err) {
      // 單張卡失敗不能拖垮整批（上游可能剛好在重啟）。下一輪它仍排在最前面。
      // 讀不到一律當成暫時性的（服務重啟、網路抖動都會這樣）：保留，下一輪重試。
      // 不因為一次讀不到就刪掉作者的登記——那個代價遠大於榜單短暫顯示舊資料。
      failed++;
      console.error("sync failed", { roleId: row.source_role_id, error: String(err) });
    }
  });

  // 一次寫完而不是邊抓邊寫：D1 是單寫者，一筆一個往返的話寫入會蓋掉並發抓取的收益。
  // 代價是整批一起成功或一起失敗——對同步來說可以接受，下一輪本來就會重跑。
  if (writes.length) await env.DB.batch(writes);

  return { ok, failed, ms: Date.now() - started };
}

/**
 * 卡片頁與作者頁的 HTML：把分享預覽寫進 <head>，其餘照 SPA 的 index.html。
 *
 * 只有 wrangler.toml 裡 run_worker_first 列出的路徑會進到這裡；其他路徑直接由
 * 靜態資源層回應，不經過 Worker。找不到的卡回 404 狀態，但內容仍是 index.html——
 * 前端會畫自己的 404 頁，而抓取器與搜尋引擎得到正確的狀態碼。
 */
const PAGE = /^(?:\/(zh-Hans|en|ja|ko))?\/(cards|authors)\/([^/]+)$/;
const SITE_NAME = "Taproom";
const PAGE_TTL = 60;

app.get("*", async (c) => {
  const url = new URL(c.req.url);
  // 用 "/" 而不是 "/index.html"：資源層預設會把後者 301 到前者。
  // 不轉發原請求的 headers：If-None-Match 是對 /cards/x 那份內容的驗證器，拿去驗殼會拿到 304，
  // 卡改了名字也永遠回「沒變」。
  const shell = await c.env.ASSETS.fetch(new Request(new URL("/", url).toString()));
  const m = url.pathname.match(PAGE);
  if (!m || !shell.ok) return shell;
  const locale = m[1] ?? "zh-Hant";
  const l = locale.startsWith("zh") ? "zh" : locale;
  const self = url.origin + url.pathname;

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
    if (!row) return new Response(shell.body, { status: 404, headers: shell.headers });
    const card = toCard(row, l);
    const res = renderHead(shell, {
      lang: locale, title: `${card.name} · ${SITE_NAME}`, description: card.summary, image: card.avatarUrl, url: self, type: "profile",
    });
    res.headers.set("Cache-Control", `public, max-age=${PAGE_TTL}`);
    return res;
  }
  const author = await getAuthor(c.env.DB, Number(m[3]));
  if (!author) return new Response(shell.body, { status: 404, headers: shell.headers });
  const a = toAuthor({ ...author, trending: 0 });
  const res = renderHead(shell, {
    lang: locale, title: `${a.name} · ${SITE_NAME}`, description: authorLine(locale, a.cardCount, a.talkTotal), image: a.avatar || null, url: self, type: "profile",
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
