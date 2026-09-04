import type { UpstreamRole } from "./upstream";
import { buildSearchText } from "./upstream";
import { HttpError, type Localized, pickLocale } from "./types";

export interface CardRow {
  id: string;
  source_role_id: string;
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
    trending: Math.max(0, row.talk_num - row.talk_num_prev),
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
  q?: string;
  tag?: string;
  authorNumId?: number;
  sort: "hot" | "new" | "top";
  limit: number;
  offset: number;
}

export async function listCards(db: D1Database, opts: ListOptions) {
  const where: string[] = [];
  const binds: unknown[] = [];
  let from = "cards c";

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
  const orderBy =
    opts.sort === "new"
      ? "c.registered_at DESC, c.id DESC"
      : opts.sort === "top"
        ? "c.talk_num DESC, c.follow_num DESC"
        : "(c.talk_num - c.talk_num_prev) DESC, c.registered_at DESC";

  const [items, total] = await Promise.all([
    db
      .prepare(`SELECT c.* FROM ${from} WHERE ${whereSql} ORDER BY ${orderBy} LIMIT ? OFFSET ?`)
      .bind(...binds, opts.limit, opts.offset)
      .all<CardRow>(),
    db.prepare(`SELECT COUNT(*) AS n FROM ${from} WHERE ${whereSql}`).bind(...binds).first<{ n: number }>(),
  ]);

  return { rows: items.results, total: total?.n ?? 0 };
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
        `UPDATE cards SET author_num_id=?, author_name=?, author_avatar=?, names=?, summaries=?,
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
      `INSERT INTO cards (id, source_role_id, author_num_id, author_name, author_avatar, names, summaries,
         avatar_url, background_url, slug, tags, talk_num, follow_num, search_text, last_synced_at,
         talk_num_prev, registered_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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

/** 同步回寫：把上一輪的 talk_num 挪進 prev，趨勢窗口因此等於一個同步周期。 */
export async function applySync(db: D1Database, id: string, prevTalkNum: number, role: UpstreamRole, now: number) {
  await db
    .prepare(
      `UPDATE cards SET author_name=?, author_avatar=?, names=?, summaries=?, avatar_url=?, background_url=?,
         slug=?, tags=?, talk_num=?, follow_num=?, search_text=?, talk_num_prev=?, last_synced_at=?
       WHERE id=?`,
    )
    .bind(
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
    )
    .run();
}

