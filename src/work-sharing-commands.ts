import {apiBaseOf} from './providers';
import {assertNormalMember} from './test-accounts';
import {Hono} from 'hono';
import {bodyLimit} from 'hono/body-limit';
import {getCard,upsertCard,finishManagedWithdrawal,type CardRow} from './cards';
import {hostGateway} from './hosting';
import {requireMember,resolveMember} from './members';
import {ownerCardSource,readOwnerVisibility} from './work-sharing';
import {managedWork,policyOperationId,workPolicyCommandHash,runWorkPolicyOperation,workPolicyGateway,type WorkPolicyCommand,type WorkPolicyReceipt,type WorkOwnerView} from './work-policy';
import {bumpOp} from './ops-metrics';
import {type Env,HttpError} from './types';

export interface AuthorOperation {member_id:string;operation_id:string;source_role_id:string;work_id:string;provider_operation_id:string;intent:string;command:string;state:'pending'|'complete'|'conflict'}
interface AuthorCommand {operationId:string;action:'set_access'|'cancel_review';targetAccess?:'private'|'unlisted'|'public';expectedPolicyRevision:string;expectedApprovalRevision:string}
function parseCommand(value:unknown):AuthorCommand{
 const b=value as Record<string,unknown>|null;
 if(!b||Array.isArray(b)||Object.keys(b).some(k=>!['operationId','action','targetAccess','expectedPolicyRevision','expectedApprovalRevision'].includes(k))
  ||typeof b.operationId!=='string'||!(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(b.operationId))
  ||typeof b.expectedPolicyRevision!=='string'||b.expectedPolicyRevision.length>128||b.expectedPolicyRevision.length<16
  ||typeof b.expectedApprovalRevision!=='string'||b.expectedApprovalRevision.length>128||b.expectedApprovalRevision.length<16
  ||(b.action!==undefined&&b.action!=='set_access'&&b.action!=='cancel_review')
  ||(b.action==='cancel_review'?b.targetAccess!==undefined:!['private','unlisted','public'].includes(String(b.targetAccess))))throw new HttpError(400,'invalid_arguments');
 return {operationId:b.operationId,action:b.action==='cancel_review'?'cancel_review':'set_access',...(b.action==='cancel_review'?{}:{targetAccess:b.targetAccess as AuthorCommand['targetAccess']}),expectedPolicyRevision:b.expectedPolicyRevision,expectedApprovalRevision:b.expectedApprovalRevision};
}
const findOperation=(env:Env,member:string,id:string)=>env.DB.prepare('SELECT * FROM author_visibility_operations WHERE member_id=? AND operation_id=?').bind(member,id).first<AuthorOperation>();

// Old DELETE is explicit author intent to withdraw. Enroll it through the same
// durable aggregate as the new command; it must never delete the community row.
export async function withdrawLegacyVisibility(env:Env,row:CardRow,account:number,token:string):Promise<void>{
 const source=row.source_role_id,memberId=await resolveMember(env.DB,'harbor',account,Date.now());
 let op=await env.DB.prepare("SELECT * FROM author_visibility_operations WHERE member_id=? AND source_role_id=? AND state='pending' AND json_extract(intent,'$.targetAccess')='private' ORDER BY created_at DESC LIMIT 1").bind(memberId,source).first<AuthorOperation>();
 if(op)await workPolicyGateway.owner(env,'harbor',source,token,true);
 else{
  const view=await readOwnerVisibility(env,source,token,row,true);
  if(view.workVisibility.syncState!=='complete')throw new HttpError(503,'visibility_sync_pending');
  if(!view.workVisibility.actions.includes('set_private'))throw new HttpError(409,'visibility_restricted');
  const command:AuthorCommand={operationId:await policyOperationId('legacy-withdraw:'+memberId+':'+source+':'+view.workVisibility.policyRevision),action:'set_access',targetAccess:'private',expectedPolicyRevision:view.workVisibility.policyRevision,expectedApprovalRevision:view.workVisibility.approvalRevision};
  const intent=JSON.stringify(command);
  await enrollAuthorOperation(env,{id:memberId,externalId:account},source,token,row,command,intent,view.provider);
  op=await findOperation(env,memberId,command.operationId);
 }
 if(!op)throw new HttpError(409,'visibility_operation_conflict');
 let state:AuthorOperation['state'];
 try{state=await recoverAuthorVisibility(env,op,token);}catch{state='pending';}
 if(state==='conflict')throw new HttpError(409,'visibility_operation_conflict');
 if(state!=='complete')throw new HttpError(503,'visibility_sync_pending',undefined,{operationId:op.operation_id,state:'pending'});
}

