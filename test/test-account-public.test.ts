import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { beforeEach, expect, it } from 'vitest';
import worker from '../src/index';
import { resetDb } from './helpers';

beforeEach(async()=>{await resetDb();});
async function request(path:string){const ctx=createExecutionContext();const res=await worker.fetch(new Request('https://sukisuki.ai'+path),env,ctx);await waitOnExecutionContext(ctx);return res;}
it('does not expose a test member through author API or its HTML head',async()=>{
 await env.DB.prepare("INSERT INTO members(id,handle,display_name,created_at,account_class,test_generation) VALUES('qa-fixture','aaaaaaaa','QA fixture',?,'test',1),('normal-fixture','bbbbbbbb','Normal fixture',?,'normal',0)").bind(Date.now(),Date.now()).run();
 expect((await request('/v1/authors/bbbbbbbb')).status).toBe(200);
 expect((await request('/v1/authors/aaaaaaaa')).status).toBe(404);
 const html=await request('/authors/aaaaaaaa');
 expect(html.status).toBe(404);expect(await html.text()).not.toContain('QA fixture');
});
it('denies direct card detail and shortcut for an old approved test card',async()=>{
 await env.DB.prepare("INSERT INTO members(id,handle,created_at,account_class,test_generation) VALUES('qa','aaaaaaaa',1,'test',1)").run();
 await env.DB.prepare("INSERT INTO member_identities(provider,external_id,member_id,linked_at) VALUES('harbor','80001','qa',1)").run();
 await env.DB.prepare("INSERT INTO cards(id,provider,source_role_id,author_num_id,registered_at,last_synced_at,status,rating) VALUES(100001,'harbor','qa-role',80001,1,1,'approved','G')").run();
 expect((await request('/v1/cards/100001')).status).toBe(404);
 expect((await request('/v1/cards/100001/manifest.webmanifest')).status).toBe(404);
});
it('excludes a fenced legacy subject from public-effect helpers',async()=>{
 await env.DB.prepare("INSERT INTO members(id,handle,created_at) VALUES('legacy','aaaaaaaa',1)").run();
 await env.DB.prepare("INSERT INTO member_identities(provider,external_id,member_id,linked_at) VALUES('harbor','279','legacy',1)").run();
 await env.DB.prepare("INSERT INTO legacy_account_fence(public_no,member_id,handle,request_id,created_at) VALUES(279,'legacy','aaaaaaaa','fixture-fence',1)").run();
 const {assertNormalMember,isTestHarborAccount}=await import('../src/test-accounts');
 await expect(assertNormalMember(env.DB,'legacy')).rejects.toThrow();
 expect(await isTestHarborAccount(env.DB,279)).toBe(true);
});
it('keeps an old test session excluded even when authentication is no longer valid',async()=>{
 const {qaSessionHint}=await import('../src/test-accounts');
 const raw='fixture-expired-session';
 const hash=btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw))))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
 await env.DB.prepare('INSERT INTO qa_session_exclusion(token_hash,expires_at) VALUES(?,?)').bind(hash,Date.now()+3600000).run();
 expect(await qaSessionHint(new Request('https://sukisuki.ai/',{headers:{Cookie:'__Host-hr-session='+raw}}),env.DB)).toBe(true);
});
