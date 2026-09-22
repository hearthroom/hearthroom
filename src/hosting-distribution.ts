import {HttpError,type Env} from './types';
import {apiBaseOf,type ProviderId} from './providers';
import {hostGateway} from './hosting';
import {transfers,type TransferCard} from './card-transfer';
import {cardHash} from './card-sync';
import {imageReference,MEDIA_FIELDS} from './card-media';
import type {TransferProgress} from './card-transfer-resources';

const digest=async(bytes:ArrayBuffer)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
async function mediaBytes(env:Env,provider:ProviderId,url:string){
 imageReference(env,provider,url);
 const r=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(20000)});
 const limit=20*1024*1024;
 if(!r.ok||Number(r.headers.get('Content-Length'))>limit||!r.body)throw new HttpError(502,'hosting_media_unavailable');
 const reader=r.body.getReader();const chunks:Uint8Array[]=[];let size=0;
 for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();throw new HttpError(409,'hosting_media_too_large')}chunks.push(value)}
 const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length}
 return {bytes:bytes.buffer,mime:r.headers.get('Content-Type')?.split(';')[0]||'application/octet-stream'};
}
export const hostingTransferMedia={
 async copy(env:Env,source:ProviderId,target:ProviderId,token:string,roleId:string,card:TransferCard):Promise<TransferCard>{
  const out=structuredClone(card);out.media={};const uploaded=new Map<string,string>();
  for(const field of MEDIA_FIELDS){const url=card.media?.[field];if(!url)continue;
   let targetURL=uploaded.get(url);
   if(!targetURL){const {bytes,mime}=await mediaBytes(env,source,url);const sha=await digest(bytes);
    const form=new FormData();form.append('file',new Blob([bytes],{type:mime}),`hosting-${sha}`);form.append('roleId',roleId);
    const r=await fetch(`${apiBaseOf(env,target)}/open/v1/image/upload`,{method:'POST',headers:{Authorization:`Bearer ${token}`},body:form,redirect:'manual',signal:AbortSignal.timeout(60000)});
    if(!r.ok)throw new HttpError(502,'hosting_media_upload_failed');
    const body=await r.json() as {data?:{imageUrl?:string;url?:string}};targetURL=body.data?.imageUrl||body.data?.url;
    if(!targetURL)throw new HttpError(502,'hosting_media_upload_failed');imageReference(env,target,targetURL);uploaded.set(url,targetURL);
   }out.media[field]=targetURL;
  }return out;
 },
 async hash(env:Env,provider:ProviderId,card:TransferCard):Promise<string>{
  const copy=structuredClone(card);copy.media={};const hashed=new Map<string,string>();
  for(const field of MEDIA_FIELDS){const url=card.media?.[field];if(!url)continue;let sha=hashed.get(url);if(!sha){sha=await digest((await mediaBytes(env,provider,url)).bytes);hashed.set(url,sha)}copy.media[field]=sha}
  return cardHash(copy);
 },
};
interface TransferRow {external_id:number;operation_id:string;draft_role_id:string|null;hosted_revision_id:string|null;progress:string;state:string}
interface Input {memberId:string;versionId:string;sourceToken:string;sourceAccount:number;targetProvider:ProviderId;targetToken:string;targetAccount:number}
// Tokens remain request-local. Every remote write has a durable operation before
// it happens; a candidate cannot occupy the official version until readback agrees.
export async function distributeHosted(env:Env,i:Input){
 const db=env.DB;
 const version=await db.prepare("SELECT * FROM hosting_versions WHERE version_id=? AND member_id=? AND hosted_revision_id IS NOT NULL AND state IN ('pending','approved')").bind(i.versionId,i.memberId).first<{provider:ProviderId;work_id:string;hosted_revision_id:string}>();
 if(!version)throw new HttpError(404,'version_not_found');
 if(version.provider===i.targetProvider)return;
 const identity=await db.prepare('SELECT member_id FROM member_identities WHERE provider=? AND external_id=?').bind(i.targetProvider,String(i.targetAccount)).first<{member_id:string}>();
 if(identity?.member_id!==i.memberId)throw new HttpError(403,'sync_account_not_linked');
 await db.prepare("INSERT OR IGNORE INTO hosting_transfers(version_id,provider,external_id,operation_id,updated_at) VALUES (?,?,?,?,?)").bind(i.versionId,i.targetProvider,i.targetAccount,crypto.randomUUID(),Date.now()).run();
 const get=()=>db.prepare('SELECT * FROM hosting_transfers WHERE version_id=? AND provider=?').bind(i.versionId,i.targetProvider).first<TransferRow>();
 let row=(await get())!;if(row.external_id!==i.targetAccount)throw new HttpError(409,'sync_account_changed');
 if(row.state==='ready'){
  try{await transfers.readHosted(env,i.targetProvider,i.targetToken,row.hosted_revision_id!,i.targetAccount);return}
  catch{
   await db.prepare("UPDATE hosting_transfers SET state='failed',error='hosting_replica_unavailable',updated_at=? WHERE version_id=? AND provider=? AND state='ready'").bind(Date.now(),i.versionId,i.targetProvider).run();
   throw new HttpError(502,'hosting_replica_unavailable');
  }
 }
 const lease=crypto.randomUUID();const now=Date.now();
 const lock=await db.prepare("UPDATE hosting_transfers SET lease=?,locked_until=?,updated_at=? WHERE version_id=? AND provider=? AND locked_until<=?").bind(lease,now+300000,now,i.versionId,i.targetProvider,now).run();
 if(!lock.meta.changes)throw new HttpError(409,'sync_busy');
 const save=async(sql:string,...args:unknown[])=>{
  const result=await db.prepare(`UPDATE hosting_transfers SET ${sql},locked_until=?,updated_at=? WHERE version_id=? AND provider=? AND lease=?`).bind(...args,Date.now()+300000,Date.now(),i.versionId,i.targetProvider,lease).run();
  if(!result.meta.changes)throw new HttpError(409,'sync_busy');
 };
 try{
  if(row.state==='mismatch'||row.state==='uncertain'){
   await save("operation_id=?,draft_role_id=NULL,hosted_revision_id=NULL,progress=?,state='pending',error=''",crypto.randomUUID(),JSON.stringify({books:{}}));row=(await get())!;
  }
  const source=(await transfers.readHosted(env,version.provider,i.sourceToken,version.hosted_revision_id,i.sourceAccount)).card;
  const sourceHash=await hostingTransferMedia.hash(env,version.provider,source);
  if(!row.draft_role_id){const draft=await hostGateway.draft(env,i.targetToken,version.work_id,row.operation_id,source.name,source.language,i.targetProvider);await save('draft_role_id=?',draft.roleId);row.draft_role_id=draft.roleId}
  if(!row.hosted_revision_id){
   const materialized=await hostingTransferMedia.copy(env,version.provider,i.targetProvider,i.targetToken,row.draft_role_id,source);
   const progress=JSON.parse(row.progress) as TransferProgress;
   await transfers.update(env,i.targetProvider,i.targetToken,row.draft_role_id,materialized,async()=>{await save("state='writing'")},progress,async()=>{await save('progress=?',JSON.stringify(progress))});
   const staged=await hostGateway.stage(env,i.targetToken,row.draft_role_id,version.work_id,row.operation_id,i.targetProvider);
   await save("hosted_revision_id=?,state='staged'",staged.hostedRevisionId);row.hosted_revision_id=staged.hostedRevisionId;
  }
  const frozen=(await transfers.readHosted(env,i.targetProvider,i.targetToken,row.hosted_revision_id,i.targetAccount)).card;
  if(await hostingTransferMedia.hash(env,i.targetProvider,frozen)!==sourceHash)throw new HttpError(409,'hosting_readback_mismatch');
  await hostGateway.promote(env,i.targetToken,row.hosted_revision_id,version.work_id,i.versionId,i.targetProvider);
  await db.batch([
   db.prepare("INSERT OR IGNORE INTO hosting_replicas(version_id,provider,source_role_id,hosted_revision_id,state,created_at) SELECT ?,?,?,?,'ready',? WHERE EXISTS(SELECT 1 FROM hosting_transfers WHERE version_id=? AND provider=? AND lease=?)").bind(i.versionId,i.targetProvider,row.draft_role_id,row.hosted_revision_id,Date.now(),i.versionId,i.targetProvider,lease),
   db.prepare("UPDATE hosting_transfers SET state='ready',error='',lease=NULL,locked_until=0,updated_at=? WHERE version_id=? AND provider=? AND lease=?").bind(Date.now(),i.versionId,i.targetProvider,lease),
  ]);
 }catch(error){
  const code=error instanceof HttpError?error.message:'hosting_transfer_failed';
  const state=code==='hosting_readback_mismatch'?'mismatch':code==='sync_create_unconfirmed'?'uncertain':'failed';
  await db.prepare('UPDATE hosting_transfers SET state=?,error=?,lease=NULL,locked_until=0,updated_at=? WHERE version_id=? AND provider=? AND lease=?').bind(state,code,Date.now(),i.versionId,i.targetProvider,lease).run();throw error;
 }
}

