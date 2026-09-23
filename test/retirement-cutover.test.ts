import {env} from 'cloudflare:test';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {resetDb,makeMember,role} from './helpers';
import {upsertCard} from '../src/cards';
import {upstream} from '../src/upstream';
import * as auth from '../src/account-auth';
import {HttpError} from '../src/types';
import {cutoverCard} from '../src/retirement-cutover';
beforeEach(resetDb);afterEach(()=>vi.restoreAllMocks());
async function fixture(){
 const member=await makeMember(10001);
 const card=await upsertCard(env.DB,role({roleId:'source',authorNumId:10001}),1,{provider:'lunatalk'});
 await env.DB.batch([
  env.DB.prepare("INSERT INTO works VALUES('work',?,'lunatalk','source',1)").bind(member),
  env.DB.prepare("INSERT INTO member_connections VALUES('harbor','22',?,1)").bind(member),
  env.DB.prepare("INSERT INTO work_copies(work_id,provider,external_id,role_id,status,updated_at) VALUES('work','harbor',22,'target','synced',1)"),
  env.DB.prepare("INSERT INTO hosting_versions(version_id,work_id,member_id,operation_id,source_role_id,provider,nsfw,hosted_revision_id,card_id,state,created_at) VALUES('version','work',?,'op','source','lunatalk',0,'sealed',?,'approved',1)").bind(member,card.id),
  env.DB.prepare("INSERT INTO hosting_replicas VALUES('version','harbor','transfer-draft','target-sealed','ready',1)"),
  env.DB.prepare("UPDATE cards SET approved_version_id='version',approved_hosted_role_id='sealed',board_hidden=1 WHERE id=?").bind(card.id),
  env.DB.prepare("INSERT INTO member_favorites VALUES(?,?,1)").bind(member,card.id),
 ]);
 vi.spyOn(upstream,'fetchRole').mockImplementation(async(_env,id)=>role({roleId:id,authorNumId:22}));
 return {member,card:Number(card.id)};
}
it('preserves public number, community ownership, approved identity and moderation',async()=>{
 const f=await fixture();await cutoverCard(env,f.card);
 expect(await env.DB.prepare('SELECT id,provider,source_role_id,author_num_id,approved_version_id,approved_hosted_role_id,board_hidden FROM cards WHERE id=?').bind(f.card).first()).toEqual({id:f.card,provider:'harbor',source_role_id:'target',author_num_id:22,approved_version_id:'version',approved_hosted_role_id:'target-sealed',board_hidden:1});
 expect(await env.DB.prepare('SELECT member_id,source_provider,source_role_id FROM works').first()).toEqual({member_id:f.member,source_provider:'harbor',source_role_id:'target'});
 expect(await env.DB.prepare('SELECT num FROM card_numbers WHERE provider=? AND source_role_id=?').bind('harbor','target').first()).toEqual({num:f.card});
 expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM member_favorites WHERE card_id=?').bind(f.card).first()).toEqual({n:1});
 expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM work_copies WHERE provider='harbor'").first()).toEqual({n:0});
 expect(await cutoverCard(env,f.card)).toEqual({status:'already_cut_over'});
});
it('does not inherit an approval when no equivalent Harper replica exists',async()=>{
 const f=await fixture();await env.DB.prepare('DELETE FROM hosting_replicas').run();await cutoverCard(env,f.card);
 expect(await env.DB.prepare('SELECT provider,status,approved_version_id,approved_hosted_role_id FROM cards').first()).toEqual({provider:'harbor',status:'needs_review',approved_version_id:null,approved_hosted_role_id:null});
});
it('rejects a target belonging to another author before any mutation',async()=>{
 const f=await fixture();vi.mocked(upstream.fetchRole).mockResolvedValue(role({roleId:'target',authorNumId:99}));
 await expect(cutoverCard(env,f.card)).rejects.toThrow('migration_owner_changed');
 expect(await env.DB.prepare('SELECT source_provider FROM works').first()).toEqual({source_provider:'lunatalk'});
});
it('fences a concurrent ownership change and rolls back all locator changes',async()=>{
 const f=await fixture();let first=true;
 vi.mocked(upstream.fetchRole).mockImplementation(async(_env,id)=>{if(first){first=false;await env.DB.prepare("UPDATE member_connections SET owner_member_id='other' WHERE provider='harbor'").run();}return role({roleId:id,authorNumId:22});});
 await expect(cutoverCard(env,f.card)).rejects.toThrow('migration_changed');
 expect(await env.DB.prepare('SELECT provider FROM card_numbers WHERE num=?').bind(f.card).first()).toEqual({provider:'lunatalk'});
 expect(await env.DB.prepare('SELECT provider FROM cards').first()).toEqual({provider:'lunatalk'});
});
it('never consumes a separately numbered target',async()=>{
 const f=await fixture();await env.DB.prepare("INSERT INTO card_numbers(provider,source_role_id) VALUES('harbor','target')").run();
 await expect(cutoverCard(env,f.card)).rejects.toThrow('migration_changed');
 expect(await env.DB.prepare('SELECT source_provider FROM works').first()).toEqual({source_provider:'lunatalk'});
});
it('rolls back earlier mutations if a late historical-locator insert fails',async()=>{
 const f=await fixture();await env.DB.prepare("INSERT INTO work_copies(work_id,provider,external_id,role_id,status,updated_at) VALUES('other','lunatalk',10001,'source','retired',1)").run();
 await expect(cutoverCard(env,f.card)).rejects.toThrow('migration_changed');
 expect(await env.DB.prepare('SELECT source_provider FROM works').first()).toEqual({source_provider:'lunatalk'});
 expect(await env.DB.prepare('SELECT provider FROM cards').first()).toEqual({provider:'lunatalk'});
 expect(await env.DB.prepare('SELECT provider FROM hosting_versions').first()).toEqual({provider:'lunatalk'});
 expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM work_copies WHERE provider='harbor'").first()).toEqual({n:1});
});

