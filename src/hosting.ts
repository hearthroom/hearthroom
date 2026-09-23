import { type Env, HttpError } from './types';
import { apiBaseOf, type ProviderId } from './providers';
import { getCard, upsertCard } from './cards';
import { pendingSubmissionOf } from './review';
import { saveSnapshotStatement } from './review-snapshot';
import { indexStatements } from './originality';
import { buildSearchText, projectRole, upstream, type UpstreamRole } from './upstream';

interface Receipt { workId: string; versionId: string; hostedRevisionId: string }
interface VersionRow {
 provider:ProviderId; version_id:string; work_id:string; member_id:string; source_role_id:string; nsfw:number;
 hosted_revision_id:string|null; card_id:string|null; submission_id:string|null;
}
/** Each provider trusts Hearthroom with its own secret. Providers never exchange keys. */
export function hostingKey(env:Env,provider:ProviderId):string|undefined {
 return provider==='lunatalk'?env.HOSTING_SERVICE_KEY_LUNATALK:env.HOSTING_SERVICE_KEY;
}
export const hostGateway = {
 async seal(env:Env,token:string,roleId:string,workId:string,versionId:string,provider:ProviderId='harbor'):Promise<Receipt> {
  const key=hostingKey(env,provider);
  if(!key)throw new HttpError(503,'hosting_unavailable');
  const res=await fetch(`${apiBaseOf(env,provider)}/open/v1/hosting/seal`,{
   method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json','X-Hosting-Key':key},
   body:JSON.stringify({roleId,workId,versionId}),redirect:'manual',signal:AbortSignal.timeout(60000),
  });
  if(!res.ok){
   const b=await res.json().catch(()=>({})) as {error?:string};
   if(b.error==='hosting_requires_uploaded_media')throw new HttpError(409,b.error);
   throw new HttpError(502,'hosting_seal_failed');
  }
  const receipt=await res.json() as Receipt;
  if(receipt.workId!==workId||receipt.versionId!==versionId||!receipt.hostedRevisionId||receipt.hostedRevisionId===roleId)throw new HttpError(502,'hosting_receipt_invalid');
  return receipt;
 },
 async draft(env:Env,token:string,workId:string,operationId:string,name:string,language:string,provider:ProviderId):Promise<{workId:string;roleId:string}>{
  const r=await hostingCall(env,provider,token,'draft',{workId,operationId,name,language});
  if(r.workId!==workId||!r.roleId)throw new HttpError(502,'hosting_receipt_invalid');return r as {workId:string;roleId:string};
 },
 async stage(env:Env,token:string,roleId:string,workId:string,operationId:string,provider:ProviderId):Promise<{workId:string;hostedRevisionId:string}>{
  const r=await hostingCall(env,provider,token,'stage',{roleId,workId,operationId});
  if(r.workId!==workId||!r.hostedRevisionId||r.hostedRevisionId===roleId)throw new HttpError(502,'hosting_receipt_invalid');return r as {workId:string;hostedRevisionId:string};
 },
 async promote(env:Env,token:string,roleId:string,workId:string,versionId:string,provider:ProviderId):Promise<Receipt>{
  const r=await hostingCall(env,provider,token,'promote',{roleId,workId,versionId});
  if(r.workId!==workId||r.versionId!==versionId||r.hostedRevisionId!==roleId)throw new HttpError(502,'hosting_receipt_invalid');return r as unknown as Receipt;
 },
 async read(env:Env,token:string,id:string,provider:ProviderId='harbor'):Promise<UpstreamRole>{
  const res=await fetch(`${apiBaseOf(env,provider)}/open/v1/role/detail?roleId=${encodeURIComponent(id)}`,{
   headers:{Authorization:`Bearer ${token}`},redirect:'manual',signal:AbortSignal.timeout(20000),
  });
  if(!res.ok)throw new HttpError(502,'hosting_read_failed');
  return projectRole(await res.json() as Record<string,unknown>);
 },
};
const receiptOf=(r:VersionRow):Receipt=>({workId:r.work_id,versionId:r.version_id,hostedRevisionId:r.hosted_revision_id!});