async function enrollAuthorOperation(env:Env,member:{id:string;externalId:number},source:string,token:string,row:CardRow|null,command:AuthorCommand,intent:string,owner:WorkOwnerView):Promise<void>{
 await assertNormalMember(env.DB,member.id);
 if(command.action==='cancel_review')throw new HttpError(409,'visibility_operation_conflict');
 if(command.targetAccess==='public')throw new HttpError(409,'review_required');
 const role=await hostGateway.read(env,token,source,'harbor');
 if(role.roleId!==source||role.authorNumId!==member.externalId)throw new HttpError(403,'not_the_author');
 if(role.creationMethod!=='hearthroom')throw new HttpError(403,'only cards created on this site can be listed');
 const now=Date.now();
 await env.DB.prepare("INSERT OR IGNORE INTO works(id,member_id,source_provider,source_role_id,created_at) VALUES(?,?,'harbor',?,?)").bind(crypto.randomUUID(),member.id,source,now).run();
 const work=await env.DB.prepare("SELECT id,member_id FROM works WHERE source_provider='harbor' AND source_role_id=?").bind(source).first<{id:string;member_id:string}>();
 if(!work||work.member_id!==member.id)throw new HttpError(403,'not_the_author');
 const grants=await env.DB.prepare("SELECT hosted_revision_id FROM hosting_versions WHERE work_id=? AND state='approved' AND hosted_revision_id IS NOT NULL ORDER BY version_id").bind(work.id).all<{hosted_revision_id:string}>();
 const providerOperation=await policyOperationId('author:'+member.id+':'+command.operationId);
 const restriction=row?.public_blocked?'suspended':row?.board_hidden?'delisted':'none';
 const pg:WorkPolicyCommand={workId:work.id,operationId:providerOperation,expectedEpoch:0,expectedOwnerRevision:owner.policyRevision,action:'bind',access:command.targetAccess!,restriction,
  ...(row?.approved_hosted_role_id?{versionRoleId:row.approved_hosted_role_id}:{}),approvedRoles:grants.results.map(g=>g.hosted_revision_id)};
 const hash=await workPolicyCommandHash('harbor',source,pg);
 // The community row and first managed fence commit together. An unknown bind
 // must never leave an unclassified legacy row readable through link preview.
 await upsertCard(env.DB,role,0,{status:'unshared',preserveExisting:true,additionalWrites:cardId=>[
  env.DB.prepare(`INSERT OR IGNORE INTO managed_work_access(work_id,provider,source_role_id,access,epoch,restriction,approved_role_id,sync_state,sync_operation_id) VALUES(?,'harbor',?,?,0,?,?,'changing',?)`).bind(work.id,source,command.targetAccess,restriction,row?.approved_hosted_role_id??null,providerOperation),
  env.DB.prepare(`INSERT OR IGNORE INTO author_visibility_operations(member_id,operation_id,source_role_id,work_id,provider_operation_id,intent,command,state,created_at,updated_at) SELECT ?,?,?,?,?,?,?,'pending',?,? WHERE EXISTS(SELECT 1 FROM managed_work_access WHERE work_id=? AND epoch=0 AND sync_operation_id=?)`).bind(member.id,command.operationId,source,work.id,providerOperation,intent,JSON.stringify(pg),now,now,work.id,providerOperation),
  env.DB.prepare(`INSERT OR IGNORE INTO visibility_operations(work_id,operation_id,root_operation_id,command,intent_hash,state,updated_at) SELECT work_id,provider_operation_id,provider_operation_id,command,?,'intent',? FROM author_visibility_operations WHERE member_id=? AND operation_id=? AND intent=? AND state='pending'`).bind(hash,now,member.id,command.operationId,intent),
  env.DB.prepare(`UPDATE cards SET rating='R' WHERE id=? AND approved_version_id IS NULL AND EXISTS(SELECT 1 FROM managed_work_access WHERE work_id=? AND sync_operation_id=?)`).bind(cardId,work.id,providerOperation),
 ]});
}

