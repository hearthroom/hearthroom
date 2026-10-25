import {createExecutionContext,env,waitOnExecutionContext} from 'cloudflare:test';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import worker from '../src/index';
import {getCard,upsertCard} from '../src/cards';
import {identities,makeMember,resetDb,restoreUpstream,role} from './helpers';
import {ADULT_CONSENT_VERSION} from '../shared/adult-consent';
import {opsMetrics} from '../src/ops-metrics';
import {workPolicyGateway} from '../src/work-policy';
import {HttpError} from '../src/types';

beforeEach(async()=>{await resetDb();identities({player:42,stranger:43});});
afterEach(()=>{vi.restoreAllMocks();restoreUpstream();});

async function fixture(approved=true){
 const source=crypto.randomUUID(),target=approved?crypto.randomUUID():source,work=crypto.randomUUID();
 const author=await makeMember(11),player=await makeMember(42);
 await env.DB.prepare('UPDATE members SET show_nsfw=1,age_verified_at=1,adult_consent_version=? WHERE id=?').bind(ADULT_CONSENT_VERSION,player).run();
 await upsertCard(env.DB,role({roleId:source,authorNumId:11,name:'Stale card metadata'}),Date.now(),{status:'approved'});
 await env.DB.prepare('UPDATE cards SET approved_hosted_role_id=? WHERE source_role_id=?').bind(approved?target:null,source).run();
 await env.DB.prepare('INSERT INTO works VALUES(?,?,?,?,?)').bind(work,author,'harbor',source,Date.now()).run();
 await env.DB.prepare("INSERT INTO managed_work_access(work_id,provider,source_role_id,access,epoch,restriction,approved_role_id) VALUES(?,'harbor',?,'private',2,'none',?)").bind(work,source,approved?target:null).run();
 const state={mode:'ok',allowed:new Set([target]),tokens:new Set(['player'])};
 const network=vi.spyOn(globalThis,'fetch').mockImplementation(async(input,init)=>{
  const url=new URL(String(input));
  if(url.pathname!=='/open/v1/role/detail')throw new Error('Unexpected network in private-player fixture');
  if(state.mode==='offline')throw new Error('Fixture Provider unavailable');
  if(state.mode==='server_error')return Response.json({error:'unavailable'},{status:503});
  const requested=url.searchParams.get('roleId')!;
  const token=new Headers(init?.headers).get('Authorization')?.replace(/^Bearer /,'')??'';
  if(!state.tokens.has(token)||!state.allowed.has(requested))return Response.json({error:'not_found'},{status:404});
  return Response.json({characterRoleId:state.mode==='wrong_role'?crypto.randomUUID():requested,accountNumId:state.mode==='wrong_author'?99:11,roleName:requested===source?'Played source':'Retained approved version',roleDesc:'Public summary',language:'zh',roleDetailDesc:'Private instructions must not escape',jailbreak:'Never expose'});
 });
 return {source,target,work,state,network};
}
async function request(path:string,token?:string){
 const context=createExecutionContext();
 const response=await worker.fetch(new Request('https://c.test'+path,{headers:token?{Authorization:'Bearer '+token}:{}}),{...env,HOSTING_SERVICE_KEY:'fixture'},context);
 await waitOnExecutionContext(context);return response;
}

