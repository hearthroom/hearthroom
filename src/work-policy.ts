import {type Env,HttpError} from './types';
import {apiBaseOf,type ProviderId} from './providers';
import {hostingKey} from './hosting';
import {bumpOp} from './ops-metrics';

export type WorkAccess='private'|'unlisted'|'public';
export type WorkRestriction='none'|'delisted'|'suspended';
export interface WorkPolicyReceipt {
 sourceRoleId:string;workId:string;operationId:string;access:WorkAccess;restriction:WorkRestriction;
 epoch:number;state:'prepared'|'complete'|'cancelled';replayed:boolean;
}
export interface WorkPolicyCommand {
 workId:string;operationId:string;expectedEpoch:number;
 action:'bind'|'private'|'unlisted'|'restore'|'prepare'|'cancel'|'restrict';
 access?:WorkAccess;restriction?:WorkRestriction;versionRoleId?:string;approvedRoles?:string[];permitId?:string;
}
export interface ManagedWork {
 work_id:string;provider:ProviderId;source_role_id:string;access:WorkAccess;epoch:number;
 restriction:WorkRestriction;approved_role_id:string|null;sync_state:'complete'|'changing';sync_operation_id:string|null;moderation_revision:number;confirmed_moderation_revision:number;
}
interface Operation {intent_hash:string;command:string;state:string;receipt:string|null}

function checked(value:unknown,source:string,work?:string,operation?:string):WorkPolicyReceipt {
 const r=value as Partial<WorkPolicyReceipt>|null;
 if(!r||r.sourceRoleId!==source||(work&&r.workId!==work)||(operation&&r.operationId!==operation)
  ||!r.workId||!Number.isSafeInteger(r.epoch)||Number(r.epoch)<=0
  ||!['private','unlisted','public'].includes(r.access??'')||!['none','delisted','suspended'].includes(r.restriction??'')
  ||!['prepared','complete','cancelled'].includes(r.state??''))throw new HttpError(503,'visibility_receipt_invalid');
 return r as WorkPolicyReceipt;
}
async function call(env:Env,provider:ProviderId,source:string,suffix:string,body?:unknown,token?:string):Promise<unknown|null>{
 const key=hostingKey(env,provider);if(!key)throw new HttpError(503,'hosting_unavailable');
 const response=await fetch(`${apiBaseOf(env,provider)}/open/v1/hosting/work-access/${encodeURIComponent(source)}${suffix}`,{
  method:body===undefined?'GET':'POST',headers:{'X-Hosting-Key':key,...(token?{Authorization:`Bearer ${token}`}:{}) ,'Content-Type':'application/json'},
  ...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:'manual',signal:AbortSignal.timeout(20000),
 });
 if(response.status===404&&body===undefined)return null;
 if(response.status===409)throw new HttpError(409,'visibility_operation_conflict');
 if(!response.ok)throw new HttpError(503,'visibility_provider_unavailable');
 return response.json();
}
export const workPolicyGateway={
 async change(env:Env,provider:ProviderId,source:string,command:WorkPolicyCommand,token?:string):Promise<WorkPolicyReceipt>{
  return checked(await call(env,provider,source,'',command,token),source,command.workId,command.operationId);
 },
 async operation(env:Env,provider:ProviderId,source:string,work:string,operation:string):Promise<WorkPolicyReceipt|null>{
  const r=await call(env,provider,source,`/operations/${encodeURIComponent(operation)}`);return r===null?null:checked(r,source,work,operation);
 },
 async state(env:Env,provider:ProviderId,source:string):Promise<WorkPolicyReceipt|null>{
  const r=await call(env,provider,source,'');return r===null?null:checked(r,source);
 },
 async commit(env:Env,provider:ProviderId,source:string,work:string,operation:string):Promise<WorkPolicyReceipt>{
  return checked(await call(env,provider,source,`/operations/${encodeURIComponent(operation)}/commit`,{}),source,work,operation);
 },
};

