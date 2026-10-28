import { reviewLength } from './review-length';
import { updateIntent, assertUpdateCooldown } from './card-update';
import {bumpOp} from './ops-metrics';
import {assertNormalMember} from './test-accounts';
import {managedWork,enrollWorkAccess,policyOperationId,workPolicyGateway,type WorkAccess} from './work-policy';
import {readOwnerVisibility} from './work-sharing';
import {fenceManagedEdit} from './work-fence';
import {prepareManagedPublication} from './work-publication';
import {firstRegistrationStatement} from './quota';
import { isTransferHeld } from './draft-transfer-gate';
import { type Env, HttpError } from './types';
import { apiBaseOf, type ProviderId } from './providers';
import { getCard, upsertCard } from './cards';
import { adoptRetiredWork } from './card-sync';
import { pendingSubmissionOf } from './review';
import { encodeSnapshot, reviewRecord } from './review-snapshot';
import { indexStatements } from './originality';
import { buildSearchBody, buildSearchName, buildSearchText, projectRole, upstream, type UpstreamRole } from './upstream';
import { resolveFandom, type ResolvedFandom } from './fandom';
import { evaluateRating, type RatingAnswers, type RatingResult } from '../shared/content-rating';

interface Receipt { workId: string; versionId: string; hostedRevisionId: string }
interface VersionRow {
 state:string;
 update_kind:'minor'|'major'; update_note:string; visibility_consent:string|null;
 provider:ProviderId; version_id:string; work_id:string; member_id:string; source_role_id:string; rating_answers:string|null;
 hosted_revision_id:string|null; card_id:string|null; submission_id:string|null;
}
interface PublicationConsent {policyRevision:string;approvalRevision:string;providerRevision:string;providerEpoch:number;initialAccess:WorkAccess}
/** Each provider trusts Hearthroom with its own secret. Providers never exchange keys. */
export function hostingKey(env:Env,provider:ProviderId):string|undefined {
 apiBaseOf(env,provider);
 return env.HOSTING_SERVICE_KEY;
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
export async function beginHostedEdit(db:D1Database,memberId:string,roleId:string,now:number,provider:ProviderId='harbor',env?:Env):Promise<{resubmit:boolean;ratingAnswers?:RatingAnswers;fandom?:string;fandomId?:string}> {
 await adoptRetiredWork(db,provider,roleId);
 const work=await db.prepare("SELECT id,member_id FROM works WHERE source_provider=? AND source_role_id=?").bind(provider,roleId).first<{id:string;member_id:string}>();
 if(!work)return {resubmit:false};
 if(work.member_id!==memberId)throw new HttpError(403,'not the author of this card');
 const unfinished=await db.prepare("SELECT 1 FROM hosting_versions WHERE work_id=? AND submission_id IS NULL AND state IN ('preparing','cancelling','failed')").bind(work.id).first();
 if(unfinished||await managedWork(db,provider,roleId)){
  if(!env)throw new HttpError(503,'visibility_sync_pending');
  await fenceManagedEdit(env,provider,roleId);
 }
 await db.batch([
  db.prepare("UPDATE review_submissions SET status='superseded',claimed_by=NULL,claimed_at=NULL,decided_at=? WHERE status='pending' AND id IN (SELECT submission_id FROM hosting_versions WHERE work_id=?)").bind(now,work.id),
  db.prepare("DELETE FROM review_snapshots WHERE submission_id IN (SELECT s.id FROM review_submissions s JOIN hosting_versions v ON v.submission_id=s.id WHERE v.work_id=? AND s.status='superseded')").bind(work.id),
  db.prepare("UPDATE cards SET status='needs_review' WHERE approved_version_id IS NULL AND id IN (SELECT card_id FROM hosting_versions WHERE work_id=? AND state='superseded')").bind(work.id),
 ]);
 const latest=await db.prepare("SELECT state,rating_answers,COALESCE(json_extract(public_role,'$.fandom'),'') AS fandom,json_extract(public_role,'$.fandomQid') AS fandom_qid FROM hosting_versions WHERE work_id=? AND submission_id IS NOT NULL ORDER BY created_at DESC,rowid DESC LIMIT 1").bind(work.id).first<{state:string;rating_answers:string|null;fandom:string;fandom_qid:string|null}>();
 // 原作與分級問卷跟著上一版走：作者改卡重送時不必再填一次。問卷改版了或上一版沒填（問卷上線前送的），就不帶，作者得重填
 return latest?.state==='superseded'?{resubmit:true,...currentAnswers(latest.rating_answers),...(latest.fandom?{fandom:latest.fandom}:{}),...(latest.fandom_qid?{fandomId:latest.fandom_qid}:{})}:{resubmit:false};
}

function currentAnswers(stored:string|null):{ratingAnswers?:RatingAnswers}{
 if(!stored)return {};
 try{return {ratingAnswers:evaluateRating(JSON.parse(stored)).answers};}catch{return {};}
}

// Persist the issuer's operation before contacting the host: a lost HTTP reply can
// resume the same seal without reading a later draft or creating another version.
export async function submitHosted(env:Env,input:{provider?:ProviderId;memberId:string;account:number;role:UpstreamRole;token:string;/** 作者問卷計分後的結果（限制級＝成人內容） */rating:RatingResult;/** 原作（已解析）；沒給＝沒有。同一個 operation 重試時以第一次送的為準。 */fandom?:ResolvedFandom;operationId:string;now:number;updateKind?:unknown;updateNote?:unknown;packId?:string|null;expectedVisibility?:{policyRevision:string;approvalRevision:string}}):Promise<Receipt>{
 const db=env.DB;
 const intent=updateIntent(input);
 const fandom:ResolvedFandom=input.fandom??{fandom:'',qid:null,key:'',search:''};
 const provider=input.provider??'harbor';
 const answers=JSON.stringify(input.rating.answers);
 if(input.role.authorNumId!==input.account)throw new HttpError(403,'not the author of this card');
 const existingOperation=()=>db.prepare('SELECT * FROM hosting_versions WHERE member_id=? AND operation_id=?').bind(input.memberId,input.operationId).first<VersionRow>();
 let version=await existingOperation();
 const checkVersion=(candidate:VersionRow|null)=>{
  if(!candidate)return null;
  if(!candidate.submission_id&&['cancelling','superseded'].includes(candidate.state))throw new HttpError(409,'hosting_operation_conflict');
  if(candidate.update_kind!==intent.updateKind||candidate.update_note!==intent.updateNote)throw new HttpError(409,'hosting_operation_conflict');
  const saved:PublicationConsent|null=candidate.visibility_consent?JSON.parse(candidate.visibility_consent) as PublicationConsent:null;
  if(!!saved!==!!input.expectedVisibility||saved&&(saved.policyRevision!==input.expectedVisibility?.policyRevision||saved.approvalRevision!==input.expectedVisibility?.approvalRevision))throw new HttpError(409,'visibility_operation_conflict');
  // Pre-questionnaire operations may resume and fill their missing answers.
  if(candidate.provider!==provider||candidate.source_role_id!==input.role.roleId||(candidate.rating_answers!==null&&candidate.rating_answers!==answers))throw new HttpError(409,'hosting_operation_conflict');
  return saved;
 };
 let consent=checkVersion(version);
 if(version&&version.rating_answers===null&&!version.submission_id){
  await db.prepare('UPDATE hosting_versions SET rating_answers=?,rating=? WHERE version_id=? AND rating_answers IS NULL').bind(answers,input.rating.rating,version.version_id).run();
 }
 if(version?.submission_id){
  if(consent){const previous=await db.prepare('SELECT status FROM review_submissions WHERE id=?').bind(version.submission_id).first<{status:string}>();if(!previous||previous.status==='superseded')throw new HttpError(409,'visibility_operation_conflict');}
  return receiptOf(version);
 }
 const existing=await getCard(db,input.role.roleId,provider);
 if(!version&&input.expectedVisibility){
  const view=await readOwnerVisibility(env,input.role.roleId,input.token,existing,true);
  if(view.workVisibility.policyRevision!==input.expectedVisibility.policyRevision||view.workVisibility.approvalRevision!==input.expectedVisibility.approvalRevision)throw new HttpError(409,'visibility_operation_conflict');
  if(view.workVisibility.syncState!=='complete')throw new HttpError(503,'visibility_sync_pending');
  const action=view.workVisibility.access==='public'?'submit_update':'submit_review';
  if(!view.workVisibility.actions.includes(action))throw new HttpError(409,'visibility_restricted');
  consent={...input.expectedVisibility,providerRevision:view.provider.policyRevision,providerEpoch:view.provider.epoch,initialAccess:view.workVisibility.access};
 }
 if(existing&&await pendingSubmissionOf(db,existing.id)){
  const retry=await existingOperation();if(retry?.submission_id){checkVersion(retry);return receiptOf(retry);}
  throw new HttpError(409,'submission_pending');
 }
 if(!version){
  try{await assertReviewLength(db,await upstream.readForReview(env,input.token,input.role.roleId,provider),'draft');}
  catch(error){if(error instanceof HttpError)throw error;throw new HttpError(503,'visibility_sync_pending');}
 }
 await adoptRetiredWork(db,provider,input.role.roleId);
 await db.prepare('INSERT OR IGNORE INTO works VALUES (?,?,?,?,?)').bind(crypto.randomUUID(),input.memberId,provider,input.role.roleId,input.now).run();
 const work=await db.prepare("SELECT id,member_id FROM works WHERE source_provider=? AND source_role_id=?").bind(provider,input.role.roleId).first<{id:string;member_id:string}>();
 if(!work||work.member_id!==input.memberId)throw new HttpError(403,'not the author of this card');
 if(!version&&intent.updateKind==='major'){
  if(!existing?.approved_version_id&&existing?.status!=='approved')throw new HttpError(400,'update_notification_unavailable');
  await assertUpdateCooldown(db,work.id,input.now);
 }
 if(!version){
  try{
   await db.prepare('INSERT INTO hosting_versions(version_id,work_id,member_id,operation_id,source_role_id,provider,rating,rating_answers,created_at,visibility_consent,update_kind,update_note) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
    .bind(crypto.randomUUID(),work.id,input.memberId,input.operationId,input.role.roleId,provider,input.rating.rating,answers,input.now,consent?JSON.stringify(consent):null,intent.updateKind,intent.updateNote).run();
  }catch(error){
   if(!await existingOperation()){
    const occupied=await db.prepare("SELECT 1 FROM hosting_versions WHERE work_id=? AND state IN ('preparing','cancelling')").bind(work.id).first();
    if(occupied){await bumpOp(db,'publication_recovery','submit','pending');throw new HttpError(409,'hosting_preparation_unfinished');}
    throw error;
   }
  }
  version=await existingOperation();
 }
 if(!version)throw new HttpError(502,'hosting_seal_failed');
 try {
 checkVersion(version);
 if(consent){
  if(version.visibility_consent!==JSON.stringify(consent))throw new HttpError(409,'visibility_operation_conflict');
  if(consent.providerEpoch===0){
   const receipt=await enrollWorkAccess(env,{memberId:input.memberId,roleId:input.role.roleId,operationId:await policyOperationId('submission-enroll:'+version.version_id),access:consent.initialAccess,token:input.token,provider,expectedOwnerRevision:consent.providerRevision});
   const current=await workPolicyGateway.owner(env,provider,input.role.roleId,input.token,true);
   if(current.epoch!==receipt.epoch||current.workId!==work.id||current.access!==consent.initialAccess)throw new HttpError(409,'visibility_operation_conflict');
   const next={...consent,providerEpoch:receipt.epoch,providerRevision:current.policyRevision};
   const saved=await db.prepare('UPDATE hosting_versions SET visibility_consent=? WHERE version_id=? AND visibility_consent=? AND submission_id IS NULL').bind(JSON.stringify(next),version.version_id,JSON.stringify(consent)).run();
   if(!saved.meta.changes&&(await existingOperation())?.visibility_consent!==JSON.stringify(next))throw new HttpError(409,'visibility_operation_conflict');
   consent=next;
  }
 }
 await db.prepare("UPDATE hosting_versions SET state='preparing' WHERE version_id=? AND submission_id IS NULL").bind(version.version_id).run();
 const receipt=await hostGateway.seal(env,input.token,input.role.roleId,work.id,version.version_id,provider);
 const sealed=await hostGateway.read(env,input.token,receipt.hostedRevisionId,provider);
 if(sealed.authorNumId!==input.account||sealed.roleId!==receipt.hostedRevisionId)throw new HttpError(502,'hosting_receipt_invalid');
 const settings=await upstream.readForReview(env,input.token,receipt.hostedRevisionId,provider);
 settings.reviewLength=await assertReviewLength(db,settings,'sealed');
 await prepareManagedPublication(env,provider,input.role.roleId,work.id,version.version_id,receipt.hostedRevisionId,consent??undefined);
 const submissionId=crypto.randomUUID();
 const privateDoc=(settings.document??{}) as Record<string,unknown>;
 // Validate size before any registry write. Snapshot creation joins the submission
 // transaction below, so reviewers never see an incomplete submitted revision.
 // 本站只留查重原文與統計；完整設定審核時向 Harbor 封存版讀，不在這裡抄一份（見 readSealedForReview）。
 const packedSnapshot=await encodeSnapshot(reviewRecord(settings));
 const snapshot=db.prepare('INSERT INTO review_snapshots(submission_id,detail,created_at) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM review_submissions WHERE id=?)').bind(submissionId,packedSnapshot,input.now,submissionId);
 const finalize=(cardId:string):D1PreparedStatement[]=>[
   firstRegistrationStatement(db,{provider,account:input.account,source:input.role.roleId,now:input.now,packId:input.packId}),
   db.prepare("UPDATE hosting_versions SET hosted_revision_id=?,card_id=?,submission_id=?,public_role=?,state='pending' WHERE version_id=? AND submission_id IS NULL").bind(receipt.hostedRevisionId,cardId,submissionId,JSON.stringify({...sealed,fandom:fandom.fandom,fandomQid:fandom.qid,fandomKey:fandom.key,fandomSearch:fandom.search,searchName:buildSearchName({...sealed,fandom:fandom.fandom,fandomSearch:fandom.search}),searchText:buildSearchText(sealed),searchBody:buildSearchBody(sealed)}),version!.version_id),
   db.prepare("INSERT INTO review_submissions(id,card_id,provider,source_role_id,kind,status,content_hash,submitted_at,rating,rating_descriptors,rating_answers) SELECT ?,?,?,?,?,'pending',?,?,?,?,? WHERE EXISTS(SELECT 1 FROM hosting_versions WHERE version_id=? AND submission_id=?)")
    .bind(submissionId,cardId,provider,receipt.hostedRevisionId,existing?.approved_version_id?'re':'first','version:'+receipt.versionId,input.now,input.rating.rating,JSON.stringify(input.rating.descriptors),answers,version!.version_id,submissionId),
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
    provider,status:'pending',preserveExisting:true,additionalWrites:finalize,
   });
  } catch(error) {
   const retry=await existingOperation();if(retry?.submission_id){checkVersion(retry);return receiptOf(retry);}throw error;
  }
 }
 const stored=await existingOperation();
 if(!stored?.submission_id)throw new HttpError(409,'submission_pending');
 return receiptOf(stored);
 } catch(error) {
  if(isTransferHeld(error))throw error;
  const managed=await managedWork(db,provider,input.role.roleId);
  if(managed?.epoch!==0)await db.prepare("UPDATE hosting_versions SET state='failed' WHERE version_id=? AND submission_id IS NULL AND state='preparing'").bind(version.version_id).run();
  if(/weekly_quota_exceeded|registration_pack_unavailable/.test(String(error)))throw new HttpError(403,'weekly_quota_exceeded');
  if(String(error).includes('hosting_operation_conflict'))throw new HttpError(409,'hosting_operation_conflict');
  if(!(error instanceof HttpError))throw new HttpError(503,'visibility_sync_pending');
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
 const owner=await db.prepare('SELECT member_id FROM works WHERE id=?').bind(row.work_id).first<{member_id:string}>();
 if(owner)await assertNormalMember(db,owner.member_id);
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

async function assertReviewLength(db:D1Database,settings:Record<string,unknown>,phase:'draft'|'sealed'){
 const length=reviewLength(settings);
 await bumpOp(db,'review_length',phase,length.eligible?'eligible':'insufficient');
 if(!length.eligible)throw new HttpError(400,'review_length_insufficient',undefined,{detail:{reviewLength:length}});
 return length;
}
