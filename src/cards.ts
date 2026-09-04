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
}

/** 回應按請求語言解析好名稱與簡介，同時附上原始多語，讓客戶端能自己切換。 */
export function toCard(row: CardRow, lang: string) {
  const names = JSON.parse(row.names) as Localized;
  const summaries = JSON.parse(row.summaries) as Localized;
  return {
    id: row.id,
    roleId: row.source_role_id,
    zone: row.zone,
    name: pickLocale(names, lang),
    summary: pickLocale(summaries, lang),
    names,
    summaries,
    avatarUrl: row.avatar_url,
    backgroundUrl: row.background_url,
    slug: row.slug,
    tags: JSON.parse(row.tags) as string[],
    author: {
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
  tag?: string;
  authorNumId?: number;
  sort: "hot" | "new" | "top";
  limit: number;
  offset: number;
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
  const where: string[] = [];
  const binds: unknown[] = [];
  let from = "cards c";

  if (opts.zone) {
    where.push("c.zone IN (?, 'all')");
    binds.push(opts.zone);
  }
  if (opts.q) {
    if ([...opts.q].length >= FTS_MIN_CHARS) {
      from = "cards_fts JOIN cards c ON c.rowid = cards_fts.rowid";
      where.push("cards_fts MATCH ?");
      binds.push(ftsPhrase(opts.q));
    } else {
      where.push(`c.search_text LIKE ? ESCAPE '\\'`);
      binds.push(likeTerm(opts.q));
    }
  }
  if (opts.tag) {
    where.push("EXISTS (SELECT 1 FROM json_each(c.tags) WHERE json_each.value = ?)");
    binds.push(opts.tag);
  }
  if (opts.authorNumId !== undefined) {
    where.push("c.author_num_id = ?");
    binds.push(opts.authorNumId);
  }

  const whereSql = where.length ? where.join(" AND ") : "1=1";
  // hot 用「這個同步窗口的對話增量」，不是累積數——累積數等於 top，排出來永遠是老卡。
  // 三種排序都對應一個索引，沒有一種需要現算。
  const orderBy =
    opts.sort === "new"
      ? "c.registered_at DESC, c.id DESC"
      : opts.sort === "top"
        ? "c.talk_num DESC, c.follow_num DESC"
        : "c.hot_score DESC, c.registered_at DESC";

  const filtered = Boolean(opts.q || opts.tag || opts.authorNumId !== undefined);

  // 多撈一筆就知道還有沒有下一頁，不必數完整組結果。
  const probe = await db
    .prepare(`SELECT c.* FROM ${from} WHERE ${whereSql} ORDER BY ${orderBy} LIMIT ? OFFSET ?`)
    .bind(...binds, opts.limit + 1, opts.offset)
    .all<CardRow>();

  const hasNext = probe.results.length > opts.limit;
  const rows = hasNext ? probe.results.slice(0, opts.limit) : probe.results;

  let total: number | null = null;
  if (!filtered) {
    // 語區條件走索引，數起來便宜；只有搜尋與標籤過濾才貴到不值得數。
    const counted = opts.zone
      ? await db.prepare("SELECT COUNT(*) AS n FROM cards WHERE zone IN (?, 'all')").bind(opts.zone).first<{ n: number }>()
      : await db.prepare("SELECT COUNT(*) AS n FROM cards").first<{ n: number }>();
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
export async function upsertCard(db: D1Database, role: UpstreamRole, now: number) {
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
         talk_num_prev, registered_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    // 首次登記把 prev 設成當前值 → trending 從 0 起算。
    // 不這樣的話一張老熱卡剛登記就會用累積總量霸榜。
    .bind(id, role.roleId, ...shared, role.talkNum, now)
    .run();
  return { id, created: true };
}

export async function getCard(db: D1Database, id: string) {
  return await db
    .prepare("SELECT * FROM cards WHERE id = ? OR source_role_id = ?")
    .bind(id, id)
    .first<CardRow>();
}

export async function getAuthor(db: D1Database, authorNumId: number) {
  return await db
    .prepare(
      `SELECT author_num_id, author_name, author_avatar, COUNT(*) AS card_count,
              SUM(talk_num) AS talk_total, MIN(registered_at) AS joined_at
       FROM cards WHERE author_num_id = ?
       GROUP BY author_num_id, author_name, author_avatar`,
    )
    .bind(authorNumId)
    .first<{
      author_num_id: number;
      author_name: string;
      author_avatar: string;
      card_count: number;
      talk_total: number;
      joined_at: number;
    }>();
}

export async function unregister(db: D1Database, roleId: string, authorNumId: number) {
  const row = await db
    .prepare("SELECT id, author_num_id FROM cards WHERE source_role_id = ? OR id = ?")
    .bind(roleId, roleId)
    .first<{ id: string; author_num_id: number }>();
  if (!row) throw new HttpError(404, "card not registered");
  if (row.author_num_id !== authorNumId) throw new HttpError(403, "not the author of this card");
  await db.prepare("DELETE FROM cards WHERE id = ?").bind(row.id).run();
}

/** 排程同步挑最久沒更新的一批。 */
export async function dueForSync(db: D1Database, limit: number) {
  const rows = await db
    .prepare("SELECT id, source_role_id, talk_num FROM cards ORDER BY last_synced_at ASC LIMIT ?")
    .bind(limit)
    .all<{ id: string; source_role_id: string; talk_num: number }>();
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
