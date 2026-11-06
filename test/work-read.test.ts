import { scoreGateway } from '../src/score-eligibility';
import {createExecutionContext,env,waitOnExecutionContext} from 'cloudflare:test';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import worker,{iconCache} from '../src/index';
import {getCard,upsertCard} from '../src/cards';
import {identitiesFor,makeMember,resetDb,restoreUpstream,role} from './helpers';
import {upstream} from '../src/upstream';
import {ADULT_CONSENT_VERSION} from '../shared/adult-consent';
import {signShortcutKey} from '../src/shortcut';
import {opsMetrics} from '../src/ops-metrics';
import {workPolicyGateway} from '../src/work-policy';
import {hostGateway} from '../src/hosting';
import {HttpError} from '../src/types';

beforeEach(async () => { await resetDb(); vi.spyOn(scoreGateway, 'read').mockResolvedValue({ eligible: true, turns: 6, credits: '0', requiredTurns: 6, paidTurns: 3, requiredCredits: '500' }); });
afterEach(()=>{vi.restoreAllMocks();restoreUpstream();});

it('does not treat a local author number or profile token as permission to read a managed private card',async()=>{
 const {source}=await managedFixture();providerFixture('private');identitiesFor({harbor:{author:11}});
 vi.spyOn(workPolicyGateway,'owner').mockRejectedValue(new HttpError(403,'insufficient_scope'));
 const response=await request('/v1/cards/'+source,'author');expect(response.status).toBe(404);expect(await response.text()).not.toContain('Stale managed work');
});
it('uses the actual owner read scope and latest saved source for managed private author preview',async()=>{
 const {source}=await managedFixture();providerFixture('private');identitiesFor({harbor:{author:11}});
 vi.spyOn(workPolicyGateway,'owner').mockResolvedValue({managed:true} as any);
 const read=vi.spyOn(hostGateway,'read').mockResolvedValue(role({roleId:source,authorNumId:11,name:'Latest owned draft'}));
 const response=await request('/v1/cards/'+source,'author');expect(response.status).toBe(200);expect(await response.json()).toMatchObject({name:'Latest owned draft',canInteract:false,listed:false});expect(read).toHaveBeenCalledTimes(1);
});

async function managedFixture(){
 const source=crypto.randomUUID(),target=crypto.randomUUID(),work=crypto.randomUUID();
 const member=await makeMember(11);
 await upsertCard(env.DB,role({roleId:source,authorNumId:11,name:'Stale managed work'}),Date.now(),{status:'approved'});
 await env.DB.prepare('UPDATE cards SET approved_hosted_role_id=? WHERE source_role_id=?').bind(target,source).run();
 await env.DB.prepare('INSERT INTO works VALUES(?,?,?,?,?)').bind(work,member,'harbor',source,Date.now()).run();
 await env.DB.prepare("INSERT INTO managed_work_access(work_id,provider,source_role_id,access,epoch,restriction,approved_role_id) VALUES(?,'harbor',?,'public',1,'none',?)").bind(work,source,target).run();
 return {source,target,work};
}
function providerFixture(access:'public'|'unlisted'|'private'='private'){
 const current={access,mode:'ok' as 'ok'|'offline'|'missing'|'wrongWork'};
 const network=vi.spyOn(globalThis,'fetch').mockImplementation(async(input,init)=>{
  if(!String(input).endsWith('/hosting/work-access/batch'))throw new Error('Unexpected network in managed board fixture');
  if(current.mode==='offline')throw new Error('Fixture Provider unavailable');
  const body=JSON.parse(String(init?.body)) as {items:{sourceRoleId:string;workId:string;targetRoleId:string}[]};
  return Response.json({items:current.mode==='missing'?[]:body.items.map(item=>({...item,...(current.mode==='wrongWork'?{workId:crypto.randomUUID()}:{}),managed:true,access:current.access,epoch:2,restriction:'none',approvedRoleId:item.targetRoleId===item.sourceRoleId?'':item.targetRoleId,shareRoleId:current.access==='public'?item.targetRoleId:current.access==='unlisted'?item.sourceRoleId:'',targetReadable:current.access!=='private',listed:current.access==='public'}))});
 });
 return {current,network};
}
async function board(){
 const context=createExecutionContext();
 const response=await worker.fetch(new Request('https://c.test/v1/cards'),{...env,HOSTING_SERVICE_KEY:'fixture-issuer'},context);
 const body=await response.json() as {items:unknown[]};
 await waitOnExecutionContext(context);
 return {response,body};
}
async function request(path:string,token?:string,init:RequestInit={}){
 const context=createExecutionContext();
 const response=await worker.fetch(new Request(path.startsWith('http')?path:'https://c.test'+path,{...init,headers:{...init.headers,...(token?{Authorization:'Bearer '+token}:{})}}),{...env,HOSTING_SERVICE_KEY:'fixture-issuer'},context);
 await waitOnExecutionContext(context);return response;
}
it('revalidates a managed public candidate before returning a stale positive board result',async()=>{
 const {source}=await managedFixture();const {network}=providerFixture();
 const {response,body}=await board();
 expect(response.status).toBe(200);expect(body.items).toEqual([]);expect(network).toHaveBeenCalledTimes(1);
 expect((await getCard(env.DB,source))?.status).toBe('approved');
});

