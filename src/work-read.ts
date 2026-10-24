import {testCardIds} from './test-accounts';
import type {CardRow} from './cards';
import {apiBaseOf} from './providers';
import {hostingKey} from './hosting';
import {type Env,HttpError} from './types';
import type {ManagedWork,WorkAccess,WorkRestriction} from './work-policy';
import {upstream} from './upstream';
import {bumpOp} from './ops-metrics';

export type VisibilityReadSurface='list'|'detail'|'social'|'library'|'metadata'|'aggregate';
async function observeRead<T>(env:Env,surface:VisibilityReadSurface,read:()=>Promise<T>,allowed:(result:T)=>boolean):Promise<T>{
 try{
  const result=await read();await bumpOp(env.DB,'visibility_read',surface,allowed(result)?'allow':'denied');return result;
 }catch(error){await bumpOp(env.DB,'visibility_read',surface,'unavailable');throw error;}
}

export const WORK_READ_BUDGET=200;
export interface WorkReadIdentity {sourceRoleId:string;workId:string;targetRoleId:string}
export interface CurrentWorkRead extends WorkReadIdentity {
 managed:boolean;access:WorkAccess|'';restriction:WorkRestriction|'';epoch:number;
 shareRoleId:string;approvedRoleId:string;targetReadable:boolean;listed:boolean;
}
const keyOf=(item:WorkReadIdentity)=>JSON.stringify([item.sourceRoleId,item.workId,item.targetRoleId]);

// This response is current authority, never an operation receipt or cache entry.
// A missing, duplicate or mismatched identity makes the entire check unavailable.
export async function readCurrentWorkPolicies(env:Env,items:WorkReadIdentity[]):Promise<CurrentWorkRead[]>{
 if(!items.length)return [];
 if(items.length>WORK_READ_BUDGET)throw new HttpError(503,'visibility_read_budget_exceeded');
 const key=hostingKey(env,'harbor');if(!key)throw new HttpError(503,'visibility_provider_unavailable');
 try{
  const response=await fetch(`${apiBaseOf(env,'harbor')}/open/v1/hosting/work-access/batch`,{
   method:'POST',headers:{'X-Hosting-Key':key,'Content-Type':'application/json'},body:JSON.stringify({items}),
   redirect:'manual',signal:AbortSignal.timeout(3000),
  });
  if(!response.ok)throw new Error('Policy batch unavailable');
  const body=await response.json() as {items?:CurrentWorkRead[]};
  if(!Array.isArray(body.items)||body.items.length!==items.length)throw new Error('Incomplete policy batch');
  const expected=new Set(items.map(keyOf));
  for(const item of body.items){
   if(!item||!expected.delete(keyOf(item))||typeof item.managed!=='boolean'||!Number.isSafeInteger(item.epoch)||item.epoch<0
    ||typeof item.targetReadable!=='boolean'||typeof item.listed!=='boolean'||typeof item.shareRoleId!=='string'||typeof item.approvedRoleId!=='string'
    ||(item.managed&&(!['private','unlisted','public'].includes(item.access)||!['none','delisted','suspended'].includes(item.restriction)||item.epoch<1)))throw new Error('Invalid policy batch');
  }
  if(expected.size)throw new Error('Missing policy identities');
  const found=new Map(body.items.map(item=>[keyOf(item),item]));
  return items.map(item=>found.get(keyOf(item))!);
 }catch{
  throw new HttpError(503,'visibility_provider_unavailable');
 }
}

export async function localWorkPolicies(env:Env,rows:Pick<CardRow,'source_role_id'|'provider'>[]):Promise<Map<string,ManagedWork>>{
 const sources=[...new Set(rows.filter(row=>row.provider==='harbor').map(row=>row.source_role_id))];
 if(sources.length>WORK_READ_BUDGET)throw new HttpError(503,'visibility_read_budget_exceeded');
 if(!sources.length)return new Map();
 const result=await env.DB.prepare("SELECT * FROM managed_work_access WHERE provider='harbor' AND source_role_id IN(SELECT value FROM json_each(?))")
  .bind(JSON.stringify(sources)).all<ManagedWork>();
 return new Map(result.results.map(policy=>[policy.source_role_id,policy]));
}

