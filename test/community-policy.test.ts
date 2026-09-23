import {approveFixtureResponse} from './hosted-fixture';
import { SELF, env } from 'cloudflare:test';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { bearer, resetDb, restoreUpstream, identitiesFor, rolesOnProviders, myRolesOnUpstream } from './helpers';
import { resolveMember } from '../src/members';

const headers = (provider='harbor') => ({...bearer(provider), 'X-Provider':provider,'Content-Type':'application/json'});
const profile = async (provider='harbor') => await (await SELF.fetch('https://c.test/v1/me',{headers:headers(provider)})).json() as any;
const register = async (roleId:string,provider='harbor') => approveFixtureResponse(await SELF.fetch('https://c.test/v1/cards',{method:'POST',headers:headers(provider),body:JSON.stringify({operationId:crypto.randomUUID(),...({roleId,nsfw:false})})}));
beforeEach(async()=>{
 await resetDb(); identitiesFor({harbor:{harbor:11}});
 rolesOnProviders({harbor:['a','b','c','d','copy'].map(roleId=>({roleId,authorNumId:11}))});
 myRolesOnUpstream({harbor:[]});
});
afterEach(restoreUpstream);
it('shares three weekly publications across all services of one community',async()=>{
 for(const id of ['a','b','c']) expect((await register(id)).status).toBe(201);
 const fourth=await register('d','harbor');expect(fourth.status).toBe(403);
 expect(await fourth.json()).toEqual({error:'weekly_quota_exceeded'});
 const mine=await SELF.fetch('https://c.test/v1/me/cards',{headers:headers('harbor')});
 expect((await mine.json() as any).quota.used).toBe(3);
});
it('a mapped copy cannot become a second community publication',async()=>{
 await register('a');
 const member=await resolveMember(env.DB,'harbor',11,Date.now());
 const work=await env.DB.prepare("SELECT id FROM works WHERE source_provider='harbor' AND source_role_id='a'").first<{id:string}>();
 await env.DB.prepare('INSERT INTO work_copies(work_id,provider,external_id,role_id,status,updated_at) VALUES (?,?,?,?,?,?)').bind(work!.id,'harbor',11,'copy','published',Date.now()).run();
 const duplicate=await register('copy','harbor');expect(duplicate.status).toBe(409);
 expect(await duplicate.json()).toEqual({error:'publication_use_original'});
 expect((await env.DB.prepare('SELECT * FROM cards').all()).results).toHaveLength(1);
});
it('concurrent publications cannot exceed the community weekly limit',async()=>{

 const responses=await Promise.all([register('a'),register('b'),register('c'),register('d','harbor')]);
 expect(responses.map(r=>r.status).sort()).toEqual([201,201,201,403]);
 expect((await env.DB.prepare('SELECT * FROM cards').all()).results).toHaveLength(3);
});
it('retains publication usage recorded before retirement',async()=>{
 await profile();const member=await resolveMember(env.DB,'harbor',11,Date.now());
 await env.DB.prepare("INSERT INTO member_identities(provider,external_id,member_id,linked_at) VALUES ('lunatalk','22',?,0)").bind(member).run();
 await env.DB.prepare("INSERT INTO card_registrations(provider,author_num_id,source_role_id,registered_at) VALUES ('lunatalk',22,'legacy',?)").bind(Date.now()).run();
 await register('a');await register('b');expect((await register('c')).status).toBe(403);
});