async function adultReader(){
 identitiesFor({harbor:{reader:42,author:11}});const reader=await makeMember(42);
 await env.DB.prepare('UPDATE members SET show_nsfw=1,age_verified_at=1,adult_consent_version=? WHERE id=?').bind(ADULT_CONSENT_VERSION,reader).run();
 return reader;
}
const jsonBody=(method:string,body:unknown):RequestInit=>({method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});

it.each(['comments','comments/count','score'])('denies stale private managed %s reads',async path=>{
 const {source}=await managedFixture();providerFixture('private');const row=(await getCard(env.DB,source))!;
 expect((await request(`/v1/cards/${row.id}/${path}`)).status).toBe(404);
});

it('allows unreviewed unlisted comments and scores while keeping adult and author self-rating rules',async()=>{
 const {source,work}=await managedFixture();providerFixture('unlisted');
 await env.DB.prepare("UPDATE managed_work_access SET access='unlisted',approved_role_id=NULL WHERE work_id=?").bind(work).run();
 await env.DB.prepare("UPDATE cards SET status='unshared',approved_hosted_role_id=NULL WHERE source_role_id=?").bind(source).run();
 const row=(await getCard(env.DB,source))!;await adultReader();
 expect((await request(`/v1/cards/${row.id}/comments`)).status).toBe(403);
 expect((await request(`/v1/cards/${row.id}/comments`,'reader')).status).toBe(200);
 const comment=await request(`/v1/cards/${row.id}/comments`,'reader',jsonBody('POST',{content:'Unlisted comment'}));
 expect(comment.status).toBe(201);
 expect((await request(`/v1/cards/${row.id}/score`,'reader',jsonBody('PUT',{score:4}))).status).toBe(204);
 expect(await(await request(`/v1/cards/${row.id}/score`,'reader')).json()).toMatchObject({count:1,mine:4});
 const author=await makeMember(11);
 await env.DB.prepare('UPDATE members SET show_nsfw=1,age_verified_at=1,adult_consent_version=? WHERE id=?').bind(ADULT_CONSENT_VERSION,author).run();
 const own=await request(`/v1/cards/${row.id}/score`,'author',jsonBody('PUT',{score:5}));
 expect(own.status).toBe(403);expect(await own.json()).toMatchObject({error:'own_card'});
 expect((await env.DB.prepare('SELECT count(*) AS n FROM reward_event_outbox').first<{n:number}>())?.n).toBe(0);
});

it.each(['like','report'])('does not allow comment ID %s to bypass the current private work policy',async action=>{
 const {source}=await managedFixture();providerFixture('private');const row=(await getCard(env.DB,source))!;const reader=await adultReader();
 const comment=crypto.randomUUID(),author=await makeMember(11);
 await env.DB.prepare('INSERT INTO comments(id,card_id,member_id,content,created_at) VALUES(?,?,?,?,?)').bind(comment,row.id,author,'Existing private discussion',Date.now()).run();
 const response=await request(`/v1/comments/${comment}/${action}`,'reader',action==='like'?{method:'PUT'}:jsonBody('POST',{reason:'spam'}));
 expect(response.status).toBe(404);
 expect((await env.DB.prepare('SELECT like_count FROM comments WHERE id=?').bind(comment).first<{like_count:number}>())?.like_count).toBe(0);
 expect((await env.DB.prepare('SELECT count(*) AS n FROM comment_reports').first<{n:number}>())?.n).toBe(0);
});