it('lets a Provider-qualified past player read the retained approved version without enabling social features',async()=>{
 const {source,target,network}=await fixture();
 const response=await request('/v1/cards/'+source,'player');
 expect(response.status).toBe(200);
 const body=await response.json();
 expect(body).toMatchObject({roleId:target,sourceRoleId:source,name:'Retained approved version',status:'private',canInteract:false,listed:false});
 expect(JSON.stringify(body)).not.toMatch(/Private instructions|jailbreak|Never expose/);
 expect(response.headers.get('Cache-Control')).toContain('no-store');expect(response.headers.get('X-Robots-Tag')).toContain('noindex');
 expect(network).toHaveBeenCalledTimes(1);
});
it('advertises only the same authenticated private target as playable',async()=>{
 const {source,target}=await fixture();
 const response=await request('/v1/cards/'+source+'/platforms','player');
 expect(response.status).toBe(200);expect(await response.json()).toEqual({platforms:[{provider:'harbor',roleId:target,playable:true}]});
 expect(response.headers.get('Cache-Control')).toContain('no-store');expect(response.headers.get('X-Robots-Tag')).toContain('noindex');
});
it('uses source only after the Provider confirms that exact source is playable',async()=>{
 const {source,target,state,network}=await fixture();state.allowed=new Set([source]);
 const response=await request('/v1/cards/'+source,'player');
 expect(response.status).toBe(200);expect(await response.json()).toMatchObject({roleId:source,name:'Played source',rating:'R',canInteract:false});
 expect(network.mock.calls.map(([url])=>new URL(String(url)).searchParams.get('roleId'))).toEqual([target,source]);
});
it('opens an actually played source when no approved version exists',async()=>{
 const {source}=await fixture(false);
 const response=await request('/v1/cards/'+source+'/platforms','player');
 expect(response.status).toBe(200);expect(await response.json()).toMatchObject({platforms:[{roleId:source}]});
});
it.each([undefined,'stranger'])('does not disclose private metadata to an unqualified %s viewer',async token=>{
 const {source}=await fixture();
 for(const path of ['/v1/cards/'+source,'/v1/cards/'+source+'/platforms']){
  const response=await request(path,token);expect(response.status).toBe(404);expect(await response.text()).not.toMatch(/Stale card|Retained approved|Played source/);
 }
});
it.each(['offline','server_error','wrong_role','wrong_author'])('fails closed on %s instead of serving cached approved details',async mode=>{
 const {source,state}=await fixture();state.mode=mode;
 const response=await request('/v1/cards/'+source,'player');expect(response.status).toBe(503);expect(await response.text()).not.toMatch(/Stale card|Retained approved|Played source/);
});
it('does not let a forged community pointer grant private access',async()=>{
 const {source,target}=await fixture();
 await request('/v1/cards/'+source,'stranger');
 const stranger=await makeMember(43);
 await env.DB.prepare('INSERT INTO member_conversations(member_id,provider,role_id,conversation_id,created_at,updated_at) VALUES(?,?,?,?,?,?)').bind(stranger,'harbor',target,'made-up',Date.now(),Date.now()).run();
 expect((await request('/v1/cards/'+source,'stranger')).status).toBe(404);
});
it('keeps private cards out of discovery, favorites and social reads for a past player',async()=>{
 const {source}=await fixture();
 const card=(await getCard(env.DB,source))!;
 for(const path of ['/v1/cards/'+source+'/comments','/v1/cards/'+source+'/score'])expect((await request(path,'player')).status).toBe(404);
 const board=await request('/v1/cards','player');expect(board.status).toBe(200);expect((await board.json() as any).items).toEqual([]);
 const player=await makeMember(42);
 await env.DB.prepare('INSERT INTO member_favorites(member_id,card_id,created_at) VALUES(?,?,?)').bind(player,card.id,Date.now()).run();
 const favorites=await request('/v1/me/favorites','player');expect(favorites.status).toBe(200);
 expect((await favorites.json() as any).items).not.toContainEqual(expect.objectContaining({name:'Retained approved version'}));
});
it('does not bypass local moderation or an unfinished policy transition',async()=>{
 const {source,work,network}=await fixture();
 await env.DB.prepare("UPDATE managed_work_access SET restriction='suspended' WHERE work_id=?").bind(work).run();
 expect((await request('/v1/cards/'+source,'player')).status).toBe(404);expect(network).not.toHaveBeenCalled();
 await env.DB.prepare("UPDATE managed_work_access SET restriction='none',sync_state='changing' WHERE work_id=?").bind(work).run();
 expect((await request('/v1/cards/'+source,'player')).status).toBe(503);expect(network).not.toHaveBeenCalled();
});
it('emits bounded private detail/platform allow, deny and unavailable counters without private data',async()=>{
 const {source,state}=await fixture();
 await request('/v1/cards/'+source,'player');await request('/v1/cards/'+source+'/platforms','player');
 await request('/v1/cards/'+source,'stranger');
 state.mode='offline';await request('/v1/cards/'+source,'player');
 const metrics=await opsMetrics(env.DB);
 expect(metrics).toContain('hearthroom_visibility_reads_total{surface="private_detail",outcome="allow"} 1');
 expect(metrics).toContain('hearthroom_visibility_reads_total{surface="private_metadata",outcome="allow"} 1');
 expect(metrics).toContain('hearthroom_visibility_reads_total{surface="private_detail",outcome="denied"} 1');
 expect(metrics).toContain('hearthroom_visibility_reads_total{surface="private_detail",outcome="unavailable"} 1');
 expect(metrics).not.toContain(source);expect(metrics).not.toContain('Bearer');expect(metrics).not.toContain('Private instructions');
});
it('applies the adult gate to qualified source play while hiding source content from an ungated player',async()=>{
 const {source,state}=await fixture(false);state.allowed=new Set([source]);
 const player=await makeMember(42);await env.DB.prepare('UPDATE members SET show_nsfw=0 WHERE id=?').bind(player).run();
 const response=await request('/v1/cards/'+source,'player');expect(response.status).toBe(403);expect(await response.text()).not.toContain('Played source');
});
it('keeps a verified author without owner-read scope out of the past-player exception',async()=>{
 const {source,state,network}=await fixture();identities({authorLow:11});state.tokens.add('authorLow');
 vi.spyOn(workPolicyGateway,'owner').mockRejectedValue(new HttpError(403,'insufficient_scope'));
 for(const path of ['/v1/cards/'+source,'/v1/cards/'+source+'/platforms'])expect((await request(path,'authorLow')).status).toBe(404);
 expect(network).not.toHaveBeenCalled();
});

