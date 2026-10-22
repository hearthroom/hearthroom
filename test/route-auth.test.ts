import { env } from 'cloudflare:test';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import worker from '../src/index';
import { resetDb } from './helpers';
import { resolveMember } from '../src/members';
import type { Env } from '../src/types';

const source='https://sukisuki.ai', target='https://sukisuki.pro';
const allowed=[source,target,'https://hearthroom.club','https://sukisuki.chat'];
let routeLimit=vi.fn(async(_input:{key:string})=>({success:true}));
const authEnv=()=>({...env,AUTH_ENABLED:'true',AUTH_ALLOWED_ORIGINS:allowed.join(','),
  AUTH_ROUTE_LIMIT:{limit:routeLimit},
  AUTH_KEYRING:JSON.stringify({active:'test',keys:{test:'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='}}),AUTH_METRICS_SECRET:'test-only'});
const context={waitUntil:(_p:Promise<unknown>)=>{},passThroughOnException(){}} as ExecutionContext;
const hash=async(s:string)=>btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
let jars:Record<string,Record<string,string>>={};
function cookie(origin:string){return Object.entries(jars[origin]??{}).map(([k,v])=>`${k}=${v}`).join('; ');}
async function request(origin:string,path:string,body?:unknown,headers:Record<string,string>={},overrides:Partial<Env>={}){
  const response=await worker.fetch(new Request(origin+path,{method:body===undefined?'GET':'POST',
    headers:{Origin:origin,'X-Hearthroom-Request':'1',Cookie:cookie(origin),'Content-Type':'application/json',...headers},
    ...(body===undefined?{}:{body:JSON.stringify(body)})}),{...authEnv(),...overrides},context);
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
beforeEach(async()=>{await resetDb();jars={};routeLimit=vi.fn(async(_input:{key:string})=>({success:true}));});
afterEach(()=>vi.restoreAllMocks());

const navigationHeaders={'Sec-Fetch-Mode':'navigate','Sec-Fetch-Dest':'document',Accept:'text/html'};
function expectPrepareFailurePage(response:Response){
  expect(response.status).toBe(302);
  expect(response.headers.get('location')).toBe('/auth/route/complete#failed=1');
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(response.headers.get('referrer-policy')).toBe('no-referrer');
}

it.each(['missing','malformed','unknown','expired','replayed'])('shows the handoff failure page for a %s top-level prepare request',async(reason)=>{
  let path='/auth/route/prepare';
  if(reason==='malformed')path+='?request=bad';
  if(reason==='unknown')path+='?request='+'a'.repeat(43);
  if(reason==='expired'||reason==='replayed'){
    await session();const url=await start();path=url.pathname+url.search;
    if(reason==='expired')await env.DB.prepare('UPDATE account_route_handoffs SET expires_at=?').bind(Date.now()-1).run();
    else await prepare(url);
  }
  const response=await request(target,path,undefined,navigationHeaders);
  expectPrepareFailurePage(response);
  expect(await response.text()).not.toContain('auth_route_invalid');
  const metrics=await env.DB.prepare("SELECT outcome,value FROM account_auth_metrics WHERE operation='route-prepare'").all<any>();
  // Malformed traffic still stops before any durable metric write.
  expect(metrics.results).toEqual(reason==='missing'||reason==='malformed'?[]:
    reason==='replayed'?[{outcome:'ok',value:1},{outcome:'denied',value:1}].sort((a,b)=>a.outcome.localeCompare(b.outcome)):[{outcome:'denied',value:1}]);
});

it.each(['disabled','configuration','origin','rate-limit','limiter-missing','limiter-unavailable'])('shows the failure page when prepare is blocked by %s without adding prevalidation metric writes',async(reason)=>{
  const overrides:Partial<Env>={};
  if(reason==='disabled')overrides.AUTH_ENABLED='false';
  if(reason==='configuration')overrides.AUTH_KEYRING='invalid';
  if(reason==='origin')overrides.AUTH_ALLOWED_ORIGINS='';
  if(reason==='rate-limit')routeLimit.mockResolvedValue({success:false});
  if(reason==='limiter-missing')overrides.AUTH_ROUTE_LIMIT=undefined;
  if(reason==='limiter-unavailable')routeLimit.mockRejectedValue(new Error('limiter unavailable'));
  expectPrepareFailurePage(await request(reason==='origin'?source:target,'/auth/route/prepare?request='+'a'.repeat(43),undefined,navigationHeaders,overrides));
  expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM account_auth_metrics').first<any>()).n).toBe(0);
});

it('keeps an unavailable prepare metric when navigation redirects to the failure page',async()=>{
  await session();const url=await start();
  await env.DB.prepare("CREATE TRIGGER route_prepare_failure BEFORE UPDATE OF target_browser ON account_route_handoffs BEGIN SELECT RAISE(ABORT,'test prepare unavailable'); END").run();
  try{
    expectPrepareFailurePage(await request(target,url.pathname+url.search,undefined,navigationHeaders));
    const metrics=await env.DB.prepare("SELECT outcome,value FROM account_auth_metrics WHERE operation='route-prepare'").all<any>();
    expect(metrics.results).toEqual([{outcome:'unavailable',value:1}]);
    const exported=await request(source,'/internal/auth/metrics',undefined,{Authorization:'Bearer test-only'});
    const text=await exported.text();
    expect(text).toContain('hearthroom_auth_operations_total{operation="route-prepare",provider="site",outcome="unavailable"} 1');
    expect(text).not.toContain(url.searchParams.get('request'));
  }finally{await env.DB.prepare('DROP TRIGGER route_prepare_failure').run();}
});

it.each([
  {},
  {Accept:'application/json'},
  {Accept:'text/html','Sec-Fetch-Mode':'cors','Sec-Fetch-Dest':'empty'},
  {Accept:'text/html','Sec-Fetch-Mode':'navigate','Sec-Fetch-Dest':'iframe'},
  {Accept:'text/html','Sec-Fetch-Dest':'document'},
] as Record<string,string>[])('preserves JSON failure responses for API and non-top-level requests (%j)',async(headers)=>{
  const response=await request(target,'/auth/route/prepare?request=bad',undefined,headers);
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({error:'auth_route_invalid'});
});

it('supports an HTML navigation from a browser without fetch metadata',async()=>{
  expectPrepareFailurePage(await request(target,'/auth/route/prepare?request=bad',undefined,{Accept:'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'}));
});

it.each(['twa','webview','TWA','twa-extra',''])('preserves only the exact TWA display marker on a navigation failure (%s)',async(marker)=>{
  const response=await request(target,'/auth/route/prepare?'+new URLSearchParams({request:'bad',_hr_app:marker,code:'private-code',extra:'discard'}),undefined,navigationHeaders);
  expect(response.status).toBe(302);
  expect(response.headers.get('location')).toBe('/auth/route/complete'+(marker==='twa'?'?_hr_app=twa':'')+'#failed=1');
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(response.headers.get('referrer-policy')).toBe('no-referrer');
});

it('keeps the TWA display marker from changing API failure responses',async()=>{
  const response=await request(target,'/auth/route/prepare?request=bad&_hr_app=twa',undefined,{Accept:'application/json'});
  expect(response.status).toBe(400);
  expect(response.headers.get('location')).toBeNull();
  expect(await response.json()).toEqual({error:'auth_route_invalid'});
});

it('preserves the source redirect and ok metric for a successful top-level prepare',async()=>{
  await session();const url=await start();
  const response=await request(target,url.pathname+url.search,undefined,navigationHeaders);
  expect(response.status).toBe(302);
  expect(response.headers.get('location')).toBe(source+'/auth/route/issue#'+new URLSearchParams({request:url.searchParams.get('request')!}));
  const metrics=await env.DB.prepare("SELECT outcome,value FROM account_auth_metrics WHERE operation='route-prepare'").all<any>();
  expect(metrics.results).toEqual([{outcome:'ok',value:1}]);
});

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

it.each(['route-start','route-issue','route-redeem','prepare'])('rate limits %s before any auth metrics or handoff writes',async(operation)=>{
  routeLimit.mockResolvedValue({success:false});
  const path=operation==='prepare'?'/auth/route/prepare?request='+'a'.repeat(43):'/v1/auth/'+operation;
  const response=await request(source,path,operation==='prepare'?undefined:{targetOrigin:target,request:'a'.repeat(43),code:'b'.repeat(43)}, {'CF-Connecting-IP':'192.0.2.42'});
  expect(response.status).toBe(429);
  expect(routeLimit).toHaveBeenCalledWith({key:'192.0.2.42'});
  expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM account_auth_metrics').first<any>()).n).toBe(0);
  expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM account_route_handoffs').first<any>()).n).toBe(0);
});

it.each(['route-issue','route-redeem','prepare'])('rejects malformed %s values without recording auth metrics',async(operation)=>{
  const response=await request(source,operation==='prepare'?'/auth/route/prepare?request=bad':'/v1/auth/'+operation,operation==='prepare'?undefined:{request:'bad',code:'bad'});
  expect(response.status).toBe(400);
  expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM account_auth_metrics').first<any>()).n).toBe(0);
});

it.each(['route-start','route-issue','route-redeem','start','complete','session','token','logout','disconnect','adult'])('returns 400 for malformed JSON and nonobject %s bodies',async(operation)=>{
  for(const body of ['{','null','[]','"text"','42']){
    const response=await worker.fetch(new Request(source+'/v1/auth/'+operation,{method:'POST',headers:{Origin:source,'X-Hearthroom-Request':'1','Content-Type':'application/json'},body}),authEnv(),context);
    expect(response.status,operation+' '+body).toBe(400);
  }
});

it('retains a completed handoff receipt while another tab starts a switch before destination logout',async()=>{
  await session();const code=await issued(),queuedLogout={...jars[target]};
  expect((await request(target,'/v1/auth/route-redeem',{code})).status).toBe(200);
  const late={...jars[target]};
  await start(source,'https://sukisuki.chat');
  jars[target]=queuedLogout;expect((await request(target,'/v1/auth/logout',{})).status).toBe(200);
  jars[target]=late;expect((await request(target,'/v1/auth/session',{})).status).toBe(401);
});

it.each([false,true])('keeps destination browser binding stable across overlapping prepares (allRoutes=%s)',async(allRoutes)=>{
  await session();const code=await issued(),beforeRedeem={...jars[target]};
  expect((await request(target,'/v1/auth/route-redeem',{code})).status).toBe(200);
  const late={...jars[target]};jars[target]=beforeRedeem;
  await prepare(await start(source,target));
  expect((await request(target,'/v1/auth/logout',{allRoutes})).status).toBe(200);
  jars[target]=late;expect((await request(target,'/v1/auth/session',{})).status).toBe(401);
});