it.each(['/v1/tags','/v1/tags/counts','/v1/authors','/v1/fandoms','/v1/suggest?q=Stale'])('does not return a stale public aggregate at %s',async path=>{
 await managedFixture();providerFixture('private');
 const response=await request(path);
 expect(response.status).toBe(503);expect(await response.text()).not.toContain('Stale managed work');
});

it.each(['/v1/tags','/v1/tags/counts','/v1/authors'])('revalidates a cached aggregate at %s',async path=>{
 await managedFixture();const {current,network}=providerFixture('public');
 expect((await request(path)).status).toBe(200);current.access='private';
 const response=await request(path);expect(response.status).toBe(503);expect(network).toHaveBeenCalledTimes(2);
});

// Real D1 contributors span multiple policy batches; the Provider mock remains
// bounded and returns the current authority for every requested identity.
async function aggregateFixture(size:number){
 const member=await makeMember(11);
 for(let start=0;start<size;start+=50){
  const cards=Array.from({length:Math.min(50,size-start)},(_,i)=>{
   const n=start+i+1;
   return env.DB.prepare(`INSERT INTO cards(id,provider,source_role_id,author_num_id,names,tags,zone,status,registered_at,last_synced_at)
    VALUES(?,'harbor',?,11,'{"zh":"Aggregate fixture"}','["劇情"]','zh','approved',1,1)`).bind(100000+n,`aggregate-source-${n}`);
  });
  await env.DB.batch(cards);
 }
 await env.DB.prepare(`INSERT INTO works(id,member_id,source_provider,source_role_id,created_at)
  SELECT 'aggregate-work-'||id,?,'harbor',source_role_id,1 FROM cards`).bind(member).run();
 await env.DB.prepare(`INSERT INTO managed_work_access(work_id,provider,source_role_id,access,epoch,restriction,approved_role_id)
  SELECT 'aggregate-work-'||id,'harbor',source_role_id,'public',1,'none',source_role_id FROM cards`).run();
}

it('counts all contributors beyond two full visibility batches and revalidates a warm cache',async()=>{
 await aggregateFixture(401);const {network}=providerFixture('public');
 for(let repeat=0;repeat<2;repeat++){
  const response=await request('/v1/tags/counts?zone=zh');
  expect(response.status).toBe(200);
  expect(response.headers.get('X-Cache')).toBe(repeat?'hit':'miss');
  expect(await response.json()).toMatchObject({counts:{story:401},ratings:{none:401}});
 }
 const batches=network.mock.calls.map(([,init])=>JSON.parse(String(init?.body)).items);
 expect(batches.map(batch=>batch.length)).toEqual([200,200,1,200,200,1]);
 for(const start of [0,3])expect(new Set(batches.slice(start,start+3).flat().map(item=>item.sourceRoleId)).size).toBe(401);
 expect(await opsMetrics(env.DB)).toContain('hearthroom_visibility_reads_total{surface="aggregate",outcome="allow"} 6');
});

it.each(['/v1/tags','/v1/authors','/v1/fandoms','/v1/suggest?q=Aggregate'])('proves every batch for shared aggregate %s',async path=>{
 await aggregateFixture(201);const {network}=providerFixture('public');
 expect((await request(path)).status).toBe(200);expect(network).toHaveBeenCalledTimes(2);
});

