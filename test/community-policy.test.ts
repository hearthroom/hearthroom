import {approveFixtureResponse} from './hosted-fixture';
import { SELF, env } from 'cloudflare:test';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { bearer, resetDb, restoreUpstream, identitiesFor, rolesOnProviders, myRolesOnUpstream } from './helpers';
import { resolveMember } from '../src/members';

const headers = (provider='lunatalk') => ({...bearer(provider), 'X-Provider':provider,'Content-Type':'application/json'});
const profile = async (provider='lunatalk') => await (await SELF.fetch('https://c.test/v1/me',{headers:headers(provider)})).json() as any;
const register = async (roleId:string,provider='lunatalk') => approveFixtureResponse(await SELF.fetch('https://c.test/v1/cards',{method:'POST',headers:headers(provider),body:JSON.stringify({operationId:crypto.randomUUID(),...({roleId,nsfw:false})})}));
async function link() {
 const a=await profile(); const b=await profile('harbor');
 return SELF.fetch('https://c.test/v1/me/connections',{method:'POST',headers:headers(),body:JSON.stringify({provider:'harbor',token:'harbor',keepHandle:a.handle,sourceHandle:a.handle,targetHandle:b.handle})});
}
beforeEach(async()=>{
 await resetDb(); identitiesFor({lunatalk:{lunatalk:11},harbor:{harbor:22}});
 rolesOnProviders({lunatalk:['a','b','c'].map(roleId=>({roleId,authorNumId:11})),harbor:['copy','d'].map(roleId=>({roleId,authorNumId:22}))});
 myRolesOnUpstream({lunatalk:[],harbor:[]});
});
afterEach(restoreUpstream);
it('shares three weekly publications across all services of one community',async()=>{
 expect((await link()).status).toBe(200);
 for(const id of ['a','b','c']) expect((await register(id)).status).toBe(201);
 const fourth=await register('d','harbor');expect(fourth.status).toBe(403);
 expect(await fourth.json()).toEqual({error:'weekly_quota_exceeded'});
 const mine=await SELF.fetch('https://c.test/v1/me/cards',{headers:headers('harbor')});
 expect((await mine.json() as any).quota.used).toBe(3);
});
it('a mapped copy cannot become a second community publication',async()=>{
 await link(); await register('a');
 const member=await resolveMember(env.DB,'lunatalk',11,Date.now());
 const work=await env.DB.prepare("SELECT id FROM works WHERE source_provider='lunatalk' AND source_role_id='a'").first<{id:string}>();
 await env.DB.prepare('INSERT INTO work_copies(work_id,provider,external_id,role_id,status,updated_at) VALUES (?,?,?,?,?,?)').bind(work!.id,'harbor',22,'copy','published',Date.now()).run();
 const duplicate=await register('copy','harbor');expect(duplicate.status).toBe(409);
 expect(await duplicate.json()).toEqual({error:'publication_use_original'});
 expect((await env.DB.prepare('SELECT * FROM cards').all()).results).toHaveLength(1);
});
it('concurrent publications cannot exceed the community weekly limit',async()=>{
 await link();
 const responses=await Promise.all([register('a'),register('b'),register('c'),register('d','harbor')]);
 expect(responses.map(r=>r.status).sort()).toEqual([201,201,201,403]);
 expect((await env.DB.prepare('SELECT * FROM cards').all()).results).toHaveLength(3);
});
it('removes only the empty community while retaining both verified sign-in identities',async()=>{
 const retained=await profile(); const empty=await profile('harbor');
 expect((await link()).status).toBe(200);
 expect((await profile('harbor')).handle).toBe(retained.handle);
 expect(await env.DB.prepare('SELECT id FROM members WHERE handle=?').bind(empty.handle).first()).toBeNull();
 expect((await env.DB.prepare('SELECT * FROM member_identities').all()).results).toHaveLength(2);
});
it('never disconnects a service, including a non-founding service',async()=>{
 await link();
 const r=await SELF.fetch('https://c.test/v1/me/connections/harbor',{method:'DELETE',headers:headers()});
 expect(r.status).toBe(409);expect((await profile()).identities).toHaveLength(2);
});
it('does not absorb a community with past publications, even after withdrawal',async()=>{
 await profile(); await profile('harbor'); await register('d','harbor');
 await env.DB.prepare("DELETE FROM cards WHERE provider='harbor'").run();
 const r=await link();expect(r.status).toBe(409);
 expect((await env.DB.prepare('SELECT * FROM members').all()).results).toHaveLength(2);
});
it('does not absorb a community with a game save or edited profile',async()=>{
 const target=await resolveMember(env.DB,'harbor',22,Date.now());
 await env.DB.prepare("INSERT INTO card_saves(member_id,role_id,key,value,updated_at) VALUES (?, 'card', 'save', '{}', 0)").bind(target).run();
 expect((await link()).status).toBe(409);
});

it('refuses to absorb an account with edited community metadata',async()=>{
 await profile('harbor');const r=await SELF.fetch('https://c.test/v1/me/profile',{method:'PUT',headers:headers('harbor'),body:JSON.stringify({displayName:'Personal profile',bio:'Keep me'})});expect(r.status).toBe(200);
 expect((await link()).status).toBe(409);expect((await profile('harbor')).bio).toBe('Keep me');
});
it('refuses an empty-looking community that still owns an upstream draft',async()=>{
 await profile('harbor');myRolesOnUpstream({harbor:[{roleId:'draft'}]});
 expect((await link()).status).toBe(409);expect((await profile('harbor')).identities).toHaveLength(1);
});
it('counts pre-migration registrations from every connected service without resetting usage',async()=>{
 await link();const now=Date.now();
 await env.DB.prepare('INSERT INTO card_registrations(provider,author_num_id,source_role_id,registered_at) VALUES (?,?,?,?)').bind('harbor',22,'legacy',now).run();
 await register('a');await register('b');expect((await register('c')).status).toBe(403);
});
