import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import worker from '../src/index';
import { beforeEach, expect, it } from 'vitest';
import { qaContextRoutes, verifyQAContext } from '../src/qa-browser-context';

const origin='https://sukisuki.ai';
const key='03'.repeat(32);
const encode=(s:Uint8Array)=>btoa(String.fromCharCode(...s)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
async function ticket(aud=origin,purpose='bootstrap',ttl=60){
 const now=Math.floor(Date.now()/1000);
 const body=encode(new TextEncoder().encode(JSON.stringify({v:1,aud,purpose,iat:now,exp:now+ttl,nonce:encode(crypto.getRandomValues(new Uint8Array(32)))})));
 const k=await crypto.subtle.importKey('raw',new Uint8Array(32).fill(3),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 return body+'.'+encode(new Uint8Array(await crypto.subtle.sign('HMAC',k,new TextEncoder().encode(body))));
}
const configured=()=>({...env,QA_BROWSER_CONTEXT_KEY:key});
beforeEach(async()=>{await env.DB.exec('DELETE FROM qa_browser_nonce');});

it('exchanges a management ticket once and issues an exclusion-only host cookie',async()=>{
 const token=await ticket();
 const request=()=>qaContextRoutes.request(origin+'/internal/qa/browser-context',{
  method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify({ticket:token}),
 },configured());
 const res=await request();expect(res.status).toBe(200);
 const set=res.headers.get('Set-Cookie')!;
 expect(set).toContain('HttpOnly');expect(set).toContain('Secure');expect(set).toContain('SameSite=Lax');expect(set).not.toContain('Domain=');
 const cookie=set.split(';')[0];
 expect(await verifyQAContext(new Request(origin+'/',{headers:{Cookie:cookie}}),configured())).toBe(true);
 expect(await verifyQAContext(new Request('https://sukisuki.chat/',{headers:{Cookie:cookie}}),configured())).toBe(false);
 expect(await res.json()).toEqual({ready:true});
 expect((await request()).status).toBe(401);
 expect((await env.DB.prepare('SELECT count(*) AS n FROM members').first<{n:number}>())!.n).toBe(0);
 expect((await env.DB.prepare('SELECT count(*) AS n FROM account_sessions').first<{n:number}>())!.n).toBe(0);
});

it('rejects wrong origin, purpose, long/expired claims, missing key and fake cookies',async()=>{
 for(const token of [await ticket('https://elsewhere.invalid'),await ticket(origin,'context'),await ticket(origin,'bootstrap',61),await ticket(origin,'bootstrap',-1)]){
  const res=await qaContextRoutes.request(origin+'/internal/qa/browser-context',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify({ticket:token})},configured());
  expect(res.status).toBe(401);expect(res.headers.get('Set-Cookie')).toBeNull();
 }
 expect(await verifyQAContext(new Request(origin+'/',{headers:{Cookie:'hh_qa_context=test'}}),configured())).toBe(false);
 const off=await qaContextRoutes.request(origin+'/internal/qa/browser-context',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify({ticket:await ticket()})},{...env,QA_BROWSER_CONTEXT_KEY:''});
 expect(off.status).toBe(404);
});


it('suppresses server AE and the same-origin beacon before account login',async()=>{
 const config=configured();
 const boot=await qaContextRoutes.request(origin+'/internal/qa/browser-context',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify({ticket:await ticket()})},config);
 const cookie=boot.headers.get('Set-Cookie')!.split(';')[0];
 const points:unknown[]=[];
 const target={...config,GA4_ENABLED:'true',ANALYTICS_ENABLED:'true',EVENTS:{writeDataPoint:(v:unknown)=>points.push(v)}} as any;
 const ctx=createExecutionContext();
 const response=await worker.fetch(new Request(origin+'/v1/analytics/session',{method:'POST',headers:{Cookie:cookie,Origin:origin,'X-Hearthroom-Request':'1'}}),target,ctx);
 await waitOnExecutionContext(ctx);
 expect(await response.json()).toEqual({enabled:false});
 expect(response.headers.get('Set-Cookie')).toBeNull();
 const beaconCtx=createExecutionContext();
 await worker.fetch(new Request(origin+'/v1/e',{method:'POST',headers:{Cookie:cookie,Origin:origin,'Content-Type':'application/json'},body:JSON.stringify([{event:'page_view',route:'/'}])}),target,beaconCtx);
 await waitOnExecutionContext(beaconCtx);
 expect(points).toEqual([]);
});