it('preserves private past-player entry when the work is only delisted',async()=>{
 const {source,target,work}=await fixture();
 await env.DB.prepare("UPDATE managed_work_access SET restriction='delisted' WHERE work_id=?").bind(work).run();
 const response=await request('/v1/cards/'+source,'player');
 expect(response.status).toBe(200);
 expect(await response.json()).toMatchObject({roleId:target,status:'private',canInteract:false,listed:false});
 const platforms=await request('/v1/cards/'+source+'/platforms','player');
 expect(platforms.status).toBe(200);
 expect(await platforms.json()).toMatchObject({platforms:[{roleId:target,playable:true}]});
});
it('gates exact private resumes with the current community moderation and sync fence',async()=>{
 const {source,work}=await fixture();
 const old=crypto.randomUUID();
 await env.DB.prepare("INSERT INTO work_copies(work_id,provider,external_id,role_id,status,updated_at) VALUES(?,'harbor',11,?,'published',?)").bind(work,old,Date.now()).run();
 const player=await makeMember(42);
 await env.DB.prepare('INSERT INTO member_conversations(member_id,provider,role_id,conversation_id,created_at,updated_at) VALUES(?,?,?,?,?,?)').bind(player,'harbor',old,'exact-saved',Date.now(),Date.now()).run();
 const read=async()=>await (await request('/v1/me/conversations/exact-saved?provider=harbor','player')).json() as any;
 expect(await read()).toMatchObject({roleId:old,canResumeExact:true});
 await env.DB.prepare('UPDATE cards SET public_blocked=1 WHERE source_role_id=?').bind(source).run();
 expect((await read()).canResumeExact).toBe(false);
 await env.DB.prepare('UPDATE cards SET public_blocked=0 WHERE source_role_id=?').bind(source).run();
 await env.DB.prepare("INSERT INTO moderation_state(provider,source_role_id,public_blocked) VALUES('harbor',?,1)").bind(source).run();
 expect((await read()).canResumeExact).toBe(false);
 await env.DB.prepare('UPDATE moderation_state SET public_blocked=0 WHERE source_role_id=?').bind(source).run();
 await env.DB.prepare("UPDATE managed_work_access SET sync_state='changing' WHERE work_id=?").bind(work).run();
 expect((await read()).canResumeExact).toBe(false);
 await env.DB.prepare("UPDATE managed_work_access SET sync_state='complete',moderation_revision=confirmed_moderation_revision+1 WHERE work_id=?").bind(work).run();
 expect((await read()).canResumeExact).toBe(false);
 await env.DB.prepare("UPDATE managed_work_access SET moderation_revision=confirmed_moderation_revision,restriction='suspended' WHERE work_id=?").bind(work).run();
 expect((await read()).canResumeExact).toBe(false);
 await env.DB.prepare("UPDATE managed_work_access SET restriction='delisted' WHERE work_id=?").bind(work).run();
 expect((await read()).canResumeExact).toBe(true);
 await env.DB.prepare('UPDATE members SET show_nsfw=0 WHERE id=?').bind(player).run();
 // Existing library policy retains previously age-verified content when discovery is off.
 expect((await read()).canResumeExact).toBe(true);
 await env.DB.prepare('UPDATE members SET adult_consent_version=0 WHERE id=?').bind(player).run();
 expect((await read()).canResumeExact).toBe(false);
 await env.DB.prepare('UPDATE members SET adult_consent_version=?,age_verified_at=NULL WHERE id=?').bind(ADULT_CONSENT_VERSION,player).run();
 expect((await read()).canResumeExact).toBe(false);
 expect((await request('/v1/me/conversations/exact-saved?provider=harbor','stranger')).status).toBe(404);
});
it('projects the Provider canonical revision after a same-work conversation migration',async()=>{
 const {source,target,work}=await fixture();
 const old=crypto.randomUUID(),player=await makeMember(42);
 await env.DB.prepare("INSERT INTO work_copies(work_id,provider,external_id,role_id,status,updated_at) VALUES(?,'harbor',11,?,'published',?)").bind(work,old,Date.now()).run();
 await env.DB.prepare('INSERT INTO member_conversations(member_id,provider,role_id,conversation_id,created_at,updated_at) VALUES(?,?,?,?,?,?)').bind(player,'harbor',old,'migrated-saved',Date.now(),Date.now()).run();
 const {ownedHistory}=await import('../src/owned-history');
 vi.spyOn(ownedHistory,'read').mockResolvedValue({conversationId:'migrated-saved',roleId:target,canGenerate:true,roleName:'Canonical saved role'});
 for(let attempt=0;attempt<2;attempt++){
  const pointer=await request('/v1/me/conversations/migrated-saved?provider=harbor','player');
  expect(pointer.status).toBe(200);expect(await pointer.json()).toMatchObject({roleId:target,canResumeExact:true});
  const list=await request('/v1/me/conversations','player');
  expect((await list.json() as any).conversations[0]).toMatchObject({conversationRoleId:target,canGenerate:true});
 }
 const stored=await env.DB.prepare("SELECT role_id FROM member_conversations WHERE member_id=? AND conversation_id='migrated-saved'").bind(player).first<{role_id:string}>();
 expect(stored?.role_id).toBe(old);
 // Both old and canonical pointers can coexist after the activity writer runs.
 await env.DB.prepare('INSERT INTO member_conversations(member_id,provider,role_id,conversation_id,created_at,updated_at) VALUES(?,?,?,?,?,?)').bind(player,'harbor',target,'migrated-saved',Date.now(),Date.now()).run();
 expect(await (await request('/v1/me/conversations/migrated-saved?provider=harbor','player')).json()).toMatchObject({roleId:target});
 // Never choose one arbitrary matching pointer if another points somewhere unknown.
 await env.DB.prepare('INSERT INTO member_conversations(member_id,provider,role_id,conversation_id,created_at,updated_at) VALUES(?,?,?,?,?,?)').bind(player,'harbor',crypto.randomUUID(),'migrated-saved',Date.now(),Date.now()).run();
 expect((await request('/v1/me/conversations/migrated-saved?provider=harbor','player')).status).toBe(404);
});
it('does not reconcile a forged conversation pointer into a different work',async()=>{
 const {target,work}=await fixture();
 const old=crypto.randomUUID(),foreign=crypto.randomUUID(),player=await makeMember(42);
 await env.DB.prepare("INSERT INTO work_copies(work_id,provider,external_id,role_id,status,updated_at) VALUES(?,'harbor',11,?,'published',?)").bind(work,old,Date.now()).run();
 await env.DB.prepare('INSERT INTO member_conversations(member_id,provider,role_id,conversation_id,created_at,updated_at) VALUES(?,?,?,?,?,?)').bind(player,'harbor',old,'foreign-saved',Date.now(),Date.now()).run();
 const {ownedHistory}=await import('../src/owned-history');
 vi.spyOn(ownedHistory,'read').mockResolvedValue({conversationId:'foreign-saved',roleId:foreign,canGenerate:true,roleName:'Foreign private text'});
 const pointer=await request('/v1/me/conversations/foreign-saved?provider=harbor','player');
 expect(pointer.status).toBe(404);expect(await pointer.text()).not.toContain('Foreign private text');
 const list=await request('/v1/me/conversations','player');
 const item=(await list.json() as any).conversations[0];
 expect(item.canGenerate).toBe(false);expect(JSON.stringify(item)).not.toContain('Foreign private text');
});

it('rejects contradictory work mappings instead of selecting one lineage',async()=>{
 const {target,work}=await fixture();
 const old=crypto.randomUUID(),player=await makeMember(42),author=await makeMember(11);
 await env.DB.prepare("INSERT INTO work_copies(work_id,provider,external_id,role_id,status,updated_at) VALUES(?,'harbor',11,?,'published',?)").bind(work,old,Date.now()).run();
 await env.DB.prepare('INSERT INTO works VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),author,'harbor',old,Date.now()).run();
 await env.DB.prepare('INSERT INTO member_conversations(member_id,provider,role_id,conversation_id,created_at,updated_at) VALUES(?,?,?,?,?,?)').bind(player,'harbor',old,'ambiguous-saved',Date.now(),Date.now()).run();
 const {ownedHistory}=await import('../src/owned-history');
 vi.spyOn(ownedHistory,'read').mockResolvedValue({conversationId:'ambiguous-saved',roleId:target,canGenerate:true});
 expect((await request('/v1/me/conversations/ambiguous-saved?provider=harbor','player')).status).toBe(404);
});
