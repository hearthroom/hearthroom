import { Hono } from "hono";
import {
  applySync,
  dueForSync,
  getAuthor,
  getCard,
  listCards,
  toCard,
  unregister,
  upsertCard,
} from "./cards";
import { loadMine } from "./mine";
import { type Env, HttpError } from "./types";
import { upstream } from "./upstream";

const app = new Hono<{ Bindings: Env }>();

app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.message }, err.status);
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

/** 榜單與搜尋。匿名可讀。 */
app.get("/v1/cards", async (c) => {
  // 只有 GET 而且完全公開，所以整個 URL 就是快取鍵，不必自己組。
  const cache = await caches.open(boardCache.namespace);
  const hit = await cache.match(c.req.raw);
  if (hit) {
    const res = new Response(hit.body, hit);
    res.headers.set("X-Cache", "hit");
    return res;
  }
  const sortParam = c.req.query("sort");
  const sort = sortParam === "new" || sortParam === "top" ? sortParam : "hot";
  const offset = clamp(c.req.query("offset"), 0, 10_000);
  const limit = Math.max(1, clamp(c.req.query("limit"), 24, 100));
  const author = c.req.query("author");

  const { rows, total, hasNext } = await listCards(c.env.DB, {
    q: c.req.query("q")?.trim() || undefined,
    tag: c.req.query("tag")?.trim() || undefined,
    authorNumId: author ? Number(author) : undefined,
    sort,
    limit,
    offset,
  });
  const l = lang(c);
  const res = c.json({ items: rows.map((r) => toCard(r, l)), total, hasNext, limit, offset, sort });
  res.headers.set("Cache-Control", `public, max-age=${BOARD_TTL}`);
  res.headers.set("X-Cache", "miss");
  // 放進快取的副本不能帶 X-Cache: miss，否則下一個人會看到錯的標記。
  const stored = res.clone();
  stored.headers.set("X-Cache", "hit");
  c.executionCtx.waitUntil(cache.put(c.req.raw, stored));
  return res;
});

app.get("/v1/cards/:id", async (c) => {
  const row = await getCard(c.env.DB, c.req.param("id"));
  if (!row) throw new HttpError(404, "card not found");
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

  const me = await upstream.fetchMe(c.env, bearer);
  const { body, source } = await loadMine(c.env, bearer, me.accountNumId, { page, pageSize, fresh });

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
  return c.json(row ? toCard(row, lang(c)) : { id }, created ? 201 : 200);
});

/** 作者自己撤銷登記。這是作品離開榜單的唯一途徑。 */
app.delete("/v1/cards/:id", async (c) => {
  const me = await requireAuthor(c);
  await unregister(c.env.DB, c.req.param("id"), me.accountNumId);
  return c.body(null, 204);
});

/**
 * 每小時同步一批：名稱、封面、作者資料與熱度信號都重新拉一次。
 * 作者在上游改了卡或換了圖，這裡下一輪自動跟上，不必回來重新登記。
 */
async function syncBatch(env: Env): Promise<{ ok: number; failed: number }> {
  const batch = await dueForSync(env.DB, Math.max(1, Number(env.SYNC_BATCH_SIZE) || 50));
  let ok = 0;
  let failed = 0;
  const now = Date.now();
  for (const row of batch) {
    try {
      const role = await upstream.fetchRole(env, row.source_role_id);
      await applySync(env.DB, row.id, row.talk_num, role, now);
      ok++;
    } catch (err) {
      // 單張卡失敗不能拖垮整批（上游可能剛好在重啟）。下一輪它仍排在最前面。
      // 讀不到一律當成暫時性的（服務重啟、網路抖動都會這樣）：保留，下一輪重試。
      // 不因為一次讀不到就刪掉作者的登記——那個代價遠大於榜單短暫顯示舊資料。
      failed++;
      console.error("sync failed", { roleId: row.source_role_id, error: String(err) });
    }
  }
  return { ok, failed };
}

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      syncBatch(env).then((r) => console.log("sync done", r)),
    );
  },
};