it('uses the linked author grant to verify a private draft without publishing it',async()=>{
 const f=await fixture();
 vi.mocked(upstream.fetchRole).mockImplementation(async(_env,id)=>{if(id==='target')throw new HttpError(404,'role not found');return role({roleId:id,authorNumId:22})});
 const access=vi.spyOn(auth,'delegatedAccess').mockResolvedValue({accessToken:'private-test',expiresAt:Date.now()+60000});
 vi.spyOn(upstream,'fetchMe').mockResolvedValue({accountNumId:22});
 const network=vi.spyOn(globalThis,'fetch').mockResolvedValue(Response.json({characterRoleId:'target',accountNumId:22,authorName:'Author'}));
 expect(await cutoverCard(env,f.card)).toEqual({status:'cut_over'});
 expect(access).toHaveBeenCalledWith(env,'harbor',22,f.member);
 expect(network).toHaveBeenCalledTimes(1);
 expect(network).toHaveBeenCalledWith(expect.stringContaining('/open/v1/role/detail?roleId=target'),expect.objectContaining({redirect:'manual',headers:expect.objectContaining({Authorization:'Bearer private-test'})}));
});
it('never forwards an unrelated saved grant or changes private draft visibility',async()=>{
 const f=await fixture();vi.mocked(upstream.fetchRole).mockRejectedValue(new HttpError(404,'role not found'));
 vi.spyOn(auth,'delegatedAccess').mockResolvedValue({accessToken:'wrong',expiresAt:Date.now()+60000});
 vi.spyOn(upstream,'fetchMe').mockResolvedValue({accountNumId:99});
 const network=vi.spyOn(globalThis,'fetch');
 await expect(cutoverCard(env,f.card)).rejects.toThrow('migration_owner_changed');
 expect(network).not.toHaveBeenCalled();
 expect(await env.DB.prepare('SELECT source_provider FROM works').first()).toEqual({source_provider:'lunatalk'});
});
it('does not follow a private-draft redirect with the author credential',async()=>{
 const f=await fixture();vi.mocked(upstream.fetchRole).mockRejectedValue(new HttpError(404,'role not found'));
 vi.spyOn(auth,'delegatedAccess').mockResolvedValue({accessToken:'private-test',expiresAt:Date.now()+60000});
 vi.spyOn(upstream,'fetchMe').mockResolvedValue({accountNumId:22});
 vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(null,{status:307,headers:{Location:'https://elsewhere.test'}}));
 await expect(cutoverCard(env,f.card)).rejects.toThrow('migration_draft_unavailable');
 expect(await env.DB.prepare('SELECT source_provider FROM works').first()).toEqual({source_provider:'lunatalk'});
});
