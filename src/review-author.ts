import { pickLocale, type Localized } from "./types";
import type { SubmissionKind } from "./review";

/**
 * 審核員看得到原作者（owner 2026-11-08：「第一件事要看到作者，如果看不到作者的話就不知道怎麼抓到……
 * 直接看到原作者就行」）。以前是盲審，佇列與審核頁都不帶作者；抓到一張盜卡卻查不到同一個人的其他卡，
 * 所以改成審核頁給作者的帳號身分，並能列出他所有的卡。
 *
 * 給的是 Harbor 帳號名稱、Harbor 公開的數字帳號 ID 與本站的 @代號；本站成員 ID（UUID）只在伺服器裡用來
 * 找「同一個人」，不進回應。作者自填的「原作者署名」是內容的一部分，不算身分。
 * 作者、玩家看到的東西都不變：這裡只給審核頁。
 */

export interface ReviewAuthor {
  /** Harbor 帳號名稱（卡片登記時同步來的） */
  name: string;
  /** 本站暱稱；跟帳號名稱一樣或沒設就是 null */
  communityName: string | null;
  /** 本站 @代號；作者還沒有本站成員列時是 null */
  handle: string | null;
  /** Harbor 公開的數字帳號 ID */
  accountNumId: number;
  avatar: string;
  /** 這位作者在本站登記過的卡數（含這張） */
  cardCount: number;
}

export interface AuthorCard {
  id: string;
  /** 未驗年齡的審核員看不到成人卡的名稱與封面，只看得到卡號與狀態 */
  name: string | null;
  coverUrl: string | null;
  adultHidden: boolean;
  status: string;
  publicBlocked: boolean;
  boardHidden: boolean;
  held: boolean;
  reReview: boolean;
  /** 審核人定案過幾次、其中幾次駁回（作者自己送的單；重新審核不算） */
  decided: number;
  rejected: number;
  /** 最近一張單（含重新審核）；沒有送審紀錄的舊卡是 null */
  latest: { id: string; status: string; submittedAt: number; decidedAt: number | null; reopen: boolean } | null;
  current: boolean;
}

/** 這張卡的作者是本站哪個成員（同一個人的所有身分都歸到他）。沒有成員列回 null。 */
const AUTHOR_OF_CARD = `SELECT c.provider, c.author_num_id, c.author_name, c.author_avatar,
    COALESCE(w.member_id, ac.owner_member_id, ai.member_id) AS member_id
  FROM cards c
  LEFT JOIN works w ON w.source_provider = c.provider AND w.source_role_id = c.source_role_id
  LEFT JOIN member_connections ac ON ac.provider = c.provider AND ac.external_id = CAST(c.author_num_id AS TEXT)
  LEFT JOIN member_identities ai ON ai.provider = c.provider AND ai.external_id = CAST(c.author_num_id AS TEXT)
  WHERE c.id = ?`;

/** 同一位作者的卡：這張卡的數字 ID，加上同一個成員在同一家供應商上的其他身分。 */
const SAME_AUTHOR = `c.provider = ?1 AND c.author_num_id IN (
    SELECT ?2
    UNION SELECT CAST(external_id AS INTEGER) FROM member_identities WHERE ?3 IS NOT NULL AND member_id = ?3 AND provider = ?1
    UNION SELECT CAST(external_id AS INTEGER) FROM member_connections WHERE ?3 IS NOT NULL AND owner_member_id = ?3 AND provider = ?1)`;

interface AuthorRow { provider: string; author_num_id: number; author_name: string; author_avatar: string; member_id: string | null }

async function authorRow(db: D1Database, cardId: string | number): Promise<AuthorRow | null> {
  return await db.prepare(AUTHOR_OF_CARD).bind(cardId).first<AuthorRow>();
}

export async function reviewAuthor(db: D1Database, cardId: string | number): Promise<ReviewAuthor | null> {
  const a = await authorRow(db, cardId);
  if (!a) return null;
  const member = a.member_id
    ? await db.prepare("SELECT handle, display_name, avatar_url FROM members WHERE id = ?").bind(a.member_id).first<{ handle: string; display_name: string | null; avatar_url: string }>()
    : null;
  const count = await db.prepare(`SELECT COUNT(*) AS n FROM cards c WHERE ${SAME_AUTHOR}`).bind(a.provider, a.author_num_id, a.member_id).first<{ n: number }>();
  const community = member?.display_name?.trim() || null;
  return {
    name: a.author_name,
    communityName: community && community !== a.author_name ? community : null,
    handle: member?.handle || null,
    accountNumId: a.author_num_id,
    avatar: (community ? member?.avatar_url : "") || a.author_avatar,
    cardCount: count?.n ?? 1,
  };
}

