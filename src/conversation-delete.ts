import {Hono} from 'hono';
import {bodyLimit} from 'hono/body-limit';
import {requireMember} from './members';
import {apiBaseOf} from './providers';
import {bindOwnedHistory} from './owned-history';
import {HttpError,type Env} from './types';

const valid=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v);
const headers=(token:string)=>({Authorization:`Bearer ${token}`,'Content-Type':'application/json'});
async function owned(env:Env,token:string,id:string):Promise<{roleId:string}|null>{
 const r=await fetch(`${apiBaseOf(env,'harbor')}/open/v1/conversation/owned?conversationId=${encodeURIComponent(id)}`,{headers:headers(token),cache:'no-store',signal:AbortSignal.timeout(12000)});
 if(r.status===404)return null;
 if(!r.ok)throw new HttpError(503,'conversation_delete_unavailable');
 const b=await r.json() as {roleId:string;conversationId:string};
 if(b.conversationId!==id||!valid(b.roleId))throw new HttpError(503,'conversation_delete_unavailable');
 return {roleId:b.roleId};
}
async function archives(env:Env,token:string,role:string):Promise<string[]>{
 const r=await fetch(`${apiBaseOf(env,'harbor')}/open/v1/conversation/archives?roleId=${encodeURIComponent(role)}`,{headers:headers(token),cache:'no-store',signal:AbortSignal.timeout(12000)});
 if(!r.ok)throw new HttpError(503,'conversation_delete_unavailable');
 const b=await r.json() as {count:number;archives:{conversationId:string}[]};
 if(!Array.isArray(b.archives)||b.count!==b.archives.length||b.count>500||b.archives.some(v=>!valid(v.conversationId)))throw new HttpError(503,'conversation_delete_unavailable');
 const ids=b.archives.map(v=>v.conversationId);
 if(new Set(ids).size!==ids.length)throw new HttpError(503,'conversation_delete_unavailable');
 return ids;
}
async function remove(env:Env,token:string,id:string):Promise<void>{
 const r=await fetch(`${apiBaseOf(env,'harbor')}/open/v1/conversation/delete`,{method:'POST',headers:headers(token),body:JSON.stringify({conversationId:id}),signal:AbortSignal.timeout(15000)});
 if(!r.ok){const b=await r.json().catch(()=>({})) as {error?:string};throw new Error(r.status===409&&/busy|progress/.test(b.error??'')?'busy':'delete_failed');}
 // A 200 is intentionally also a no-op. Verify the owned read no longer exposes it.
 if(await conversationDeletion.owned(env,token,id))throw new Error('delete_failed');
}
export const conversationDeletion={owned,archives,remove};
type Pointer={roleId:string;conversationId:string;updatedAt:number};
type Group={roleId:string;conversationId:string;ids:string[];pointers:Pointer[]};
type Snapshot={v:1;member:string;expires:number;groups:Group[]};
const encode=(value:Uint8Array)=>btoa(Array.from(value,b=>String.fromCharCode(b)).join('')).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const decode=(value:string)=>Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
async function key(env:Env){
 if(!env.SHORTCUT_SECRET)throw new HttpError(503,'conversation_delete_unavailable');
 return crypto.subtle.importKey('raw',new TextEncoder().encode(env.SHORTCUT_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
}
const subject=async(member:{id:string;provider:string;externalId:number})=>encode(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([member.id,member.provider,member.externalId])))));
const signedBytes=(payload:string)=>new TextEncoder().encode('hearthroom.conversation-delete.v1:'+payload);
async function sign(env:Env,snapshot:Snapshot){
 const bytes=new TextEncoder().encode(JSON.stringify(snapshot));
 if(bytes.length>180000)throw new HttpError(503,'conversation_delete_unavailable');
 const payload=encode(bytes);
 return payload+'.'+encode(new Uint8Array(await crypto.subtle.sign('HMAC',await key(env),signedBytes(payload))));
}
async function verify(env:Env,raw:unknown,member:string):Promise<Snapshot>{
 if(typeof raw!=='string'||raw.length>250000)throw new HttpError(400,'invalid_selection');
 const [payload,sig,...rest]=raw.split('.');let snapshot:Snapshot;
 try{
  if(!payload||!sig||rest.length||!await crypto.subtle.verify('HMAC',await key(env),decode(sig),signedBytes(payload)))throw new Error();
  snapshot=JSON.parse(new TextDecoder().decode(decode(payload)));
 }catch(error){if(error instanceof HttpError)throw error;throw new HttpError(400,'invalid_selection');}
 if(snapshot.v!==1||snapshot.member!==member)throw new HttpError(403,'invalid_selection');
 if(snapshot.expires<Date.now())throw new HttpError(409,'selection_expired');
 return snapshot;
}
export const conversationDeleteRoutes=new Hono<{Bindings:Env}>();
conversationDeleteRoutes.use('/v1/me/conversations',bodyLimit({maxSize:260000}));
conversationDeleteRoutes.use('/v1/me/conversations/delete-preview',bodyLimit({maxSize:260000}));
conversationDeleteRoutes.post('/v1/me/conversations/delete-preview',async c=>{
 c.header('Cache-Control','private, no-store');
 const member=await requireMember(c);const token=c.req.header('Authorization')?.match(/^Bearer\s+(\S+)$/)?.[1];
 if(!token||member.provider!=='harbor')throw new HttpError(401,'unauthorized');
 await key(c.env);
 const b=await c.req.json().catch(()=>null) as {conversations?:{conversationRoleId:string;conversationId:string}[]}|null;
 if(!Array.isArray(b?.conversations)||!b.conversations.length||b.conversations.length>24||b.conversations.some(v=>!valid(v?.conversationRoleId)||!valid(v?.conversationId)))throw new HttpError(400,'invalid_selection');
 const groups:Group[]=[];const seen=new Set<string>();
 for(const item of b.conversations){
  if(seen.has(item.conversationId))continue;seen.add(item.conversationId);
  const pointer=await c.env.DB.prepare("SELECT role_id AS roleId,conversation_id AS conversationId,updated_at AS updatedAt FROM member_conversations WHERE member_id=? AND provider='harbor' AND role_id=? AND conversation_id=?").bind(member.id,item.conversationRoleId,item.conversationId).first<Pointer>();
  // A migrated owned role may be returned by the read projection. Resolve using the exact pointer ID first.
  const pointers=pointer?[pointer]:(await c.env.DB.prepare("SELECT role_id AS roleId,conversation_id AS conversationId,updated_at AS updatedAt FROM member_conversations WHERE member_id=? AND provider='harbor' AND conversation_id=? LIMIT 2").bind(member.id,item.conversationId).all<Pointer>()).results;
  if(!pointers.length)throw new HttpError(404,'not_found');
  let capability:{roleId:string}|null;let ids:string[];
  try{capability=await conversationDeletion.owned(c.env,token,item.conversationId);
   if(capability){
    const bound=await bindOwnedHistory(c.env,item.conversationRoleId,item.conversationId,{conversationId:item.conversationId,roleId:capability.roleId,canGenerate:false});
    if(!bound)throw new HttpError(404,'not_found');
    ids=await conversationDeletion.archives(c.env,token,capability.roleId);
    if(!ids.includes(item.conversationId))throw new HttpError(409,'selection_changed');
   }else ids=[];
  }catch(error){if(error instanceof HttpError)throw error;throw new HttpError(503,'conversation_delete_unavailable');}
  const roleId=capability?.roleId??item.conversationRoleId;
  const allPointers=(await c.env.DB.prepare("SELECT role_id AS roleId,conversation_id AS conversationId,updated_at AS updatedAt FROM member_conversations WHERE member_id=? AND provider='harbor' AND (conversation_id IN (SELECT value FROM json_each(?)) OR conversation_id=?)").bind(member.id,JSON.stringify(ids),item.conversationId).all<Pointer>()).results;
  groups.push({roleId,conversationId:item.conversationId,ids,pointers:allPointers});
 }
 const unique=new Set(groups.flatMap(g=>g.ids));
 if(unique.size!==groups.reduce((n,g)=>n+g.ids.length,0))throw new HttpError(400,'duplicate_selection');
 const snapshot:Snapshot={v:1,member:await subject(member),expires:Date.now()+15*60*1000,groups};
 return c.json({selectionToken:await sign(c.env,snapshot),groups:groups.map(g=>({roleId:g.roleId,conversationId:g.conversationId,count:g.ids.length})),total:unique.size});
});
conversationDeleteRoutes.delete('/v1/me/conversations',async c=>{
 c.header('Cache-Control','private, no-store');
 const member=await requireMember(c);const token=c.req.header('Authorization')?.match(/^Bearer\s+(\S+)$/)?.[1];
 if(!token||member.provider!=='harbor')throw new HttpError(401,'unauthorized');
 const b=await c.req.json().catch(()=>null) as {selectionToken?:unknown;conversationIds?:unknown}|null;
 const snapshot=await verify(c.env,b?.selectionToken,await subject(member));
 let groups=snapshot.groups;
 if(b?.conversationIds!==undefined){
  const anchors=b.conversationIds;
  if(!Array.isArray(anchors)||!anchors.length||anchors.length>24||anchors.some(id=>!valid(id))||new Set(anchors).size!==anchors.length||anchors.some(id=>!snapshot.groups.some(g=>g.conversationId===id)))throw new HttpError(400,'invalid_selection');
  const selected=new Set(anchors);groups=groups.filter(g=>selected.has(g.conversationId));
 }
 const results=[];
 for(const group of groups){
  let deletedCount=0;let status:'deleted'|'busy'|'error'='deleted';
  try{
   // Keep the owned anchor readable until every other signed segment is gone.
   // Apply this at consumption too, so previously issued snapshots are safe.
   const orderedIds=group.ids.filter(id=>id!==group.conversationId);
   if(group.ids.includes(group.conversationId))orderedIds.push(group.conversationId);
   for(const id of orderedIds){await conversationDeletion.remove(c.env,token,id);deletedCount++;}
   if(!group.ids.length&&await conversationDeletion.owned(c.env,token,group.conversationId))throw new Error('selection_changed');
   await c.env.DB.batch(group.pointers.map(p=>c.env.DB.prepare("DELETE FROM member_conversations WHERE member_id=? AND provider='harbor' AND role_id=? AND conversation_id=? AND updated_at=?").bind(member.id,p.roleId,p.conversationId,p.updatedAt)));
  }catch(error){status=error instanceof Error&&error.message==='busy'?'busy':'error';}
  results.push({roleId:group.roleId,conversationId:group.conversationId,status,deletedCount});
 }
 return c.json({results,deletedCount:results.reduce((n,r)=>n+r.deletedCount,0)},results.some(r=>r.status!=='deleted')?207:200);
});
