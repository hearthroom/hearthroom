import {SELF,env} from 'cloudflare:test';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {resetDb,identities,bearer,restoreUpstream} from './helpers';
import {conversationDeletion} from '../src/conversation-delete';
const original={...conversationDeletion};
const rows=new Map<string,{roleId:string}>();
const calls:string[]=[];
const request=(path:string,body:unknown,method='POST',token='fan')=>SELF.fetch('https://c.test/v1/me/conversations'+path,{method,headers:{...bearer(token),'Content-Type':'application/json'},body:JSON.stringify(body)});
const put=(roleId:string,conversationId:string)=>request('',{roleId,conversationId},'PUT');
let archiveIds=['current','save'];
beforeEach(async()=>{
 await resetDb();identities({fan:20001,other:20002});rows.clear();calls.length=0;archiveIds=['current','save'];
 rows.set('current',{roleId:'role'});rows.set('save',{roleId:'role'});
 conversationDeletion.owned=async(_env,_token,id)=>rows.get(id)??null;
 conversationDeletion.archives=async()=>[...archiveIds];
 conversationDeletion.remove=async(_env,_token,id)=>{calls.push(id);rows.delete(id);};
 await put('role','current');
});
afterEach(()=>{vi.unstubAllGlobals();Object.assign(conversationDeletion,original);restoreUpstream();});
const preview=async()=>{const r=await request('/delete-preview',{conversations:[{conversationRoleId:'role',conversationId:'current'}]});expect(r.status).toBe(200);return await r.json() as any;};
it('freezes exact segments, deletes through the shared service and removes only unchanged own pointers',async()=>{
 const p=await preview();expect(p.total).toBe(2);expect(p.groups).toEqual([{roleId:'role',conversationId:'current',count:2}]);
 archiveIds.push('new');rows.set('new',{roleId:'role'});await put('role','new');
 const r=await request('',{selectionToken:p.selectionToken},'DELETE');expect(r.status).toBe(200);
 expect((await r.json() as any).results[0]).toMatchObject({status:'deleted',deletedCount:2});
 expect(calls.sort()).toEqual(['current','save']);expect(rows.has('new')).toBe(true);
 expect(await env.DB.prepare("SELECT conversation_id AS id FROM member_conversations").first()).toEqual({id:'new'});
});
it('binds snapshots to the member and rejects edits without deleting anything',async()=>{
 const p=await preview();expect((await request('',{selectionToken:p.selectionToken},'DELETE','other')).status).toBe(403);
 const parts=p.selectionToken.split('.');parts[0]=parts[0].slice(0,-2)+'aa';
 expect((await request('',{selectionToken:parts.join('.')},'DELETE')).status).toBe(400);expect(calls).toEqual([]);
});
it('cleans confirmed ghost pointers but does not turn a transient upstream failure into deletion',async()=>{
 rows.clear();const p=await preview();expect(p.total).toBe(0);
 expect((await request('',{selectionToken:p.selectionToken},'DELETE')).status).toBe(200);expect(calls).toEqual([]);
 expect(await env.DB.prepare('SELECT 1 FROM member_conversations').first()).toBeNull();
 await put('role','current');conversationDeletion.owned=async()=>{throw new Error('upstream down');};
 expect((await request('/delete-preview',{conversations:[{conversationRoleId:'role',conversationId:'current'}]})).status).toBe(503);
 expect(await env.DB.prepare('SELECT 1 FROM member_conversations').first()).not.toBeNull();
});
it('preserves failed card pointers and emits failure metrics, then allows retry with the frozen snapshot',async()=>{
 const p=await preview();conversationDeletion.remove=async()=>{throw new Error('busy');};
 const r=await request('',{selectionToken:p.selectionToken},'DELETE');expect(r.status).toBe(207);
 expect((await r.json() as any).results[0]).toMatchObject({status:'busy',deletedCount:0});
 expect(await env.DB.prepare('SELECT 1 FROM member_conversations').first()).not.toBeNull();
 const metrics=await (await SELF.fetch('https://c.test/metrics')).text();expect(metrics).toContain('operation="conversations_delete",outcome="error"');
 conversationDeletion.remove=async(_env,_token,id)=>{rows.delete(id);};
 expect((await request('',{selectionToken:p.selectionToken},'DELETE')).status).toBe(200);
 expect(await env.DB.prepare('SELECT 1 FROM member_conversations').first()).toBeNull();
});
it('refuses unrecorded selections and selection expansion beyond the page bound',async()=>{
 expect((await request('/delete-preview',{conversations:[{conversationRoleId:'other-role',conversationId:'current'}]})).status).toBe(404);
 expect((await request('/delete-preview',{conversations:Array(25).fill({conversationRoleId:'role',conversationId:'current'})})).status).toBe(400);
});

it('production transport forwards the same bearer, requires complete archives and confirms the delete postcondition',async()=>{
 const responses=[new Response(JSON.stringify({archives:[{conversationId:'current'}],count:2})),new Response(JSON.stringify({success:'ok'})),new Response('{}',{status:404})];
 const fetcher=vi.fn(async()=>responses.shift()!);vi.stubGlobal('fetch',fetcher);
 await expect(original.archives(env,'own-token','role')).rejects.toThrow('conversation_delete_unavailable');
 conversationDeletion.owned=original.owned;
 await original.remove(env,'own-token','current');
 expect(fetcher.mock.calls).toHaveLength(3);
 const post=fetcher.mock.calls[1] as unknown as [string,RequestInit];
 expect(post[0]).toContain('/open/v1/conversation/delete');
 expect(post[1]).toMatchObject({method:'POST',headers:{Authorization:'Bearer own-token'},body:JSON.stringify({conversationId:'current'})});
});
it('rejects a successful HTTP no-op that still exposes the segment and never treats a 503 as a ghost',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response('{}',{status:503})));
 await expect(original.owned(env,'fan','current')).rejects.toThrow('conversation_delete_unavailable');
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({success:'ok'}))));
 conversationDeletion.owned=async()=>({roleId:'role'});
 await expect(original.remove(env,'fan','current')).rejects.toThrow('delete_failed');
});
it('retries only selected frozen card groups and refuses forged or duplicate group anchors',async()=>{
 rows.set('second-current',{roleId:'second-role'});await put('second-role','second-current');
 conversationDeletion.archives=async(_env,_token,role)=>role==='role'?['current','save']:['second-current'];
 const p=await (await request('/delete-preview',{conversations:[{conversationRoleId:'role',conversationId:'current'},{conversationRoleId:'second-role',conversationId:'second-current'}]})).json() as any;
 const result=await request('',{selectionToken:p.selectionToken,conversationIds:['second-current']},'DELETE');
 expect(result.status).toBe(200);expect((await result.json() as any).results).toEqual([{roleId:'second-role',conversationId:'second-current',status:'deleted',deletedCount:1}]);
 expect(calls).toEqual(['second-current']);expect(rows.has('current')).toBe(true);
 expect((await request('',{selectionToken:p.selectionToken,conversationIds:['forged']},'DELETE')).status).toBe(400);
 expect((await request('',{selectionToken:p.selectionToken,conversationIds:['current','current']},'DELETE')).status).toBe(400);
 expect((await request('',{selectionToken:p.selectionToken,conversationIds:[]},'DELETE')).status).toBe(400);
 expect(calls).toEqual(['second-current']);
});
