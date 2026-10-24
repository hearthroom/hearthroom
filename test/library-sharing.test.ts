import {createExecutionContext,env,waitOnExecutionContext} from 'cloudflare:test';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import worker from '../src/index';
import {getCard,upsertCard} from '../src/cards';
import {identitiesFor,makeMember,resetDb,restoreUpstream,role} from './helpers';
import {upstream} from '../src/upstream';
import {ADULT_CONSENT_VERSION} from '../shared/adult-consent';

beforeEach(resetDb);afterEach(()=>{vi.restoreAllMocks();restoreUpstream();});
async function fixture(){
 const member=await makeMember(42),owner=await makeMember(11);identitiesFor({harbor:{reader:42,other:43}});
 const source=crypto.randomUUID(),target=crypto.randomUUID(),work=crypto.randomUUID();
 await upsertCard(env.DB,role({roleId:source,authorNumId:11,name:'Private current title'}),1,{status:'approved'});
 const card=(await getCard(env.DB,source))!;
 await env.DB.prepare('UPDATE cards SET approved_hosted_role_id=? WHERE id=?').bind(target,card.id).run();
 await env.DB.prepare('INSERT INTO works VALUES(?,?,?,?,?)').bind(work,owner,'harbor',source,1).run();
 await env.DB.prepare("INSERT INTO managed_work_access(work_id,provider,source_role_id,access,epoch,restriction,approved_role_id) VALUES(?,'harbor',?,'public',1,'none',?)").bind(work,source,target).run();
 await env.DB.prepare('INSERT INTO member_favorites VALUES(?,?,1)').bind(member,card.id).run();
 const current={access:'private',offline:false};
 vi.spyOn(globalThis,'fetch').mockImplementation(async(input,init)=>{
  if(!String(input).endsWith('/hosting/work-access/batch')||current.offline)throw new Error('Fixture unavailable');
  const {items}=JSON.parse(String(init?.body));return Response.json({items:items.map((i:any)=>({...i,managed:true,access:current.access,restriction:'none',epoch:2,approvedRoleId:target,shareRoleId:current.access==='public'?target:current.access==='unlisted'?source:'',targetReadable:current.access!=='private',listed:current.access==='public'}))});
 });
 return {member,owner,source,target,work,card,current};
}
async function request(path:string,method='GET',token='reader'){
 const ctx=createExecutionContext();const response=await worker.fetch(new Request('https://c.test/v1/me/'+path,{method,headers:{Authorization:'Bearer '+token}}),{...env,HOSTING_SERVICE_KEY:'fixture-issuer'},ctx);await waitOnExecutionContext(ctx);return response;
}
it('returns only a generic removal pointer for the readers existing private bookmark',async()=>{
 const {card,source}=await fixture();const response=await request('favorites');expect(response.status).toBe(200);
 const body=await response.json();expect(body).toMatchObject({items:[{unavailable:true,bookmarkId:card.id}]});
 const serialized=JSON.stringify(body);expect(serialized).not.toContain('Private current title');expect(serialized).not.toContain(source);expect(serialized).not.toContain('author');
 expect(await(await request('favorites','GET','other')).json()).toMatchObject({items:[]});
});
it('does not create a new private bookmark from a stale approved community row',async()=>{
 const {card}=await fixture();expect((await request('favorites/'+card.id,'PUT','other')).status).toBe(404);
});
it('removes an own private bookmark without exposing the global favorite count',async()=>{
 const {card}=await fixture();const response=await request('favorites/'+card.id,'DELETE');
 expect(await response.json()).toEqual({active:false});expect(await(await request('favorites')).json()).toMatchObject({items:[]});
});
it('keeps provider failure distinct from an authors private decision',async()=>{
 const {current}=await fixture();current.offline=true;expect((await request('favorites')).status).toBe(503);
});
it('restores the same favorite after the author reopens the work',async()=>{
 const {card,current}=await fixture();await request('favorites');current.access='public';
 expect(await(await request('favorites')).json()).toMatchObject({items:[{id:card.id,name:'Private current title'}]});
});
it('keeps unlisted favorites reachable and reads latest saved content only after adult consent',async()=>{
 const {work,card,source,current,member}=await fixture();current.access='unlisted';
 await env.DB.prepare("UPDATE managed_work_access SET access='unlisted' WHERE work_id=?").bind(work).run();
 const sourceRead=vi.spyOn(upstream,'fetchRole').mockResolvedValue(role({roleId:source,authorNumId:11,name:'Latest saved name'}));
 expect(await(await request('favorites')).json()).toMatchObject({items:[]});expect(sourceRead).not.toHaveBeenCalled();
 await env.DB.prepare('UPDATE members SET age_verified_at=1,adult_consent_version=? WHERE id=?').bind(ADULT_CONSENT_VERSION,member).run();
 expect(await(await request('favorites')).json()).toMatchObject({items:[{id:card.id,name:'Latest saved name'}]});expect(sourceRead).toHaveBeenCalledTimes(1);
});
it('gates feed candidates against current policy before returning any card fields',async()=>{
 const {member,owner}=await fixture();await env.DB.prepare('INSERT INTO member_follows VALUES(?,?,1)').bind(member,owner).run();
 expect(await(await request('feed')).json()).toMatchObject({items:[],total:null});
});
