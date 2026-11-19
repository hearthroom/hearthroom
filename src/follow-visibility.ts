import { HttpError } from "./types";

/**
 * 作者主頁的關注／粉絲可見度（任務 2026-11-19-profile-visibility）。
 *
 * - 作品數、被聊過一律公開，不在這裡。
 * - 關注：list（數字＋他人可開名單）／count（只有數字）／hidden（連數字都不回）。
 * - 粉絲：list／count；粉絲數不能藏。
 *
 * 名單規則：一條關注 A→B 只有在 A 的關注＝list 且 B 的粉絲＝list 時才公開——同一條件同時決定它
 * 出不出現在 A 的關注名單與 B 的粉絲名單。A 把關注設成不公開，卻從 B 的粉絲名單被看到，等於設定沒用。
 * 作者看自己的粉絲名單時，作者自己的設定不算，但粉絲那一方仍要是 list（同一個理由）。
 * 人數永遠是真實的總數；沒列出的差額另外回 unlisted，讓畫面說明「另有 N 位未公開」，而不是像壞掉。
 *
 * 可見度與人數都在快取之外即時讀：作者頁快照與作者榜快取有五分鐘，剛改成隱藏的數字不能再被送出去。
 */
export const FOLLOWING_VISIBILITY = ["list", "count", "hidden"] as const;
export const FOLLOWERS_VISIBILITY = ["list", "count"] as const;
export type FollowingVisibility = (typeof FOLLOWING_VISIBILITY)[number];
export type FollowersVisibility = (typeof FOLLOWERS_VISIBILITY)[number];

export const FOLLOW_LIST_PAGE = 30;

export interface PublicFollowStats {
  followers: number;
  /** null＝作者設成不公開，回應裡不帶數字 */
  following: number | null;
  followersVisibility: FollowersVisibility;
  followingVisibility: FollowingVisibility;
}

type StatsRow = { handle: string; followers: number; following: number; followers_visibility: FollowersVisibility; following_visibility: FollowingVisibility };

const STATS_SELECT = `SELECT m.handle, m.followers_visibility, m.following_visibility,
  (SELECT COUNT(*) FROM member_follows f WHERE f.author_id=m.id) AS followers,
  (SELECT COUNT(*) FROM member_follows f WHERE f.member_id=m.id) AS following
  FROM members m`;

function toPublic(r: StatsRow): PublicFollowStats {
  return {
    followers: r.followers,
    following: r.following_visibility === "hidden" ? null : r.following,
    followersVisibility: r.followers_visibility,
    followingVisibility: r.following_visibility,
  };
}

/** 一批公開 ID 的他人視角人數與可見度（作者榜、搜尋結果、作者頁共用）。沒有成員列的公開 ID 不在結果裡。 */
export async function publicFollowStats(db: D1Database, handles: string[]): Promise<Map<string, PublicFollowStats>> {
  const unique = [...new Set(handles.filter(Boolean))];
  if (!unique.length) return new Map();
  const rows = await db.prepare(`${STATS_SELECT} WHERE m.handle IN (SELECT value FROM json_each(?)) AND m.account_class='normal'`)
    .bind(JSON.stringify(unique)).all<StatsRow>();
  return new Map(rows.results.map((r) => [r.handle, toPublic(r)]));
}

/** 本人的設定（「我的」頁與設定頁讀）。 */
export async function ownFollowVisibility(db: D1Database, memberId: string): Promise<{ followingVisibility: FollowingVisibility; followersVisibility: FollowersVisibility }> {
  const r = await db.prepare("SELECT following_visibility, followers_visibility FROM members WHERE id=?").bind(memberId)
    .first<{ following_visibility: FollowingVisibility; followers_visibility: FollowersVisibility }>();
  return { followingVisibility: r?.following_visibility ?? "count", followersVisibility: r?.followers_visibility ?? "count" };
}

