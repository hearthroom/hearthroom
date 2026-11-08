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
it('filters a 401-work owner catalog in bounded authority batches before slicing the page',async()=>{
 const {roles,network,lists,views}=await fixture(401);views[400].access='private';
 const response=await request('?access=private&pageSize=24');expect(response.status).toBe(200);
 const body=await response.json() as any;expect(body.total).toBe(24);expect(body.hasNext).toBe(false);expect(body.items.map((r:any)=>r.roleId)).toEqual([...roles.slice(0,23),roles[400]].map(r=>r.roleId));
 expect(lists).toHaveBeenCalledTimes(5);expect(network.mock.calls.map(([,init])=>JSON.parse(String(init?.body)).sourceRoleIds.length)).toEqual([200,200,1]);
 const warm=await request('?access=private&pageSize=24');expect(warm.status).toBe(200);expect(lists).toHaveBeenCalledTimes(5);expect(network).toHaveBeenCalledTimes(6);
});
it('returns no partial author catalog when a later authority batch is unavailable',async()=>{
 const {network}=await fixture(201),original=network.getMockImplementation()!;
 network.mockImplementation(async(input,init)=>JSON.parse(String(init?.body)).sourceRoleIds.length===1?Response.json({items:[]}):original(input,init));
 const response=await request('?access=private');expect(response.status).toBe(503);expect(await response.json()).toEqual({error:'visibility_provider_unavailable'});expect(network).toHaveBeenCalledTimes(2);
});
it('rejects a repeated upstream inventory page rather than looping or returning a partial filter',async()=>{
 const {lists,network,roles}=await fixture(201);lists.mockResolvedValue({items:roles.slice(0,100),hasNext:true,total:201});
 const response=await request('?access=private');expect(response.status).toBe(503);expect(lists).toHaveBeenCalledTimes(2);expect(network).not.toHaveBeenCalled();
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


it.each(['', '?access=unlisted'])('returns no displayed rating in the unlisted author inventory (%s)',async query=>{
 const {roles,views}=await fixture(1);
 Object.assign(roles[0],{rating:'R'});Object.assign(views[0],{access:'unlisted'});
 await upsertCard(env.DB,role({roleId:roles[0].roleId,authorNumId:11}),0,{status:'unlisted'});
 await env.DB.prepare("UPDATE cards SET rating='R' WHERE source_role_id=?").bind(roles[0].roleId).run();
 const response=await request(query);expect(response.status).toBe(200);
 expect(await response.json()).toMatchObject({items:[{roleId:roles[0].roleId,rating:null,workVisibility:{access:'unlisted'}}]});
 expect((await getCard(env.DB,roles[0].roleId))?.rating).toBe('R');
});

it('omits the rating of a legacy unlisted card when visibility controls are disabled',async()=>{
 const {roles}=await fixture(1);
 await upsertCard(env.DB,role({roleId:roles[0].roleId,authorNumId:11}),0,{status:'unlisted'});
 await env.DB.prepare("UPDATE cards SET rating='R' WHERE source_role_id=?").bind(roles[0].roleId).run();
 expect(await(await request('',false)).json()).toMatchObject({items:[{rating:null}]});
});
// 重新審核（審核員 2026-11-08）：作品分享開著時，「我的卡片」的每一條路都要帶出重新審核中，不帶理由
it('marks a card under re-review on every sharing list path, without the reason',async()=>{
 const {roles}=await fixture(4);
 await upsertCard(env.DB,role({roleId:roles[0].roleId,authorNumId:11}),0,{status:'approved'});
 const card=(await env.DB.prepare('SELECT id FROM cards WHERE source_role_id=?').bind(roles[0].roleId).first<{id:number}>())!.id;
 await env.DB.prepare("INSERT INTO review_submissions(id,card_id,provider,source_role_id,kind,status,content_hash,submitted_at,reopen_of,reopened_by,reopen_reason) VALUES('reopen-1',?,'harbor','hosted-revision-1','re','pending','version:v1',1,'orig','member-x','疑似盜用')").bind(card).run();
 // 重審單的 source_role_id 是過審那一版的封存編號（不是作者的草稿），作者的「新版審核中」不會被它觸發
 for(const query of ['','?access=public']){
  const res=await request(query);expect(res.status).toBe(200);
  const body=await res.json() as {items:{roleId:string;reReview?:boolean}[]};
  expect(body.items.find(i=>i.roleId===roles[0].roleId)?.reReview,query).toBe(true);
  expect(body.items.filter(i=>i.reReview)).toHaveLength(1);
  expect(JSON.stringify(body)).not.toContain('疑似盜用');
  expect((body.items.find(i=>i.roleId===roles[0].roleId) as {workVisibility?:{update?:string}}).workVisibility?.update).not.toBe('pending');
 }
});
