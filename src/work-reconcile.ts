import {type Env,HttpError} from './types';
import type {ProviderId} from './providers';
import {bumpOp} from './ops-metrics';
import {fenceManagedWork,syncManagedRestriction} from './work-fence';
import {finalizeManagedReview} from './work-publication';
import {correctReview} from './review-correction';
import {projectWorkReceipt,runWorkPolicyOperation,workPolicyGateway,policyOperationId,type WorkPolicyCommand} from './work-policy';
import {finishManagedWithdrawal} from './cards';
import {recoverAuthorVisibility,type AuthorOperation} from './work-sharing-commands';
import {refreshWorkAccess} from './work-refresh';

// Bounded recovery of persisted intent. No identity or bearer is stored. A lost
// author command is read back, but never newly authorized by the scheduler.
export async function reconcileWorkAccess(env:Env,limit=10):Promise<{complete:number;pending:number}>{
 const rows=await env.DB.prepare(`SELECT p.work_id AS work_id,p.provider,p.source_role_id,p.sync_operation_id,p.moderation_revision,p.confirmed_moderation_revision,o.command,o.root_operation_id,p.reconcile_at AS due,0 AS prepare_only
 FROM managed_work_access p LEFT JOIN visibility_operations o ON o.work_id=p.work_id AND o.operation_id=p.sync_operation_id
 WHERE (p.sync_state='changing' AND NOT EXISTS(SELECT 1 FROM author_visibility_operations a WHERE a.work_id=p.work_id AND a.provider_operation_id=p.sync_operation_id AND a.state='conflict')) OR p.moderation_revision>p.confirmed_moderation_revision
 UNION ALL
 SELECT p.work_id AS work_id,p.provider,p.source_role_id,o.operation_id,p.moderation_revision,p.confirmed_moderation_revision,o.command,o.root_operation_id,o.updated_at AS due,1 AS prepare_only
 FROM visibility_operations o JOIN managed_work_access p ON p.work_id=o.work_id
 WHERE o.state IN ('intent','pending') AND json_extract(o.command,'$.action')='prepare' AND p.sync_state='complete'
 AND p.moderation_revision=p.confirmed_moderation_revision AND p.sync_operation_id IS NOT o.operation_id
 ORDER BY due,work_id LIMIT ?`)
 .bind(Math.max(1,Math.min(10,limit))).all<{work_id:string;provider:ProviderId;source_role_id:string;sync_operation_id:string;moderation_revision:number;confirmed_moderation_revision:number;command:string|null;root_operation_id:string|null;prepare_only:number}>();
 let complete=0,pending=0;
 for(const row of rows.results){
  try{
   await env.DB.prepare('UPDATE managed_work_access SET reconcile_at=? WHERE work_id=?').bind(Date.now(),row.work_id).run();
   if(row.prepare_only){
    await runWorkPolicyOperation(env,row.provider,row.source_role_id,JSON.parse(row.command!) as WorkPolicyCommand);
    complete++;await bumpOp(env.DB,'work_access','reconcile','success');continue;
   }
   const author=await env.DB.prepare('SELECT * FROM author_visibility_operations WHERE work_id=? AND provider_operation_id=?').bind(row.work_id,row.sync_operation_id).first<AuthorOperation>();
   if(author&&row.moderation_revision===row.confirmed_moderation_revision){
    const state=await recoverAuthorVisibility(env,author);
    if(state==='complete')complete++;else pending++;
    // Never auto-rebase an author's stale CAS command onto a newer choice.
    await bumpOp(env.DB,'work_access','reconcile',state==='complete'?'success':state==='conflict'?'conflict':'pending');
    continue;
   }
   // Durable attempt order prevents an absent author receipt from starving
   // unrelated works or prepared permits across bounded scheduler runs.
   await env.DB.prepare('UPDATE managed_work_access SET reconcile_at=? WHERE work_id=?').bind(Date.now(),row.work_id).run();
   const decision=await env.DB.prepare(`SELECT d.submission_id FROM work_review_decisions d JOIN hosting_versions v ON v.submission_id=d.submission_id
    JOIN work_publication_permits g ON g.version_id=v.version_id WHERE v.work_id=? AND g.operation_id=? AND g.state='prepared'`)
    .bind(row.work_id,row.sync_operation_id).first<{submission_id:string}>();
   const candidates=await env.DB.prepare(`SELECT x.submission_id,x.actor_member_id,x.operation_id,x.note FROM review_corrections x JOIN hosting_versions v ON v.submission_id=x.submission_id WHERE v.work_id=? AND x.state='pending'`).bind(row.work_id).all<{submission_id:string;actor_member_id:string;operation_id:string;note:string}>();
   let correction:typeof candidates.results[number]|undefined;
   for(const candidate of candidates.results){if(candidate.operation_id===row.sync_operation_id||await policyOperationId('review-correction-bind:'+candidate.operation_id)===row.sync_operation_id){correction=candidate;break;}}
   if(correction&&row.moderation_revision===row.confirmed_moderation_revision){
    await correctReview(env,{id:correction.submission_id,member:correction.actor_member_id,operationId:correction.operation_id,note:correction.note,now:Date.now()});
    complete++;continue;
   }
   const saved=row.command?JSON.parse(row.command) as WorkPolicyCommand:null;
   if(row.moderation_revision>row.confirmed_moderation_revision||!saved||saved.action==='restrict'){await syncManagedRestriction(env,row.provider,row.source_role_id,'reconcile');}
   else if(decision){await finalizeManagedReview(env,decision.submission_id);}else{
    if(!row.command||!row.root_operation_id)throw new HttpError(503,'visibility_sync_pending');
    const command=JSON.parse(row.command) as WorkPolicyCommand;
    if(command.action==='bind'){
     const receipt=await runWorkPolicyOperation(env,row.provider,row.source_role_id,command);
     await projectWorkReceipt(env,row.provider,receipt,undefined,'bind');
    }else if(command.action==='prepare'){
     // A known commit conflict superseded the decision. Refresh only this
     // still-owned projection; no approval or first-publication effect follows.
     const state=await workPolicyGateway.state(env,row.provider,row.source_role_id);
     if(!state||state.workId!==row.work_id)throw new HttpError(503,'visibility_sync_pending');
     await projectWorkReceipt(env,row.provider,{...state,operationId:row.sync_operation_id});
    }else if(command.action!=='correct_review'){
     if(['private','unlisted','restore'].includes(command.action)){
      const receipt=await workPolicyGateway.operation(env,row.provider,row.source_role_id,row.work_id,command.operationId);
      if(!receipt)throw new HttpError(503,'visibility_sync_pending');
     }
     await fenceManagedWork(env,row.provider,row.source_role_id,'',command.action,{rootOperation:row.root_operation_id,restriction:command.restriction});
     if(command.action==='private'){
      const card=await env.DB.prepare('SELECT id FROM cards WHERE provider=? AND source_role_id=?').bind(row.provider,row.source_role_id).first<{id:string}>();
      if(card)await finishManagedWithdrawal(env.DB,card.id);
     }
    }
   }
   complete++;await bumpOp(env.DB,'work_access','reconcile','success');
  }catch(error){
   pending++;await bumpOp(env.DB,'work_access','reconcile',error instanceof HttpError&&error.status===409?'conflict':'pending');
  }
 }
 const refreshed=await refreshWorkAccess(env,Math.max(0,Math.min(10,limit)-rows.results.length),rows.results.map(row=>row.work_id));
 return {complete:complete+refreshed.complete,pending:pending+refreshed.pending};
}
