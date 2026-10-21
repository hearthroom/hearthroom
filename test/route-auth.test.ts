import { env } from 'cloudflare:test';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import worker from '../src/index';
import { resetDb } from './helpers';
import { resolveMember } from '../src/members';

const source='https://sukisuki.ai', target='https://sukisuki.pro';
const allowed=[source,target,'https://hearthroom.club','https://sukisuki.chat'];
const authEnv=()=>({...env,AUTH_ENABLED:'true',AUTH_ALLOWED_ORIGINS:allowed.join(','),
  AUTH_KEYRING:JSON.stringify({active:'test',keys:{test:'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='}}),AUTH_METRICS_SECRET:'test-only'});
const context={waitUntil:(_p:Promise<unknown>)=>{},passThroughOnException(){}} as ExecutionContext;
const hash=async(s:string)=>btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
let jars:Record<string,Record<string,string>>={};
function cookie(origin:string){return Object.entries(jars[origin]??{}).map(([k,v])=>`${k}=${v}`).join('; ');}
async function request(origin:string,path:string,body?:unknown,headers:Record<string,string>={}){
  const response=await worker.fetch(new Request(origin+path,{method:body===undefined?'GET':'POST',
    headers:{Origin:origin,'X-Hearthroom-Request':'1',Cookie:cookie(origin),'Content-Type':'application/json',...headers},
    ...(body===undefined?{}:{body:JSON.stringify(body)})}),authEnv(),context);
  for(const c of response.headers.getSetCookie()){
    const pair=c.split(';')[0],i=pair.indexOf('=');
    (jars[origin]??={})[pair.slice(0,i)]=pair.slice(i+1);
  }
  return response;
}
async function session(origin=source,id=22){
  const member=await resolveMember(env.DB,'harbor',id,Date.now()),raw=crypto.randomUUID(),tokenHash=await hash(raw);
  await env.DB.prepare('INSERT INTO account_sessions VALUES(?,?,?,?,?,?,?)').bind(tokenHash,member,'harbor',String(id),origin,Date.now()-1000,Date.now()+86400000).run();
  (jars[origin]??={})['__Host-hr-session']=raw;
  return {member,tokenHash};
}
async function start(origin=source,to=target,returnTo='/en/play/123?tab=a#last'){
  const r=await request(origin,'/v1/auth/route-start',{targetOrigin:to,returnTo});
  expect(r.status).toBe(200);
  const url=new URL((await r.json() as any).url);
  expect(url.origin).toBe(to);expect(url.pathname).toBe('/auth/route/prepare');
  return url;
}
async function prepare(url:URL){
  const r=await request(url.origin,url.pathname+url.search);
  expect(r.status).toBe(302);
  const next=new URL(r.headers.get('location')!);
  return new URLSearchParams(next.hash.slice(1)).get('request')!;
}
async function issued(){
  const url=await start(),id=await prepare(url);
  const r=await request(source,'/v1/auth/route-issue',{request:id});
  expect(r.status).toBe(200);
  const next=new URL((await r.json() as any).url);
  expect(next.origin).toBe(target);expect(next.search).toBe('');
  return new URLSearchParams(next.hash.slice(1)).get('code')!;
}
beforeEach(async()=>{await resetDb();jars={};});
afterEach(()=>vi.restoreAllMocks());

it('hands off only an existing site session, preserves path and never contacts Harbor',async()=>{
  const original=await session();
  vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('Harbor is unreachable'));
  const code=await issued();
  const r=await request(target,'/v1/auth/route-redeem',{code});
  expect(r.status).toBe(200);
  expect(await r.json()).toEqual({ok:true,returnTo:'/en/play/123?tab=a#last'});
  const me=await request(target,'/v1/auth/session',{});
  expect(me.status).toBe(200);expect((await me.json() as any).me.accountNumId).toBe(22);
  expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM members').first<any>()).n).toBe(1);
  const dest=await env.DB.prepare('SELECT * FROM account_sessions WHERE origin=?').bind(target).first<any>();
  const initial=await env.DB.prepare('SELECT * FROM account_sessions WHERE token_hash=?').bind(original.tokenHash).first<any>();
  expect(dest.created_at).toBe(initial.created_at);expect(dest.token_hash).not.toBe(original.tokenHash);
  expect(r.headers.get('cache-control')).toBe('private, no-store');
  expect(r.headers.get('referrer-policy')).toBe('no-referrer');
  expect(r.headers.getSetCookie().join(';')).toContain('HttpOnly');
  const rows=await env.DB.prepare('SELECT * FROM account_route_handoffs').all();
  expect(JSON.stringify(rows.results)).not.toContain(code);
});