// Legacy rows retain their original contract until explicit enrollment. Once
// enrolled, both the durable D1 fence and current PG policy constrain discovery.
export async function filterPublicRows(env:Env,rows:CardRow[],surface:VisibilityReadSurface='list'):Promise<{rows:CardRow[];checked:boolean}>{
 return observeRead(env,surface,()=>publicRows(env,rows),result=>result.rows.length===rows.length);
}
async function publicRows(env:Env,rows:CardRow[]):Promise<{rows:CardRow[];checked:boolean}>{
 if(rows.length>WORK_READ_BUDGET)throw new HttpError(503,'visibility_read_budget_exceeded');
 const hidden=await testCardIds(env.DB,rows.map(r=>String(r.id)));
 rows=rows.filter(r=>!hidden.has(String(r.id)));
 const local=await localWorkPolicies(env,rows);
 const candidates=rows.filter(row=>{
  const p=local.get(row.source_role_id);
  return p&&row.status==='approved'&&!row.board_hidden&&!row.public_blocked&&p.access==='public'&&p.restriction==='none'
   &&p.sync_state==='complete'&&p.moderation_revision===p.confirmed_moderation_revision;
 });
 const identities=candidates.map(row=>({sourceRoleId:row.source_role_id,workId:local.get(row.source_role_id)!.work_id,targetRoleId:row.approved_hosted_role_id??row.source_role_id}));
 const current=await readCurrentWorkPolicies(env,identities);
 const allowed=new Set(candidates.filter((row,index)=>{
  const p=local.get(row.source_role_id)!,r=current[index];
  return r.managed&&r.epoch>=p.epoch&&r.access==='public'&&r.restriction==='none'&&r.targetReadable&&r.listed&&r.shareRoleId===identities[index].targetRoleId;
 }).map(row=>String(row.id)));
 return {rows:rows.filter(row=>!local.has(row.source_role_id)||allowed.has(String(row.id))),checked:local.size>0};
}

export async function revalidateBoardBody(env:Env,body:string):Promise<string>{
 const value=JSON.parse(body) as {items?:{id:string;roleId:string}[];total?:number|null};
 if(!Array.isArray(value.items)||value.items.length>WORK_READ_BUDGET)throw new HttpError(503,'visibility_read_budget_exceeded');
 if(!value.items.length)return body;
 const ids=value.items.map(item=>String(item.id));
 const result=await env.DB.prepare("SELECT * FROM cards WHERE id IN(SELECT value FROM json_each(?)) AND status='approved' AND board_hidden=0 AND public_blocked=0")
  .bind(JSON.stringify(ids)).all<CardRow>();
 const visible=await filterPublicRows(env,result.results);
 const current=new Map(visible.rows.map(row=>[String(row.id),row.approved_hosted_role_id??row.source_role_id]));
 const items=value.items.filter(item=>current.get(String(item.id))===item.roleId);
 return JSON.stringify({...value,items,...(visible.checked||items.length!==value.items.length?{total:null}:{})});
}

// Aggregates cannot be proven by checking only the displayed cards. Bound the
// managed contributors to one set query/RPC; larger or diverged projections are
// unavailable until reconciled, rather than reporting stale totals or zero.
export async function provePublicAggregates(env:Env,zone?:string):Promise<void>{
 const result=await env.DB.prepare(`SELECT c.* FROM managed_work_access p JOIN cards c
 ON c.provider=p.provider AND c.source_role_id=p.source_role_id
 WHERE p.access='public' AND p.restriction='none' AND p.sync_state='complete'
 AND p.moderation_revision=p.confirmed_moderation_revision AND c.status='approved' AND c.board_hidden=0 AND c.public_blocked=0
 ${zone?"AND c.zone IN (?, 'all')":''} LIMIT ?`).bind(...(zone?[zone]:[]),WORK_READ_BUDGET+1).all<CardRow>();
 if(result.results.length>WORK_READ_BUDGET)throw new HttpError(503,'visibility_read_budget_exceeded');
 const visible=await filterPublicRows(env,result.results,'aggregate');
 if(visible.rows.length!==result.results.length)throw new HttpError(503,'visibility_sync_pending');
}

export interface CurrentCardAccess {
 managed:boolean;access:WorkAccess;reachable:boolean;indexable:boolean;shareRoleId:string;
}