// Only this source's unchanged, still-owned fence can complete. Historical PG
// receipts are never permission to overwrite a newer epoch or another command.
async function finalize(env:Env,op:AuthorOperation,receipt:WorkPolicyReceipt):Promise<void>{
 const p=await managedWork(env.DB,'harbor',op.source_role_id);
 const current=await workPolicyGateway.state(env,'harbor',op.source_role_id);
 if(!p||!current||current.workId!==op.work_id||current.epoch!==receipt.epoch||current.access!==receipt.access||current.restriction!==receipt.restriction)throw new HttpError(409,'visibility_operation_conflict');
 if(p.sync_operation_id!==op.provider_operation_id)throw new HttpError(409,'visibility_operation_conflict');
 const card=await getCard(env.DB,op.source_role_id,'harbor');if(!card)throw new HttpError(503,'visibility_sync_pending');
 const guard="EXISTS(SELECT 1 FROM managed_work_access WHERE work_id=? AND sync_operation_id=? AND sync_state='changing' AND moderation_revision=confirmed_moderation_revision)";
 const confirmed="EXISTS(SELECT 1 FROM managed_work_access WHERE work_id=? AND epoch=? AND access=? AND restriction=? AND sync_state='complete' AND sync_operation_id IS NULL AND moderation_revision=confirmed_moderation_revision)";
 const status=receipt.access==='public'?'approved':'unshared';
 const writes=[
  env.DB.prepare(`UPDATE review_submissions SET status='superseded',claimed_by=NULL,claimed_at=NULL,decided_at=? WHERE card_id=? AND status='pending' AND ${guard}`).bind(Date.now(),card.id,op.work_id,op.provider_operation_id),
  env.DB.prepare(`DELETE FROM review_snapshots WHERE submission_id IN(SELECT id FROM review_submissions WHERE card_id=? AND status='superseded') AND ${guard}`).bind(card.id,op.work_id,op.provider_operation_id),
  env.DB.prepare(`UPDATE work_publication_permits SET state='cancelled' WHERE state='prepared' AND version_id IN(SELECT version_id FROM hosting_versions WHERE work_id=? AND state='superseded') AND ${guard}`).bind(op.work_id,op.work_id,op.provider_operation_id),
  // The database publication guard requires this projection before a retained
  // unshared card may become approved. Both writes remain in one D1 transaction.
  env.DB.prepare(`UPDATE managed_work_access SET access=?,epoch=?,restriction=?,sync_state='complete',sync_operation_id=NULL WHERE work_id=? AND sync_operation_id=? AND epoch<=? AND moderation_revision=confirmed_moderation_revision`).bind(receipt.access,receipt.epoch,receipt.restriction,op.work_id,op.provider_operation_id,receipt.epoch),
  env.DB.prepare(`UPDATE cards SET status=? WHERE id=? AND ${confirmed}`).bind(status,card.id,op.work_id,receipt.epoch,receipt.access,receipt.restriction),
  env.DB.prepare(`UPDATE author_visibility_operations SET state='complete',updated_at=? WHERE member_id=? AND operation_id=? AND state='pending' AND EXISTS(SELECT 1 FROM managed_work_access WHERE work_id=? AND epoch=? AND sync_state='complete' AND sync_operation_id IS NULL)`).bind(Date.now(),op.member_id,op.operation_id,op.work_id,receipt.epoch),
 ];
 const results=await env.DB.batch(writes);if(!results[3].meta.changes||!results[4].meta.changes||!results[5].meta.changes)throw new HttpError(409,'visibility_operation_conflict');
 await bumpOp(env.DB,'work_access',(JSON.parse(op.command) as WorkPolicyCommand).action,'success');
}
async function authorConflict(env:Env,op:AuthorOperation):Promise<'conflict'>{
 await env.DB.prepare("UPDATE author_visibility_operations SET state='conflict',updated_at=? WHERE member_id=? AND operation_id=? AND state='pending'").bind(Date.now(),op.member_id,op.operation_id).run();
 return 'conflict';
}
export async function recoverAuthorVisibility(env:Env,op:AuthorOperation,token?:string):Promise<AuthorOperation['state']>{
 await assertNormalMember(env.DB,op.member_id);
 const latest=await findOperation(env,op.member_id,op.operation_id);if(!latest)throw new HttpError(404,'card_not_found');
 if(latest.state!=='pending')return latest.state;
 const fence=await managedWork(env.DB,'harbor',op.source_role_id);
 if(fence?.sync_operation_id!==op.provider_operation_id||fence.sync_state!=='changing'){
  const again=await findOperation(env,op.member_id,op.operation_id);if(again?.state==='complete')return 'complete';
  await env.DB.batch([
   env.DB.prepare("UPDATE author_visibility_operations SET state='conflict',updated_at=? WHERE member_id=? AND operation_id=? AND state='pending'").bind(Date.now(),op.member_id,op.operation_id),
   env.DB.prepare("UPDATE visibility_operations SET state='conflict',updated_at=? WHERE work_id=? AND operation_id=? AND state IN ('intent','pending')").bind(Date.now(),op.work_id,op.provider_operation_id),
  ]);return 'conflict';
 }
 const command=JSON.parse(op.command) as WorkPolicyCommand;
 // An explicit Provider CAS refusal is terminal even if the process stopped
 // after persisting the lower-level refusal and before updating this aggregate.
 const intent=await env.DB.prepare('SELECT state FROM visibility_operations WHERE work_id=? AND operation_id=?').bind(op.work_id,op.provider_operation_id).first<{state:string}>();
 if(intent?.state==='conflict')return authorConflict(env,op);
 let receipt:WorkPolicyReceipt|null;
 try{
  receipt=await workPolicyGateway.operation(env,'harbor',op.source_role_id,op.work_id,op.provider_operation_id);
  if(!receipt){if(!token)return 'pending';receipt=await runWorkPolicyOperation(env,'harbor',op.source_role_id,command,token);}
 }catch(error){
  if(error instanceof HttpError&&error.status===409)return authorConflict(env,op);
  throw error;
 }
 if(receipt.state!=='complete')return 'pending';
 await env.DB.prepare("UPDATE visibility_operations SET state='complete',receipt=?,updated_at=? WHERE work_id=? AND operation_id=?").bind(JSON.stringify(receipt),Date.now(),op.work_id,op.provider_operation_id).run();
 try{await finalize(env,op,receipt);return 'complete';}
 catch(error){
  if(error instanceof HttpError&&error.status===409)return authorConflict(env,op);
  throw error;
 }
}

