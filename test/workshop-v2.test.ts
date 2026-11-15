import { SELF,env } from 'cloudflare:test';
import { afterEach,beforeEach,expect,it } from 'vitest';
import { approveFixtureResponse } from './hosted-fixture';
import { bearer,identities,makeMember,ratingBody,resetDb,restoreUpstream,rolesOnMainSite } from './helpers';
import { applyWorkshopEvents } from '../src/workshop';
import { restoreWorkshopUpstream } from '../src/workshop-gateway';
let cardId:number,workId:string;
beforeEach(async()=>{
 await resetDb();identities({owner:74001,creator:74002});await makeMember(74001);await makeMember(74002);
 rolesOnMainSite({roleId:'v2-synthetic-card',authorNumId:74001,name:'Synthetic workshop v2'});
 const r=await approveFixtureResponse(await SELF.fetch('https://c.test/v1/cards',{method:'POST',headers:{...bearer('owner'),'Content-Type':'application/json'},body:JSON.stringify({roleId:'v2-synthetic-card',operationId:crypto.randomUUID(),...ratingBody(false)})}));expect(r.status).toBe(201);cardId=Number((await r.json() as any).id);
 const row=await env.DB.prepare("SELECT id FROM works WHERE source_provider='harbor' AND source_role_id='v2-synthetic-card'").first<{id:string}>();workId=row!.id;
});
afterEach(()=>{restoreWorkshopUpstream();restoreUpstream()});
async function tab(){const r=await SELF.fetch(`https://c.test/v1/cards/${cardId}/workshop`,{headers:bearer('creator')});expect(r.status).toBe(200);return await r.json() as any}
it('missing or legacy automatic policy never creates a workshop page',async()=>{
 expect(await tab()).toMatchObject({tabVisible:false,allowNew:false,items:[]});
 await env.DB.prepare('INSERT INTO workshop_policies(provider,work_id,card_id,allow_new,revision,updated_at) VALUES(?,?,?,?,?,?)').bind('harbor',workId,cardId,1,1,Date.now()).run();
 expect(await tab()).toMatchObject({tabVisible:false,allowNew:false,items:[]});
});
it('only explicit v2 policy events can enable the page; legacy replays cannot reopen it',async()=>{
 const event=(key:string,revision:number,allowNew:boolean,policyVersion:number)=>({kind:'policy_changed',eventKey:key,workId,sourceRoleId:'v2-synthetic-card',payload:{revision,allowNew,policyVersion}});
 await applyWorkshopEvents(env,[event('old-before',100,true,1)]);expect((await tab()).allowNew).toBe(false);
 await applyWorkshopEvents(env,[event('v2-open',2,true,2)]);expect(await tab()).toMatchObject({tabVisible:true,allowNew:true});
 await applyWorkshopEvents(env,[event('v2-close',3,false,2),event('old-after',101,true,1)]);expect(await tab()).toMatchObject({tabVisible:false,allowNew:false,items:[]});
});

function publication(id=crypto.randomUUID(),version=1){return {workshopId:id,releaseId:crypto.randomUUID(),workId,sourceRoleId:'v2-synthetic-card',kind:'lorebook',status:'published',publicationRevision:version*2-1,version,draftRevision:2,publishedAt:Date.now(),contentHash:'synthetic-v1',authorPublicNo:74002,cardOwnerPublicNo:74001,ownerState:'visible',ownerGeneration:0,residentChars:14,policyVersion:2,sealed:{name:'Synthetic lore',summary:'SFW local lore',readme:'A local synthetic note.',coverUrl:'',rating:'G',worldbook:[{id:'lore',content:'synthetic lore',enabled:true,mode:'constant'}],rules:{rules:[]},opening:{mode:'greeting'},updateNote:''}}}
async function openPolicy(){await applyWorkshopEvents(env,[{kind:'policy_changed',eventKey:'open-fixture',workId,sourceRoleId:'v2-synthetic-card',payload:{allowNew:true,revision:2,policyVersion:2}}])}
it('publishes directly with the creator token and stores one public version without review',async()=>{
 await openPolicy();const receipt=publication();const calls:any[]=[];
 const gateway=await import('../src/workshop-gateway');(gateway.workshopUpstream as any).publish=async(_env:any,token:any,input:any)=>{calls.push({token,input});return receipt};
 (gateway.workshopUpstream as any).draftMetadata=async()=>({workshopId:receipt.workshopId,card:{cardId:workId,roleId:'v2-synthetic-card'}});
 const body={expectedRevision:2,operationId:crypto.randomUUID(),kind:'dlc'};
 for(let i=0;i<2;i++){const r=await SELF.fetch(`https://c.test/v1/me/workshops/${receipt.workshopId}/publish`,{method:'POST',headers:{...bearer('creator'),'Content-Type':'application/json'},body:JSON.stringify(body)});expect(r.status).toBe(200);expect(await r.json()).toMatchObject({status:'published',version:1,kind:'lorebook'})}
 expect(calls[0]).toMatchObject({token:'creator',input:{workshopId:receipt.workshopId,expectedRevision:2}});expect(calls[0].input.kind).toBeUndefined();
 const row=await env.DB.prepare('SELECT version_no,resident_chars,rule_count,opening_count FROM workshops WHERE id=?').bind(receipt.workshopId).first();expect(row).toMatchObject({version_no:1,resident_chars:14,rule_count:0,opening_count:0});
 expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM workshop_versions WHERE workshop_id=?').bind(receipt.workshopId).first<{n:number}>())?.n).toBe(1);
 expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM workshop_review_submissions').first<{n:number}>())?.n).toBe(0);
 expect((await tab()).items).toHaveLength(1);
});
it('recovers publication from the actual v2 event without a review row',async()=>{
 await openPolicy();const receipt=publication();
 const event={kind:'release_published',eventKey:'published-fixture',workId,workshopId:receipt.workshopId,payload:{policyVersion:2,publication:receipt}};
 await applyWorkshopEvents(env,[event,event]);
 expect((await tab()).items).toHaveLength(1);
 expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM workshop_versions').first<{n:number}>())?.n).toBe(1);
});

