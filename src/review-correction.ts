import { HttpError, pickLocale, type Env, type Localized } from './types';
import { reviewerRole } from './members';
import { getSubmission } from './review';
import { managedWork, policyOperationId, runWorkPolicyOperation, projectWorkReceipt, workPolicyGateway, type WorkPolicyCommand } from './work-policy';
import type { ProviderId } from './providers';
import { bumpOp } from './ops-metrics';
import {readCurrentWorkPolicies} from './work-read';

export const REVIEW_CORRECTION_TTL_MS = 24 * 60 * 60 * 1000;

export async function correctionEligibility(db:D1Database,id:string,member:string,now:number) {
 const [s,role,stamp]=await Promise.all([getSubmission(db,id),reviewerRole(db,member),db.prepare("SELECT 1 FROM review_stamps WHERE submission_id=? AND member_id=? AND verdict='approve'").bind(id,member).first()]);
 const manager=role==='manager'||role==='owner';
 return {canCorrect:s.status==='approved'&&(manager||!!stamp&&s.decided_at!==null&&now-s.decided_at<=REVIEW_CORRECTION_TTL_MS),manager,deadline:s.decided_at===null?null:s.decided_at+REVIEW_CORRECTION_TTL_MS};
}

interface Correction {
 operation_id:string;submission_id:string;actor_member_id:string;actor_role:string;note:string;
 original_decided_at:number;created_at:number;state:'pending'|'complete'|'conflict';command:string|null;
 public_version_id:string|null;public_state:'previous_version'|'unpublished'|'unchanged'|null;
}
const outcome=(x:Correction,replayed:boolean)=>({operationId:x.operation_id,status:'rejected' as const,publicVersionId:x.public_version_id,publicState:x.public_state,replayed});

/** One durable intent spans issuer/Provider. Unknown replies keep the work fenced;
 * retries recover the original operation and never reinterpret a later epoch. */
