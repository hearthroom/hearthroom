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
