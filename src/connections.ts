import type {ProviderId} from "./providers";

/** Resolve existing community ownership, including historical connection overrides. */
export async function connectedMemberId(db: D1Database, provider: ProviderId, externalId: number): Promise<string | null> {
  // 一次查完：連結覆寫優先，沒有才用原始身分。分兩次問的話，最常見的「原始身分」每次都要兩趟往返。
  const row = await db.prepare(`SELECT COALESCE(
    (SELECT owner_member_id FROM member_connections WHERE provider=? AND external_id=?),
    (SELECT member_id FROM member_identities WHERE provider=? AND external_id=?)
  ) AS id`).bind(provider, String(externalId), provider, String(externalId)).first<{id:string|null}>();
  return row?.id ?? null;
}
