import {env,SELF} from 'cloudflare:test';
import {beforeEach,expect,it,vi,afterEach} from 'vitest';
import {resetDb,makeMember,role} from './helpers';
import {upsertCard} from '../src/cards';
import * as auth from '../src/account-auth';
import * as distribution from '../src/hosting-distribution';
import * as drafts from '../src/card-sync';
import {upstream} from '../src/upstream';

beforeEach(resetDb);
afterEach(()=>vi.restoreAllMocks());
it('has no public migration entry point',async()=>{
 const response=await SELF.fetch('https://c.test/internal/retirement/migrate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({cardNumber:100001})});
 expect(response.status).toBe(403);
 expect(await env.DB.prepare('SELECT count(*) AS n FROM hosting_transfers').first()).toEqual({n:0});
});
it('rejects an unrelated issuer key before looking up a card',async()=>{
 const response=await SELF.fetch('https://c.test/internal/retirement/migrate',{method:'POST',headers:{'Content-Type':'application/json','X-Retirement-Key':'incorrect'},body:JSON.stringify({cardNumber:100001})});
 expect(response.status).toBe(403);
});
const request=(cardNumber:number)=>SELF.fetch('https://c.test/internal/retirement/migrate',{method:'POST',headers:{'Content-Type':'application/json','X-Retirement-Key':'fixture-harbor'},body:JSON.stringify({cardNumber})});
async function fixture(){
 const member=await makeMember(10001);
 const card=await upsertCard(env.DB,role({roleId:'draft',authorNumId:10001}),1,{provider:'lunatalk'});
 await env.DB.batch([
  env.DB.prepare("INSERT INTO works VALUES('work',?,'lunatalk','draft',1)").bind(member),
  env.DB.prepare("INSERT INTO hosting_versions(version_id,work_id,member_id,operation_id,source_role_id,provider,nsfw,hosted_revision_id,card_id,state,created_at) VALUES('version','work',?,'op','draft','lunatalk',0,'sealed',?,'approved',1)").bind(member,card.id),
  env.DB.prepare("UPDATE cards SET approved_version_id='version',approved_hosted_role_id='sealed' WHERE id=?").bind(card.id),
  env.DB.prepare("INSERT INTO member_connections VALUES('harbor','22',?,1)").bind(member),
 ]);
 return {member,card:Number(card.id)};
}
it('uses only the approved version and effective linked author accounts',async()=>{
 const f=await fixture();
 const grant=vi.spyOn(auth,'delegatedAccess').mockImplementation(async(_env,p)=>({accessToken:p,expiresAt:Date.now()+60000}));
 vi.spyOn(upstream,'fetchMe').mockImplementation(async(_env,_token,p)=>({accountNumId:p==='harbor'?22:10001}));
 const transfer=vi.spyOn(distribution,'distributeHosted').mockResolvedValue();
 const response=await request(f.card);
 expect(response.status).toBe(200);
 expect(await response.json()).toEqual({status:'ready'});
 expect(grant).toHaveBeenCalledWith(env,'lunatalk',10001,f.member);
 expect(grant).toHaveBeenCalledWith(env,'harbor',22,f.member);
 expect(transfer).toHaveBeenCalledWith(env,{memberId:f.member,versionId:'version',sourceAccount:10001,sourceToken:'lunatalk',targetProvider:'harbor',targetAccount:22,targetToken:'harbor'});
});
it('does not copy after a token resolves to a different account',async()=>{
 const f=await fixture();
 vi.spyOn(auth,'delegatedAccess').mockResolvedValue({accessToken:'token',expiresAt:Date.now()+60000});
 vi.spyOn(upstream,'fetchMe').mockResolvedValue({accountNumId:999});
 const transfer=vi.spyOn(distribution,'distributeHosted');
 expect((await request(f.card)).status).toBe(409);
 expect(transfer).not.toHaveBeenCalled();
});
it('reuses a reachable replica without requesting credentials or recopying',async()=>{
 const f=await fixture();
 await env.DB.prepare("INSERT INTO hosting_replicas VALUES('version','harbor','target-draft','target-sealed','ready',1)").run();
 vi.spyOn(upstream,'fetchRole').mockResolvedValue(role({roleId:'target-sealed',authorNumId:22}));
 const grant=vi.spyOn(auth,'delegatedAccess');
 const response=await request(f.card);
 expect(await response.json()).toEqual({status:'already_ready'});
 expect(grant).not.toHaveBeenCalled();
});
it('migrates the editable draft separately without publishing it',async()=>{
 const f=await fixture();
 vi.spyOn(auth,'delegatedAccess').mockImplementation(async(_env,p)=>({accessToken:p,expiresAt:Date.now()+60000}));
 vi.spyOn(upstream,'fetchMe').mockImplementation(async(_env,_token,p)=>({accountNumId:p==='harbor'?22:10001}));
 const sync=vi.spyOn(drafts,'syncCard').mockResolvedValue({roleId:'target',status:'synced'} as never);
 const response=await SELF.fetch('https://c.test/internal/retirement/migrate',{method:'POST',headers:{'Content-Type':'application/json','X-Retirement-Key':'fixture-harbor'},body:JSON.stringify({cardNumber:f.card,draft:true})});
 expect(response.status).toBe(200);
 expect(sync).toHaveBeenCalledWith(env,{memberId:f.member,sourceProvider:'lunatalk',sourceRoleId:'draft',sourceAccount:10001,sourceToken:'lunatalk',targetProvider:'harbor',targetAccount:22,targetToken:'harbor',publish:false});
});

it('rejects a draft when the saved target grant belongs to another account',async()=>{
 const f=await fixture();
 vi.spyOn(auth,'delegatedAccess').mockResolvedValue({accessToken:'token',expiresAt:Date.now()+60000});
 vi.spyOn(upstream,'fetchMe').mockResolvedValue({accountNumId:999});
 const sync=vi.spyOn(drafts,'syncCard');
 const response=await SELF.fetch('https://c.test/internal/retirement/migrate',{method:'POST',headers:{'Content-Type':'application/json','X-Retirement-Key':'fixture-harbor'},body:JSON.stringify({cardNumber:f.card,draft:true})});
 expect(response.status).toBe(409);
 expect(sync).not.toHaveBeenCalled();
});
