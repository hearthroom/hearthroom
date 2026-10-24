import {env,createExecutionContext,waitOnExecutionContext} from 'cloudflare:test';
import {beforeEach,expect,it} from 'vitest';
import worker from '../src/index';
import {resetDb} from './helpers';
import type {Env} from '../src/types';
const key='04'.repeat(32),origin='https://sukisuki.ai',path='/internal/qa/accounts';
const hex=(a:ArrayBuffer)=>[...new Uint8Array(a)].map(v=>v.toString(16).padStart(2,'0')).join('');
async function request(body:object,signed=true){
 const raw=JSON.stringify(body),stamp=String(Math.floor(Date.now()/1000)),nonce=crypto.randomUUID()+crypto.randomUUID();
 const headers:Record<string,string>={'Content-Type':'application/json'};
 if(signed){const k=await crypto.subtle.importKey('raw',new Uint8Array(32).fill(4),{name:'HMAC',hash:'SHA-256'},false,['sign']);const hash=hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw)));
  headers['X-QA-Time']=stamp;headers['X-QA-Nonce']=nonce;headers['X-QA-Signature']=hex(await crypto.subtle.sign('HMAC',k,new TextEncoder().encode([origin,'POST',path,stamp,nonce,hash].join('\n'))));}
 const ctx=createExecutionContext();const response=await worker.fetch(new Request(origin+path,{method:'POST',headers,body:raw}),{...env,HARBOR_TEST_ACCOUNTS_ENABLED:'1',QA_ACCOUNT_CONTROL_KEY:key} as Env,ctx);await waitOnExecutionContext(ctx);return response;
}
beforeEach(async()=>{
 await resetDb();await env.DB.batch([
 env.DB.prepare("INSERT INTO members(id,handle,created_at,account_class,test_generation) VALUES('qa','aaaaaaaa',1,'test',1),('normal','bbbbbbbb',1,'normal',0)"),
 env.DB.prepare("INSERT INTO member_identities(provider,external_id,member_id,linked_at) VALUES('harbor','80001','qa',1),('harbor','80002','normal',1)"),
 env.DB.prepare("INSERT INTO qa_session_generation VALUES('qa-token',1)"),
 env.DB.prepare("INSERT INTO account_sessions VALUES('qa-token','qa','harbor','80001','https://sukisuki.ai',1,9999999999999),('normal-token','normal','harbor','80002','https://sukisuki.ai',1,9999999999999)"),
 ]);
});
const pause={requestId:'fixture-pause-request',action:'pause',oldPublicNo:80001,newPublicNo:80001,oldGeneration:1,newGeneration:1,stage:0,fresh:false};
it('requires signed narrow control and never changes normal members',async()=>{
 expect((await request(pause,false)).status).toBe(403);
 expect((await request({...pause,oldPublicNo:80002,newPublicNo:80002})).status).toBe(403);
 expect((await env.DB.prepare("SELECT count(*) AS n FROM account_sessions WHERE member_id='normal'").first())?.n).toBe(1);
});
it('revokes only the test slot and replays the same durable receipt',async()=>{
 expect((await request(pause)).status).toBe(200);
 expect((await request(pause)).status).toBe(200);
 expect((await env.DB.prepare("SELECT count(*) AS n FROM account_sessions WHERE member_id='qa'").first())?.n).toBe(0);
 expect((await env.DB.prepare("SELECT count(*) AS n FROM account_sessions WHERE member_id='normal'").first())?.n).toBe(1);
 expect((await request({...pause,stage:1})).status).toBe(409);
});
it('rejects an authorization callback captured before reset even after reactivation',async()=>{
 expect((await request({...pause,requestId:'fixture-reset-request',action:'reset',newGeneration:2,stage:3})).status).toBe(200);
 await env.DB.prepare("INSERT INTO qa_session_generation VALUES('raced-old',1)").run();
 await expect(env.DB.prepare("INSERT INTO account_sessions VALUES('raced-old','qa','harbor','80001','https://sukisuki.ai',1,9999999999999)").run()).rejects.toThrow();
 await env.DB.prepare("INSERT INTO qa_session_generation VALUES('fresh-proof',2)").run();
 await env.DB.prepare("INSERT INTO account_sessions VALUES('fresh-proof','qa','harbor','80001','https://sukisuki.ai',1,9999999999999)").run();
 expect((await env.DB.prepare("SELECT count(*) AS n FROM account_sessions WHERE member_id='qa'").first())?.n).toBe(1);
});

it('has a separate 279-only legacy path and permanently fences late sessions',async()=>{
 await env.DB.batch([
  env.DB.prepare("INSERT INTO members(id,handle,created_at) VALUES('legacy','cccccccc',1)"),
  env.DB.prepare("INSERT INTO member_identities(provider,external_id,member_id,linked_at) VALUES('harbor','279','legacy',1)"),
  env.DB.prepare("INSERT INTO account_sessions VALUES('legacy-token','legacy','harbor','279','https://sukisuki.ai',1,9999999999999)"),
 ]);
 const deletion={...pause,requestId:'fixture-legacy-request',action:'delete-legacy',oldPublicNo:279,newPublicNo:279,oldGeneration:0,newGeneration:0};
 expect((await request({...deletion,oldPublicNo:80002,newPublicNo:80002})).status).toBe(403);
 expect((await request(deletion)).status).toBe(200);
 expect((await request(deletion)).status).toBe(200);
 expect((await env.DB.prepare("SELECT count(*) AS n FROM account_sessions WHERE member_id='legacy'").first())?.n).toBe(0);
 expect((await env.DB.prepare("SELECT count(*) AS n FROM account_sessions WHERE member_id='normal'").first())?.n).toBe(1);
 await expect(env.DB.prepare("INSERT INTO account_sessions VALUES('late-legacy-token','legacy','harbor','279','https://sukisuki.ai',1,9999999999999)").run()).rejects.toThrow();
});
it('keeps unrelated people and retained audit history when legacy cleanup is blocked',async()=>{
 await env.DB.batch([
  env.DB.prepare("INSERT INTO members(id,handle,created_at) VALUES('legacy','cccccccc',1)"),
  env.DB.prepare("INSERT INTO member_identities(provider,external_id,member_id,linked_at) VALUES('harbor','279','legacy',1)"),
  env.DB.prepare("INSERT INTO official_author_audit(request_id,actor_id,member_id,official,reason,payload,created_at) VALUES('retained-audit','normal','legacy',1,'fixture','{}',1)"),
 ]);
 const deletion={...pause,requestId:'fixture-blocked-legacy',action:'delete-legacy',oldPublicNo:279,newPublicNo:279,oldGeneration:0,newGeneration:0};
 expect((await request(deletion)).status).toBe(409);
 expect((await env.DB.prepare("SELECT count(*) AS n FROM members WHERE id='legacy'").first())?.n).toBe(1);
 expect((await env.DB.prepare("SELECT count(*) AS n FROM official_author_audit WHERE request_id='retained-audit'").first())?.n).toBe(1);
 expect((await env.DB.prepare("SELECT count(*) AS n FROM account_sessions WHERE member_id='normal'").first())?.n).toBe(1);
});