// Explicit author sync also distributes the currently approved version and any
// pending update. Editing a draft never grants that draft the old approval.
export async function distributeWorkVersions(env:Env,i:Omit<Input,'versionId'> & {sourceProvider:ProviderId;sourceRoleId:string}) {
 const versions=await env.DB.prepare(`SELECT v.version_id FROM hosting_versions v JOIN works w ON w.id=v.work_id
 LEFT JOIN cards c ON c.id=v.card_id WHERE w.source_provider=? AND w.source_role_id=? AND w.member_id=?
 AND (v.state='pending' OR (v.state='approved' AND c.approved_version_id=v.version_id))`)
 .bind(i.sourceProvider,i.sourceRoleId,i.memberId).all<{version_id:string}>();
 for(const version of versions.results)await distributeHosted(env,{...i,versionId:version.version_id});
}

// Remember destinations even when their browser authorization has expired. The
// author can see and retry the failure; credentials never enter durable storage.
export async function seedSavedHostingTargets(env:Env,memberId:string,versionId:string,authorized:ProviderId[]) {
 const targets=await env.DB.prepare(`SELECT c.provider,c.external_id FROM work_copies c
 JOIN hosting_versions v ON v.work_id=c.work_id
 WHERE v.version_id=? AND v.member_id=? AND c.provider<>v.provider AND c.role_id IS NOT NULL`)
 .bind(versionId,memberId).all<{provider:ProviderId;external_id:number}>();
 for(const target of targets.results){
  const ready=authorized.includes(target.provider);
  await env.DB.prepare(`INSERT OR IGNORE INTO hosting_transfers(version_id,provider,external_id,operation_id,state,error,updated_at) VALUES (?,?,?,?,?,?,?)`)
  .bind(versionId,target.provider,target.external_id,crypto.randomUUID(),ready?'pending':'failed',ready?'':'sync_authorization_expired',Date.now()).run();
 }
}
