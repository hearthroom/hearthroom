import type { UpstreamRole, Zone } from "./upstream";
import { buildSearchText } from "./upstream";
import { HttpError, type Localized, pickLocale } from "./types";

export interface CardRow {
  id: string;
  source_role_id: string;
  zone: string;
  author_num_id: number;
  author_name: string;
  author_avatar: string;
  names: string;
  summaries: string;
  avatar_url: string | null;
  background_url: string | null;
  slug: string | null;
  tags: string;
  talk_num: number;
  follow_num: number;
  talk_num_prev: number;
  hot_score: number;
  registered_at: number;
  last_synced_at: number;
  /** 供應商代號（0004 起）。現在只有 lunatalk。 */
  provider: string;
  /** 審核狀態（0004 起）：pending / approved / rejected / needs_review / unshared。榜單只算 approved。 */
  status: string;
  /** 過審時綁上的內容雜湊；空字串＝過審前登記的舊卡，同步時第一次看到就綁上。 */
  reviewed_hash: string;
  /** 作者的本站公開 ID（members.handle，0005 起），從身分表接上來的；作者還沒成為成員時是 null。 */
  author_handle?: string | null;
  /** 成人內容（0006 起）：作者提交時宣告、審核人對照過的本站分級。預設不展示。 */
  nsfw: number;
}

/**
 * 卡片列表與單卡都把作者的本站公開 ID 接上來：對外的作者連結用它，不用上游的數字 ID。
 * LEFT JOIN——作者還沒有成員列（只在很早期登記過、還沒再登入）時 handle 是 null，前端把名字畫成純文字。
 */
const AUTHOR_JOIN = `LEFT JOIN member_identities ai ON ai.provider = c.provider AND ai.external_id = CAST(c.author_num_id AS TEXT)
  LEFT JOIN members am ON am.id = ai.member_id`;
const CARD_COLUMNS = "c.*, am.handle AS author_handle";

/** 對外露出的卡片只有在榜的。榜單、標籤、作者榜、卡片頁都走這個條件。 */
const LISTED = "status = 'approved'";
/**
 * 加上成人內容的門：沒開啟（或沒登入）的人只看得到一般內容。
 * 標籤列與作者榜永遠只算一般內容——它們走邊緣快取、對所有人一樣；只有榜單、卡片頁、單一作者頁有「開了才看得到」的版本。
 */
const listed = (allowNsfw: boolean) => (allowNsfw ? LISTED : `${LISTED} AND nsfw = 0`);

/** 回應按請求語言解析好名稱與簡介，同時附上原始多語，讓客戶端能自己切換。 */
export function toCard(row: CardRow, lang: string) {
  const names = JSON.parse(row.names) as Localized;
  const summaries = JSON.parse(row.summaries) as Localized;
  return {
    id: row.id,
    roleId: row.source_role_id,
    zone: row.zone,
    /** 這張卡支援哪家供應商（拿那家的帳號、用那家的 AI 服務在本站玩）。不是來源、不是由誰提供——卡是作者的。 */
    provider: row.provider,
    nsfw: row.nsfw === 1,
    name: pickLocale(names, lang),
    summary: pickLocale(summaries, lang),
    names,
    summaries,
    avatarUrl: row.avatar_url,
    backgroundUrl: row.background_url,
    slug: row.slug,
    tags: JSON.parse(row.tags) as string[],
    author: {
      handle: row.author_handle ?? null,
      accountNumId: row.author_num_id,
      name: row.author_name,
      avatar: row.author_avatar,
    },
    talkNum: row.talk_num,
    followNum: row.follow_num,
    trending: Math.max(0, row.hot_score),
    registeredAt: row.registered_at,
    syncedAt: row.last_synced_at,
  };
}