export const workSharingCommandRoutes=new Hono<{Bindings:Env}>();
workSharingCommandRoutes.post('/v1/me/cards/:id/visibility',bodyLimit({maxSize:4096}),async c=>{
 c.header('Cache-Control','private, no-store');const member=await requireMember(c);
 if(c.env.WORK_SHARING_ENABLED!=='true')throw new HttpError(409,'visibility_disabled');
 if(member.provider!=='harbor')throw new HttpError(404,'card_not_found');
 const command=parseCommand(await c.req.json().catch(()=>null));const intent=JSON.stringify(command);
 const {source,row}=await ownerCardSource(c.env,c.req.param('id'));const token=c.req.header('Authorization')!.replace(/^Bearer\s+/i,'');
 let op=await findOperation(c.env,member.id,command.operationId);
 if(op&&(op.source_role_id!==source||op.intent!==intent))throw new HttpError(409,'visibility_operation_conflict');
 if(op)await workPolicyGateway.owner(c.env,'harbor',source,token,true);
 if(!op){
  const view=await readOwnerVisibility(c.env,source,token,row,true);
  if(command.action!=='cancel_review'&&command.targetAccess!=='public'&&view.workVisibility.rewardRetention){const r=view.workVisibility.rewardRetention;throw new HttpError(409,'card_reward_public_locked',undefined,{publicUntil:r.publicUntil,publicDays:r.days,requiredCredits:r.recoveryCredits});}
  if(view.workVisibility.policyRevision!==command.expectedPolicyRevision||view.workVisibility.approvalRevision!==command.expectedApprovalRevision)throw new HttpError(409,'visibility_operation_conflict');
  if(view.workVisibility.syncState!=='complete')throw new HttpError(503,'visibility_sync_pending');
  if(command.action==='cancel_review'&&!view.workVisibility.actions.includes('cancel_review'))throw new HttpError(409,'visibility_operation_conflict');
  if(view.workVisibility.restriction==='takedown'||(view.workVisibility.restriction==='suspended'&&command.targetAccess!=='private'))throw new HttpError(409,'visibility_restricted');
  const p=await managedWork(c.env.DB,'harbor',source);
  if(!p){
   await enrollAuthorOperation(c.env,member,source,token,row,command,intent,view.provider);
  }else{
  if(!row)throw new HttpError(503,'visibility_sync_pending');
  const action:WorkPolicyCommand['action']=command.action==='cancel_review'?'cancel':command.targetAccess==='public'?'restore':command.targetAccess!;
  if((view.workVisibility.restriction==='suspended'&&action!=='private')||(action==='restore'&&view.workVisibility.restriction!=='none'))throw new HttpError(409,'visibility_restricted');
  if(action==='restore'&&(!view.workVisibility.restorable||!row.approved_version_id||!row.approved_hosted_role_id))throw new HttpError(409,'review_required');
  const pending=await c.env.DB.prepare("SELECT g.operation_id FROM work_publication_permits g JOIN hosting_versions v ON v.version_id=g.version_id JOIN review_submissions s ON s.id=v.submission_id WHERE v.work_id=? AND s.status='pending' AND g.state IN ('prepared','published') ORDER BY v.created_at DESC LIMIT 1").bind(p.work_id).first<{operation_id:string}>();
  const providerOperation=await policyOperationId('author:'+member.id+':'+command.operationId);
  const pg:WorkPolicyCommand={workId:p.work_id,operationId:providerOperation,expectedEpoch:view.provider.epoch,expectedOwnerRevision:view.provider.policyRevision,action,...(pending?{permitId:pending.operation_id}:{})};
  const now=Date.now(),hash=await workPolicyCommandHash('harbor',source,pg);
  await c.env.DB.batch([
   c.env.DB.prepare(`INSERT OR IGNORE INTO author_visibility_operations(member_id,operation_id,source_role_id,work_id,provider_operation_id,intent,command,state,created_at,updated_at) SELECT ?,?,?,?,?,?,?,'pending',?,? WHERE EXISTS(SELECT 1 FROM managed_work_access WHERE work_id=? AND epoch=? AND sync_state='complete' AND moderation_revision=confirmed_moderation_revision)`).bind(member.id,command.operationId,source,p.work_id,providerOperation,intent,JSON.stringify(pg),now,now,p.work_id,p.epoch),
   c.env.DB.prepare(`INSERT OR IGNORE INTO visibility_operations(work_id,operation_id,root_operation_id,command,intent_hash,state,updated_at) SELECT work_id,provider_operation_id,provider_operation_id,command,?,'intent',? FROM author_visibility_operations WHERE member_id=? AND operation_id=? AND intent=? AND state='pending'`).bind(hash,now,member.id,command.operationId,intent),
   c.env.DB.prepare(`UPDATE managed_work_access SET sync_state='changing',sync_operation_id=? WHERE work_id=? AND epoch=? AND sync_state='complete' AND moderation_revision=confirmed_moderation_revision AND EXISTS(SELECT 1 FROM author_visibility_operations WHERE member_id=? AND operation_id=? AND intent=? AND state='pending')`).bind(providerOperation,p.work_id,p.epoch,member.id,command.operationId,intent),
  ]);
  }
  op=await findOperation(c.env,member.id,command.operationId);if(!op||op.intent!==intent)throw new HttpError(409,'visibility_operation_conflict');
 }
 let state=op.state;
 try{state=await recoverAuthorVisibility(c.env,op,token);}catch(error){if(error instanceof HttpError&&error.status===409)throw error;state='pending';}
 if(state==='pending')return c.json({operation:{operationId:op.operation_id,state}},202);
 if(state==='conflict')return c.json({error:'visibility_operation_conflict',operation:{operationId:op.operation_id,state}},409);
 const latest=await readOwnerVisibility(c.env,source,token,await getCard(c.env.DB,source,'harbor'));
 return c.json({workVisibility:latest.workVisibility,operation:{operationId:op.operation_id,state}},200);
});
workSharingCommandRoutes.get('/v1/me/cards/:id/visibility/operations/:operationId',async c=>{
 c.header('Cache-Control','private, no-store');const member=await requireMember(c);
 const {source,row}=await ownerCardSource(c.env,c.req.param('id'));const token=c.req.header('Authorization')!.replace(/^Bearer\s+/i,'');
 await workPolicyGateway.owner(c.env,'harbor',source,token);
 const op=await findOperation(c.env,member.id,c.req.param('operationId'));if(!op||op.source_role_id!==source)throw new HttpError(404,'visibility_operation_not_found');
 let state=op.state;try{state=await recoverAuthorVisibility(c.env,op);}catch{state='pending';}
 if(state==='pending')return c.json({operation:{operationId:op.operation_id,state}},202);
 if(state==='conflict')return c.json({error:'visibility_operation_conflict',operation:{operationId:op.operation_id,state}},409);
 const latest=await readOwnerVisibility(c.env,source,token,await getCard(c.env.DB,source,'harbor'));
 return c.json({workVisibility:latest.workVisibility,operation:{operationId:op.operation_id,state}},200);
});