// An unlisted link shares the latest saved source, rather than the last review
// snapshot. This is a presentation projection: publication dates, social data
// and the durable card identity are never rewritten by a read.
export async function unlistedCardRow(env:Env,row:CardRow):Promise<CardRow>{
 const role=await upstream.fetchRole(env,row.source_role_id,'harbor');
 if(role.roleId!==row.source_role_id||role.authorNumId!==row.author_num_id)throw new HttpError(503,'visibility_provider_unavailable');
 return {...row,approved_hosted_role_id:row.source_role_id,status:'unlisted',rating:'R',rating_descriptors:null,
  names:JSON.stringify(role.names),summaries:JSON.stringify(role.summaries),tags:JSON.stringify(role.tags),
  zone:role.zone,background_url:role.backgroundUrl,share_image_url:role.shareImageUrl??null,
  landscape_url:role.backgroundLandscapeUrl??null,slug:role.slug??null,
  fandom:role.fandom??'',fandom_qid:null,fandom_labels:null,fandom_key:'',featured_at:null};
}

export async function currentCardAccess(env:Env,row:CardRow,surface:VisibilityReadSurface='detail'):Promise<CurrentCardAccess>{
 return observeRead(env,surface,()=>cardAccess(env,row),result=>result.reachable);
}
async function cardAccess(env:Env,row:CardRow):Promise<CurrentCardAccess>{
 return (await cardsAccess(env,[row])).get(String(row.id))!;
}
export async function currentCardsAccess(env:Env,rows:CardRow[],surface:VisibilityReadSurface='library'):Promise<Map<string,CurrentCardAccess>>{
 return observeRead(env,surface,()=>cardsAccess(env,rows),result=>[...result.values()].every(r=>r.reachable));
}
async function cardsAccess(env:Env,rows:CardRow[]):Promise<Map<string,CurrentCardAccess>>{
 const policies=await localWorkPolicies(env,rows),out=new Map<string,CurrentCardAccess>();
 const candidates:CardRow[]=[];
 const hidden=await testCardIds(env.DB,rows.map(r=>String(r.id)));
 for(const row of rows){
  if(hidden.has(String(row.id))){out.set(String(row.id),{managed:true,access:'private',reachable:false,indexable:false,shareRoleId:''});continue;}
  const p=policies.get(row.source_role_id);
  if(!p){
   if(row.status==='unlisted'&&!row.public_blocked){candidates.push(row);continue;}
   out.set(String(row.id),{managed:false,access:row.status==='approved'?'public':'unlisted',reachable:row.status==='approved'&&!row.public_blocked,indexable:row.status==='approved'&&!row.public_blocked&&!row.board_hidden,shareRoleId:row.approved_hosted_role_id??row.source_role_id});continue;
  }
  if(p.access==='private'||p.restriction==='suspended'||row.public_blocked){out.set(String(row.id),{managed:true,access:p.access,reachable:false,indexable:false,shareRoleId:''});continue;}
  if(p.sync_state!=='complete'||p.moderation_revision!==p.confirmed_moderation_revision)throw new HttpError(503,'visibility_sync_pending');
  candidates.push(row);
 }
 const targets=candidates.map(row=>({sourceRoleId:row.source_role_id,workId:policies.get(row.source_role_id)?.work_id??'00000000-0000-0000-0000-000000000000',targetRoleId:!policies.has(row.source_role_id)||policies.get(row.source_role_id)!.access==='unlisted'?row.source_role_id:row.approved_hosted_role_id??row.source_role_id}));
 const current=await readCurrentWorkPolicies(env,targets);
 for(const [i,row] of candidates.entries()){
  const p=policies.get(row.source_role_id),r=current[i];
  if(!p){
   if(r.managed||r.targetReadable&&r.shareRoleId!==row.source_role_id)throw new HttpError(503,'visibility_sync_pending');
   out.set(String(row.id),{managed:false,access:'unlisted',reachable:r.targetReadable,indexable:false,shareRoleId:r.shareRoleId});continue;
  }
  const denied={managed:true,access:p.access,reachable:false,indexable:false,shareRoleId:''};
  if(!r.managed||r.epoch<p.epoch)throw new HttpError(503,'visibility_provider_unavailable');
  if(r.access==='private'){out.set(String(row.id),{...denied,access:'private'});continue;}
  if(r.restriction==='suspended'){out.set(String(row.id),denied);continue;}
  if(r.access!==p.access||r.shareRoleId!==targets[i].targetRoleId)throw new HttpError(503,'visibility_sync_pending');
  out.set(String(row.id),{managed:true,access:p.access,reachable:r.targetReadable,indexable:r.targetReadable&&r.listed&&p.access==='public'&&p.restriction==='none'&&!row.board_hidden&&row.status==='approved',shareRoleId:r.shareRoleId});
 }
 return out;
}
