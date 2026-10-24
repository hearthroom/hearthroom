import {createExecutionContext,env,waitOnExecutionContext} from 'cloudflare:test';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import worker from '../src/index';
import {getCard,upsertCard} from '../src/cards';
import {makeMember,resetDb,restoreUpstream,role} from './helpers';
beforeEach(resetDb);afterEach(()=>{vi.restoreAllMocks();restoreUpstream();});
async function fixture(count=5){
 const member=await makeMember(11),ids:string[]=[],denied=new Set<string>();
 for(let i=0;i<count;i++){
  const source=crypto.randomUUID(),target=crypto.randomUUID(),work=crypto.randomUUID();ids.push(source);
  await upsertCard(env.DB,role({roleId:source,authorNumId:11,name:'Card '+i}),count-i,{status:'approved'});
  await env.DB.prepare('UPDATE cards SET approved_hosted_role_id=? WHERE source_role_id=?').bind(target,source).run();
  await env.DB.prepare('INSERT INTO works VALUES(?,?,?,?,1)').bind(work,member,'harbor',source).run();
  await env.DB.prepare("INSERT INTO managed_work_access(work_id,provider,source_role_id,access,epoch,restriction,approved_role_id) VALUES(?,'harbor',?,'public',1,'none',?)").bind(work,source,target).run();
 }
 const batches:number[]=[];
 vi.spyOn(globalThis,'fetch').mockImplementation(async(input,init)=>{
  if(!String(input).endsWith('/hosting/work-access/batch'))throw new Error('Unexpected request');
  const {items}=JSON.parse(String(init?.body));batches.push(items.length);
  return Response.json({items:items.map((r:any)=>({...r,managed:true,access:denied.has(r.sourceRoleId)?'private':'public',epoch:2,restriction:'none',approvedRoleId:r.targetRoleId,shareRoleId:denied.has(r.sourceRoleId)?'':r.targetRoleId,targetReadable:!denied.has(r.sourceRoleId),listed:!denied.has(r.sourceRoleId)}))});
 });return {ids,denied,batches};
}
async function page(query=''){
 const ctx=createExecutionContext();const response=await worker.fetch(new Request('https://c.test/v1/cards?sort=new&limit=2'+query),{...env,HOSTING_SERVICE_KEY:'fixture-issuer'},ctx);await waitOnExecutionContext(ctx);
 return {response,body:await response.json() as any};
}
it('fills a visible page before exposing a proven next page and follows an opaque continuation without duplicates',async()=>{
 const {ids,denied}=await fixture();denied.add(ids[0]);denied.add(ids[2]);
 const first=await page();expect(first.body.items.map((r:any)=>r.sourceRoleId)).toEqual([ids[1],ids[3]]);expect(first.body.total).toBeNull();expect(first.body.hasNext).toBe(true);expect(first.body.nextCursor).toEqual(expect.any(String));
 const next=await page('&offset=2&cursor='+encodeURIComponent(first.body.nextCursor));expect(next.body.items.map((r:any)=>r.sourceRoleId)).toEqual([ids[4]]);expect(next.body.hasNext).toBe(false);
 const previous=await page('&cursor='+encodeURIComponent(next.body.previousCursor));expect(previous.body.items.map((r:any)=>r.sourceRoleId)).toEqual([ids[1],ids[3]]);
});
it('refills a warm candidate cache and proves hasNext after an out-of-band private change',async()=>{
 const {ids,denied}=await fixture(3);const first=await page();expect(first.body.hasNext).toBe(true);denied.add(ids[0]);denied.add(ids[2]);
 const warm=await page();expect(warm.body.items.map((r:any)=>r.sourceRoleId)).toEqual([ids[1]]);expect(warm.body.hasNext).toBe(false);expect(warm.body.total).toBeNull();
});
it('does not disclose stale totals when only an off-page managed work became private',async()=>{
 const {ids,denied}=await fixture();denied.add(ids.at(-1)!);
 const first=await page();expect(first.body.items).toHaveLength(2);expect(first.body.total).toBeNull();
});
it('fails unavailable when the bounded candidate set cannot prove another visible item',async()=>{
 const {ids,denied,batches}=await fixture(201);ids.slice(0,200).forEach(id=>denied.add(id));
 const result=await page();expect(result.response.status).toBe(503);expect(result.body.error).toBe('visibility_read_budget_exceeded');expect(batches).toEqual([200]);
});
it('rejects tampered or cross-filter continuation tokens instead of trusting their position',async()=>{
 await fixture();const first=await page();expect(first.body.nextCursor).toEqual(expect.any(String));
 expect((await page('&offset=2&cursor='+encodeURIComponent(first.body.nextCursor+'x'))).response.status).toBe(400);
 expect((await page('&offset=2&tag=other&cursor='+encodeURIComponent(first.body.nextCursor))).response.status).toBe(400);
});