it('closed policy hides detail, batch, versions and comments even from an existing join',async()=>{
 await openPolicy();const receipt=publication();await applyWorkshopEvents(env,[{kind:'release_published',eventKey:'closed-read-publish',workId,workshopId:receipt.workshopId,payload:{policyVersion:2,publication:receipt}}]);
 const gateway=await import('../src/workshop-gateway');gateway.workshopUpstream.state=async()=>({items:[{workshopId:receipt.workshopId,viewerJoined:true,viewerAccessible:true,moderationState:'approved',ownerState:'visible'}]});
 await applyWorkshopEvents(env,[{kind:'policy_changed',eventKey:'closed-read-policy',workId,sourceRoleId:'v2-synthetic-card',payload:{policyVersion:2,revision:3,allowNew:false}}]);
 expect(await tab()).toMatchObject({tabVisible:false,total:0,items:[]});
 for(const path of [`/v1/workshops/${receipt.workshopId}`,`/v1/workshops/${receipt.workshopId}/versions`,`/v1/workshops/${receipt.workshopId}/comments`,`/v1/workshops/${receipt.workshopId}/comments/count`]){
  const r=await SELF.fetch('https://c.test'+path,{headers:bearer('creator')});expect(r.status,path).toBe(404);
 }
 const batch=await SELF.fetch(`https://c.test/v1/workshops?ids=${receipt.workshopId}`,{headers:bearer('creator')});expect(batch.status).toBe(200);expect((await batch.json() as any).items).toEqual([]);
 await applyWorkshopEvents(env,[{kind:'policy_changed',eventKey:'closed-read-reopen',workId,sourceRoleId:'v2-synthetic-card',payload:{policyVersion:2,revision:4,allowNew:true}}]);
 expect((await tab()).items).toHaveLength(1);
});

it('retired submission, withdrawal, appeal and reopening-interest routes are unreachable',async()=>{
 const id=crypto.randomUUID();
 for(const [method,path] of [['POST',`/v1/me/workshops/${id}/submit`],['POST',`/v1/me/workshops/${id}/withdraw`],['POST',`/v1/moderation/workshop-appeals/${id}/decision`],['GET','/v1/moderation/workshop-appeals'],['PUT',`/v1/cards/${cardId}/workshop/interest`],['DELETE',`/v1/cards/${cardId}/workshop/interest`]]){
  const r=await SELF.fetch('https://c.test'+path,{method,headers:{...bearer('creator'),'Content-Type':'application/json'},...(method==='GET'?{}:{body:'{}'})});expect(r.status,path).toBe(404);
 }
});

it('unpublish tombstone wins late publication retries and allows a later version',async()=>{
 await openPolicy();const receipt=publication();
 const unpublish={workshopId:receipt.workshopId,workId,sourceRoleId:receipt.sourceRoleId,status:'draft',kind:receipt.kind,version:1,draftRevision:3,publicationRevision:2,authorPublicNo:74002,cardOwnerPublicNo:74001,policyVersion:2};
 await applyWorkshopEvents(env,[{kind:'release_unpublished',eventKey:'unpublish-before-publish',workId,workshopId:receipt.workshopId,payload:{policyVersion:2,publication:unpublish}}]);
 await applyWorkshopEvents(env,[{kind:'release_published',eventKey:'late-publish',workId,workshopId:receipt.workshopId,payload:{policyVersion:2,publication:receipt}}]);
 expect((await tab()).items).toEqual([]);
 const next={...receipt,releaseId:crypto.randomUUID(),version:2,publicationRevision:3};
 await applyWorkshopEvents(env,[{kind:'release_published',eventKey:'republish-next',workId,workshopId:receipt.workshopId,payload:{policyVersion:2,publication:next}}]);
 expect((await tab()).items).toHaveLength(1);
 await applyWorkshopEvents(env,[{kind:'release_unpublished',eventKey:'old-unpublish-retry',workId,workshopId:receipt.workshopId,payload:{policyVersion:2,publication:unpublish}}]);
 expect((await tab()).items).toHaveLength(1);
});

