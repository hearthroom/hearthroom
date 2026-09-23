import type {ProviderId} from "./providers";

/** Resolve existing community ownership, including historical connection overrides. */
export async function connectedMemberId(db: D1Database, provider: ProviderId, externalId: number): Promise<string | null> {
  const connected = await db.prepare('SELECT owner_member_id AS id FROM member_connections WHERE provider=? AND external_id=?').bind(provider, String(externalId)).first<{id:string}>();
  if (connected) return connected.id;
  const original = await db.prepare('SELECT member_id AS id FROM member_identities WHERE provider=? AND external_id=?').bind(provider, String(externalId)).first<{id:string}>();
  return original?.id ?? null;
}
