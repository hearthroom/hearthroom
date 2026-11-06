import {createExecutionContext,env,waitOnExecutionContext} from 'cloudflare:test';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import worker from '../src/index';
import {sealAuth} from '../src/account-auth';
import {ADULT_CONSENT_VERSION} from '../shared/adult-consent';
import {publicCandidates,publicCandidatePage} from '../src/work-pagination';
import {getCard,upsertCard} from '../src/cards';
import {identities,makeMember,resetDb,restoreUpstream,role} from './helpers';
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
const testEnv=()=>({...env,HOSTING_SERVICE_KEY:'fixture-issuer',AUTH_ENABLED:'true',AUTH_ALLOWED_ORIGINS:'https://c.test',AUTH_KEYRING:JSON.stringify({active:'test',keys:{test:'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='}})});
async function page(query='',headers:Record<string,string>={}){
 const ctx=createExecutionContext();const response=await worker.fetch(new Request('https://c.test/v1/cards?sort=new&limit=2'+query,{headers}),testEnv(),ctx);await waitOnExecutionContext(ctx);
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
it('scans multiple bounded batches and keeps warm continuations free of duplicates',async()=>{
 const {ids,denied,batches}=await fixture(260);ids.slice(0,200).forEach(id=>denied.add(id));
 const first=await page();expect(first.response.status).toBe(200);expect(first.body.items.map((r:any)=>r.sourceRoleId)).toEqual(ids.slice(200,202));expect(first.body.hasNext).toBe(true);expect(batches).toEqual([200,60]);
 const warm=await page();expect(warm.response.headers.get('X-Cache')).toBe('hit');expect(warm.body.items.map((r:any)=>r.sourceRoleId)).toEqual(ids.slice(200,202));
 const next=await page('&offset=2&cursor='+encodeURIComponent(first.body.nextCursor));expect(next.response.status).toBe(200);expect(next.body.items.map((r:any)=>r.sourceRoleId)).toEqual(ids.slice(202,204));
 const previous=await page('&cursor='+encodeURIComponent(next.body.previousCursor));expect(previous.body.items.map((r:any)=>r.sourceRoleId)).toEqual(ids.slice(200,202));expect(batches.every(n=>n<=200)).toBe(true);
});
it.each(['offline','missing','wrongWork'] as const)('fails closed when a later candidate batch is %s',async failure=>{
 const {ids,denied}=await fixture(201);ids.slice(0,199).forEach(id=>denied.add(id));
 const network=vi.mocked(globalThis.fetch),original=network.getMockImplementation()!;
 network.mockImplementation(async(input,init)=>{
  const {items}=JSON.parse(String(init?.body));
  if(items.some((r:any)=>r.sourceRoleId===ids[200])){
   if(failure==='offline')throw new TypeError('Synthetic later-batch reset');
   if(failure==='missing')return Response.json({items:[]});
   return Response.json({items:items.map((r:any)=>({...r,workId:crypto.randomUUID()}))});
  }
  return original(input,init);
 });
 const result=await page();expect(result.response.status).toBe(503);expect(result.body).toEqual({error:'visibility_provider_unavailable'});expect(network).toHaveBeenCalledTimes(failure==='offline'?3:2);
});
it('rejects tampered or cross-filter continuation tokens instead of trusting their position',async()=>{
 await fixture();const first=await page();expect(first.body.nextCursor).toEqual(expect.any(String));
 expect((await page('&offset=2&cursor='+encodeURIComponent(first.body.nextCursor+'x'))).response.status).toBe(400);
 expect((await page('&offset=2&tag=other&cursor='+encodeURIComponent(first.body.nextCursor))).response.status).toBe(400);
});
it('continues a cookie-derived first page when the client adds the redundant nsfw request flag',async()=>{
 await fixture();
 const cookie='__Host-hr-adult='+await sealAuth(testEnv(),'guest-adult',{show:true,verifiedAt:Date.now(),consentVersion:ADULT_CONSENT_VERSION});
 const first=await page('',{Cookie:cookie});
 expect(first.response.headers.get('X-Adult-Content')).toBe('1');
 expect(first.body.hasNext).toBe(true);
 const next=await page('&nsfw=1&offset=2&cursor='+encodeURIComponent(first.body.nextCursor),{Cookie:cookie});
 // Both requests resolve to the same effective adult permission; only transport differs.
 expect(next.response.status).toBe(200);
 expect(next.body.items).toHaveLength(2);
 expect(next.body.items.map((r:any)=>r.id)).not.toEqual(first.body.items.map((r:any)=>r.id));
 expect(next.body.hasNext).toBe(true);
 const third=await page('&nsfw=1&offset=4&cursor='+encodeURIComponent(next.body.nextCursor),{Cookie:cookie});
 expect(third.response.status).toBe(200);expect(third.body.hasNext).toBe(false);
 const ids=[...first.body.items,...next.body.items,...third.body.items].map((r:any)=>r.id);
 expect(ids).toHaveLength(5);expect(new Set(ids).size).toBe(5);
});

it('keeps effective adult permission and real filters bound even when nsfw syntax changes',async()=>{
 await fixture();
 const cookie='__Host-hr-adult='+await sealAuth(testEnv(),'guest-adult',{show:true,verifiedAt:Date.now(),consentVersion:ADULT_CONSENT_VERSION});
 const first=await page('',{Cookie:cookie});
 const continuation='&nsfw=1&offset=2&cursor='+encodeURIComponent(first.body.nextCursor);
 expect((await page(continuation)).response.status).toBe(400);
 for(const filter of ['&tag=other','&hide=horror','&rating=PG12']){
  expect((await page(continuation+filter,{Cookie:cookie})).response.status).toBe(400);
 }
});
it('continues a signed-in cookie page with bearer access and rejects a later permission downgrade',async()=>{
 await fixture();
 const member=await makeMember(22),raw='pagination-session';
 identities({'viewer-token':22});
 await env.DB.prepare('UPDATE members SET show_nsfw=1,age_verified_at=1,adult_consent_version=? WHERE id=?').bind(ADULT_CONSENT_VERSION,member).run();
 const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw)));
 const hash=btoa(String.fromCharCode(...digest)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
 await env.DB.prepare('INSERT INTO account_sessions VALUES(?,?,?,?,?,?,?)').bind(hash,member,'harbor','22','https://c.test',Date.now(),Date.now()+86400000).run();
 const cookie={Cookie:'__Host-hr-session='+raw};
 const first=await page('',cookie);
 expect(first.response.headers.get('X-Adult-Content')).toBe('1');
 const headers={...cookie,Authorization:'Bearer viewer-token'};
 const continuation='&nsfw=1&offset=2&cursor='+encodeURIComponent(first.body.nextCursor);
 const next=await page(continuation,headers);
 expect(next.response.status).toBe(200);
 expect(next.response.headers.get('X-Adult-Content')).toBe('1');
 const third=await page('&nsfw=1&offset=4&cursor='+encodeURIComponent(next.body.nextCursor),headers);
 expect(third.response.status).toBe(200);expect(third.body.hasNext).toBe(false);
 const ids=[...first.body.items,...next.body.items,...third.body.items].map((r:any)=>r.id);
 expect(ids).toHaveLength(5);expect(new Set(ids).size).toBe(5);
 expect((await page('&offset=2&cursor='+encodeURIComponent(first.body.nextCursor),headers)).response.status).toBe(400);
 await env.DB.prepare('UPDATE members SET show_nsfw=0 WHERE id=?').bind(member).run();
 expect((await page(continuation,headers)).response.status).toBe(400);
});
it('accepts an unexpired pre-deployment token that included nsfw in its binding',async()=>{
 await fixture();
 const url=new URL('https://c.test/v1/cards?sort=new&limit=2&nsfw=1');url.searchParams.sort();
 const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([url.pathname,url.search,false,'']))));
 const binding=btoa(String.fromCharCode(...digest)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
 const candidates=await publicCandidates(testEnv(),{sort:'new',limit:2,offset:0},0);
 const first=await publicCandidatePage(testEnv(),candidates,{raw:0,trail:[],binding},{limit:2,offset:0,lang:'zh',allowNsfw:false},{sort:'new',limit:2,offset:0});
 const next=await page('&nsfw=1&offset=2&cursor='+encodeURIComponent(first.nextCursor!));
 expect(next.response.status).toBe(200);
 expect(next.body.items).toHaveLength(2);
});

