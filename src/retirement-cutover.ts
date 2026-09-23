import {connectedMemberId} from './connections';
import {memberProfile} from './members';
import {buildSearchText,upstream} from './upstream';
import {HttpError,type Env} from './types';

/** One bounded operator transaction. Immutable review evidence is never rewritten. */
export async function cutoverCard(env:Env,cardNumber:number){
 const db=env.DB;
 const row=await db.prepare(`SELECT n.provider,n.source_role_id,w.id AS work_id,w.member_id,
 c.status,c.author_num_id,c.approved_version_id FROM card_numbers n
 LEFT JOIN works w ON w.source_provider=n.provider AND w.source_role_id=n.source_role_id
 LEFT JOIN cards c ON c.id=n.num WHERE n.num=?`).bind(cardNumber)
 .first<{provider:string;source_role_id:string;work_id:string|null;member_id:string|null;status:string|null;author_num_id:number|null;approved_version_id:string|null}>();
 if(!row?.work_id||!row.member_id)throw new HttpError(404,'migration_card_unavailable');
 if(row.provider==='harbor')return {status:'already_cut_over'};
 if(row.provider!=='lunatalk')throw new HttpError(409,'migration_changed');
 const profile=await memberProfile(db,row.member_id);
 const source=profile?.identities.filter(i=>i.provider==='lunatalk'),target=profile?.identities.filter(i=>i.provider==='harbor');
 if(source?.length!==1||target?.length!==1)throw new HttpError(409,'migration_account_unlinked');
 const sourceAccount=source[0].externalId,targetAccount=target[0].externalId;
 if(row.author_num_id!==null&&row.author_num_id!==sourceAccount)throw new HttpError(409,'migration_owner_changed');
 if(await connectedMemberId(db,'harbor',targetAccount)!==row.member_id)throw new HttpError(409,'migration_owner_changed');
 const copy=await db.prepare("SELECT role_id,external_id FROM work_copies WHERE work_id=? AND provider='harbor' AND role_id IS NOT NULL").bind(row.work_id).first<{role_id:string;external_id:number}>();
 if(!copy||copy.external_id!==targetAccount)throw new HttpError(409,'migration_draft_unavailable');
 const draft=await upstream.fetchRole(env,copy.role_id,'harbor');
 if(draft.roleId!==copy.role_id||draft.authorNumId!==targetAccount)throw new HttpError(409,'migration_owner_changed');
 const replica=row.approved_version_id ? await db.prepare("SELECT r.hosted_revision_id FROM hosting_replicas r JOIN hosting_versions v ON v.version_id=r.version_id WHERE r.version_id=? AND r.provider='harbor' AND r.state='ready' AND v.state='approved' AND v.member_id=? AND v.work_id=?").bind(row.approved_version_id,row.member_id,row.work_id).first<{hosted_revision_id:string}>():null;
 const approved=replica?await upstream.fetchRole(env,replica.hosted_revision_id,'harbor'):null;
 if(approved&&(approved.authorNumId!==targetAccount||approved.roleId!==replica!.hosted_revision_id||approved.roleId===copy.role_id))throw new HttpError(409,'migration_owner_changed');
 const guard=(sql:string,...args:unknown[])=>db.prepare(`SELECT CASE WHEN (${sql}) THEN 1 ELSE json('migration_changed') END`).bind(...args);
 const identity=`COALESCE((SELECT owner_member_id FROM member_connections WHERE provider=? AND external_id=?),(SELECT member_id FROM member_identities WHERE provider=? AND external_id=?))=?`;
 const now=Date.now();
 const statements=[
  guard("EXISTS(SELECT 1 FROM works WHERE id=? AND member_id=? AND source_provider='lunatalk' AND source_role_id=?)",row.work_id,row.member_id,row.source_role_id),
  guard("EXISTS(SELECT 1 FROM card_numbers WHERE num=? AND provider='lunatalk' AND source_role_id=?)",cardNumber,row.source_role_id),
  guard(identity,'lunatalk',String(sourceAccount),'lunatalk',String(sourceAccount),row.member_id),
  guard(identity,'harbor',String(targetAccount),'harbor',String(targetAccount),row.member_id),
  guard("NOT EXISTS(SELECT 1 FROM card_numbers WHERE provider='harbor' AND source_role_id=?) AND NOT EXISTS(SELECT 1 FROM works WHERE source_provider='harbor' AND source_role_id=?) AND NOT EXISTS(SELECT 1 FROM cards WHERE provider='harbor' AND source_role_id=?) AND NOT EXISTS(SELECT 1 FROM moderation_state WHERE provider='harbor' AND source_role_id=?) AND NOT EXISTS(SELECT 1 FROM card_registrations WHERE provider='harbor' AND source_role_id=?)",copy.role_id,copy.role_id,copy.role_id,copy.role_id,copy.role_id),
  guard("EXISTS(SELECT 1 FROM work_copies WHERE work_id=? AND provider='harbor' AND role_id=? AND external_id=?)",row.work_id,copy.role_id,targetAccount),
  guard("NOT EXISTS(SELECT 1 FROM hosting_versions WHERE work_id=? AND state='preparing')",row.work_id),
  row.status===null?guard('NOT EXISTS(SELECT 1 FROM cards WHERE id=?)',cardNumber):guard("EXISTS(SELECT 1 FROM cards WHERE id=? AND provider='lunatalk' AND source_role_id=? AND author_num_id=? AND status=? AND approved_version_id IS ?)",cardNumber,row.source_role_id,sourceAccount,row.status,row.approved_version_id),
 ];
 if(replica)statements.push(guard("EXISTS(SELECT 1 FROM hosting_replicas WHERE version_id=? AND provider='harbor' AND hosted_revision_id=? AND state='ready')",row.approved_version_id,replica.hosted_revision_id));
 statements.push(
  db.prepare("UPDATE review_submissions SET status='superseded',claimed_by=NULL,claimed_at=NULL,decided_at=? WHERE card_id=? AND status='pending'").bind(now,cardNumber),
  db.prepare("UPDATE works SET source_provider='harbor',source_role_id=? WHERE id=?").bind(copy.role_id,row.work_id),
  db.prepare("UPDATE card_numbers SET provider='harbor',source_role_id=? WHERE num=?").bind(copy.role_id,cardNumber),
  db.prepare("UPDATE card_registrations SET provider='harbor',source_role_id=?,author_num_id=? WHERE provider='lunatalk' AND source_role_id=? AND author_num_id=?").bind(copy.role_id,targetAccount,row.source_role_id,sourceAccount),
  db.prepare("UPDATE cards SET provider='harbor',source_role_id=?,author_num_id=?,author_name=?,author_avatar=?,last_synced_at=0 WHERE id=?").bind(copy.role_id,targetAccount,draft.authorName,draft.authorAvatar,cardNumber),
 );
 for(const table of ['moderation_state','moderation_cases','moderation_events','moderation_compensation'])statements.push(db.prepare(`UPDATE ${table} SET provider='harbor',source_role_id=? WHERE provider='lunatalk' AND source_role_id=?`).bind(copy.role_id,row.source_role_id));
 if(approved){
  statements.push(db.prepare("UPDATE hosting_versions SET provider='harbor',source_role_id=?,hosted_revision_id=?,public_role=? WHERE version_id=?").bind(copy.role_id,approved.roleId,JSON.stringify({...approved,searchText:buildSearchText(approved)}),row.approved_version_id));
  statements.push(db.prepare("UPDATE cards SET approved_hosted_role_id=?,names=?,summaries=?,background_url=?,slug=?,search_text=? WHERE id=?").bind(approved.roleId,JSON.stringify(approved.names),JSON.stringify(approved.summaries),approved.backgroundUrl,approved.slug,buildSearchText(approved),cardNumber));
 }else if(row.approved_version_id){
  statements.push(db.prepare("UPDATE cards SET status='needs_review',approved_version_id=NULL,approved_hosted_role_id=NULL WHERE id=?").bind(cardNumber));
 }
 statements.push(
  db.prepare("DELETE FROM work_copies WHERE work_id=? AND provider='harbor'").bind(row.work_id),
  db.prepare("INSERT INTO work_copies(work_id,provider,external_id,role_id,status,updated_at) VALUES(?,'lunatalk',?,?,'retired',?)").bind(row.work_id,sourceAccount,row.source_role_id,now),
  db.prepare('UPDATE moderation_clock SET revision=revision+1 WHERE id=1'),
  db.prepare('UPDATE public_catalog_clock SET revision=? WHERE id=1').bind(crypto.randomUUID()),
 );
 try{await db.batch(statements)}catch{throw new HttpError(409,'migration_changed')}
 const readback=await db.prepare("SELECT n.provider,n.source_role_id,w.member_id FROM card_numbers n JOIN works w ON w.source_provider=n.provider AND w.source_role_id=n.source_role_id WHERE n.num=?").bind(cardNumber).first<{provider:string;source_role_id:string;member_id:string}>();
 if(readback?.provider!=='harbor'||readback.source_role_id!==copy.role_id||readback.member_id!==row.member_id)throw new HttpError(502,'migration_readback_failed');
 return {status:approved?'cut_over':'draft_cut_over'};
}