export async function correctReview(env:Env,input:{id:string;member:string;operationId:string;note:string;now:number}) {
 const db=env.DB;
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.operationId)||!input.note.trim()||input.note.trim().length>2000)throw new HttpError(400,'invalid review correction');
 const reason=input.note.trim(),s=await getSubmission(db,input.id);
 let x=await db.prepare("SELECT * FROM review_corrections WHERE operation_id=? OR (submission_id=? AND state<>'conflict') ORDER BY operation_id=? DESC LIMIT 1").bind(input.operationId,input.id,input.operationId).first<Correction>();
 if(x&&(x.submission_id!==input.id||x.operation_id!==input.operationId||x.actor_member_id!==input.member||x.note!==reason))throw new HttpError(409,'review_correction_changed');
 if(x?.state==='complete'){await bumpOp(db,'review_correction','correct','replay');return outcome(x,true);}
 if(x?.state==='conflict')throw new HttpError(409,'review_correction_changed');
 if(await db.prepare("SELECT 1 FROM card_rewards WHERE card_id=? AND public_days IS NOT NULL AND (status='pending' OR (status='paid' AND provider_entry_id IS NULL))").bind(s.card_id).first())throw new HttpError(503,'review_correction_reward_pending');
 if(!x){
  const eligibility=await correctionEligibility(db,input.id,input.member,input.now);
  if(s.status!=='approved')throw new HttpError(409,'review_correction_not_final');
  if(!eligibility.canCorrect)throw new HttpError(403,'review_correction_manager_required');
  const role=await reviewerRole(db,input.member);
  try{await db.prepare(`INSERT INTO review_corrections(operation_id,submission_id,actor_member_id,actor_role,note,original_decided_at,created_at)
   SELECT ?,id,?,?,?,?,? FROM review_submissions WHERE id=? AND status='approved' AND decided_at=?
   ON CONFLICT DO NOTHING`).bind(input.operationId,input.member,role,reason,s.decided_at,input.now,input.id,s.decided_at).run();}catch(error){if(String(error).includes('review correction reward pending'))throw new HttpError(503,'review_correction_reward_pending');throw error;}
  x=await db.prepare("SELECT * FROM review_corrections WHERE submission_id=? AND state<>'conflict'").bind(input.id).first<Correction>();
  if(!x||x.operation_id!==input.operationId||x.actor_member_id!==input.member||x.note!==reason)throw new HttpError(409,'review_correction_changed');
 }
 const v=await db.prepare('SELECT version_id,work_id,source_role_id,hosted_revision_id FROM hosting_versions WHERE submission_id=?').bind(s.id).first<{version_id:string;work_id:string;source_role_id:string;hosted_revision_id:string}>();
 if(!v?.hosted_revision_id)throw new HttpError(409,'review_correction_version_unavailable');
 const provider=s.provider as ProviderId;
 let managed=await managedWork(db,provider,v.source_role_id);
 if(!managed||managed.epoch===0){
  // Bootstrap from issuer-approved history, under a stable operation/fence.
  const bindId=await policyOperationId('review-correction-bind:'+x.operation_id);
  const saved=await db.prepare('SELECT command FROM visibility_operations WHERE operation_id=? AND work_id=?').bind(bindId,v.work_id).first<{command:string}>();
  const card=await db.prepare('SELECT approved_hosted_role_id,public_blocked,board_hidden,status FROM cards WHERE id=?').bind(s.card_id).first<{approved_hosted_role_id:string;public_blocked:number;board_hidden:number;status:string}>();
  const grants=await db.prepare("SELECT hosted_revision_id FROM hosting_versions WHERE work_id=? AND state='approved' ORDER BY version_id").bind(v.work_id).all<{hosted_revision_id:string}>();
  const bind:WorkPolicyCommand=saved?JSON.parse(saved.command):{workId:v.work_id,operationId:bindId,expectedEpoch:0,action:'bind',access:card?.status==='approved'?'public':'private',restriction:card?.public_blocked?'suspended':card?.board_hidden?'delisted':'none',versionRoleId:card?.approved_hosted_role_id,approvedRoles:grants.results.map(r=>r.hosted_revision_id)};
  await db.prepare("INSERT OR IGNORE INTO managed_work_access(work_id,provider,source_role_id,access,epoch,restriction,approved_role_id,sync_state,sync_operation_id) VALUES(?,?,?,?,0,?,?,'changing',?)")
   .bind(v.work_id,provider,v.source_role_id,bind.access!,bind.restriction!,bind.versionRoleId??null,bindId).run();
  managed=await managedWork(db,provider,v.source_role_id);
  if(managed?.sync_operation_id!==bindId)throw new HttpError(409,'review_correction_changed');
  const receipt=await runWorkPolicyOperation(env,provider,v.source_role_id,bind,undefined,x.operation_id);
  await projectWorkReceipt(env,provider,receipt,bind.versionRoleId);
  managed=await managedWork(db,provider,v.source_role_id);
 }
 if(!managed)throw new HttpError(503,'visibility_sync_pending');
 if(!x.command){
  const card=await db.prepare('SELECT approved_version_id FROM cards WHERE id=?').bind(s.card_id).first<{approved_version_id:string|null}>();
  const fallback=await db.prepare(`SELECT v.version_id,v.hosted_revision_id FROM hosting_versions v JOIN review_submissions s ON s.id=v.submission_id
   WHERE v.work_id=? AND v.state='approved' AND s.status='approved' AND s.id<>? AND s.decided_at<=?
   AND NOT EXISTS(SELECT 1 FROM moderation_blocked_versions b WHERE b.version_id=v.version_id)
   ORDER BY s.decided_at DESC,v.created_at DESC,v.version_id DESC LIMIT 1`).bind(v.work_id,s.id,s.decided_at).first<{version_id:string;hosted_revision_id:string}>();
  const rewards=await db.prepare("SELECT provider_entry_id FROM card_rewards WHERE card_id=? AND status='paid' AND public_days IS NOT NULL AND provider_entry_id IS NOT NULL ORDER BY id").bind(s.card_id).all<{provider_entry_id:string}>();
  const command:WorkPolicyCommand={workId:v.work_id,operationId:x.operation_id,expectedEpoch:managed.epoch,action:'correct_review',versionRoleId:v.hosted_revision_id,approvedRoles:fallback?[fallback.hosted_revision_id]:[],rewardPayoutEntryIds:rewards.results.map(r=>r.provider_entry_id)};
  const current=card?.approved_version_id===v.version_id;
  try{await db.batch([
   db.prepare("UPDATE managed_work_access SET sync_state='changing',sync_operation_id=? WHERE work_id=? AND epoch=? AND sync_operation_id IS NULL").bind(x.operation_id,v.work_id,command.expectedEpoch),
   db.prepare(`UPDATE review_corrections SET command=?,public_version_id=?,public_state=? WHERE operation_id=? AND command IS NULL`)
    .bind(JSON.stringify(command),current?fallback?.version_id??null:card?.approved_version_id??null,current?fallback?'previous_version':'unpublished':'unchanged',x.operation_id),
  ]);}catch(error){if(String(error).includes('review correction changed')){await db.prepare("UPDATE review_corrections SET state='conflict' WHERE operation_id=? AND state='pending' AND command IS NULL").bind(x.operation_id).run();throw new HttpError(409,'review_correction_changed');}throw error;}
  x=(await db.prepare('SELECT * FROM review_corrections WHERE operation_id=?').bind(x.operation_id).first<Correction>())!;
 }
 const command=JSON.parse(x.command!) as WorkPolicyCommand;
 const priorOperation=await db.prepare("SELECT state FROM visibility_operations WHERE work_id=? AND operation_id=?").bind(v.work_id,x.operation_id).first<{state:string}>();
 const fenceEpoch=priorOperation?.state==='complete'?managed.epoch:command.expectedEpoch;
 const fenced=await db.prepare(`UPDATE managed_work_access SET sync_state='changing',sync_operation_id=? WHERE work_id=? AND epoch=?
  AND (sync_operation_id IS NULL OR sync_operation_id=?)`).bind(x.operation_id,v.work_id,fenceEpoch,x.operation_id).run();
 if(!fenced.meta.changes){
  const latest=await db.prepare('SELECT * FROM review_corrections WHERE operation_id=?').bind(x.operation_id).first<Correction>();
  if(latest?.state==='complete')return outcome(latest,true);
  throw new HttpError(409,'review_correction_changed');
 }
 let receipt;
 try{receipt=await runWorkPolicyOperation(env,provider,v.source_role_id,command);}catch(error){
  const conflict=error instanceof HttpError&&error.status===409;
  await bumpOp(db,'review_correction','correct',conflict?'conflict':'pending');
  if(conflict){
   // A definitive refusal is not an unknown result. Confirm absence of this
   // command and fresh policy identity before allowing a newly confirmed intent.
   const operation=await workPolicyGateway.operation(env,provider,v.source_role_id,v.work_id,x.operation_id);
   const card=await db.prepare('SELECT approved_hosted_role_id FROM cards WHERE id=?').bind(s.card_id).first<{approved_hosted_role_id:string|null}>();
   const [current]=await readCurrentWorkPolicies(env,[{sourceRoleId:v.source_role_id,workId:v.work_id,targetRoleId:card?.approved_hosted_role_id??v.source_role_id}]);
   if(!operation&&current.managed&&current.epoch>command.expectedEpoch&&current.approvedRoleId===(card?.approved_hosted_role_id??'')){
    await db.batch([
     db.prepare(`UPDATE managed_work_access SET epoch=?,access=?,restriction=?,sync_state='complete',sync_operation_id=NULL
      WHERE work_id=? AND epoch=? AND sync_operation_id=?`).bind(current.epoch,current.access,current.restriction,v.work_id,command.expectedEpoch,x.operation_id),
     db.prepare(`UPDATE review_corrections SET state='conflict' WHERE operation_id=? AND state='pending'
      AND EXISTS(SELECT 1 FROM managed_work_access WHERE work_id=? AND epoch=? AND sync_state='complete' AND sync_operation_id IS NULL)`)
      .bind(x.operation_id,v.work_id,current.epoch),
     db.prepare(`UPDATE cards SET status=? WHERE id=? AND approved_version_id IS NOT NULL
      AND EXISTS(SELECT 1 FROM review_corrections WHERE operation_id=? AND state='conflict')`)
      .bind(current.access==='public'?'approved':'unshared',s.card_id,x.operation_id),
    ]);
   }
  }
  throw error;
 }
 const live=await workPolicyGateway.state(env,provider,v.source_role_id);
 if(!live||live.workId!==v.work_id||live.epoch<receipt.epoch)throw new HttpError(409,'review_correction_changed');
 if(live.epoch!==receipt.epoch){
  const expected=await db.prepare('SELECT hosted_revision_id FROM hosting_versions WHERE version_id=?').bind(x.public_version_id).first<{hosted_revision_id:string}>();
  const [current]=await readCurrentWorkPolicies(env,[{sourceRoleId:v.source_role_id,workId:v.work_id,targetRoleId:expected?.hosted_revision_id??v.source_role_id}]);
  if(!current.managed||current.epoch!==live.epoch||current.approvedRoleId!==(expected?.hosted_revision_id??''))throw new HttpError(409,'review_correction_changed');
  // The correction already committed. Preserve newer access/restriction facts
  // without resending or rebasing the original destructive command.
  receipt={...receipt,epoch:current.epoch,access:current.access,restriction:current.restriction};
 }else if(live.access!==receipt.access||live.restriction!==receipt.restriction)throw new HttpError(409,'review_correction_changed');
 const writes:D1PreparedStatement[]=[
  db.prepare("UPDATE review_corrections SET state='applying' WHERE operation_id=?").bind(x.operation_id),
  db.prepare(`UPDATE managed_work_access SET access=?,restriction=?,epoch=?,approved_role_id=(SELECT hosted_revision_id FROM hosting_versions WHERE version_id=?),sync_state='complete',sync_operation_id=NULL WHERE work_id=? AND sync_operation_id=? AND epoch=?`)
   .bind(receipt.access,receipt.restriction,receipt.epoch,x.public_version_id,v.work_id,x.operation_id,fenceEpoch),
  db.prepare("UPDATE review_submissions SET status='rejected',note=? WHERE id=? AND status='approved'").bind(x.note,s.id),
  db.prepare("UPDATE hosting_versions SET state='rejected' WHERE version_id=?").bind(v.version_id),
 ];
 if(x.public_state!=='unchanged'){
  const replacement=x.public_version_id?await db.prepare('SELECT public_role,rating FROM hosting_versions WHERE version_id=?').bind(x.public_version_id).first<{public_role:string;rating:string|null}>():null;
  if(replacement){
   const role=JSON.parse(replacement.public_role);
   writes.push(db.prepare(`UPDATE cards SET approved_version_id=?,approved_hosted_role_id=(SELECT hosted_revision_id FROM hosting_versions WHERE version_id=?),status=?,reviewed_hash=(SELECT content_hash FROM review_submissions WHERE id=(SELECT submission_id FROM hosting_versions WHERE version_id=?)),
    names=?,summaries=?,rating=?,rating_descriptors=(SELECT rating_descriptors FROM review_submissions WHERE id=(SELECT submission_id FROM hosting_versions WHERE version_id=?)),zone=?,tags=?,background_url=?,share_image_url=?,landscape_url=?,slug=?,search_name=?,search_text=?,search_body=?,fandom=?,fandom_key=?,fandom_qid=? WHERE id=?`)
    .bind(x.public_version_id,x.public_version_id,receipt.access==='public'?'approved':'unshared',x.public_version_id,JSON.stringify(role.names),JSON.stringify(role.summaries),replacement.rating,x.public_version_id,role.zone,JSON.stringify(role.tags),role.backgroundUrl||role.avatarUrl||null,role.shareImageUrl||null,role.backgroundLandscapeUrl||null,role.slug??null,role.searchName??'',role.searchText??'',role.searchBody??'',role.fandom??'',role.fandomKey??'',role.fandomQid??null,s.card_id));
  }else writes.push(db.prepare("UPDATE cards SET status='rejected',approved_version_id=NULL,approved_hosted_role_id=NULL,reviewed_hash='' WHERE id=?").bind(s.card_id));
 }
 writes.push(
  db.prepare(`INSERT OR IGNORE INTO community_notifications(event_key,member_id,kind,path,created_at,card_id,extra)
   SELECT ?,o.member_id,'review_result',?, ?,o.card_id,? FROM community_card_owners o WHERE o.card_id=? AND o.member_id IS NOT NULL
   AND NOT EXISTS(SELECT 1 FROM community_preferences p WHERE p.member_id=o.member_id AND p.notifications=0)`)
   .bind('review-correction:'+x.operation_id,'/mine/reviews/'+s.id,input.now,JSON.stringify({status:'rejected',kind:s.kind,note:x.note.slice(0,500),correction:true,rewardKept:!!command.rewardPayoutEntryIds?.length,versionId:v.version_id}),s.card_id),
  db.prepare("UPDATE review_corrections SET state='complete',completed_at=?,public_state=?,public_version_id=? WHERE operation_id=? AND state='applying'")
   .bind(input.now,receipt.access==='public'&&receipt.restriction!=='suspended'?x.public_state:'unpublished',receipt.access==='public'&&receipt.restriction!=='suspended'?x.public_version_id:null,x.operation_id),
  db.prepare("INSERT INTO ops_metrics VALUES('review_correction','correct','success',1) ON CONFLICT(metric,operation,outcome) DO UPDATE SET value=value+1"),
 );
 try{await db.batch(writes);}catch(error){
  const latest=await db.prepare('SELECT * FROM review_corrections WHERE operation_id=?').bind(x.operation_id).first<Correction>();
  if(latest?.state==='complete')return outcome(latest,true);
  throw error;
 }
 const completed=(await db.prepare('SELECT * FROM review_corrections WHERE operation_id=?').bind(x.operation_id).first<Correction>())!;
 return outcome(completed,false);
}

