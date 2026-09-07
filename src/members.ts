import { DEFAULT_PROVIDER, type ProviderId } from "./providers";
import { type Env, HttpError } from "./types";
import { upstream } from "./upstream";

/**
 * 成員與身分。
 *
 * 本站沒有原生登入：成員是第一次以某家供應商登入時自動建立的，之後每個需要身分的請求
 * 仍然把 token 轉發給供應商驗（跟登記一樣，用完即棄），拿回公開 ID 再查身分表換成成員。
 * 成員 id 是本站產生的不透明字串——審核人、領取、蓋章都掛在它上面，供應商換了或多綁
 * 一家，這些紀錄不用動。
 *
 * 這裡存的關於一個人的東西只有：供應商代號、供應商上的公開 ID、可選的顯示名稱。
 * 沒有 token、沒有信箱、沒有內部識別碼。
 */
export interface Member {
  id: string;
  provider: ProviderId;
  /** 供應商上的公開 ID（lunatalk = accountNumId） */
  externalId: number;
}

export async function resolveMember(db: D1Database, provider: ProviderId, externalId: number, now: number): Promise<string> {
  const ext = String(externalId);
  const found = await db
    .prepare("SELECT member_id FROM member_identities WHERE provider = ? AND external_id = ?")
    .bind(provider, ext)
    .first<{ member_id: string }>();
  if (found) return found.member_id;
  const id = crypto.randomUUID();
  // 兩個請求同時第一次登入：身分表的主鍵擋住第二個，重讀就拿到第一個建的。
  try {
    await db.batch([
      db.prepare("INSERT INTO members (id, created_at) VALUES (?, ?)").bind(id, now),
      db.prepare("INSERT INTO member_identities (provider, external_id, member_id, linked_at) VALUES (?, ?, ?, ?)").bind(provider, ext, id, now),
    ]);
    return id;
  } catch {
    const again = await db
      .prepare("SELECT member_id FROM member_identities WHERE provider = ? AND external_id = ?")
      .bind(provider, ext)
      .first<{ member_id: string }>();
    if (again) return again.member_id;
    throw new HttpError(502, "could not create member");
  }
}

export async function isReviewer(db: D1Database, memberId: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT 1 AS ok FROM reviewers WHERE member_id = ? AND revoked_at IS NULL")
    .bind(memberId)
    .first<{ ok: number }>();
  return !!row;
}

/** 這個成員在某家供應商上的公開 ID；沒綁就是 null。 */
export async function externalIdOf(db: D1Database, memberId: string, provider: ProviderId): Promise<number | null> {
  const row = await db
    .prepare("SELECT external_id FROM member_identities WHERE member_id = ? AND provider = ?")
    .bind(memberId, provider)
    .first<{ external_id: string }>();
  return row ? Number(row.external_id) : null;
}

type Ctx = { env: Env; req: { header: (k: string) => string | undefined } };

/** 轉發 token 問供應商「你是誰」，再換成本站成員。token 不落庫、不進日誌。 */
export async function requireMember(c: Ctx): Promise<Member> {
  const bearer = c.req.header("Authorization")?.match(/^Bearer\s+(\S+)$/)?.[1];
  if (!bearer) throw new HttpError(401, "missing bearer token");
  const me = await upstream.fetchMe(c.env, bearer);
  const id = await resolveMember(c.env.DB, DEFAULT_PROVIDER, me.accountNumId, Date.now());
  return { id, provider: DEFAULT_PROVIDER, externalId: me.accountNumId };
}

export async function requireReviewer(c: Ctx): Promise<Member> {
  const member = await requireMember(c);
  if (!(await isReviewer(c.env.DB, member.id))) throw new HttpError(403, "not a reviewer");
  return member;
}
