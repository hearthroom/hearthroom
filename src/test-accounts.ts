import {HttpError} from './types';

/** Server-owned member classification, also usable by scheduled delivery. */
export async function assertNormalMember(db:D1Database,...ids:(string|null|undefined)[]):Promise<void>{
 const values=[...new Set(ids.filter((id):id is string=>!!id))];
 if(!values.length)return;
 const row=await db.prepare(`SELECT 1 FROM members WHERE (account_class='test' OR EXISTS(SELECT 1 FROM legacy_account_fence f WHERE f.member_id=members.id)) AND id IN(SELECT value FROM json_each(?)) LIMIT 1`).bind(JSON.stringify(values)).first();
 if(row)throw new HttpError(403,'test_account_operation_not_allowed');
}
export async function testCardIds(db:D1Database,ids:string[]):Promise<Set<string>>{
 if(!ids.length)return new Set();
 const rows=await db.prepare(`SELECT c.id FROM cards c JOIN members m ON m.id IN(
 (SELECT owner_member_id FROM member_connections WHERE provider=c.provider AND external_id=CAST(c.author_num_id AS TEXT)),
 (SELECT member_id FROM member_identities WHERE provider=c.provider AND external_id=CAST(c.author_num_id AS TEXT)))
 WHERE c.id IN(SELECT value FROM json_each(?)) AND (m.account_class='test' OR EXISTS(SELECT 1 FROM legacy_account_fence f WHERE f.member_id=m.id))`).bind(JSON.stringify(ids)).all<{id:string}>();
 return new Set(rows.results.map(r=>String(r.id)));
}
/** n is always a trusted SQL alias, never request input. */
export const eligibleNotification=(n='n')=>`NOT EXISTS(SELECT 1 FROM members qa WHERE (qa.account_class='test' OR EXISTS(SELECT 1 FROM legacy_account_fence f WHERE f.member_id=qa.id)) AND qa.id IN (${n}.member_id,${n}.actor_id,${n}.author_id))
 AND NOT EXISTS(SELECT 1 FROM community_card_owners qo JOIN members qm ON qm.id=qo.member_id WHERE qo.card_id=${n}.card_id AND (qm.account_class='test' OR EXISTS(SELECT 1 FROM legacy_account_fence f WHERE f.member_id=qm.id)))`;
export async function isTestHarborAccount(db:D1Database,...numbers:(number|undefined)[]):Promise<boolean>{
 const ids=numbers.filter((n):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>0).map(String);
 if(!ids.length)return false;
 if(await db.prepare('SELECT 1 FROM legacy_account_fence WHERE CAST(public_no AS TEXT) IN(SELECT value FROM json_each(?)) LIMIT 1').bind(JSON.stringify(ids)).first())return true;
 return !!await db.prepare(`SELECT 1 FROM members m JOIN member_identities i ON m.id IN(i.member_id,(SELECT owner_member_id FROM member_connections WHERE provider=i.provider AND external_id=i.external_id)) WHERE i.provider='harbor' AND i.external_id IN(SELECT value FROM json_each(?)) AND (m.account_class='test' OR EXISTS(SELECT 1 FROM legacy_account_fence f WHERE f.member_id=m.id)) LIMIT 1`).bind(JSON.stringify(ids)).first();
}

export async function assertPublicSource(db:D1Database,provider:string,source:string):Promise<void>{
 const cards=await db.prepare('SELECT CAST(id AS TEXT) AS id FROM cards WHERE provider=? AND source_role_id=?').bind(provider,source).all<{id:string}>();
 if((await testCardIds(db,cards.results.map(r=>r.id))).size)throw new HttpError(403,'test_account_operation_not_allowed');
 const work=await db.prepare('SELECT member_id FROM works WHERE source_provider=? AND source_role_id=?').bind(provider,source).first<{member_id:string}>();
 if(work)await assertNormalMember(db,work.member_id);
}

/** Exclusion only: invalid, paused and old-generation sessions never become measurable guests. */
export async function qaSessionHint(req:Request,db:D1Database):Promise<boolean>{
 const raw=req.headers.get('Cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith('__Host-hr-session='))?.slice('__Host-hr-session='.length);
 if(!raw||raw.length>512)return false;
 const tokenHash=btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw))))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
 return !!await db.prepare(`SELECT 1 FROM qa_session_exclusion WHERE token_hash=?1 AND expires_at>?2
 UNION ALL SELECT 1 FROM account_sessions s JOIN members m ON m.id=s.member_id WHERE s.token_hash=?1 AND (m.account_class='test' OR EXISTS(SELECT 1 FROM legacy_account_fence f WHERE f.member_id=m.id)) LIMIT 1`).bind(tokenHash,Date.now()).first();
}