it.each(['private','offline','missing','wrongWork'] as const)('rejects an aggregate when its second policy batch is %s',async failure=>{
 await aggregateFixture(201);const {current,network}=providerFixture('public');
 // Change authority only after the first batch has been read, so this catches
 // implementations that return a partial count or stop after their first page.
 const read=network.getMockImplementation()!;
 network.mockImplementation(async(input,init)=>{
  if(network.mock.calls.length===2){if(failure==='private')current.access='private';else current.mode=failure;}
  return read(input,init);
 });
 const response=await request('/v1/tags/counts?zone=zh');
 expect(response.status).toBe(503);expect(await response.json()).toEqual({error:failure==='private'?'visibility_sync_pending':'visibility_provider_unavailable'});
 expect(network).toHaveBeenCalledTimes(2);
 const metrics=await opsMetrics(env.DB);
 expect(metrics).toContain('hearthroom_visibility_reads_total{surface="aggregate",outcome="allow"} 1');
 expect(metrics).toContain(`hearthroom_visibility_reads_total{surface="aggregate",outcome="${failure==='private'?'denied':'unavailable'}"} 1`);
});

it('keeps zone and all-zone contributors isolated across an exact full batch',async()=>{
 await aggregateFixture(201);const {network}=providerFixture('public');
 await env.DB.prepare("UPDATE cards SET zone=CASE id WHEN 100001 THEN 'all' WHEN 100002 THEN 'en' ELSE 'zh' END").run();
 const zh=await request('/v1/tags/counts?zone=zh');expect(zh.status).toBe(200);expect(await zh.json()).toMatchObject({ratings:{none:200}});
 const en=await request('/v1/tags/counts?zone=en');expect(en.status).toBe(200);expect(await en.json()).toMatchObject({ratings:{none:2}});
 const all=await request('/v1/tags/counts?zone=all');expect(all.status).toBe(200);expect(await all.json()).toMatchObject({ratings:{none:201}});
 expect(network.mock.calls.map(([,init])=>JSON.parse(String(init?.body)).items.length)).toEqual([200,2,200,1]);
});

it('excludes locally private works from author and tag aggregates without granting from a cached approval',async()=>{
 const {work}=await managedFixture();const {network}=providerFixture('public');
 await env.DB.prepare("UPDATE managed_work_access SET access='private' WHERE work_id=?").bind(work).run();
 const authors=await request('/v1/authors');expect(authors.status).toBe(200);expect(await authors.json()).toMatchObject({items:[]});
 const tags=await request('/v1/tags');expect(tags.status).toBe(200);expect(await tags.json()).toMatchObject({items:[]});
 expect(network).not.toHaveBeenCalled();
});

it('records fixed-label policy read outcomes without role or work identifiers',async()=>{
 const {source,work}=await managedFixture();const {current}=providerFixture('private');
 await request(`/v1/cards/${source}`);current.access='public';await request(`/v1/cards/${source}`);
 current.mode='offline';await request(`/v1/cards/${source}`);
 const metrics=await opsMetrics(env.DB);
 for(const outcome of ['allow','denied','unavailable'])expect(metrics).toContain(`hearthroom_visibility_reads_total{surface="detail",outcome="${outcome}"} 1`);
 expect(metrics).not.toContain(source);expect(metrics).not.toContain(work);
});

it('revalidates current permission again on a warm board cache hit',async()=>{
 await managedFixture();const {current,network}=providerFixture('public');
 const first=await board();expect(first.response.status).toBe(200);expect(first.body.items).toHaveLength(1);
 current.access='private';
 const second=await board();expect(second.response.status).toBe(200);expect(second.body.items).toEqual([]);
 expect(second.response.headers.get('X-Cache')).toBe('hit');expect(network).toHaveBeenCalledTimes(2);
});

it.each(['offline','missing','wrongWork'] as const)('fails closed for a %s Provider batch without returning private metadata',async mode=>{
 await managedFixture();const {current}=providerFixture('public');current.mode=mode;
 const {response,body}=await board();
 expect(response.status).toBe(503);expect(body).not.toHaveProperty('items');
 expect(JSON.stringify(body)).not.toContain('Stale managed work');
});

it('honors the local durable fence even if Provider still allows the work',async()=>{
 const {work}=await managedFixture();const {network}=providerFixture('public');
 await env.DB.prepare("UPDATE managed_work_access SET sync_state='changing',sync_operation_id=? WHERE work_id=?").bind(crypto.randomUUID(),work).run();
 const {response,body}=await board();
 expect(response.status).toBe(200);expect(body.items).toEqual([]);expect(network).not.toHaveBeenCalled();
});