/** trigram 至少要 3 個字元才有 token 可比；更短的查詢只能掃 LIKE。 */
const FTS_MIN_CHARS = 3;
/** 包成 phrase，順便讓使用者輸入的 AND/OR/NEAR/* 失去 FTS 語法意義。 */
const ftsPhrase = (q: string) => `"${q.replace(/"/g, '""')}"`;
const likeTerm = (q: string) => `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;

export interface ListOptions {
  /** 語區。榜單永遠帶著；作者主頁不帶，列他所有語言的作品。 */
  zone?: Zone;
  q?: string;
  /** 標籤名字們（類型鍵展開後）；任一命中都算。 */
  tags?: string[];
  /** 作者頁：這個成員（本站 id）的卡 */
  authorMemberId?: string;
  /** relevance 只在有搜尋字時有意義；沒有搜尋字或走 LIKE 時退回 hot。 */
  /** 上榜時間下限（毫秒），日／週／月榜用。 */
  since?: number;
  sort: "hot" | "new" | "random" | "relevance";
  limit: number;
  offset: number;
  /** 不論審核狀態全列。只有作者看自己的「已登記」那一組用；對外的榜單永遠只列在榜的。 */
  anyStatus?: boolean;
  /** 看的人開了成人內容（且驗過年齡）；沒開就只列一般內容 */
  allowNsfw?: boolean;
}

export interface ListResult {
  rows: CardRow[];
  hasNext: boolean;
  /**
   * 未篩選時才給精確總數。
   *
   * 有篩選時 COUNT(*) 得把整組結果算出來才知道有幾筆——FTS MATCH 與 json_each 的
   * tag 過濾尤其貴，常常比排序本身還慢，而使用者其實只需要知道「還有沒有下一頁」。
   * 未篩選的那次是掃一個小索引，便宜，而那也正是「共 N 張」最有意義的場合。
   */
  total: number | null;
}

export async function listCards(db: D1Database, opts: ListOptions) {
  const where: string[] = opts.anyStatus ? ["1=1"] : [`c.${listed(!!opts.allowNsfw)}`];
  const binds: unknown[] = [];
  let from = "cards c";
  let usingFts = false;

  if (opts.zone) {
    where.push("c.zone IN (?, 'all')");
    binds.push(opts.zone);
  }
  if (opts.q) {
    if ([...opts.q].length >= FTS_MIN_CHARS) {
      usingFts = true;
      from = "cards_fts JOIN cards c ON c.rowid = cards_fts.rowid";
      where.push("cards_fts MATCH ?");
      binds.push(ftsPhrase(opts.q));
    } else {
      where.push(`c.search_text LIKE ? ESCAPE '\\'`);
      binds.push(likeTerm(opts.q));
    }
  }
  if (opts.tags?.length) {
    // 類型鍵展開成幾種語言的名字，任一命中都算；字面標籤就是一個名字
    where.push(`EXISTS (SELECT 1 FROM json_each(c.tags) WHERE json_each.value IN (${opts.tags.map(() => "?").join(",")}))`);
    binds.push(...opts.tags);
  }
  if (opts.since !== undefined) {
    // 日／週／月榜：只看上榜時間在窗口內的卡（owner 2026-09-07：時間是卡片上榜的那一刻）
    where.push("c.registered_at >= ?");
    binds.push(opts.since);
  }
  if (opts.authorMemberId !== undefined) {
    // 作者＝這個成員在任一家供應商上的身分
    where.push("ai.member_id = ?");
    binds.push(opts.authorMemberId);
  }

  const whereSql = where.join(" AND ");
  // hot 用「這個同步窗口的對話增量」，不是累積數——累積數等於 top，排出來永遠是老卡。
  // 三種排序都對應一個索引，沒有一種需要現算。
  // 相關度是 FTS 的 bm25（越小越相關），再用熱度打破平手。LIKE 那條路沒有相關度可言。
  // 榜的口徑照魅魔島：日／週／月榜與最熱都按累積對話數（窗口由 since 決定），最新按上榜時間，推薦隨機。
  // 舊的 hot_score（同步窗口增量）不再當排序鍵，只留給前端顯示「正在被聊」。
  const orderBy =
    opts.sort === "new"
      ? "c.registered_at DESC, c.id DESC"
      : opts.sort === "random"
        ? "RANDOM()"
        : opts.sort === "relevance" && usingFts
          ? "bm25(cards_fts), c.talk_num DESC"
          : "c.talk_num DESC, c.follow_num DESC, c.registered_at DESC";

  const filtered = Boolean(opts.q || opts.tags?.length || opts.authorMemberId !== undefined || opts.since !== undefined);

  // 多撈一筆就知道還有沒有下一頁，不必數完整組結果。
  const probe = await db
    .prepare(`SELECT ${CARD_COLUMNS} FROM ${from} ${AUTHOR_JOIN} WHERE ${whereSql} ORDER BY ${orderBy} LIMIT ? OFFSET ?`)
    .bind(...binds, opts.limit + 1, opts.offset)
    .all<CardRow>();

  const hasNext = probe.results.length > opts.limit;
  const rows = hasNext ? probe.results.slice(0, opts.limit) : probe.results;

  let total: number | null = null;
  if (!filtered) {
    // 語區條件走索引，數起來便宜；只有搜尋與標籤過濾才貴到不值得數。
    const counted = opts.zone
      ? await db.prepare(`SELECT COUNT(*) AS n FROM cards WHERE ${listed(!!opts.allowNsfw)} AND zone IN (?, 'all')`).bind(opts.zone).first<{ n: number }>()
      : await db.prepare(`SELECT COUNT(*) AS n FROM cards WHERE ${listed(!!opts.allowNsfw)}`).first<{ n: number }>();
    total = counted?.n ?? 0;
  } else if (!hasNext) {
    // 已經翻到最後一頁，總數就是走過的量，不必再問一次資料庫。
    total = opts.offset + rows.length;
  }

  return { rows, hasNext, total };
}

/**
 * 登記／更新一張卡。呼叫者的擁有關係由 index.ts 先跟上游確認過。
 *
 * 內容全部來自同步結果，作者送不進任何欄位——這是「登記完再偷換成別的東西」
 * 在結構上不可能發生的原因。
 */
export async function upsertCard(db: D1Database, role: UpstreamRole, now: number, opts: { status?: string; provider?: string; nsfw?: boolean } = {}) {
  const existing = await db
    .prepare("SELECT id, talk_num FROM cards WHERE source_role_id = ?")
    .bind(role.roleId)
    .first<{ id: string; talk_num: number }>();

  const shared = [
    role.zone,
    role.authorNumId,
    role.authorName,
    role.authorAvatar,
    JSON.stringify(role.names),
    JSON.stringify(role.summaries),
    role.avatarUrl,
    role.backgroundUrl,
    role.slug,
    JSON.stringify(role.tags),
    role.talkNum,
    role.followNum,
    buildSearchText(role),
    now,
  ];

  if (existing) {
    await db
      .prepare(
        `UPDATE cards SET zone=?, author_num_id=?, author_name=?, author_avatar=?, names=?, summaries=?,
           avatar_url=?, background_url=?, slug=?, tags=?, talk_num=?, follow_num=?, search_text=?,
           last_synced_at=?, talk_num_prev=?
         WHERE id=?`,
      )
      .bind(...shared, existing.talk_num, existing.id)
      .run();
    return { id: existing.id, created: false };
  }

  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO cards (id, source_role_id, zone, author_num_id, author_name, author_avatar, names, summaries,
         avatar_url, background_url, slug, tags, talk_num, follow_num, search_text, last_synced_at,
         talk_num_prev, registered_at, provider, status, nsfw)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    // 首次登記把 prev 設成當前值 → trending 從 0 起算。
    // 不這樣的話一張老熱卡剛登記就會用累積總量霸榜。
    .bind(id, role.roleId, ...shared, role.talkNum, now, opts.provider ?? "lunatalk", opts.status ?? "approved", opts.nsfw ? 1 : 0)
    .run();
  return { id, created: true };
}

/** 改審核狀態。只有審核流程（index.ts 的提交、review.ts 的蓋章、同步的比對）會叫它。 */
/** 作者再次提交時改了宣告。同步不碰這個欄位——分級是本站的事，不跟著供應商的資料走。 */
export async function setCardNsfw(db: D1Database, id: string, nsfw: boolean): Promise<void> {
  await db.prepare("UPDATE cards SET nsfw = ? WHERE id = ?").bind(nsfw ? 1 : 0, id).run();
}

export async function setCardStatus(db: D1Database, id: string, status: string): Promise<void> {
  await db.prepare("UPDATE cards SET status = ? WHERE id = ?").bind(status, id).run();
}

export async function getCard(db: D1Database, id: string) {
  return await db
    .prepare(`SELECT ${CARD_COLUMNS} FROM cards c ${AUTHOR_JOIN} WHERE c.id = ? OR c.source_role_id = ?`)
    .bind(id, id)
    .first<CardRow>();
}

/** 一個成員的公開作者頁：把他在各家供應商上、登記在本站且在榜的卡彙總。沒有在榜的卡就是 null。 */
export async function getAuthor(db: D1Database, memberId: string, allowNsfw = false) {
  const row = await db
    .prepare(
      `SELECT am.handle AS handle, MAX(c.author_name) AS author_name, MAX(c.author_avatar) AS author_avatar,
              COUNT(*) AS card_count, SUM(c.talk_num) AS talk_total, MIN(c.registered_at) AS joined_at,
              GROUP_CONCAT(DISTINCT c.provider) AS providers
       FROM cards c ${AUTHOR_JOIN}
       WHERE ai.member_id = ? AND c.${listed(allowNsfw)}`,
    )
    .bind(memberId)
    .first<{
      handle: string | null;
      author_name: string;
      author_avatar: string;
      card_count: number;
      talk_total: number;
      joined_at: number;
      providers: string | null;
    }>();
  if (!row || !row.card_count) return null;
  return { ...row, providers: (row.providers ?? "").split(",").filter(Boolean) };
}

export async function unregister(db: D1Database, roleId: string, authorNumId: number) {
  const row = await db
    .prepare("SELECT id, author_num_id FROM cards WHERE source_role_id = ? OR id = ?")
    .bind(roleId, roleId)
    .first<{ id: string; author_num_id: number }>();
  if (!row) throw new HttpError(404, "card not registered");
  if (row.author_num_id !== authorNumId) throw new HttpError(403, "not the author of this card");
  // 還在排隊的審核單一併作廢；蓋過章的紀錄留著（那是審核人做過的事，不隨卡片消失）。
  await db.batch([
    db.prepare("DELETE FROM review_submissions WHERE card_id = ? AND status = 'pending'").bind(row.id),
    db.prepare("DELETE FROM cards WHERE id = ?").bind(row.id),
  ]);
}

/** 排程同步挑最久沒更新的一批。帶著審核狀態與已過審的內容版本，同步順手比對內容有沒有變。 */
export async function dueForSync(db: D1Database, limit: number) {
  const rows = await db
    .prepare("SELECT id, source_role_id, talk_num, provider, status, reviewed_hash FROM cards ORDER BY last_synced_at ASC LIMIT ?")
    .bind(limit)
    .all<{ id: string; source_role_id: string; talk_num: number; provider: string; status: string; reviewed_hash: string }>();
  return rows.results;
}

/**
 * 同步回寫的語句：把上一輪的 talk_num 挪進 prev，趨勢窗口因此等於一個同步周期。
 *
 * 回傳語句而不是直接執行，呼叫端才能把整批塞進一次 db.batch()——D1 是單寫者，
 * 一筆一個往返的話寫入會變成整個同步的瓶頸（並發抓取反而幫不上忙）。
 */
export function syncStatement(db: D1Database, id: string, prevTalkNum: number, role: UpstreamRole, now: number) {
  return db
    .prepare(
      `UPDATE cards SET zone=?, author_name=?, author_avatar=?, names=?, summaries=?, avatar_url=?, background_url=?,
         slug=?, tags=?, talk_num=?, follow_num=?, search_text=?, talk_num_prev=?, last_synced_at=?
       WHERE id=?`,
    )
    .bind(
      role.zone,
      role.authorName,
      role.authorAvatar,
      JSON.stringify(role.names),
      JSON.stringify(role.summaries),
      role.avatarUrl,
      role.backgroundUrl,
      role.slug,
      JSON.stringify(role.tags),
      role.talkNum,
      role.followNum,
      buildSearchText(role),
      prevTalkNum,
      now,
      id,
    );
}


/**
 * 這位作者一共登記了幾張。
 *
 * 「已登記」不能靠掃上游那一頁來數：作者可能有一百多張卡，一頁只看得到二十幾張，
 * 數出來的是「這一頁裡有幾張」而不是「一共有幾張」。本站的 D1 才是登記這件事的權威。
 */
export async function countByAuthor(db: D1Database, authorNumId: number): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM cards WHERE author_num_id = ?")
    .bind(authorNumId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** 這批 roleId 裡，哪些已經登記在本站。永遠直接查庫，不快取——見 src/mine.ts 的說明。 */
export async function registeredAmong(db: D1Database, roleIds: string[]): Promise<Set<string>> {
  if (!roleIds.length) return new Set();
  const holes = roleIds.map(() => "?").join(",");
  const rows = await db
    .prepare(`SELECT source_role_id FROM cards WHERE source_role_id IN (${holes})`)
    .bind(...roleIds)
    .all<{ source_role_id: string }>();
  return new Set(rows.results.map((r) => r.source_role_id));
}

/**
 * 這一區最常見的標籤。榜單用它做「按類型看」的篩選列——標籤是作者自己打的，
 * 沒有固定分類表，所以「類型」就是大家實際在用的那些詞。
 */
export async function topTags(db: D1Database, zone: Zone | undefined, limit: number) {
  const where = zone ? `WHERE c.${listed(false)} AND c.zone IN (?, 'all')` : `WHERE c.${listed(false)}`;
  const binds: unknown[] = zone ? [zone, limit] : [limit];
  const rows = await db
    .prepare(
      `SELECT j.value AS tag, COUNT(*) AS n FROM cards c, json_each(c.tags) j ${where}
       GROUP BY j.value ORDER BY n DESC, tag LIMIT ?`,
    )
    .bind(...binds)
    .all<{ tag: string; n: number }>();
  return rows.results;
}

export interface AuthorRow {
  handle: string | null;
  author_num_id: number;
  author_name: string;
  author_avatar: string;
  card_count: number;
  talk_total: number;
  trending: number;
  joined_at: number;
}

/**
 * 作者榜：把這一區的卡按作者彙總。
 * 數字都是他登記在本站的作品加總，不是他在來源那邊的全部——本站看不到、也不該看到其他的。
 */
export async function listAuthors(
  db: D1Database,
  opts: { zone?: Zone; q?: string; sort: "talk" | "cards" | "hot"; limit: number; offset: number },
) {
  const where: string[] = [`c.${listed(false)}`];
  const binds: unknown[] = [];
  if (opts.zone) { where.push("c.zone IN (?, 'all')"); binds.push(opts.zone); }
  if (opts.q) { where.push(`c.author_name LIKE ? ESCAPE '\\'`); binds.push(likeTerm(opts.q)); }
  const orderBy =
    opts.sort === "cards" ? "card_count DESC, talk_total DESC" : opts.sort === "hot" ? "trending DESC, talk_total DESC" : "talk_total DESC, card_count DESC";
  const rows = await db
    .prepare(
      `SELECT am.handle AS handle, c.author_num_id, MAX(c.author_name) AS author_name, MAX(c.author_avatar) AS author_avatar,
              COUNT(*) AS card_count, SUM(c.talk_num) AS talk_total, SUM(MAX(c.hot_score, 0)) AS trending,
              MIN(c.registered_at) AS joined_at
       FROM cards c ${AUTHOR_JOIN} WHERE ${where.join(" AND ")}
       GROUP BY c.provider, c.author_num_id ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
    )
    .bind(...binds, opts.limit + 1, opts.offset)
    .all<AuthorRow>();
  const hasNext = rows.results.length > opts.limit;
  return { rows: hasNext ? rows.results.slice(0, opts.limit) : rows.results, hasNext };
}

export const toAuthor = (a: AuthorRow) => ({
  handle: a.handle ?? null,
  accountNumId: a.author_num_id,
  name: a.author_name,
  avatar: a.author_avatar,
  cardCount: a.card_count,
  talkTotal: a.talk_total ?? 0,
  trending: a.trending ?? 0,
  joinedAt: a.joined_at,
});