// Called before the editor writes any part of a draft. Retire the old review
// first so a reviewer holding its snapshot cannot publish it during the save.
// Keep the obligation durable across partial saves and browser/network failures.
export async function beginHostedEdit(db:D1Database,memberId:string,roleId:string,now:number,provider:ProviderId='harbor'):Promise<{resubmit:boolean;nsfw?:boolean}> {
 const work=await db.prepare("SELECT id,member_id FROM works WHERE source_provider=? AND source_role_id=?").bind(provider,roleId).first<{id:string;member_id:string}>();
 if(!work)return {resubmit:false};
 if(work.member_id!==memberId)throw new HttpError(403,'not the author of this card');
 await db.batch([
  db.prepare("UPDATE review_submissions SET status='superseded',claimed_by=NULL,claimed_at=NULL,decided_at=? WHERE status='pending' AND id IN (SELECT submission_id FROM hosting_versions WHERE work_id=?)").bind(now,work.id),
  db.prepare("DELETE FROM review_snapshots WHERE submission_id IN (SELECT s.id FROM review_submissions s JOIN hosting_versions v ON v.submission_id=s.id WHERE v.work_id=? AND s.status='superseded')").bind(work.id),
  db.prepare("UPDATE cards SET status='needs_review' WHERE approved_version_id IS NULL AND id IN (SELECT card_id FROM hosting_versions WHERE work_id=? AND state='superseded')").bind(work.id),
 ]);
 const latest=await db.prepare('SELECT state,nsfw FROM hosting_versions WHERE work_id=? AND submission_id IS NOT NULL ORDER BY created_at DESC,rowid DESC LIMIT 1').bind(work.id).first<{state:string;nsfw:number}>();
 return latest?.state==='superseded'?{resubmit:true,nsfw:latest.nsfw===1}:{resubmit:false};
}

// Persist the issuer's operation before contacting the host: a lost HTTP reply can
// resume the same seal without reading a later draft or creating another version.
export async function submitHosted(env:Env,input:{provider?:ProviderId;memberId:string;account:number;role:UpstreamRole;token:string;nsfw:boolean;operationId:string;now:number}):Promise<Receipt>{
 const db=env.DB;
 const provider=input.provider??'harbor';
 if(input.role.authorNumId!==input.account)throw new HttpError(403,'not the author of this card');
 const existingOperation=()=>db.prepare('SELECT * FROM hosting_versions WHERE member_id=? AND operation_id=?').bind(input.memberId,input.operationId).first<VersionRow>();
 let version=await existingOperation();
 if(version&&(version.provider!==provider||version.source_role_id!==input.role.roleId||version.nsfw!==Number(input.nsfw)))throw new HttpError(409,'hosting_operation_conflict');
 if(version?.submission_id)return receiptOf(version);
 const existing=await getCard(db,input.role.roleId,provider);
 if(existing&&await pendingSubmissionOf(db,existing.id)){
  const retry=await existingOperation();if(retry?.submission_id)return receiptOf(retry);
  throw new HttpError(409,'submission_pending');
 }
 await db.prepare('INSERT OR IGNORE INTO works VALUES (?,?,?,?,?)').bind(crypto.randomUUID(),input.memberId,provider,input.role.roleId,input.now).run();
 const work=await db.prepare("SELECT id,member_id FROM works WHERE source_provider=? AND source_role_id=?").bind(provider,input.role.roleId).first<{id:string;member_id:string}>();
 if(!work||work.member_id!==input.memberId)throw new HttpError(403,'not the author of this card');
 if(!version){
  try{
   await db.prepare('INSERT INTO hosting_versions(version_id,work_id,member_id,operation_id,source_role_id,provider,nsfw,created_at) VALUES (?,?,?,?,?,?,?,?)')
    .bind(crypto.randomUUID(),work.id,input.memberId,input.operationId,input.role.roleId,provider,Number(input.nsfw),input.now).run();
  }catch(error){if(!await existingOperation())throw new HttpError(409,'submission_pending');}
  version=await existingOperation();
 }
 if(!version)throw new HttpError(502,'hosting_seal_failed');
 try {
 await db.prepare("UPDATE hosting_versions SET state='preparing' WHERE version_id=? AND submission_id IS NULL").bind(version.version_id).run();
 const receipt=await hostGateway.seal(env,input.token,input.role.roleId,work.id,version.version_id,provider);
 const sealed=await hostGateway.read(env,input.token,receipt.hostedRevisionId,provider);
 if(sealed.authorNumId!==input.account||sealed.roleId!==receipt.hostedRevisionId)throw new HttpError(502,'hosting_receipt_invalid');
 const settings=await upstream.readForReview(env,input.token,receipt.hostedRevisionId,provider);
 const submissionId=crypto.randomUUID();
 const privateDoc=(settings.document??{}) as Record<string,unknown>;
 // Validate size before any registry write. Snapshot creation joins the submission
 // transaction below, so reviewers never see an incomplete submitted revision.
 saveSnapshotStatement(db,submissionId,settings,input.now);
 const snapshot=db.prepare('INSERT INTO review_snapshots(submission_id,detail,created_at) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM review_submissions WHERE id=?)').bind(submissionId,JSON.stringify(settings),input.now,submissionId);
 const finalize=(cardId:string):D1PreparedStatement[]=>[
   db.prepare("UPDATE hosting_versions SET hosted_revision_id=?,card_id=?,submission_id=?,public_role=?,state='pending' WHERE version_id=? AND submission_id IS NULL").bind(receipt.hostedRevisionId,cardId,submissionId,JSON.stringify({...sealed,searchText:buildSearchText(sealed)}),version!.version_id),
   db.prepare("INSERT INTO review_submissions(id,card_id,provider,source_role_id,kind,status,content_hash,submitted_at,nsfw) SELECT ?,?,?,?,?,'pending',?,?,? WHERE EXISTS(SELECT 1 FROM hosting_versions WHERE version_id=? AND submission_id=?)")
    .bind(submissionId,cardId,provider,receipt.hostedRevisionId,existing?.approved_version_id?'re':'first','version:'+receipt.versionId,input.now,Number(input.nsfw),version!.version_id,submissionId),
   db.prepare("INSERT OR IGNORE INTO hosting_replicas(version_id,provider,source_role_id,hosted_revision_id,state,created_at) SELECT version_id,provider,source_role_id,hosted_revision_id,'ready',created_at FROM hosting_versions WHERE version_id=? AND submission_id=?").bind(version!.version_id,submissionId),
   snapshot,
   // 查重指紋跟審核單同一批：單子沒寫成就不留指紋
   ...indexStatements(db,{submissionId,cardId,memberId:input.memberId,text:String(privateDoc.roleDetailDesc??''),names:[String(privateDoc.roleName??''),String(privateDoc.userName??'')],now:input.now}),
   db.prepare("UPDATE cards SET status='pending' WHERE id=? AND approved_version_id IS NULL").bind(cardId),
 ];
 if(existing){await db.batch(finalize(existing.id));}
 else {
  try {
   await upsertCard(db,{...sealed,roleId:input.role.roleId,creationMethod:'hearthroom'},input.now,{
    provider,status:'pending',nsfw:input.nsfw,recordRegistration:true,preserveExisting:true,additionalWrites:finalize,
   });
  } catch(error) {
   const retry=await existingOperation();if(retry?.submission_id)return receiptOf(retry);throw error;
  }
 }
 const stored=await existingOperation();
 if(!stored?.submission_id)throw new HttpError(409,'submission_pending');
 return receiptOf(stored);
 } catch(error) {
  await db.prepare("UPDATE hosting_versions SET state='failed' WHERE version_id=? AND submission_id IS NULL").bind(version.version_id).run();
  throw error;
 }
}