/** Metadata of versions this reviewer handled; never author identities or private snapshots. */
export async function listReviewDecisions(db:D1Database, member:string, now:number, lang:string, before?:number) {
  const rows=await db.prepare(`SELECT st.rowid cursor,s.id,s.status,s.kind,s.decided_at,s.submitted_at,st.verdict,st.note,st.created_at,
    EXISTS(SELECT 1 FROM review_corrections x WHERE x.submission_id=s.id AND x.state='complete') corrected,
    v.version_id,c.id card_id,coalesce(json_extract(v.public_role,'$.names'),c.names) names
    FROM review_stamps st JOIN review_submissions s ON s.id=st.submission_id JOIN cards c ON c.id=s.card_id
    LEFT JOIN hosting_versions v ON v.submission_id=s.id
    WHERE st.member_id=? AND st.rowid<? ORDER BY st.rowid DESC LIMIT 51`)
    .bind(member,before??Number.MAX_SAFE_INTEGER).all<{
      cursor:number;id:string;status:string;kind:string;decided_at:number|null;submitted_at:number;corrected:number;verdict:string;note:string;created_at:number;
      version_id:string|null;card_id:string;names:string;
    }>();
  const page=rows.results.slice(0,50);
  return {items:page.map(r=>({
    id:r.id,status:r.status,kind:r.kind,verdict:r.verdict,note:r.note,at:r.created_at,
    submittedAt:r.submitted_at,corrected:!!r.corrected,decidedAt:r.decided_at,versionId:r.version_id,card:{id:String(r.card_id),name:pickLocale(JSON.parse(r.names) as Localized,lang)},
    canCorrect:r.status==='approved'&&r.verdict==='approve'&&r.decided_at!==null&&now-r.decided_at<=REVIEW_CORRECTION_TTL_MS,
  })),nextCursor:rows.results.length>50?page.at(-1)!.cursor:null};
}
