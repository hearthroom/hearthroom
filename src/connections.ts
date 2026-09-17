import { HttpError } from "./types";
import { resolveMember, type Member } from "./members";
import type { ProviderId } from "./providers";

/** Both issuer proofs are checked by the caller. Existing identities and history stay untouched. */
export async function linkIdentity(
  db: D1Database,
  member: Member,
  provider: ProviderId,
  externalId: number,
  now: number
) {
  const existing = await db
    .prepare(
      `SELECT external_id FROM member_connections WHERE owner_member_id=? AND provider=?
 UNION SELECT external_id FROM member_identities WHERE member_id=? AND provider=?`
    )
    .bind(member.id, provider, member.id, provider)
    .first<{ external_id: string }>();
  if (existing) {
    if (existing.external_id === String(externalId)) return;
    throw new HttpError(409, "provider_already_connected");
  }
  const claimed = await db
    .prepare(
      "SELECT owner_member_id FROM member_connections WHERE provider=? AND external_id=?"
    )
    .bind(provider, String(externalId))
    .first();
  if (claimed) throw new HttpError(409, "account_already_connected");
  await resolveMember(db, provider, externalId, now);
  const target = await db
    .prepare(
      "SELECT member_id FROM member_identities WHERE provider=? AND external_id=?"
    )
    .bind(provider, String(externalId))
    .first<{ member_id: string }>();
  // Never merge an existing connected group. Disconnect its extra accounts explicitly first.
  if (
    target &&
    (await db
      .prepare("SELECT 1 FROM member_connections WHERE owner_member_id=?")
      .bind(target.member_id)
      .first())
  )
    throw new HttpError(409, "account_already_connected");
  try {
    await db.batch([
      db
        .prepare(
          "INSERT OR IGNORE INTO member_connections(provider,external_id,owner_member_id,linked_at) SELECT provider,external_id,member_id,linked_at FROM member_identities WHERE member_id=?"
        )
        .bind(member.id),
      db
        .prepare(`INSERT INTO member_connections(provider,external_id,owner_member_id,linked_at)
          VALUES (?,?,CASE WHEN EXISTS (
            SELECT 1 FROM member_connections WHERE provider=? AND external_id=? AND owner_member_id=?
          ) THEN ? ELSE NULL END,?)`)
        // Revalidate the caller's current identity inside the atomic batch. A changed owner
        // fails the NOT NULL constraint and rolls the entire batch back, including anchors.
        .bind(provider, String(externalId), member.provider, String(member.externalId), member.id, member.id, now),
    ]);
  } catch {
    throw new HttpError(409, "connection_conflict");
  }
}
export async function unlinkIdentity(
  db: D1Database,
  member: Member,
  provider: ProviderId
) {
  if (member.provider === provider)
    throw new HttpError(409, "cannot_disconnect_current_account");
  if (
    await db
      .prepare(
        "SELECT 1 FROM member_identities WHERE member_id=? AND provider=?"
      )
      .bind(member.id, provider)
      .first()
  )
    throw new HttpError(409, "cannot_disconnect_founding_account");
  // The original identity becomes independent again. No upstream assets or history are moved.
  await db.batch([
    db
      .prepare(
        "DELETE FROM member_connections WHERE owner_member_id=? AND provider=?"
      )
      .bind(member.id, provider),
    // An independent member needs no connection anchor. Retain every original identity.
    db
      .prepare(
        `DELETE FROM member_connections WHERE owner_member_id=? AND NOT EXISTS (
   SELECT 1 FROM member_connections c WHERE c.owner_member_id=? AND NOT EXISTS (
    SELECT 1 FROM member_identities i WHERE i.member_id=? AND i.provider=c.provider AND i.external_id=c.external_id
   )
  )`
      )
      .bind(member.id, member.id, member.id),
  ]);
}

/** Read-only: previewing a second identity must not create or link a community account. */
export async function connectedMemberId(db: D1Database, provider: ProviderId, externalId: number): Promise<string | null> {
  const connected = await db.prepare('SELECT owner_member_id AS id FROM member_connections WHERE provider=? AND external_id=?').bind(provider, String(externalId)).first<{id:string}>();
  if (connected) return connected.id;
  const original = await db.prepare('SELECT member_id AS id FROM member_identities WHERE provider=? AND external_id=?').bind(provider, String(externalId)).first<{id:string}>();
  return original?.id ?? null;
}