/** 作者的卡最多列這麼多張（最新登記的在前）；再多也只是同一個結論。 */
export const AUTHOR_CARDS_MAX = 100;

export async function authorCards(db: D1Database, cardId: string | number, opts: { lang: string; adultAllowed: boolean }): Promise<{ items: AuthorCard[]; total: number } | null> {
  const a = await authorRow(db, cardId);
  if (!a) return null;
  const rows = await db
    .prepare(
      `SELECT c.id, c.names, c.background_url AS cover, c.status, c.public_blocked, c.board_hidden, c.rating,
              EXISTS(SELECT 1 FROM review_holds h WHERE h.card_id = c.id) AS held,
              EXISTS(SELECT 1 FROM review_submissions r WHERE r.card_id = c.id AND r.status = 'pending' AND r.reopen_of IS NOT NULL) AS re_review,
              (SELECT COUNT(*) FROM review_submissions r WHERE r.card_id = c.id AND r.status IN ('approved', 'rejected') AND r.reopen_of IS NULL) AS decided,
              (SELECT COUNT(*) FROM review_submissions r WHERE r.card_id = c.id AND r.status = 'rejected' AND r.reopen_of IS NULL) AS rejected,
              (SELECT json_object('id', r.id, 'status', r.status, 'submittedAt', r.submitted_at, 'decidedAt', r.decided_at, 'reopen', r.reopen_of IS NOT NULL)
                 FROM review_submissions r WHERE r.card_id = c.id AND r.status <> 'superseded' ORDER BY r.submitted_at DESC, r.rowid DESC LIMIT 1) AS latest
       FROM cards c WHERE ${SAME_AUTHOR}
       ORDER BY c.registered_at DESC, c.id DESC LIMIT ?4`,
    )
    .bind(a.provider, a.author_num_id, a.member_id, AUTHOR_CARDS_MAX)
    .all<{ id: number; names: string; cover: string | null; status: string; public_blocked: number; board_hidden: number; rating: string | null; held: number; re_review: number; decided: number; rejected: number; latest: string | null }>();
  const total = (await db.prepare(`SELECT COUNT(*) AS n FROM cards c WHERE ${SAME_AUTHOR}`).bind(a.provider, a.author_num_id, a.member_id).first<{ n: number }>())?.n ?? rows.results.length;
  const items = rows.results.map((r): AuthorCard => {
    const hidden = r.rating === "R" && !opts.adultAllowed;
    const latest = r.latest ? (JSON.parse(r.latest) as { id: string; status: string; submittedAt: number; decidedAt: number | null; reopen: number }) : null;
    return {
      id: String(r.id),
      name: hidden ? null : pickLocale(JSON.parse(r.names) as Localized, opts.lang),
      coverUrl: hidden ? null : r.cover,
      adultHidden: hidden,
      status: r.status,
      publicBlocked: !!r.public_blocked,
      boardHidden: !!r.board_hidden,
      held: !!r.held,
      reReview: !!r.re_review,
      decided: r.decided,
      rejected: r.rejected,
      latest: latest ? { ...latest, reopen: !!latest.reopen } : null,
      current: String(r.id) === String(cardId),
    };
  });
  return { items, total };
}

/**
 * 送審類型（審核員 2026-11-08）：首次送審／過審後更新／被退回後再送，加上審核員發起的重新審核。
 * 不能看 kind 欄位：被駁回後重送的卡沒有過審版本，kind 仍是 first；kind 只決定要幾章。
 * 看這張單之前最近一次定案的結果：沒有→首次；駁回→退回後再送；通過→更新。
 * 同步開的舊卡重審單（kind re、之前沒有定案紀錄）也是更新。
 */
export type SubmissionType = "first" | "update" | "resubmit" | "reopen";
export function submissionType(s: { reopen_of: string | null; kind: SubmissionKind; previous: "approved" | "rejected" | null }): SubmissionType {
  if (s.reopen_of) return "reopen";
  if (s.previous === "rejected") return "resubmit";
  if (s.previous === "approved" || s.kind === "re") return "update";
  return "first";
}
