import { type Env, HttpError } from './types';
import { apiBaseOf } from './providers';
import { getCard, upsertCard } from './cards';
import { pendingSubmissionOf } from './review';
import { saveSnapshotStatement } from './review-snapshot';
import { projectRole, upstream, type UpstreamRole } from './upstream';

interface Receipt { workId: string; versionId: string; hostedRevisionId: string }
interface VersionRow {
 version_id:string; work_id:string; member_id:string; source_role_id:string; nsfw:number;
 hosted_revision_id:string|null; card_id:string|null; submission_id:string|null;
}
export const hostGateway = {
 async seal(env:Env,token:string,roleId:string,workId:string,versionId:string):Promise<Receipt> {
  if(!env.HOSTING_SERVICE_KEY)throw new HttpError(503,'hosting_unavailable');
  const res=await fetch(`${apiBaseOf(env,'harbor')}/open/v1/hosting/seal`,{
   method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json','X-Hosting-Key':env.HOSTING_SERVICE_KEY},
   body:JSON.stringify({roleId,workId,versionId}),redirect:'manual',signal:AbortSignal.timeout(20000),
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
 async read(env:Env,token:string,id:string):Promise<UpstreamRole>{
  const res=await fetch(`${apiBaseOf(env,'harbor')}/open/v1/role/detail?roleId=${encodeURIComponent(id)}`,{
   headers:{Authorization:`Bearer ${token}`},redirect:'manual',signal:AbortSignal.timeout(20000),
  });
  if(!res.ok)throw new HttpError(502,'hosting_read_failed');
  return projectRole(await res.json() as Record<string,unknown>);
 },
};
const receiptOf=(r:VersionRow):Receipt=>({workId:r.work_id,versionId:r.version_id,hostedRevisionId:r.hosted_revision_id!});

// Persist the issuer's operation before contacting the host: a lost HTTP reply can
// resume the same seal without reading a later draft or creating another version.
export async function submitHosted(env:Env,input:{memberId:string;account:number;role:UpstreamRole;token:string;nsfw:boolean;operationId:string;now:number}):Promise<Receipt>{
 const db=env.DB;
 if(input.role.authorNumId!==input.account)throw new HttpError(403,'not the author of this card');
 const existingOperation=()=>db.prepare('SELECT * FROM hosting_versions WHERE member_id=? AND operation_id=?').bind(input.memberId,input.operationId).first<VersionRow>();
 let version=await existingOperation();
 if(version&&(version.source_role_id!==input.role.roleId||version.nsfw!==Number(input.nsfw)))throw new HttpError(409,'hosting_operation_conflict');
 if(version?.submission_id)return receiptOf(version);
 const existing=await getCard(db,input.role.roleId,'harbor');
 if(existing&&await pendingSubmissionOf(db,existing.id)){
  const retry=await existingOperation();if(retry?.submission_id)return receiptOf(retry);
  throw new HttpError(409,'submission_pending');
 }
 await db.prepare('INSERT OR IGNORE INTO works VALUES (?,?,?,?,?)').bind(crypto.randomUUID(),input.memberId,'harbor',input.role.roleId,input.now).run();
 const work=await db.prepare("SELECT id,member_id FROM works WHERE source_provider='harbor' AND source_role_id=?").bind(input.role.roleId).first<{id:string;member_id:string}>();
 if(!work||work.member_id!==input.memberId)throw new HttpError(403,'not the author of this card');
 if(!version){
  try{
   await db.prepare('INSERT INTO hosting_versions(version_id,work_id,member_id,operation_id,source_role_id,provider,nsfw,created_at) VALUES (?,?,?,?,?,\'harbor\',?,?)')
    .bind(crypto.randomUUID(),work.id,input.memberId,input.operationId,input.role.roleId,Number(input.nsfw),input.now).run();
  }catch(error){if(!await existingOperation())throw new HttpError(409,'submission_pending');}
  version=await existingOperation();
 }
 if(!version)throw new HttpError(502,'hosting_seal_failed');
 try {
 await db.prepare("UPDATE hosting_versions SET state='preparing' WHERE version_id=? AND submission_id IS NULL").bind(version.version_id).run();
 const receipt=await hostGateway.seal(env,input.token,input.role.roleId,work.id,version.version_id);
 const sealed=await hostGateway.read(env,input.token,receipt.hostedRevisionId);
 if(sealed.authorNumId!==input.account||sealed.roleId!==receipt.hostedRevisionId)throw new HttpError(502,'hosting_receipt_invalid');
 const settings=await upstream.readForReview(env,input.token,receipt.hostedRevisionId,'harbor');
 const submissionId=crypto.randomUUID();
 // Validate size before any registry write. Snapshot creation joins the submission
 // transaction below, so reviewers never see an incomplete submitted revision.
 saveSnapshotStatement(db,submissionId,settings,input.now);
 const snapshot=db.prepare('INSERT INTO review_snapshots(submission_id,detail,created_at) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM review_submissions WHERE id=?)').bind(submissionId,JSON.stringify(settings),input.now,submissionId);
 const finalize=(cardId:string):D1PreparedStatement[]=>[
   db.prepare("UPDATE hosting_versions SET hosted_revision_id=?,card_id=?,submission_id=?,public_role=?,state='pending' WHERE version_id=? AND submission_id IS NULL").bind(receipt.hostedRevisionId,cardId,submissionId,JSON.stringify(sealed),version!.version_id),
   db.prepare("INSERT INTO review_submissions(id,card_id,provider,source_role_id,kind,status,content_hash,submitted_at,nsfw) SELECT ?,?,'harbor',?,?,'pending',?,?,? WHERE EXISTS(SELECT 1 FROM hosting_versions WHERE version_id=? AND submission_id=?)")
    .bind(submissionId,cardId,receipt.hostedRevisionId,existing?.reviewed_hash?'re':'first','version:'+receipt.versionId,input.now,Number(input.nsfw),version!.version_id,submissionId),
   snapshot,
   db.prepare("UPDATE cards SET status='pending' WHERE id=? AND approved_version_id IS NULL").bind(cardId),
 ];
 if(existing){await db.batch(finalize(existing.id));}
 else {
  try {
   await upsertCard(db,{...sealed,roleId:input.role.roleId,creationMethod:'hearthroom'},input.now,{
    provider:'harbor',status:'pending',nsfw:input.nsfw,recordRegistration:true,preserveExisting:true,additionalWrites:finalize,
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
 const row=await db.prepare(`SELECT v.*,s.status,c.status AS card_status,c.approved_version_id
  FROM hosting_versions v LEFT JOIN review_submissions s ON s.id=v.submission_id LEFT JOIN cards c ON c.id=v.card_id WHERE v.version_id=?`)
  .bind(versionId).first<VersionRow & {status:string|null;card_status:string|null;approved_version_id:string|null}>();
 if(!row||!row.hosted_revision_id)throw new HttpError(404,'version_not_found');
 const status=row.status==='approved'?(row.card_status==='approved'?'approved':'revoked'):(row.status??'pending');
 return {...receiptOf(row),status};
}
