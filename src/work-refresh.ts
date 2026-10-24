import {bumpOp} from './ops-metrics';
import {type Env,HttpError} from './types';
import {workPolicyGateway,type ManagedWork} from './work-policy';
import {readCurrentWorkPolicies,WORK_READ_BUDGET} from './work-read';

type RefreshRow=ManagedWork&{card_id:string;card_approved_role:string|null;card_version:string|null};
// Refresh current facts, never replay a command or infer authority from a receipt.
// An established policy fence clears only after PG advanced past its CAS.
// A definitively refused first bind has no established policy to project.
export async function refreshWorkAccess(env:Env,limit:number,alreadyChecked:string[]=[],onlyWorkIds?:string[]):Promise<{complete:number;pending:number}>{
 if(limit<1)return {complete:0,pending:0};
 const rows=await env.DB.prepare(`SELECT p.*,c.id AS card_id,c.approved_hosted_role_id AS card_approved_role,c.approved_version_id AS card_version
 FROM managed_work_access p JOIN cards c ON c.provider=p.provider AND c.source_role_id=p.source_role_id
 WHERE p.provider='harbor' AND p.epoch>=0 AND p.moderation_revision=p.confirmed_moderation_revision
 AND p.work_id NOT IN(SELECT value FROM json_each(?))
 AND (? IS NULL OR p.work_id IN(SELECT value FROM json_each(?)))
 AND (p.sync_state='complete' OR EXISTS(SELECT 1 FROM author_visibility_operations a
 WHERE a.work_id=p.work_id AND a.provider_operation_id=p.sync_operation_id AND a.state='conflict'
 AND json_extract(a.command,'$.expectedEpoch')<p.epoch+1))
 ORDER BY p.reconcile_at,p.work_id LIMIT ?`).bind(JSON.stringify(alreadyChecked),onlyWorkIds?JSON.stringify(onlyWorkIds):null,onlyWorkIds?JSON.stringify(onlyWorkIds):null,Math.min(onlyWorkIds?WORK_READ_BUDGET:10,limit)).all<RefreshRow>();
 if(!rows.results.length)return {complete:0,pending:0};
 const now=Date.now();
 await env.DB.batch(rows.results.map(p=>env.DB.prepare('UPDATE managed_work_access SET reconcile_at=? WHERE work_id=?').bind(now,p.work_id)));
 let current;
 try{current=await readCurrentWorkPolicies(env,rows.results.map(p=>({sourceRoleId:p.source_role_id,workId:p.work_id,targetRoleId:p.card_approved_role??p.source_role_id})));}
 catch{await bumpOp(env.DB,'work_access','reconcile','pending');return {complete:0,pending:rows.results.length};}
 let complete=0,pending=0;
 for(const [index,p] of rows.results.entries()){
  try{
   const r=current[index];
   if(p.epoch===0){
    if(p.sync_state!=='changing'||r.managed||r.epoch!==0||!p.sync_operation_id)throw new HttpError(503,'visibility_sync_pending');
    // This GET must explicitly establish no original receipt. A timeout, stale
    // receipt or a newly established PG policy can never remove this fence.
    if(await workPolicyGateway.operation(env,'harbor',p.source_role_id,p.work_id,p.sync_operation_id))throw new HttpError(503,'visibility_sync_pending');
    const removed=await env.DB.prepare(`DELETE FROM managed_work_access
     WHERE work_id=? AND epoch=0 AND sync_state='changing' AND sync_operation_id=?
     AND moderation_revision=? AND confirmed_moderation_revision=?
     AND EXISTS(SELECT 1 FROM cards c WHERE c.provider=managed_work_access.provider AND c.source_role_id=managed_work_access.source_role_id AND c.approved_hosted_role_id IS ?)
     AND EXISTS(SELECT 1 FROM author_visibility_operations a JOIN visibility_operations o ON o.work_id=a.work_id AND o.operation_id=a.provider_operation_id
      WHERE a.work_id=managed_work_access.work_id AND a.provider_operation_id=managed_work_access.sync_operation_id AND a.state='conflict' AND o.state='conflict'
      AND json_extract(a.command,'$.action')='bind' AND json_extract(a.command,'$.expectedEpoch')=0
      AND json_extract(o.command,'$.action')='bind' AND json_extract(o.command,'$.expectedEpoch')=0)
     AND NOT EXISTS(SELECT 1 FROM visibility_operations o WHERE o.work_id=managed_work_access.work_id AND o.state IN ('intent','pending'))
     AND NOT EXISTS(SELECT 1 FROM author_visibility_operations a WHERE a.work_id=managed_work_access.work_id AND a.state='pending')`)
     .bind(p.work_id,p.sync_operation_id,p.moderation_revision,p.confirmed_moderation_revision,p.card_approved_role).run();
    if(!removed.meta.changes)throw new HttpError(409,'visibility_operation_conflict');
    complete++;await bumpOp(env.DB,'work_access','reconcile','success');continue;
   }
   const restrictionRank={none:0,delisted:1,suspended:2};
   if(!r.managed||r.epoch<p.epoch||r.approvedRoleId!==(p.card_approved_role??'')||r.approvedRoleId!==(p.approved_role_id??'')
    ||restrictionRank[r.restriction as keyof typeof restrictionRank]<restrictionRank[p.restriction]
    ||(r.access==='public'&&(!p.card_version||!r.targetReadable||r.shareRoleId!==p.card_approved_role))
    ||(r.access==='unlisted'&&r.restriction!=='suspended'&&(!r.targetReadable||r.shareRoleId!==p.source_role_id))
    ||(r.epoch===p.epoch&&(p.sync_state!=='complete'||r.access!==p.access||r.restriction!==p.restriction)))throw new HttpError(503,'visibility_sync_pending');
   const guard=`EXISTS(SELECT 1 FROM managed_work_access p JOIN cards c ON c.provider=p.provider AND c.source_role_id=p.source_role_id
    WHERE p.work_id=? AND p.epoch=? AND p.sync_state=? AND p.sync_operation_id IS ?
    AND p.moderation_revision=? AND p.confirmed_moderation_revision=? AND c.approved_hosted_role_id IS ?)`;
   const args=[p.work_id,p.epoch,p.sync_state,p.sync_operation_id,p.moderation_revision,p.confirmed_moderation_revision,p.card_approved_role];
   const writes:D1PreparedStatement[]=[];
   if(r.epoch>p.epoch){
    writes.push(env.DB.prepare(`UPDATE review_submissions SET status='superseded',claimed_by=NULL,claimed_at=NULL,decided_at=?
     WHERE card_id=? AND status='pending' AND ${guard}`).bind(now,p.card_id,...args));
    writes.push(env.DB.prepare(`DELETE FROM review_snapshots WHERE submission_id IN(SELECT id FROM review_submissions WHERE card_id=? AND status='superseded') AND ${guard}`).bind(p.card_id,...args));
    writes.push(env.DB.prepare(`UPDATE cards SET status=? WHERE id=? AND ${guard}`).bind(r.access==='public'?'approved':'unshared',p.card_id,...args));
   }
   writes.push(env.DB.prepare(`UPDATE managed_work_access SET access=?,restriction=?,epoch=?,sync_state='complete',sync_operation_id=NULL
    WHERE work_id=? AND ${guard}`).bind(r.access,r.restriction,r.epoch,p.work_id,...args));
   const result=await env.DB.batch(writes);
   if(!result.at(-1)?.meta.changes)throw new HttpError(409,'visibility_operation_conflict');
   complete++;await bumpOp(env.DB,'work_access','reconcile','success');
  }catch{pending++;await bumpOp(env.DB,'work_access','reconcile','pending');}
 }
 return {complete,pending};
}