it('invalidates an empty board candidate cache when a managed work becomes public',async()=>{
 const {work}=await managedFixture();const {network}=providerFixture('public');
 await env.DB.prepare("UPDATE managed_work_access SET access='private' WHERE work_id=?").bind(work).run();
 expect((await board()).body.items).toEqual([]);
 await env.DB.prepare("UPDATE managed_work_access SET access='public',epoch=2 WHERE work_id=?").bind(work).run();
 expect((await board()).body.items).toHaveLength(1);
 expect(network).toHaveBeenCalledTimes(1);
});

it('does not return stale approved metadata from a private managed card detail',async()=>{
 const {source}=await managedFixture();providerFixture('private');
 const response=await request('/v1/cards/'+source);
 expect(response.status).toBe(404);
 expect(await response.text()).not.toContain('Stale managed work');
});

it('returns unavailable instead of approved metadata when detail policy cannot be confirmed',async()=>{
 const {source}=await managedFixture();const {current}=providerFixture('public');current.mode='offline';
 const response=await request('/v1/cards/'+source);
 expect(response.status).toBe(503);expect(await response.text()).not.toContain('Stale managed work');
});

it.each(['G','R'])('shares the latest unlisted source without exposing the stored %s rating',async rating=>{
 const {source,work}=await managedFixture();providerFixture('unlisted');
 await env.DB.prepare("UPDATE cards SET rating=?,rating_descriptors='[\"sex\"]' WHERE source_role_id=?").bind(rating,source).run();
 const before=await getCard(env.DB,source);
 await env.DB.prepare("UPDATE managed_work_access SET access='unlisted' WHERE work_id=?").bind(work).run();
 const read=vi.spyOn(upstream,'fetchRole').mockResolvedValue(role({roleId:source,authorNumId:11,name:'Latest saved title'}));
 const denied=await request('/v1/cards/'+source);
 expect(denied.status).toBe(403);expect(await denied.text()).not.toContain('Latest saved title');expect(read).not.toHaveBeenCalled();
 identitiesFor({harbor:{reader:42}});const reader=await makeMember(42);
 await env.DB.prepare('UPDATE members SET show_nsfw=1,age_verified_at=1,adult_consent_version=? WHERE id=?').bind(ADULT_CONSENT_VERSION,reader).run();
 const response=await request('/v1/cards/'+source,'reader');
 expect(response.status).toBe(200);
 expect(await response.json()).toMatchObject({roleId:source,sourceRoleId:source,name:'Latest saved title',rating:null,ratingDescriptors:[],status:'unlisted',canInteract:true,listed:false});
 expect(response.headers.get('X-Robots-Tag')).toContain('noindex');
 expect(response.headers.get('Cache-Control')).toContain('no-store');
 expect(await getCard(env.DB,source)).toEqual(before);
});

it.each(['manifest.webmanifest','icon-192.png','touch-icon.png','platforms'])('checks current permission before returning %s metadata',async file=>{
 const {source}=await managedFixture();providerFixture('private');
 const response=await request(`/v1/cards/${source}/${file}`);
 expect(response.status).toBe(404);expect(await response.text()).not.toContain('Stale managed work');
});

it.each(['','en/','ja/'])('removes private card metadata from the %sHTML shell',async prefix=>{
 const {source}=await managedFixture();providerFixture('private');
 const response=await request(`/${prefix}cards/${source}`);
 expect(response.status).toBe(404);expect(await response.text()).not.toContain('Stale managed work');
 expect(response.headers.get('X-Robots-Tag')).toContain('noindex');
 expect(response.headers.get('Cache-Control')).toContain('no-store');
});

it('returns an unlisted noindex HTML shell without fetching or injecting saved source content',async()=>{
 const {source,work}=await managedFixture();providerFixture('unlisted');
 await env.DB.prepare("UPDATE managed_work_access SET access='unlisted' WHERE work_id=?").bind(work).run();
 const read=vi.spyOn(upstream,'fetchRole');
 const response=await request(`/cards/${source}`);
 expect(response.status).toBe(200);expect(response.headers.get('X-Robots-Tag')).toContain('noindex');
 const body=await response.text();expect(body).not.toContain('Stale managed work');expect(body).toContain('name="robots" content="noindex');
 expect(read).not.toHaveBeenCalled();
});