export async function managedWork(db:D1Database,provider:ProviderId,source:string):Promise<ManagedWork|null>{
 return db.prepare('SELECT * FROM managed_work_access WHERE provider=? AND source_role_id=?').bind(provider,source).first<ManagedWork>();
}
async function hash(command:unknown):Promise<string>{
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(command)));
 return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
}
export async function policyOperationId(identity:string):Promise<string>{
 const h=await hash({identity});
 return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;
}

export async function workPolicyIntentStatement(env:Env,provider:ProviderId,source:string,command:WorkPolicyCommand,root=command.operationId,moderationRevision?:number):Promise<D1PreparedStatement>{
 const intent=await hash({provider,source,command});
 return env.DB.prepare("INSERT OR IGNORE INTO visibility_operations(work_id,operation_id,root_operation_id,command,intent_hash,state,updated_at,moderation_revision) VALUES(?,?,?,?,?,'intent',?,?)")
  .bind(command.workId,command.operationId,root,JSON.stringify(command),intent,Date.now(),moderationRevision??null);
}

// Persist only bounded commands and receipts, never a bearer. After an unknown
// reply, read the original operation before resending the same idempotent command.
export async function runWorkPolicyOperation(env:Env,provider:ProviderId,source:string,command:WorkPolicyCommand,token?:string,rootOperation=command.operationId):Promise<WorkPolicyReceipt>{
 const db=env.DB;const intent=await hash({provider,source,command});
 const inserted=await (await workPolicyIntentStatement(env,provider,source,command,rootOperation)).run();
 const op=await db.prepare('SELECT intent_hash,command,state,receipt FROM visibility_operations WHERE work_id=? AND operation_id=?').bind(command.workId,command.operationId).first<Operation>();
 if(!op||op.intent_hash!==intent)throw new HttpError(409,'visibility_operation_conflict');
 if(op.state==='conflict')throw new HttpError(409,'visibility_operation_conflict');
 if(op.state==='complete'&&op.receipt){
  await bumpOp(db,'work_access',command.action,'replay');
  return checked(JSON.parse(op.receipt),source,command.workId,command.operationId);
 }
 try{
  const recovered=inserted.meta.changes?null:await workPolicyGateway.operation(env,provider,source,command.workId,command.operationId);
  const receipt=checked(recovered??await workPolicyGateway.change(env,provider,source,command,token),source,command.workId,command.operationId);
  await db.prepare("UPDATE visibility_operations SET state='complete',receipt=?,updated_at=? WHERE work_id=? AND operation_id=? AND intent_hash=?")
   .bind(JSON.stringify(receipt),Date.now(),command.workId,command.operationId,intent).run();
  await bumpOp(db,'work_access',command.action,recovered?'replay':'confirmed');
  return receipt;
 }catch(error){
  const conflict=error instanceof HttpError&&error.status===409;
  await db.prepare('UPDATE visibility_operations SET state=?,updated_at=? WHERE work_id=? AND operation_id=? AND state<>\'complete\'')
   .bind(conflict?'conflict':'pending',Date.now(),command.workId,command.operationId).run();
  await bumpOp(db,'work_access',command.action,conflict?'conflict':'pending');
  if(conflict)throw error;
  throw new HttpError(503,'visibility_sync_pending',undefined,{operationId:command.operationId,state:'pending'});
 }
}

// A confirmed higher PG epoch makes older, still-unresolved commands incapable
// of mutation. Preserve their intent for audit, but stop retrying or counting them.
export function supersedeOlderWorkIntents(env:Env,receipt:WorkPolicyReceipt):D1PreparedStatement{
 return env.DB.prepare(`UPDATE visibility_operations SET state='conflict',updated_at=?
 WHERE work_id=? AND operation_id<>? AND state IN ('intent','pending') AND json_extract(command,'$.expectedEpoch')<?
 AND EXISTS(SELECT 1 FROM managed_work_access WHERE work_id=? AND epoch>=? AND sync_state='complete')`)
 .bind(Date.now(),receipt.workId,receipt.operationId,receipt.epoch,receipt.workId,receipt.epoch);
}