/** 驗證設定請求裡的兩個欄位；沒帶的回 undefined。不合法回 400。 */
export function parseFollowVisibility(body: { followingVisibility?: unknown; followersVisibility?: unknown }) {
  const following = body.followingVisibility;
  const followers = body.followersVisibility;
  if (following !== undefined && !(FOLLOWING_VISIBILITY as readonly unknown[]).includes(following)) throw new HttpError(400, "followingVisibility_invalid");
  if (followers !== undefined && !(FOLLOWERS_VISIBILITY as readonly unknown[]).includes(followers)) throw new HttpError(400, "followersVisibility_invalid");
  return { following: following as FollowingVisibility | undefined, followers: followers as FollowersVisibility | undefined };
}

export async function updateFollowVisibility(db: D1Database, memberId: string, next: { following?: FollowingVisibility; followers?: FollowersVisibility }) {
  if (next.following === undefined && next.followers === undefined) return;
  await db.prepare("UPDATE members SET following_visibility=COALESCE(?,following_visibility), followers_visibility=COALESCE(?,followers_visibility) WHERE id=?")
    .bind(next.following ?? null, next.followers ?? null, memberId).run();
}

export interface FollowListPage {
  total: number;
  unlisted: number;
  items: { handle: string; name: string; avatar: string }[];
  hasNext: boolean;
  offset: number;
  limit: number;
}

/**
 * 名單一頁。kind＝following：owner 關注的人；followers：關注 owner 的人。
 * own＝作者本人看自己的粉絲：略過作者自己的設定，對方那一方的同意照樣要。
 * 作者自己的設定不是 list（且不是本人）時回 403 list_not_public，不回任何人數。
 */
export async function followList(db: D1Database, ownerHandle: string, kind: "following" | "followers", offset: number, own = false): Promise<FollowListPage> {
  const owner = await db.prepare("SELECT id, following_visibility, followers_visibility FROM members WHERE handle=? AND account_class='normal'").bind(ownerHandle)
    .first<{ id: string; following_visibility: FollowingVisibility; followers_visibility: FollowersVisibility }>();
  if (!owner) throw new HttpError(404, "author not found");
  const setting = kind === "following" ? owner.following_visibility : owner.followers_visibility;
  if (!own && setting !== "list") throw new HttpError(403, "list_not_public");
  // following：owner→other，對方要 followers=list；followers：other→owner，對方要 following=list
  const [ownerCol, otherCol, otherConsent] = kind === "following"
    ? ["member_id", "author_id", "o.followers_visibility='list'"]
    : ["author_id", "member_id", "o.following_visibility='list'"];
  const [counts, page] = await db.batch<{ total: number; listed: number } | { handle: string; name: string; avatar: string }>([
    db.prepare(`SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN o.account_class='normal' AND ${otherConsent} THEN 1 ELSE 0 END),0) AS listed
      FROM member_follows f JOIN members o ON o.id=f.${otherCol} WHERE f.${ownerCol}=?`).bind(owner.id),
    db.prepare(`SELECT o.handle, COALESCE(o.display_name,o.handle) AS name, o.avatar_url AS avatar
      FROM member_follows f JOIN members o ON o.id=f.${otherCol}
      WHERE f.${ownerCol}=? AND o.account_class='normal' AND ${otherConsent}
      ORDER BY f.created_at DESC, o.handle LIMIT ? OFFSET ?`).bind(owner.id, FOLLOW_LIST_PAGE + 1, offset),
  ]);
  const c = counts.results[0] as { total: number; listed: number };
  const rows = page.results as { handle: string; name: string; avatar: string }[];
  return {
    total: c.total,
    unlisted: c.total - c.listed,
    items: rows.slice(0, FOLLOW_LIST_PAGE),
    hasNext: rows.length > FOLLOW_LIST_PAGE,
    offset,
    limit: FOLLOW_LIST_PAGE,
  };
}
