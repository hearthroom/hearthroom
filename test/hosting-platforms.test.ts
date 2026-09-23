import { env, SELF } from 'cloudflare:test';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { resetDb, role, makeMember } from './helpers';
import { submitHosted, hostGateway } from '../src/hosting';
import { upstream } from '../src/upstream';
import { claim, stamp } from '../src/review';

beforeEach(async()=>{await resetDb();vi.spyOn(upstream,'fetchRole').mockImplementation(async(_env,id)=>role({roleId:id}));});
afterEach(()=>vi.restoreAllMocks());
async function approved(provider: 'lunatalk'|'harbor') {
 const memberId=await makeMember(10001);
 vi.spyOn(hostGateway,'seal').mockImplementation(async(_env,_token,_role,workId,versionId)=>({workId,versionId,hostedRevisionId:'sealed-'+versionId}));
 vi.spyOn(hostGateway,'read').mockImplementation(async(_env,_token,id)=>role({roleId:id,authorNumId:10001}));
 vi.spyOn(upstream,'readForReview').mockResolvedValue({hashes:{card:'',welcome:'',worldbook:'',authorAsset:'',content:''}});
 const receipt=await submitHosted(env,{provider,memberId,account:10001,role:role({roleId:'draft',authorNumId:10001}),token:'author',nsfw:false,operationId:crypto.randomUUID(),now:Date.now()});
 const sub=await env.DB.prepare('SELECT id FROM review_submissions').first<{id:string}>();
 for(const reviewer of ['one','two']){await claim(env.DB,sub!.id,reviewer,Date.now());await stamp(env.DB,{submissionId:sub!.id,memberId:reviewer,verdict:'approve',note:'',now:Date.now()});}
 return receipt;
}
it('lists all ready copies of the approved version without testing mutable draft visibility',async()=>{
 const receipt=await approved('harbor');
 await env.DB.prepare("INSERT INTO hosting_replicas(version_id,provider,source_role_id,hosted_revision_id,state,created_at) VALUES (?,'lunatalk','private-copy','frozen-copy','ready',1)").bind(receipt.versionId).run();
 const read=vi.mocked(upstream.fetchRole);
 const res=await SELF.fetch('https://c.test/v1/cards/draft/platforms');
 expect(await res.json()).toEqual({platforms:[{provider:'harbor',roleId:receipt.hostedRevisionId,playable:true}]});
 expect(read.mock.calls.map(c=>c[1])).toEqual([receipt.hostedRevisionId]);
});
it('does not list failed copies and removes every choice on community withdrawal',async()=>{
 const receipt=await approved('harbor');
 await env.DB.prepare("INSERT INTO hosting_replicas(version_id,provider,source_role_id,hosted_revision_id,state,created_at) VALUES (?,'lunatalk','partial-copy','incomplete','failed',1)").bind(receipt.versionId).run();
 let res=await SELF.fetch('https://c.test/v1/cards/draft/platforms');
 expect((await res.json() as {platforms:unknown[]}).platforms).toHaveLength(1);
 await env.DB.prepare("UPDATE cards SET status='withdrawn' WHERE source_role_id='draft'").run();
 res=await SELF.fetch('https://c.test/v1/cards/draft/platforms');
 expect(res.status).toBe(404);
});
it('resolves a replica to its community work without widening author lookup',async()=>{
 const {getPublicCard,getCard}=await import('../src/cards');
 const {workFor}=await import('../src/card-sync');
 const receipt=await approved('harbor');
 await env.DB.prepare("INSERT INTO hosting_replicas VALUES (?,'lunatalk','copy-draft','frozen-copy','ready',1)").bind(receipt.versionId).run();
 expect((await getPublicCard(env.DB,'frozen-copy','lunatalk'))?.source_role_id).toBe('draft');
 expect(await getCard(env.DB,'frozen-copy','lunatalk')).toBeNull();
 expect((await workFor(env.DB,'lunatalk','frozen-copy'))?.id).toBe(receipt.workId);
});
it('refuses to resume through a retired replica',async()=>{
 const response=await SELF.fetch('https://c.test/v1/me/conversations',{method:'PUT',headers:{Authorization:'Bearer author','X-Provider':'lunatalk','Content-Type':'application/json'},body:JSON.stringify({roleId:'old',conversationId:'chat'})});
 expect(response.status).toBe(400);
});

it('omits an immutable replica after its provider removes access',async()=>{
 const receipt=await approved('harbor');
 await env.DB.prepare("INSERT INTO hosting_replicas VALUES (?,'lunatalk','copy-draft','gone','ready',1)").bind(receipt.versionId).run();
 vi.mocked(upstream.fetchRole).mockImplementation(async(_env,id)=>{if(id==='gone')throw new Error('unavailable');return role({roleId:id})});
 const response=await SELF.fetch('https://c.test/v1/cards/draft/platforms');
 expect(await response.json()).toEqual({platforms:[{provider:'harbor',roleId:receipt.hostedRevisionId,playable:true}]});
});
