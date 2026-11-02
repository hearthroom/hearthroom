import {createExecutionContext,env,waitOnExecutionContext} from 'cloudflare:test';
import {afterEach,beforeEach,it,expect,vi} from 'vitest';
import worker from '../src/index';
import {bearer,identities,makeMember,resetDb,restoreUpstream,rolesOnMainSite} from './helpers';

beforeEach(async()=>{
 await resetDb();identities({viewer:42});rolesOnMainSite({roleId:'region-new-share',authorNumId:11});
 vi.spyOn(globalThis,'fetch').mockImplementation(async(input,init)=>{
  if(!String(input).endsWith('/hosting/work-access/batch'))throw new Error('Unexpected region share fixture request');
  const body=JSON.parse(String(init?.body)) as {items:Record<string,unknown>[]};
  return Response.json({items:body.items.map(item=>({...item,managed:false,access:'unlisted',restriction:'none',epoch:0,approvedRoleId:'',shareRoleId:item.sourceRoleId,targetReadable:true,listed:false}))});
 });
 const member=await makeMember(42);await env.DB.prepare("UPDATE members SET country_region='CN' WHERE id=?").bind(member).run();
});
afterEach(()=>{vi.restoreAllMocks();restoreUpstream();});
it('classifies the conservative unregistered share gate as region unavailable in CN',async()=>{
 for(const suffix of ['','/leaderboard']){
  const ctx=createExecutionContext();
  const response=await worker.fetch(new Request('https://c.test/v1/cards/region-new-share'+suffix,{headers:bearer('viewer')}),{...env,WORK_SHARING_ENABLED:'true',HOSTING_SERVICE_KEY:'fixture'},ctx);
  await waitOnExecutionContext(ctx);
  expect(response.status).toBe(403);expect(await response.json()).toMatchObject({error:'region_unavailable'});
 }
});