it('rejects guests, untrusted targets, lookalike hosts, cross-origin POST and unsafe return paths',async()=>{
  expect((await request(source,'/v1/auth/route-start',{targetOrigin:target})).status).toBe(401);
  await session();
  for(const to of ['https://evil.test','https://sukisuki.pro.evil.test','http://sukisuki.pro','https://play.sukisuki.pro',target+'/path'])
    expect((await request(source,'/v1/auth/route-start',{targetOrigin:to})).status).toBe(400);
  expect((await request(source,'/v1/auth/route-start',{targetOrigin:target},{Origin:target})).status).toBe(403);
  for(const path of ['//evil.test','/\\evil.test','/bad\npath','/auth/route/complete']){
    await start(source,target,path);
    const row=await env.DB.prepare('SELECT return_to FROM account_route_handoffs').first<any>();
    expect(row.return_to).toBe('/');
  }
});

it('binds issue to the initiating browser and the original site session',async()=>{
  await session();const id=await prepare(await start());
  const saved={...jars[source]};delete jars[source]['__Host-hr-route-source'];
  expect((await request(source,'/v1/auth/route-issue',{request:id})).status).toBe(400);
  jars[source]=saved;await session(source,99);
  expect((await request(source,'/v1/auth/route-issue',{request:id})).status).toBe(400);
});

it('cannot redeem a forwarded code in another browser or another official origin',async()=>{
  await session();const code=await issued(),saved={...jars[target]};
  jars[target]={};expect((await request(target,'/v1/auth/route-redeem',{code})).status).toBe(400);
  jars['https://sukisuki.chat']=saved;
  expect((await request('https://sukisuki.chat','/v1/auth/route-redeem',{code})).status).toBe(400);
  jars[target]=saved;expect((await request(target,'/v1/auth/route-redeem',{code})).status).toBe(200);
  expect((await request(target,'/v1/auth/route-redeem',{code})).status).toBe(400);
});

it('allows at most one concurrent redemption and leaves one destination session',async()=>{
  await session();const code=await issued();
  const responses=await Promise.all([request(target,'/v1/auth/route-redeem',{code}),request(target,'/v1/auth/route-redeem',{code})]);
  expect(responses.map(r=>r.status).sort()).toEqual([200,400]);
  expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM account_sessions WHERE origin=?').bind(target).first<any>()).n).toBe(1);
});

it.each(['expiry','logout','ownership'])('denies a pending handoff after %s',async(reason)=>{
  const original=await session();const code=await issued();
  if(reason==='expiry')await env.DB.prepare('UPDATE account_route_handoffs SET expires_at=?').bind(Date.now()-1).run();
  if(reason==='logout')await request(source,'/v1/auth/logout',{});
  if(reason==='ownership')await env.DB.prepare('DELETE FROM member_identities WHERE member_id=?').bind(original.member).run();
  expect((await request(target,'/v1/auth/route-redeem',{code})).status).toBe(400);
  expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM account_sessions WHERE origin=?').bind(target).first<any>()).n).toBe(0);
});

it('logs out the transferred browser family across routes while preserving another device',async()=>{
  await session();const code=await issued();await request(target,'/v1/auth/route-redeem',{code});
  expect((await (await request(target,'/v1/auth/session',{})).json() as any).otherLines).toEqual([source]);
  const current={...jars[source]};await session(source);const other={...jars[source]};jars[source]=current;
  expect((await request(target,'/v1/auth/logout',{allRoutes:true})).status).toBe(200);
  expect((await request(source,'/v1/auth/session',{})).status).toBe(401);
  jars[source]=other;expect((await request(source,'/v1/auth/session',{})).status).toBe(200);
});