// This endpoint contains only authority metadata. TLS authenticates the configured
// issuer; no user-supplied URL or browser approval is trusted by hosting services.
export async function hostingDecision(db:D1Database,versionId:string){
 const row=await db.prepare(`SELECT v.*,s.status,c.status AS card_status,c.public_blocked,EXISTS(SELECT 1 FROM moderation_blocked_versions b WHERE b.version_id=v.version_id) AS version_blocked,c.approved_version_id
  FROM hosting_versions v LEFT JOIN review_submissions s ON s.id=v.submission_id LEFT JOIN cards c ON c.id=v.card_id WHERE v.version_id=?`)
  .bind(versionId).first<VersionRow & {status:string|null;card_status:string|null;public_blocked:number|null;version_blocked:number;approved_version_id:string|null}>();
 if(!row||!row.hosted_revision_id)throw new HttpError(404,'version_not_found');
 const status=row.status==='approved'?(row.card_status==='approved'&&!row.public_blocked&&!row.version_blocked?'approved':'revoked'):(row.status??'pending');
 return {...receiptOf(row),status};
}

async function hostingCall(env:Env,provider:ProviderId,token:string,operation:string,body:unknown):Promise<Record<string,string>>{
 const key=hostingKey(env,provider);
  if(!key)throw new HttpError(503,'hosting_unavailable');
 const response=await fetch(`${apiBaseOf(env,provider)}/open/v1/hosting/${operation}`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'X-Hosting-Key':key,'Content-Type':'application/json'},body:JSON.stringify(body),redirect:'manual',signal:AbortSignal.timeout(60000)});
 if(!response.ok)throw new HttpError(502,'hosting_'+operation+'_failed');
 return await response.json() as Record<string,string>;
}