it('saving author policy synchronizes D1 before returning success and survives an already-committed retry',async()=>{
 const gateway=await import('../src/workshop-gateway');let committed=false,calls=0;
 const policy={allowNew:true,everOpened:true,revision:2,workId,sourceRoleId:'v2-synthetic-card',items:[],counts:{dlcPublished:0,dlcDrafts:0,lorebookPublished:0,lorebookDrafts:0,joinCount:0}};
 (gateway.workshopUpstream as any).policySave=async(_env:any,token:any,input:any)=>{expect(token).toBe('owner');expect(input.roleId).toBeTruthy();calls++;if(committed)throw new (await import('../src/types')).HttpError(409,'workshop_policy_stale');committed=true;return policy};
 (gateway.workshopUpstream as any).policyGet=async()=>policy;
 const body={allowNew:true,expectedRevision:1};
 for(let i=0;i<2;i++){
  const r=await SELF.fetch(`https://c.test/v1/cards/${cardId}/workshop/policy`,{method:'POST',headers:{...bearer('owner'),'Content-Type':'application/json'},body:JSON.stringify(body)});expect(r.status).toBe(200);expect(await r.json()).toMatchObject(policy);expect((await tab()).allowNew).toBe(true);
 }
 expect(calls).toBe(2);
 const foreign=await SELF.fetch(`https://c.test/v1/cards/${cardId}/workshop/policy`,{method:'POST',headers:{...bearer('creator'),'Content-Type':'application/json'},body:JSON.stringify(body)});expect(foreign.status).toBe(403);expect(calls).toBe(2);
});

it('quarantines one invalid publication without blocking a later consent closure or acknowledgement',async()=>{
 await openPolicy();const invalid={...publication(),residentChars:999};
 const events=[{seq:10,kind:'release_published',eventKey:'poisoned-publication',workId,workshopId:invalid.workshopId,payload:{policyVersion:2,publication:invalid}},{seq:11,kind:'policy_changed',eventKey:'close-after-poison',workId,sourceRoleId:'v2-synthetic-card',payload:{policyVersion:2,revision:3,allowNew:false}}];
 const gateway=await import('../src/workshop-gateway');let ack=0;gateway.workshopUpstream.pullOutbox=async()=>({events});gateway.workshopUpstream.ackOutbox=async(_env,seq)=>{ack=seq;return {ok:true}};
 const {drainProviderWorkshopOutbox}=await import('../src/workshop');
 const result=await drainProviderWorkshopOutbox(env);
 expect(result).toMatchObject({drained:2,applied:1});expect(ack).toBe(11);expect((await tab()).allowNew).toBe(false);
 const quarantined=await env.DB.prepare('SELECT reason,event_kind FROM workshop_sync_rejections WHERE event_key=?').bind('poisoned-publication').first();expect(quarantined).toMatchObject({reason:'invalid_publication',event_kind:'release_published'});
 const metrics=await (await import('../src/ops-metrics')).opsMetrics(env.DB);expect(metrics).toContain('hearthroom_workshop_operations_total{operation="sync",outcome="rejected"} 1');
});

it('keeps DLC before player extensions on the first page',async()=>{
 await openPolicy();const {applyWorkshopPublication}=await import('../src/workshop-publication');
 for(let i=0;i<21;i++){const p=publication();await applyWorkshopPublication(env,'harbor',p as any);await env.DB.prepare('UPDATE workshops SET install_count=100 WHERE id=?').bind(p.workshopId).run()}
 const dlc={...publication(),kind:'dlc',authorPublicNo:74001};await applyWorkshopPublication(env,'harbor',dlc as any);
 const rows=(await tab()).items;expect(rows).toHaveLength(20);expect(rows[0]).toMatchObject({id:dlc.workshopId,kind:'dlc'});
});

it('rejects an unavailable base card before committing a creator publication',async()=>{
 await openPolicy();const receipt=publication();let writes=0;
 const gateway=await import('../src/workshop-gateway');
 (gateway.workshopUpstream as any).draftMetadata=async()=>({workshopId:receipt.workshopId,card:{cardId:workId,roleId:'v2-synthetic-card'}});
 gateway.workshopUpstream.publish=async()=>{writes++;return receipt as any};
 await env.DB.prepare("UPDATE cards SET status='unshared' WHERE id=?").bind(cardId).run();
 const r=await SELF.fetch(`https://c.test/v1/me/workshops/${receipt.workshopId}/publish`,{method:'POST',headers:{...bearer('creator'),'Content-Type':'application/json'},body:JSON.stringify({expectedRevision:2,operationId:crypto.randomUUID()})});
 expect(r.status).toBe(404);expect(writes).toBe(0);
});