// Delete first in the Provider's financial transaction. A rejected or unknown
// result must never withdraw a still-existing public card from the community.
workSharingCommandRoutes.post('/v1/me/cards/:id/delete',bodyLimit({maxSize:1024}),async c=>{
 c.header('Cache-Control','private, no-store');const member=await requireMember(c);
 if(member.provider!=='harbor')throw new HttpError(404,'card_not_found');
 const body=await c.req.json().catch(()=>null) as {rewardRecoveryCredits?:unknown}|null;
 const credits=body?.rewardRecoveryCredits??0;if(typeof credits!=='number'||!Number.isSafeInteger(credits)||credits<0)throw new HttpError(400,'invalid_request');
 const {source,row}=await ownerCardSource(c.env,c.req.param('id'));
 if(row&&row.author_num_id!==Number(member.externalId))throw new HttpError(403,'not_the_author');
 const token=c.req.header('Authorization')!.replace(/^Bearer\s+/i,'');
 let response:Response;
 try{response=await fetch(`${apiBaseOf(c.env,'harbor')}/open/v1/role/${encodeURIComponent(source)}`,{method:'DELETE',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({rewardRecoveryCredits:credits}),redirect:'manual',signal:AbortSignal.timeout(20000)});}
 catch{throw new HttpError(503,'temporarily_unavailable');}
 const result=await response.json().catch(()=>null) as Record<string,unknown>|null;
 if(response.status===409&&typeof result?.error==='string'&&['card_reward_recovery_required','card_reward_recovery_insufficient'].includes(result.error)){
  const details:Record<string,unknown>={};for(const key of ['publicUntil','publicDays','requiredCredits','availableCredits','shortfallCredits'])if(typeof result[key]==='number'||(key==='publicUntil'&&typeof result[key]==='string'))details[key]=result[key];
  throw new HttpError(409,result.error,undefined,details);
 }
 if(response.status===401)throw new HttpError(401,'missing bearer token');
 if(response.status===403)throw new HttpError(403,'not_the_author');
 if(response.status===404)throw new HttpError(404,'card_not_found');
 if(response.status!==200||result?.message!=='success')throw new HttpError(503,'temporarily_unavailable');
 if(row)await finishManagedWithdrawal(c.env.DB,row.id);
 return c.json({message:'success'});
});
