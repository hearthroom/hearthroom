import {createExecutionContext,env,waitOnExecutionContext} from 'cloudflare:test';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import worker from '../src/index';
import {getCard,upsertCard} from '../src/cards';
import {identitiesFor,makeMember,resetDb,restoreUpstream,role} from './helpers';
import {upstream,type MyRole} from '../src/upstream';

beforeEach(resetDb);afterEach(()=>{vi.restoreAllMocks();restoreUpstream();});
async function fixture(count=30){
 const member=await makeMember(11);identitiesFor({harbor:{owner:11}});
 const roles:MyRole[]=Array.from({length:count},(_,i)=>({roleId:crypto.randomUUID(),name:'Draft '+i,summary:'',avatarUrl:null,backgroundUrl:null,zone:'all',visibility:i<23?'private':'unlisted',talkNum:0}));
 const lists=vi.spyOn(upstream,'fetchMyRoles').mockImplementation(async(_e,_t,page,size)=>({items:roles.slice((page-1)*size,page*size),total:roles.length,hasNext:page*size<roles.length}));
 const views=roles.map(r=>({sourceRoleId:r.roleId,workId:'00000000-0000-0000-0000-000000000000',managed:false,access:r.visibility,epoch:0,restriction:'none',state:'complete',replayed:false,approvedRoleId:'',policyRevision:'policy-'+r.roleId,approvalRevision:'approval-'+r.roleId,revisionState:'unknown',restorable:false,restoreReason:'not_approved',providerRestriction:'none'}));
 const network=vi.spyOn(globalThis,'fetch').mockImplementation(async(input,init)=>{
  if(!String(input).endsWith('/hosting/work-access/owner-batch'))throw new Error('Unexpected mine request');
  expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer owner');
  const {sourceRoleIds}=JSON.parse(String(init?.body)) as {sourceRoleIds:string[]};
  return Response.json({items:sourceRoleIds.map(id=>views.find(v=>v.sourceRoleId===id))});
 });
 return {member,roles,views,lists,network};
}
async function request(query='',enabled=true){
 const context=createExecutionContext();const res=await worker.fetch(new Request('https://c.test/v1/me/cards'+query,{headers:{Authorization:'Bearer owner'}}),{...env,HOSTING_SERVICE_KEY:'fixture-issuer',WORK_SHARING_ENABLED:enabled?'true':'false'},context);
 await waitOnExecutionContext(context);return res;
}
it('filters author access before pagination and batches the current full projection',async()=>{
 const {roles,network}=await fixture();
 const res=await request('?access=unlisted&pageSize=3&page=2');expect(res.status).toBe(200);
 const body=await res.json() as {items:{roleId:string;workVisibility:{access:string}}[];total:number;hasNext:boolean};
 expect(body.items.map(i=>i.roleId)).toEqual(roles.slice(26,29).map(r=>r.roleId));expect(body.total).toBe(7);expect(body.hasNext).toBe(true);
 expect(body.items.every(i=>i.workVisibility.access==='unlisted')).toBe(true);expect(network).toHaveBeenCalledTimes(1);
 expect(res.headers.get('Cache-Control')).toBe('private, no-store');
});
it('refreshes only saved cards on the requested author page in a bounded current-policy batch',async()=>{
 const {member,roles,views,network}=await fixture(12);
 for(const [i,r] of roles.entries()){
  const work=crypto.randomUUID();await upsertCard(env.DB,role({roleId:r.roleId,authorNumId:11}),0,{status:'unshared'});
  await env.DB.prepare('INSERT INTO works VALUES(?,?,?,?,?)').bind(work,member,'harbor',r.roleId,0).run();
  await env.DB.prepare("INSERT INTO managed_work_access(work_id,provider,source_role_id,access,epoch,restriction) VALUES(?,'harbor',?,'unlisted',2,'none')").bind(work,r.roleId).run();
  Object.assign(views[i],{managed:true,workId:work,access:'unlisted',epoch:5,revisionState:'changed'});
 }
 const owner=network.getMockImplementation()!;
 network.mockImplementation(async(input,init)=>{
  if(!String(input).endsWith('/work-access/batch'))return owner(input,init);
  const {items}=JSON.parse(String(init?.body));
  return Response.json({items:items.map((item:any)=>({...views.find(v=>v.sourceRoleId===item.sourceRoleId),...item,shareRoleId:item.sourceRoleId,targetReadable:true,listed:false}))});
 });
 const response=await request('?pageSize=12');expect(response.status).toBe(200);
 const body=await response.json() as {items:{workVisibility:{syncState:string;actions:string[]}}[]};
 expect(body.items).toHaveLength(12);
 expect(body.items.every(i=>i.workVisibility.syncState==='complete'&&i.workVisibility.actions.includes('set_private'))).toBe(true);
 expect(network.mock.calls.filter(([input])=>String(input).endsWith('/work-access/batch'))).toHaveLength(1);
 expect(await env.DB.prepare('SELECT count(*) AS n FROM managed_work_access WHERE epoch=5').first()).toEqual({n:12});
 expect(await env.DB.prepare('SELECT count(*) AS n FROM author_visibility_operations').first()).toEqual({n:0});
});
it('keeps share-only registration independent of the old listed filter',async()=>{
 const {roles}=await fixture(2);await upsertCard(env.DB,role({roleId:roles[0].roleId,authorNumId:11}),0,{status:'unshared'});
 const response=await request('?filter=listed');expect(response.status).toBe(200);
 expect(await response.json()).toMatchObject({items:[],total:0,registeredTotal:0});
 const unlisted=await request('?filter=unlisted');expect(await unlisted.json()).toMatchObject({total:2,registeredTotal:0});
 expect((await getCard(env.DB,roles[0].roleId))?.registered_at).toBe(0);
});
it('rejects an unknown access filter instead of silently switching to all',async()=>{
 await fixture();expect((await request('?access=typo')).status).toBe(400);
});
it('fails unavailable rather than page-filtering an author catalog beyond the bounded budget',async()=>{
 const {network,lists}=await fixture(201);const response=await request('?access=private');
 expect(response.status).toBe(503);expect(await response.json()).toMatchObject({error:'visibility_read_budget_exceeded'});
 expect(lists).toHaveBeenCalledTimes(2);expect(network).not.toHaveBeenCalled();
});
it('keeps ordinary inventory pages available beyond the access-filter budget',async()=>{
 const {network}=await fixture(201);const response=await request('?page=2&pageSize=24');
 expect(response.status).toBe(200);expect(await response.json()).toMatchObject({total:201,hasNext:true});
 expect(network).toHaveBeenCalledTimes(1);
});
it('does not count a share-only card as submitted when the new UI is disabled',async()=>{
 const {roles}=await fixture(2);await upsertCard(env.DB,role({roleId:roles[0].roleId,authorNumId:11}),0,{status:'unshared'});
 expect(await(await request('?filter=listed',false)).json()).toMatchObject({items:[],registeredTotal:0});
});
it.each(['missing','duplicate','foreign','offline'])('does not use cached or partial author permissions when batch is %s',async mode=>{
 const {network,views}=await fixture(2);
 if(mode==='offline')network.mockRejectedValue(new Error('Fixture offline'));
 else network.mockResolvedValue(Response.json({items:mode==='missing'?[]:mode==='duplicate'?[views[0],views[0]]:[views[0],{...views[1],sourceRoleId:crypto.randomUUID()}]}));
 expect((await request()).status).toBe(503);
});

it('rejects a valid access filter when the capability is disabled instead of returning unfiltered data',async()=>{
 const {network,lists}=await fixture();const res=await request('?access=private',false);
 expect(res.status).toBe(409);expect(await res.json()).toEqual({error:'visibility_disabled'});
 expect(network).not.toHaveBeenCalled();expect(lists).not.toHaveBeenCalled();
});
