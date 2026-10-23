import {type Env,HttpError} from './types';
import type {ProviderId} from './providers';
import {managedWork,policyOperationId,projectWorkReceipt,runWorkPolicyOperation,workPolicyGateway,workPolicyIntentStatement,type WorkPolicyCommand,type WorkPolicyReceipt,type WorkRestriction} from './work-policy';

interface PendingPermit {operation_id:string;version_id:string;submission_id:string}
export async function fenceManagedWork(env:Env,provider:ProviderId,source:string,identity:string,action:'cancel'|'restrict'|'private'|'unlisted'|'restore',options:{token?:string;restriction?:WorkRestriction;rootOperation?:string;moderationRevision?:number}={}):Promise<WorkPolicyReceipt|null>{
 const db=env.DB;const p=await managedWork(db,provider,source);if(!p)return null;
 if(p.epoch===0)throw new HttpError(503,'visibility_sync_pending');
 const root=options.rootOperation??await policyOperationId('fence:'+p.work_id+':'+identity);
 const saved=await db.prepare('SELECT operation_id,command,state,receipt FROM visibility_operations WHERE work_id=? AND root_operation_id=? ORDER BY rowid DESC LIMIT 1')
  .bind(p.work_id,root).first<{operation_id:string;command:string;state:string;receipt:string|null}>();
 const old=saved?JSON.parse(saved.command) as WorkPolicyCommand:null;
 if(old&&(old.action!==action||old.restriction!==options.restriction))throw new HttpError(409,'visibility_operation_conflict');
 if(saved?.state==='complete'&&saved.receipt&&p.sync_operation_id!==saved.operation_id)return JSON.parse(saved.receipt) as WorkPolicyReceipt;
 if(saved&&p.sync_operation_id!==saved.operation_id)throw new HttpError(409,'visibility_operation_conflict');
 const pending=await db.prepare(`SELECT g.operation_id,v.version_id,v.submission_id FROM work_publication_permits g
 JOIN hosting_versions v ON v.version_id=g.version_id JOIN review_submissions s ON s.id=v.submission_id
 WHERE v.work_id=? AND s.status='pending' AND g.state IN ('prepared','published') ORDER BY v.created_at DESC,v.rowid DESC LIMIT 1`)
 .bind(p.work_id).first<PendingPermit>();
 let command:WorkPolicyCommand;
 if(old&&saved?.state!=='conflict'){command=old;}else{
  const live=old?await workPolicyGateway.state(env,provider,source):{workId:p.work_id,epoch:p.epoch};
  if(!live||live.workId!==p.work_id)throw new HttpError(503,'visibility_sync_pending',undefined,{operationId:root,state:'pending'});
  // A confirmed epoch conflict is a known failed command. A derived child can
  // rebase the same still-current intent; unknown replies retain the exact key.
  const operation=old?await policyOperationId(root+':epoch:'+live.epoch):root;
  command={workId:p.work_id,operationId:operation,expectedEpoch:live.epoch,action,
   ...(options.restriction?{restriction:options.restriction}:{}),...(old?.permitId?{permitId:old.permitId}:pending?{permitId:pending.operation_id}:{})};
 }
 const operation=command.operationId;
 const durable=await db.batch([
  await workPolicyIntentStatement(env,provider,source,command,root,options.moderationRevision),
  db.prepare(`UPDATE managed_work_access SET sync_state='changing',sync_operation_id=?
   WHERE work_id=? AND epoch=? AND sync_operation_id IS ? AND (? IS NULL OR moderation_revision=?)`)
   .bind(operation,p.work_id,p.epoch,p.sync_operation_id,options.moderationRevision??null,options.moderationRevision??null),
 ]);
 if(!durable[1].meta.changes){
  if(durable[0].meta.changes)await db.prepare("UPDATE visibility_operations SET state='conflict' WHERE work_id=? AND operation_id=? AND state='intent'").bind(p.work_id,operation).run();
  throw new HttpError(409,'visibility_operation_conflict');
 }

 const receipt=await runWorkPolicyOperation(env,provider,source,command,options.token,root);
 // Cancel the local pending review before releasing the projection fence. Old
 // reviewers can no longer finalize their stored decision or emit first awards.
 const current=await managedWork(db,provider,source);
 if(current?.sync_operation_id!==operation)throw new HttpError(409,'visibility_operation_conflict');
 if(command.permitId)await db.batch([
  db.prepare(`UPDATE review_submissions SET status='superseded',claimed_by=NULL,claimed_at=NULL,decided_at=? WHERE status='pending'
   AND id IN (SELECT v.submission_id FROM hosting_versions v JOIN work_publication_permits g ON g.version_id=v.version_id WHERE g.operation_id=?)
   AND EXISTS(SELECT 1 FROM managed_work_access WHERE work_id=? AND sync_operation_id=?)`).bind(Date.now(),command.permitId,p.work_id,operation),
  db.prepare(`DELETE FROM review_snapshots WHERE submission_id IN (SELECT s.id FROM review_submissions s JOIN hosting_versions v ON v.submission_id=s.id
   JOIN work_publication_permits g ON g.version_id=v.version_id WHERE g.operation_id=? AND s.status='superseded')`).bind(command.permitId),
  db.prepare(`UPDATE work_publication_permits SET state='cancelled' WHERE operation_id=? AND version_id IN(SELECT v.version_id FROM hosting_versions v
   JOIN review_submissions s ON s.id=v.submission_id WHERE v.work_id=? AND s.status='superseded')`).bind(command.permitId,p.work_id),
 ]);
 await projectWorkReceipt(env,provider,receipt,undefined,action,options.moderationRevision);return receipt;
}

export async function fenceManagedEdit(env:Env,provider:ProviderId,source:string):Promise<void>{
 const pending=await env.DB.prepare(`SELECT s.id FROM review_submissions s JOIN hosting_versions v ON v.submission_id=s.id
 JOIN managed_work_access p ON p.work_id=v.work_id WHERE p.provider=? AND p.source_role_id=? AND s.status='pending'
 ORDER BY s.submitted_at DESC LIMIT 1`).bind(provider,source).first<{id:string}>();
 if(pending)await fenceManagedWork(env,provider,source,'edit:'+pending.id,'cancel');
}

export async function syncManagedRestriction(env:Env,provider:ProviderId,source:string,identity:string):Promise<void>{
 const managed=await managedWork(env.DB,provider,source);if(!managed)return;
 const state=await env.DB.prepare('SELECT public_blocked,board_hidden FROM moderation_state WHERE provider=? AND source_role_id=?').bind(provider,source).first<{public_blocked:number;board_hidden:number}>();
 const restriction:WorkRestriction=state?.public_blocked?'suspended':state?.board_hidden?'delisted':'none';
 const active=managed.sync_operation_id?await env.DB.prepare('SELECT root_operation_id,command,moderation_revision FROM visibility_operations WHERE work_id=? AND operation_id=?')
  .bind(managed.work_id,managed.sync_operation_id).first<{root_operation_id:string;command:string;moderation_revision:number|null}>():null;
 const old=active?JSON.parse(active.command) as WorkPolicyCommand:null;
 const rootOperation=old?.action==='restrict'&&old.restriction===restriction&&active?.moderation_revision===managed.moderation_revision?active.root_operation_id:undefined;
 await fenceManagedWork(env,provider,source,identity+':'+restriction+':'+managed.moderation_revision,'restrict',{restriction,rootOperation,moderationRevision:managed.moderation_revision});
}
