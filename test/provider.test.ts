import {env,SELF} from 'cloudflare:test';
import {beforeEach,expect,it} from 'vitest';
import {resetDb,identitiesFor,bearer} from './helpers';
import {parseProvider,apiBaseOf,configuredProviders,reviewEnabled} from '../src/providers';
beforeEach(async()=>{await resetDb();identitiesFor({harbor:{one:10001,two:10002}})});
it('parses the sole supported issuer and fails closed for other values',()=>{
 expect(parseProvider(undefined)).toBe('harbor');expect(parseProvider(' Harbor ')).toBe('harbor');
 for(const value of ['lunatalk','openai','lunatalk;harbor'])expect(()=>parseProvider(value)).toThrow();
});
it('requires an explicitly configured Harbor endpoint',()=>{
 expect(configuredProviders({})).toEqual([]);expect(()=>apiBaseOf({})).toThrow();
 expect(apiBaseOf({PROVIDER_API_BASE_HARBOR:'https://harbor.test'})).toBe('https://harbor.test');
});
it('retains separate community identities for different Harbor accounts',async()=>{
 const me=async(token:string)=>(await(await SELF.fetch('https://c.test/v1/me',{headers:bearer(token)})).json()) as {handle:string};
 const first=await me('one');expect((await me('one')).handle).toBe(first.handle);expect((await me('two')).handle).not.toBe(first.handle);
});
it('requires the explicit review switch',()=>{expect(reviewEnabled({REVIEW_ENABLED:'true'})).toBe(true);expect(reviewEnabled({})).toBe(false)});

it('preserves a previously linked community when its founding Luna account retires',async()=>{
 const {resolveMember,memberProfile}=await import('../src/members');
 const original=await resolveMember(env.DB,'lunatalk',99,1);
 const other=await resolveMember(env.DB,'harbor',10001,2);
 await env.DB.prepare("UPDATE members SET display_name='Retained community' WHERE id=?").bind(original).run();
 await env.DB.prepare("INSERT INTO member_connections(provider,external_id,owner_member_id,linked_at) VALUES('harbor','10001',?,3)").bind(original).run();
 const response=await SELF.fetch('https://c.test/v1/me',{headers:bearer('one')});
 const profile=await response.json() as any;
 expect(profile.handle).toBe((await memberProfile(env.DB,original))!.handle);
 expect(profile.displayName).toBe('Retained community');
 expect(profile.identities.map((i:any)=>i.provider)).toEqual(['harbor']);
 expect(await resolveMember(env.DB,'harbor',10001,4)).toBe(original);
 expect(other).not.toBe(original);
});