it('retains default route-only logout and records low-cardinality metrics',async()=>{
  await session();const code=await issued();await request(target,'/v1/auth/route-redeem',{code});
  await request(target,'/v1/auth/logout',{});
  expect((await request(source,'/v1/auth/session',{})).status).toBe(200);
  const metrics=await request(source,'/internal/auth/metrics',undefined,{Authorization:'Bearer test-only'});
  const text=await metrics.text();
  for(const op of ['route-start','route-prepare','route-issue','route-redeem'])
    expect(text).toContain(`operation="${op}",provider="site",outcome="ok"} 1`);
  expect(text).not.toContain(code);expect(text).not.toContain(source);
});

it('supports every directed pair in the official four-route list',async()=>{
  for(const from of allowed)for(const to of allowed.filter(o=>o!==from)){
    await session(from);const id=await prepare(await start(from,to,'/ja/cards/123?mode=view#last'));
    const issued=await request(from,'/v1/auth/route-issue',{request:id});
    expect(issued.status).toBe(200);
    const url=new URL((await issued.json() as any).url),code=new URLSearchParams(url.hash.slice(1)).get('code');
    const done=await request(to,'/v1/auth/route-redeem',{code});
    expect(done.status).toBe(200);
    expect(await done.json()).toEqual({ok:true,returnTo:'/ja/cards/123?mode=view#last'});
    expect((await (await request(to,'/v1/auth/session',{})).json() as any).me.accountNumId).toBe(22);
  }
});

it('rolls back session creation if receipt consumption fails and preserves an existing target login',async()=>{
  await session();const existing=await session(target,99),code=await issued();
  await env.DB.prepare("CREATE TRIGGER route_receipt_failure BEFORE UPDATE OF consumed_session ON account_route_handoffs BEGIN SELECT RAISE(ABORT,'test receipt unavailable'); END").run();
  try{
    expect((await request(target,'/v1/auth/route-redeem',{code})).status).toBe(503);
    const rows=await env.DB.prepare('SELECT token_hash FROM account_sessions WHERE origin=?').bind(target).all<any>();
    expect(rows.results.map(r=>r.token_hash)).toEqual([existing.tokenHash]);
    expect((await env.DB.prepare('SELECT consumed_session FROM account_route_handoffs').first<any>()).consumed_session).toBeNull();
  }finally{await env.DB.prepare('DROP TRIGGER route_receipt_failure').run();}
  expect((await request(target,'/v1/auth/route-redeem',{code})).status).toBe(200);
});

it('does not reset the source absolute lifetime or accept a replaced source intent',async()=>{
  const original=await session(),id=await prepare(await start());
  await start();
  expect((await request(source,'/v1/auth/route-issue',{request:id})).status).toBe(400);
  const code=await issued();
  await env.DB.prepare('UPDATE account_sessions SET created_at=? WHERE token_hash=?').bind(Date.now()-181*86400000,original.tokenHash).run();
  expect((await request(target,'/v1/auth/route-redeem',{code})).status).toBe(400);
});

it.each([false,true])('fences a queued destination redemption after logout (allRoutes=%s)',async(allRoutes)=>{
  await session();const code=await issued(),queued={...jars[target]};
  expect((await request(target,'/v1/auth/logout',{allRoutes})).status).toBe(200);
  jars[target]=queued;
  expect((await request(target,'/v1/auth/route-redeem',{code})).status).toBe(400);
  expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM account_sessions WHERE origin=?').bind(target).first<any>()).n).toBe(0);
});

it.each([false,true])('invalidates a redeemed session even when its cookie response arrives after logout (allRoutes=%s)',async(allRoutes)=>{
  await session();const code=await issued(),queuedLogout={...jars[target]};
  expect((await request(target,'/v1/auth/route-redeem',{code})).status).toBe(200);
  const late={...jars[target]};jars[target]=queuedLogout;
  expect((await request(target,'/v1/auth/logout',{allRoutes})).status).toBe(200);
  jars[target]=late;
  expect((await request(target,'/v1/auth/session',{})).status).toBe(401);
});