it('uses one random ordering across authority batches so a sparse recommendation remains discoverable',async()=>{
 const {ids,denied,batches}=await fixture(201);ids.slice(0,200).forEach(id=>denied.add(id));
 const source={sort:'random' as const,limit:2,offset:0,randomSeed:1};
 const candidates=await publicCandidates(testEnv(),source,0);
 expect(candidates.ids).toEqual((await env.DB.prepare('SELECT id FROM cards ORDER BY id LIMIT 200').all<{id:number}>()).results.map(r=>String(r.id)));
 const result=await publicCandidatePage(testEnv(),candidates,{raw:0,trail:[],binding:'random-fixture'}, {limit:2,offset:0,lang:'zh',allowNsfw:false},source);
 expect(result.items.map(r=>r.sourceRoleId)).toEqual([ids[200]]);expect(result.hasNext).toBe(false);expect(batches).toEqual([200,1]);
});

it.each(['day','week','month','search','author','feed'] as const)('preserves %s discovery scope while scanning beyond one authority batch',async surface=>{
 const {ids,denied,batches}=await fixture(201);ids.slice(0,200).forEach(id=>denied.add(id));
 await env.DB.prepare('UPDATE cards SET registered_at=registered_at+?').bind(Date.now()).run();
 let url='https://c.test/v1/cards?limit=2&sort='+surface;
 if(surface==='search')url='https://c.test/v1/cards?limit=2&sort=new&q=Card';
 if(surface==='author'){
  const member=await env.DB.prepare('SELECT handle FROM members WHERE id=?').bind('member-11').first<{handle:string}>();
  url='https://c.test/v1/cards?limit=2&sort=new&author='+member!.handle;
 }
 const headers:Record<string,string>={};
 if(surface==='feed'){
  identities({'reader-token':22});await makeMember(22);
  await env.DB.prepare('INSERT INTO member_follows(member_id,author_id,created_at) VALUES(?,?,?)').bind('member-22','member-11',Date.now()).run();
  headers.Authorization='Bearer reader-token';url='https://c.test/v1/me/feed?limit=2';
 }
 const ctx=createExecutionContext(),response=await worker.fetch(new Request(url,{headers}),testEnv(),ctx);await waitOnExecutionContext(ctx);
 expect(response.status).toBe(200);const body=await response.json() as any;expect(body.items.map((r:any)=>r.sourceRoleId)).toEqual([ids[200]]);expect(body.hasNext).toBe(false);expect(batches).toEqual([200,1]);
});

it('finishes an all-denied 401-candidate catalog without returning partial totals or looping',async()=>{
 const {ids,denied,batches}=await fixture(401);ids.forEach(id=>denied.add(id));
 const result=await page();expect(result.response.status).toBe(200);expect(result.body).toMatchObject({items:[],total:null,hasNext:false});expect(batches).toEqual([200,200,1]);
 const warm=await page();expect(warm.response.headers.get('X-Cache')).toBe('hit');expect(warm.body).toMatchObject({items:[],total:null,hasNext:false});expect(batches).toEqual([200,200,1,200,200,1]);
});
