import { HttpError } from "./types";
import { type Member } from "./members";
import type { ProviderId } from "./providers";

/** Community data makes an identity permanent. Rechecked inside the write transaction. */
export const EMPTY_MEMBER = `
 profile_edited_at IS NULL AND bio = '' AND avatar_key = ''
 AND age_verified_at IS NULL AND show_nsfw = 0 AND hidden_tags = '[]'
 AND NOT EXISTS (SELECT 1 FROM member_connections WHERE owner_member_id=members.id)
 AND (SELECT COUNT(*) FROM member_identities WHERE member_id=members.id)=1
 AND NOT EXISTS (SELECT 1 FROM discord_links WHERE member_id=members.id)
 AND NOT EXISTS (SELECT 1 FROM discord_link_attempts WHERE member_id=members.id)
 AND NOT EXISTS (SELECT 1 FROM community_preferences WHERE member_id=members.id)
 AND NOT EXISTS (SELECT 1 FROM community_awards WHERE member_id=members.id)
 AND NOT EXISTS (SELECT 1 FROM community_notifications WHERE member_id=members.id)
 AND NOT EXISTS (SELECT 1 FROM community_case_jobs WHERE member_id=members.id)
 AND NOT EXISTS (SELECT 1 FROM works WHERE member_id=members.id)
 AND NOT EXISTS (SELECT 1 FROM card_saves WHERE member_id=members.id)
 AND NOT EXISTS (SELECT 1 FROM member_conversations WHERE member_id=members.id)
 AND NOT EXISTS (SELECT 1 FROM member_favorites WHERE member_id=members.id)
 AND NOT EXISTS (SELECT 1 FROM member_follows WHERE member_id=members.id OR author_id=members.id)
 AND NOT EXISTS (SELECT 1 FROM comments WHERE member_id=members.id)
 AND NOT EXISTS (SELECT 1 FROM comment_likes WHERE member_id=members.id)
 AND NOT EXISTS (SELECT 1 FROM reviewers WHERE member_id=members.id)
 AND NOT EXISTS (SELECT 1 FROM review_stamps WHERE member_id=members.id)
 AND NOT EXISTS (SELECT 1 FROM review_submissions WHERE claimed_by=members.id)
 AND NOT EXISTS (SELECT 1 FROM member_identities i JOIN cards c ON c.provider=i.provider AND c.author_num_id=CAST(i.external_id AS INTEGER) WHERE i.member_id=members.id)
 AND NOT EXISTS (SELECT 1 FROM member_identities i JOIN card_registrations r ON r.provider=i.provider AND r.author_num_id=CAST(i.external_id AS INTEGER) WHERE i.member_id=members.id)
 AND NOT EXISTS (SELECT 1 FROM member_identities i JOIN work_copies c ON c.provider=i.provider AND c.external_id=CAST(i.external_id AS INTEGER) WHERE i.member_id=members.id)
 AND NOT EXISTS (SELECT 1 FROM member_identities i JOIN game_worlds g ON g.author_num_id=CAST(i.external_id AS INTEGER) WHERE i.member_id=members.id)
`;
export async function emptyCommunity(db:D1Database, id:string):Promise<boolean> {
 return !!await db.prepare(`SELECT 1 FROM members WHERE id=? AND ${EMPTY_MEMBER}`).bind(id).first();
}

/** Both issuers are verified by the caller. Only a blank target community may be absorbed. */
export async function linkIdentity(db:D1Database, member:Member, provider:ProviderId, externalId:number, now:number) {
 const existing=await db.prepare(`SELECT external_id FROM member_connections WHERE owner_member_id=? AND provider=?
 UNION SELECT external_id FROM member_identities WHERE member_id=? AND provider=?`).bind(member.id,provider,member.id,provider).first<{external_id:string}>();
 if(existing) {
  if(existing.external_id===String(externalId))return;
  throw new HttpError(409,'provider_already_connected');
 }
 if(await db.prepare('SELECT 1 FROM member_connections WHERE provider=? AND external_id=?').bind(provider,String(externalId)).first())throw new HttpError(409,'account_already_connected');
 const target=await db.prepare('SELECT member_id FROM member_identities WHERE provider=? AND external_id=?').bind(provider,String(externalId)).first<{member_id:string}>();
 if(target && !await emptyCommunity(db,target.member_id))throw new HttpError(409,'connection_target_not_empty');
 try {
  await db.batch([
   // NULL violates the constraint if the owner moved or the target acquired data since preview.
   db.prepare(`INSERT INTO member_connections(provider,external_id,owner_member_id,linked_at)
    VALUES (?,?,CASE WHEN EXISTS (SELECT 1 FROM members WHERE id=?)
    AND COALESCE((SELECT owner_member_id FROM member_connections WHERE provider=? AND external_id=?),
                 (SELECT member_id FROM member_identities WHERE provider=? AND external_id=?))=?
    AND COALESCE((SELECT member_id FROM member_identities WHERE provider=? AND external_id=?),'')=?
    AND (? IS NULL OR EXISTS (SELECT 1 FROM members WHERE id=? AND ${EMPTY_MEMBER}))
    THEN ? ELSE NULL END,?)`).bind(provider,String(externalId),member.id,member.provider,String(member.externalId),member.provider,String(member.externalId),member.id,provider,String(externalId),target?.member_id??'',target?.member_id??null,target?.member_id??null,member.id,now),
   db.prepare(`INSERT INTO member_identities(provider,external_id,member_id,linked_at) VALUES (?,?,?,?)
     ON CONFLICT(provider,external_id) DO UPDATE SET member_id=excluded.member_id`).bind(provider,String(externalId),member.id,now),
   db.prepare('DELETE FROM members WHERE id=? AND id<>? AND NOT EXISTS (SELECT 1 FROM member_identities WHERE member_id=members.id)').bind(target?.member_id??null,member.id),
  ]);
 }catch {throw new HttpError(409,'connection_conflict');}
}
export async function unlinkIdentity(_db:D1Database,_member:Member,_provider:ProviderId) {
 throw new HttpError(409,'connection_permanent');
}

/** Read-only: previewing a second identity must not create or link a community account. */
export async function connectedMemberId(db: D1Database, provider: ProviderId, externalId: number): Promise<string | null> {
  const connected = await db.prepare('SELECT owner_member_id AS id FROM member_connections WHERE provider=? AND external_id=?').bind(provider, String(externalId)).first<{id:string}>();
  if (connected) return connected.id;
  const original = await db.prepare('SELECT member_id AS id FROM member_identities WHERE provider=? AND external_id=?').bind(provider, String(externalId)).first<{id:string}>();
  return original?.id ?? null;
}
