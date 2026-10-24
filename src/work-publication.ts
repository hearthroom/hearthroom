import {assertPublicSource} from './test-accounts';
import {type Env,HttpError} from './types';
import type {ProviderId} from './providers';
import {bumpOp} from './ops-metrics';
import {managedWork,policyOperationId,projectWorkReceipt,supersedeOlderWorkIntents,runWorkPolicyOperation,workPolicyGateway,type WorkPolicyCommand,type WorkPolicyReceipt} from './work-policy';

export async function prepareManagedPublication(env:Env,provider:ProviderId,source:string,work:string,version:string,role:string,consent?:{providerEpoch:number;providerRevision:string}):Promise<void>{
 await assertPublicSource(env.DB,provider,source);
 const managed=await managedWork(env.DB,provider,source);if(!managed)return;
 if(managed.work_id!==work||managed.sync_state!=='complete'||consent&&managed.epoch!==consent.providerEpoch)throw new HttpError(409,'visibility_operation_conflict');
 let permit=await env.DB.prepare('SELECT operation_id,epoch FROM work_publication_permits WHERE version_id=?').bind(version).first<{operation_id:string;epoch:number}>();
 if(!permit){
  const current=consent?{workId:work,epoch:consent.providerEpoch}:await workPolicyGateway.state(env,provider,source);if(!current||current.workId!==work)throw new HttpError(503,'visibility_sync_pending');
  const op=await policyOperationId('publication:'+version);
  await env.DB.prepare("INSERT OR IGNORE INTO work_publication_permits(version_id,operation_id,epoch,state) VALUES(?,?,?,'prepared')").bind(version,op,current.epoch).run();
  permit=await env.DB.prepare('SELECT operation_id,epoch FROM work_publication_permits WHERE version_id=?').bind(version).first<{operation_id:string;epoch:number}>();
 }
 if(!permit)throw new HttpError(503,'visibility_sync_pending');
 const command:WorkPolicyCommand={workId:work,operationId:permit.operation_id,expectedEpoch:permit.epoch,action:'prepare',versionRoleId:role,...(consent?{expectedOwnerRevision:consent.providerRevision}:{})};
 const receipt=await runWorkPolicyOperation(env,provider,source,command);
 if(receipt.state!=='prepared')throw new HttpError(409,'visibility_operation_conflict');
}

interface Publication {
 version_id:string;work_id:string;provider:ProviderId;source_role_id:string;hosted_revision_id:string;
 operation_id:string;state:string;card_id:string;status:string;content_hash:string;kind:string;decided_at:number;
}
export async function finalizeManagedReview(env:Env,submission:string):Promise<void>{
 const db=env.DB;
 const row=await db.prepare(`SELECT v.version_id,v.work_id,v.provider,v.source_role_id,v.hosted_revision_id,
 g.operation_id,g.state,s.card_id,s.status,s.content_hash,s.kind,d.decided_at
 FROM hosting_versions v JOIN work_publication_permits g ON g.version_id=v.version_id
 JOIN review_submissions s ON s.id=v.submission_id JOIN work_review_decisions d ON d.submission_id=s.id
 WHERE s.id=?`).bind(submission).first<Publication>();
 if(!row)throw new HttpError(503,'visibility_sync_pending');
 await assertPublicSource(db,row.provider,row.source_role_id);
 if(row.status==='approved'&&row.state==='published')return;
 if(row.status!=='pending'||row.state==='conflict'||row.state==='cancelled')throw new HttpError(409,'visibility_operation_conflict');
 const lock=await db.prepare(`UPDATE managed_work_access SET sync_state='changing',sync_operation_id=?
 WHERE work_id=? AND (sync_operation_id IS NULL OR sync_operation_id=?)
 AND EXISTS(SELECT 1 FROM review_submissions WHERE id=? AND status='pending')`).bind(row.operation_id,row.work_id,row.operation_id,submission).run();
 if(!lock.meta.changes)throw new HttpError(409,'visibility_operation_conflict');
 let receipt:WorkPolicyReceipt;
 try{
  const recovered=await workPolicyGateway.operation(env,row.provider,row.source_role_id,row.work_id,row.operation_id);
  receipt=recovered?.state==='complete'?recovered:await workPolicyGateway.commit(env,row.provider,row.source_role_id,row.work_id,row.operation_id);
  const current=await workPolicyGateway.state(env,row.provider,row.source_role_id);
  if(!current||current.workId!==row.work_id||current.epoch!==receipt.epoch||current.access!=='public'||current.restriction!=='none'
   ||receipt.state!=='complete'||receipt.access!=='public'||receipt.restriction!=='none')throw new HttpError(409,'visibility_operation_conflict');
 }catch(error){
  if(error instanceof HttpError&&error.status===409){
   await db.batch([
    db.prepare("UPDATE work_publication_permits SET state='conflict' WHERE version_id=? AND state<>'published'").bind(row.version_id),
    db.prepare("UPDATE review_submissions SET status='superseded',claimed_by=NULL,claimed_at=NULL WHERE id=? AND status='pending'").bind(submission),
   ]);
   await bumpOp(db,'work_access','publish','conflict');throw error;
  }
  await bumpOp(db,'work_access','publish','pending');
  throw new HttpError(503,'visibility_sync_pending',undefined,{operationId:row.operation_id,state:'pending'});
 }
 // A newer cancel/restriction owns sync_operation_id or a higher epoch. It can
 // never be overwritten by a delayed receipt from the old publication.
 const final=await db.batch([
  db.prepare(`UPDATE managed_work_access SET access=?,epoch=?,restriction=?,approved_role_id=?,sync_state='complete',sync_operation_id=NULL
   WHERE work_id=? AND epoch<=? AND sync_operation_id=? AND EXISTS(SELECT 1 FROM review_submissions WHERE id=? AND status='pending')`)
   .bind(receipt.access,receipt.epoch,receipt.restriction,row.hosted_revision_id,row.work_id,receipt.epoch,row.operation_id,submission),
  db.prepare(`UPDATE work_publication_permits SET state='published',published_epoch=? WHERE version_id=? AND state='prepared'
   AND EXISTS(SELECT 1 FROM managed_work_access WHERE work_id=? AND epoch=? AND approved_role_id=? AND sync_state='complete')`)
   .bind(receipt.epoch,row.version_id,row.work_id,receipt.epoch,row.hosted_revision_id),
  db.prepare(`UPDATE review_submissions SET status='approved',decided_at=? WHERE id=? AND status='pending'
   AND EXISTS(SELECT 1 FROM work_publication_permits WHERE version_id=? AND state='published')`).bind(row.decided_at,submission,row.version_id),
  db.prepare(`UPDATE cards SET status='approved',reviewed_hash=?,registered_at=CASE WHEN ?='first' THEN ? ELSE registered_at END
   WHERE id=? AND EXISTS(SELECT 1 FROM review_submissions WHERE id=? AND status='approved')`).bind(row.content_hash,row.kind,row.decided_at,row.card_id,submission),
  db.prepare("DELETE FROM review_snapshots WHERE submission_id=? AND EXISTS(SELECT 1 FROM review_submissions WHERE id=? AND status='approved')").bind(submission,submission),
  supersedeOlderWorkIntents(env,receipt),
 ]);
 if(!final[2].meta.changes)throw new HttpError(409,'visibility_operation_conflict');
 await bumpOp(db,'work_access','publish','success');
}