export async function projectWorkReceipt(env:Env,provider:ProviderId,receipt:WorkPolicyReceipt,approvedRole?:string|null,operation?:string,moderationRevision?:number):Promise<void>{
 const projection=env.DB.prepare(`INSERT INTO managed_work_access(work_id,provider,source_role_id,access,epoch,restriction,approved_role_id)
 VALUES(?,?,?,?,?,?,?) ON CONFLICT(work_id) DO UPDATE SET access=excluded.access,epoch=excluded.epoch,restriction=excluded.restriction,
 approved_role_id=coalesce(excluded.approved_role_id,managed_work_access.approved_role_id),sync_state='complete',sync_operation_id=NULL,
 confirmed_moderation_revision=coalesce(?,managed_work_access.confirmed_moderation_revision)
 WHERE managed_work_access.epoch<=excluded.epoch AND (managed_work_access.sync_operation_id IS NULL OR managed_work_access.sync_operation_id=?) AND (? IS NULL OR managed_work_access.moderation_revision=?)`)
 .bind(receipt.workId,provider,receipt.sourceRoleId,receipt.access,receipt.epoch,receipt.restriction,approvedRole??null,moderationRevision??null,receipt.operationId,moderationRevision??null,moderationRevision??null);
 const [result]=await env.DB.batch([projection,supersedeOlderWorkIntents(env,receipt)]);
 if(!result.meta.changes)throw new HttpError(409,'visibility_operation_conflict');
 if(operation)await bumpOp(env.DB,'work_access',operation,'success');
}

// Enrollment is internal and opt-in. It derives lineage/approval from issuer
// records; the initial access is the authenticated author's requested setting.
export async function enrollWorkAccess(env:Env,input:{memberId:string;roleId:string;operationId:string;access:WorkAccess;token:string;provider?:ProviderId}):Promise<WorkPolicyReceipt>{
 const provider=input.provider??'harbor';const db=env.DB;
 const work=await db.prepare('SELECT id,member_id FROM works WHERE source_provider=? AND source_role_id=?').bind(provider,input.roleId).first<{id:string;member_id:string}>();
 if(!work)throw new HttpError(404,'card_not_found');if(work.member_id!==input.memberId)throw new HttpError(403,'not_the_author');
 const card=await db.prepare('SELECT approved_hosted_role_id,public_blocked,board_hidden FROM cards WHERE provider=? AND source_role_id=?').bind(provider,input.roleId).first<{approved_hosted_role_id:string|null;public_blocked:number;board_hidden:number}>();
 const grants=await db.prepare("SELECT hosted_revision_id FROM hosting_versions WHERE work_id=? AND state='approved' AND hosted_revision_id IS NOT NULL ORDER BY version_id").bind(work.id).all<{hosted_revision_id:string}>();
 const command:WorkPolicyCommand={workId:work.id,operationId:input.operationId,expectedEpoch:0,action:'bind',access:input.access,
  restriction:card?.public_blocked?'suspended':card?.board_hidden?'delisted':'none',
  ...(card?.approved_hosted_role_id?{versionRoleId:card.approved_hosted_role_id}:{}),approvedRoles:grants.results.map(r=>r.hosted_revision_id)};
 const previous=await db.prepare('SELECT command FROM visibility_operations WHERE work_id=? AND operation_id=?').bind(work.id,input.operationId).first<{command:string}>();
 const saved=previous?JSON.parse(previous.command) as WorkPolicyCommand:null;
 if(saved&&(saved.action!=='bind'||saved.access!==input.access))throw new HttpError(409,'visibility_operation_conflict');
 // Mark the work managed before sending bind. Otherwise a legacy reviewer can
 // publish while the remote result is unknown and D1 has no policy row yet.
 await db.prepare(`INSERT OR IGNORE INTO managed_work_access(work_id,provider,source_role_id,access,epoch,restriction,approved_role_id,sync_state,sync_operation_id)
 VALUES(?,?,?,?,0,?,?,'changing',?)`).bind(work.id,provider,input.roleId,input.access,command.restriction,card?.approved_hosted_role_id??null,input.operationId).run();
 const receipt=await runWorkPolicyOperation(env,provider,input.roleId,saved??command,input.token);
 await projectWorkReceipt(env,provider,receipt,card?.approved_hosted_role_id,'bind');return receipt;
}