it('checks private permission before serving a previously cached home-screen icon',async()=>{
 const {source}=await managedFixture();const row=(await getCard(env.DB,source))!;providerFixture('private');
 iconCache.namespace='work-read-icon-'+crypto.randomUUID();
 const cache=await caches.open(iconCache.namespace);
 await cache.put(new Request(`https://icon.invalid/${row.id}/192/any?src=${encodeURIComponent(row.background_url!)}`),new Response('Previously cached cover',{headers:{'Content-Type':'image/png'}}));
 const response=await request(`/v1/cards/${source}/icon-192.png`);
 expect(response.status).toBe(404);expect(await response.text()).not.toContain('Previously cached cover');
});

it('requires an adult shortcut credential for unlisted latest-source metadata and rechecks it after private',async()=>{
 const {source,work}=await managedFixture();const {current}=providerFixture('unlisted');
 await env.DB.prepare("UPDATE managed_work_access SET access='unlisted' WHERE work_id=?").bind(work).run();
 const row=(await getCard(env.DB,source))!;
 const read=vi.spyOn(upstream,'fetchRole').mockResolvedValue(role({roleId:source,authorNumId:11,name:'Latest shortcut name'}));
 expect((await request(`/v1/cards/${source}/manifest.webmanifest`)).status).toBe(404);expect(read).not.toHaveBeenCalled();
 const key=await signShortcutKey('test-shortcut-secret',row.id);
 const response=await request(`/v1/cards/${source}/manifest.webmanifest?k=${encodeURIComponent(key)}`);
 expect(response.status).toBe(200);expect(await response.json()).toMatchObject({name:'Latest shortcut name'});
 expect(response.headers.get('Cache-Control')).toContain('no-store');expect(response.headers.get('X-Robots-Tag')).toContain('noindex');
 current.access='private';
 expect((await request(`/v1/cards/${source}/manifest.webmanifest?k=${encodeURIComponent(key)}`)).status).toBe(404);
});

it.each(['offline','missing','wrongWork'] as const)('does not emit positive HTML metadata on %s authority',async mode=>{
 const {source}=await managedFixture();const {current}=providerFixture('public');current.mode=mode;
 const response=await request(`/cards/${source}`);
 expect(response.status).toBe(503);expect(await response.text()).not.toContain('Stale managed work');
 expect(response.headers.get('Cache-Control')).toContain('no-store');expect(response.headers.get('X-Robots-Tag')).toContain('noindex');
});

it.each(['https://play.sukisuki.ai/','https://sukisuki.ai/play/','https://sukisuki.ai/en/play/'])('adds noindex on the unlisted play shell %s',async base=>{
 const {source,work}=await managedFixture();providerFixture('unlisted');
 await env.DB.prepare("UPDATE managed_work_access SET access='unlisted' WHERE work_id=?").bind(work).run();
 const row=(await getCard(env.DB,source))!;
 const response=await request(`${base}${row.id}/`);
 expect(response.status).toBe(200);expect(response.headers.get('X-Robots-Tag')).toContain('noindex');
 expect(await response.text()).toContain('name="robots" content="noindex');expect(response.headers.get('Cache-Control')).toContain('no-store');
});


it('issues the same protected shortcut credential for an unrated unlisted card',async()=>{
 const {source,work}=await managedFixture();providerFixture('unlisted');
 await env.DB.prepare("UPDATE managed_work_access SET access='unlisted' WHERE work_id=?").bind(work).run();
 vi.spyOn(upstream,'fetchRole').mockResolvedValue(role({roleId:source,authorNumId:11}));
 await adultReader();
 const response=await request('/v1/cards/'+source,'reader');
 const body=await response.json() as {rating:string|null;shortcutKey?:string};
 expect(response.status).toBe(200);expect(body.rating).toBeNull();expect(body.shortcutKey).toBeTruthy();
 expect((await request(`/v1/cards/${source}/manifest.webmanifest`)).status).toBe(404);
 expect((await request(`/v1/cards/${source}/manifest.webmanifest?k=${encodeURIComponent(body.shortcutKey!)}`)).status).toBe(200);
});

