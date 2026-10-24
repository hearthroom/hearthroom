import {createExecutionContext,env,waitOnExecutionContext} from 'cloudflare:test';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import worker from '../src/index';
import {ensureCardNumber,getCard} from '../src/cards';
import {hostGateway} from '../src/hosting';
import {HttpError} from '../src/types';
import {opsMetrics} from '../src/ops-metrics';
import {identitiesFor,makeMember,resetDb,restoreUpstream,role} from './helpers';
import {upstream} from '../src/upstream';
import {ADULT_CONSENT_VERSION} from '../shared/adult-consent';
beforeEach(resetDb);afterEach(()=>{vi.restoreAllMocks();restoreUpstream();});
async function fixture(){
 identitiesFor({harbor:{reader:42}});const reader=await makeMember(42),source=crypto.randomUUID();
 vi.spyOn(hostGateway,'read').mockRejectedValue(new HttpError(403,'role_not_author'));
 const content=vi.spyOn(upstream,'fetchRole').mockResolvedValue(role({roleId:source,authorNumId:11,name:'Latest link content'}));
 const current={readable:true,managed:false};
 vi.spyOn(globalThis,'fetch').mockImplementation(async(input,init)=>{
  if(!String(input).endsWith('/hosting/work-access/batch'))throw new Error('Unexpected lazy request');
  const {items}=JSON.parse(String(init?.body));return Response.json({items:items.map((i:any)=>({...i,managed:current.managed,access:current.managed?'private':'',restriction:current.managed?'none':'',epoch:current.managed?1:0,approvedRoleId:'',shareRoleId:current.readable?source:'',targetReadable:current.readable,listed:false}))});
 });return {source,reader,content,current};
}
async function request(source:string,token='reader'){const ctx=createExecutionContext();const res=await worker.fetch(new Request('https://c.test/v1/cards/'+source,{headers:token?{Authorization:'Bearer '+token}:{}}),{...env,HOSTING_SERVICE_KEY:'fixture-issuer',WORK_SHARING_ENABLED:'true'},ctx);await waitOnExecutionContext(ctx);return res;}
async function adult(member:string){await env.DB.prepare('UPDATE members SET show_nsfw=1,age_verified_at=1,adult_consent_version=? WHERE id=?').bind(ADULT_CONSENT_VERSION,member).run();}
it('lazily registers a verified legacy link once with social access and zero publication usage',async()=>{
 const {source,reader}=await fixture();await adult(reader);
 for(let i=0;i<2;i++){const response=await request(source);expect(response.status).toBe(200);expect(await response.json()).toMatchObject({sourceRoleId:source,status:'unlisted',name:'Latest link content',canInteract:true,listed:false});expect(response.headers.get('X-Robots-Tag')).toContain('noindex');}
 expect(await getCard(env.DB,source)).toMatchObject({registered_at:0,status:'unlisted',rating:'R'});
 for(const table of ['card_registrations','hosting_versions','review_submissions','managed_work_access','visibility_operations'])expect(await env.DB.prepare(`SELECT count(*) AS n FROM ${table}`).first()).toEqual({n:0});
 expect(await env.DB.prepare('SELECT count(*) AS n FROM cards').first()).toEqual({n:1});
});
it('checks the conservative adult gate before reading unreviewed source fields',async()=>{
 const {source,content}=await fixture();const response=await request(source);expect(response.status).toBe(403);expect(content).not.toHaveBeenCalled();expect(await getCard(env.DB,source)).toBeNull();
});
it.each(['private','managed'])('never enrolls or registers unknown legacy authority when %s',async mode=>{
 const {source,reader,current}=await fixture();await adult(reader);current.readable=false;current.managed=mode==='managed';
 expect((await request(source)).status).toBe(mode==='managed'?503:404);expect(await getCard(env.DB,source)).toBeNull();
});

it.each([false,true])('lets the scoped author read a never-submitted private card (numbered=%s)',async numbered=>{
 const {source,content,current}=await fixture();current.readable=false;
 identitiesFor({harbor:{owner:11,reader:42,profileOnly:11}});
 const read=vi.spyOn(hostGateway,'read').mockImplementation(async(_env,token,id)=>{
  if(token!=='owner')throw new HttpError(403,'insufficient_scope');
  return role({roleId:id,authorNumId:11,name:'Owned private draft'});
 });
 const id=numbered?String(await ensureCardNumber(env.DB,'harbor',source)):source;
 const response=await request(id,'owner');expect(response.status).toBe(200);
 expect(await response.json()).toMatchObject({roleId:source,name:'Owned private draft',canInteract:false,listed:false});
 expect(response.headers.get('Cache-Control')).toContain('no-store');
 expect(response.headers.get('X-Robots-Tag')).toContain('noindex');
 expect(read).toHaveBeenCalledWith(expect.anything(),'owner',source);
 expect(content).not.toHaveBeenCalled();
 for(const token of ['reader','profileOnly','']){
  const denied=await request(id,token);expect(denied.status).toBe(404);
  expect(await denied.text()).not.toContain('Owned private draft');
 }
 expect(await getCard(env.DB,source)).toBeNull();
 for(const table of ['works','managed_work_access','visibility_operations','card_registrations'])expect(await env.DB.prepare(`SELECT count(*) AS n FROM ${table}`).first()).toEqual({n:0});
 expect(await opsMetrics(env.DB)).toContain('hearthroom_visibility_reads_total{surface="detail",outcome="allow"} 1');
 expect(await opsMetrics(env.DB)).toContain('hearthroom_visibility_reads_total{surface="detail",outcome="denied"} 3');
});

it('does not let a scoped reader impersonate the author of a private source',async()=>{
 const {source,current}=await fixture();current.readable=false;
 vi.spyOn(hostGateway,'read').mockResolvedValue(role({roleId:source,authorNumId:11,name:'Private source'}));
 const denied=await request(source);expect(denied.status).toBe(404);
 expect(await denied.text()).not.toContain('Private source');
});

it('preserves public-link registration and social access when the visitor is its author',async()=>{
 const {source}=await fixture();identitiesFor({harbor:{owner:11}});await adult(await makeMember(11));
 vi.spyOn(hostGateway,'read').mockResolvedValue(role({roleId:source,authorNumId:11}));
 const response=await request(source,'owner');expect(response.status).toBe(200);
 expect(await response.json()).toMatchObject({sourceRoleId:source,status:'unlisted',canInteract:true,listed:false});
 expect(await getCard(env.DB,source)).toMatchObject({status:'unlisted',registered_at:0});
});