it('keeps unlisted social reads gated and out of public discovery independently of the old approved rating',async()=>{
 const {source,work}=await managedFixture();providerFixture('unlisted');
 await env.DB.prepare("UPDATE managed_work_access SET access='unlisted' WHERE work_id=?").bind(work).run();
 await env.DB.prepare("UPDATE cards SET rating='G' WHERE source_role_id=?").bind(source).run();
 const row=(await getCard(env.DB,source))!;
 for(const suffix of ['', '/comments', '/comments/count', '/score', '/leaderboard', '/honors']){
  const denied=await request('/v1/cards/'+row.id+suffix);
  expect(denied.status,suffix).toBe(403);
 }
 const denied=await request('/v1/cards/'+source);
 expect(await denied.json()).toMatchObject({error:'adult_content',reason:'unrated'});
 const control=await upsertCard(env.DB,role({roleId:crypto.randomUUID(),authorNumId:11,name:'Stale public control'}),Date.now(),{status:'approved'});
 for(let warm=0;warm<2;warm++)for(const path of ['/v1/cards','/v1/cards?q=Stale','/v1/cards?sort=hot','/v1/cards?sort=random','/v1/cards?sort=day']){
  expect(await(await request(path)).json()).toMatchObject({items:[{id:control.id}]});
 }
 const sitemap=await(await request('/sitemap.xml')).text();
 // Card URLs are not part of the current sitemap at all (src/sitemap.ts).
 expect(sitemap).toContain('/updates</loc>');expect(sitemap).not.toContain('/cards/');
 const reader=await adultReader();
 await env.DB.prepare("UPDATE members SET country_region='CN' WHERE id=?").bind(reader).run();
 const cn=await request('/v1/cards/'+source,'reader');
 expect(cn.status).toBe(403);expect(await cn.json()).toMatchObject({error:'region_unavailable'});
});


it('does not reuse an allowed unlisted response for an unverified or CN reader',async()=>{
 const {source,work}=await managedFixture();providerFixture('unlisted');
 await env.DB.prepare("UPDATE managed_work_access SET access='unlisted' WHERE work_id=?").bind(work).run();
 vi.spyOn(upstream,'fetchRole').mockResolvedValue(role({roleId:source,authorNumId:11,name:'Unreviewed source'}));
 const reader=await adultReader();
 const path='/v1/cards/'+source;
 expect(await(await request(path,'reader')).json()).toMatchObject({rating:null,status:'unlisted'});
 for(const assignment of ['age_verified_at=NULL','adult_consent_version=NULL','show_nsfw=0',"country_region='CN'"]){
  await env.DB.prepare('UPDATE members SET age_verified_at=1,adult_consent_version=?,show_nsfw=1,country_region=\'TW\' WHERE id=?').bind(ADULT_CONSENT_VERSION,reader).run();
  await env.DB.prepare(`UPDATE members SET ${assignment} WHERE id=?`).bind(reader).run();
  const denied=await request(path,'reader');expect(denied.status,assignment).toBe(403);
  expect(await denied.text()).not.toContain('Unreviewed source');
 }
 await env.DB.prepare('UPDATE members SET age_verified_at=1,adult_consent_version=?,show_nsfw=1,country_region=\'TW\' WHERE id=?').bind(ADULT_CONSENT_VERSION,reader).run();
 expect(await(await request(path,'reader')).json()).toMatchObject({rating:null,status:'unlisted'});
});

it.each(['G','P','PG12','PG15','R'])('preserves the approved public %s classification',async rating=>{
 const {source}=await managedFixture();providerFixture('public');await adultReader();
 await env.DB.prepare('UPDATE cards SET rating=? WHERE source_role_id=?').bind(rating,source).run();
 const response=await request('/v1/cards/'+source,'reader');
 expect(response.status).toBe(200);expect(await response.json()).toMatchObject({rating});
});
