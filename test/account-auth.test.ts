import { env } from 'cloudflare:test';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import worker from '../src/index';
import { upstream } from '../src/upstream';
import { resetDb } from './helpers';
import { accountAuthMaintenance, openAuth, sealAuth } from '../src/account-auth';

const origin = 'https://hearthroom.club';
const authEnv = () => ({ ...env, AUTH_ENABLED: 'true', AUTH_ALLOWED_ORIGINS: origin,
  AUTH_KEYRING: JSON.stringify({ active: 'test', keys: { test: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' } }),
  AUTH_METRICS_SECRET: 'metrics-test-only', ...envOverride });
// 預設模擬沒設固定客戶端的自架部署（動態註冊路徑）；固定客戶端的測試自己設。
let envOverride: Record<string, string> = {HARBOR_CLIENT_ID:''};
const context = { waitUntil: (_p: Promise<unknown>) => {}, passThroughOnException() {} } as ExecutionContext;
let cookies: Record<string, string> = {};
function cookieHeader() { return Object.entries(cookies).map(([k,v])=>`${k}=${v}`).join('; '); }
async function request(path: string, body?: unknown, extra: Record<string,string> = {}) {
  const response = await worker.fetch(new Request(origin + '/v1/auth/' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Origin: origin, 'X-Hearthroom-Request': '1', Cookie: cookieHeader(), 'Content-Type':'application/json', ...extra },
    ...(body === undefined ? {} : {body: JSON.stringify(body)}),
  }), authEnv(), context);
  for (const c of response.headers.getSetCookie()) {
    const pair = c.split(';')[0]; const eq = pair.indexOf('='); cookies[pair.slice(0,eq)]=pair.slice(eq+1);
  }
  return response;
}
beforeEach(async()=>{ await resetDb(); cookies={}; envOverride={HARBOR_CLIENT_ID:''}; });
afterEach(()=>vi.restoreAllMocks());

it('advertises managed auth only with complete configuration and rejects cross-origin starts', async()=>{
  expect(await (await request('config')).json()).toEqual({managed:true});
  const r=await request('start',{provider:'harbor',returnTo:'/me'},{Origin:'https://attacker.test'});
  expect(r.status).toBe(403);
});

function providers(){
  let serial=0;
  const identity=new Map<string,number>();
  vi.spyOn(upstream,'fetchMe').mockImplementation(async(_env,token)=>{
    const id=identity.get(token);if(!id)throw new Error('invalid access');
    return {accountNumId:id,nickName:'Test account',avatar:''};
  });
  vi.spyOn(upstream,'fetchMyRoles').mockResolvedValue({items:[],hasNext:false} as any);
  const network=vi.spyOn(globalThis,'fetch').mockImplementation(async(input,init)=>{
    // Match the production Workers fetch boundary: redirect:error throws before I/O.
    if(init?.redirect==='error')throw new TypeError('Workers fetch only supports follow or manual redirects');
    const url=String(input);
    if(url.endsWith('/oauth/register'))return Response.json({client_id:url.includes('harperharbor')?'harbor-client':'luna-client'});
    if(url.endsWith('/oauth/revoke'))return new Response('',{status:200});
    if(url.endsWith('/oauth/token')){
      const body=new URLSearchParams(String(init?.body)),id=Number(body.get('code')||'22');
      const accessToken=`test-access-${++serial}`;identity.set(accessToken,id);
      return Response.json({access_token:accessToken,refresh_token:`test-refresh-${serial}`,expires_in:3600});
    }
    throw new Error('unexpected upstream');
  });
  return {network,identity};
}
async function login(provider:string,id:number,linkFrom?:string){
  const start=await request('start',{provider,returnTo:'/me',linkFrom});
  expect(start.status).toBe(200);
  const url=new URL((await start.json() as any).url);
  const response=await request('complete',{code:String(id),state:url.searchParams.get('state')});
  expect(response.status).toBe(200);
  return response.json() as Promise<any>;
}
async function connection(path:string,provider:string,token:string,choice={}){
  return worker.fetch(new Request(origin+'/v1/me/connections'+path,{method:'POST',headers:{Origin:origin,Cookie:cookieHeader(),'X-Hearthroom-Request':'1','X-Provider':'harbor','Content-Type':'application/json'},body:JSON.stringify({provider,token,...choice})}),authEnv(),context);
}
it('recovers the Harbor grant on a clean device without exposing another account',async()=>{
 const p=providers();await login('harbor',22);cookies={};await login('harbor',22);
 const a=await (await request('token',{provider:'harbor'})).json() as any;
 expect(p.identity.get(a.accessToken)).toBe(22);
 cookies={};await login('harbor',99);
 const b=await (await request('token',{provider:'harbor'})).json() as any;
 expect(p.identity.get(b.accessToken)).toBe(99);expect(b.accessToken).not.toBe(a.accessToken);
});
it('ciphertexts cannot be swapped between accounts and old keys remain readable',async()=>{
 const encrypted=await sealAuth(authEnv(),'credential:harbor:22:one',{secret:'private'});
 await expect(openAuth(authEnv(),'credential:harbor:99:one',encrypted)).rejects.toThrow('auth_credentials_unavailable');
 const rotated={...authEnv(),AUTH_KEYRING:JSON.stringify({active:'next',keys:{test:'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',next:btoa('b'.repeat(32))}})};
 expect(await openAuth(rotated,'credential:harbor:22:one',encrypted)).toEqual({secret:'private'});
});
it('keeps revocation retries durable without deleting the community session',async()=>{
 const p=providers();await login('harbor',22);const real=p.network.getMockImplementation()!;
 p.network.mockImplementation(async(input,init)=>String(input).endsWith('/oauth/revoke')?new Response('',{status:503}):real(input,init));
 expect(await (await request('disconnect',{provider:'harbor'})).json()).toEqual({ok:true,pending:true});
 expect((await request('token',{provider:'harbor'})).status).toBe(401);
 expect((await request('session',{provider:'harbor'})).status).toBe(200);
 expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM account_auth_revocations').first<any>()).n).toBe(1);
 p.network.mockImplementation(real);await env.DB.prepare('UPDATE account_auth_revocations SET retry_at=0').run();await accountAuthMaintenance(authEnv());
 expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM account_auth_revocations').first<any>()).n).toBe(0);
});

it('requires CSRF protection even for token reads, denies unconfigured origins, and never logs secrets in metrics',async()=>{
  providers();await login('harbor',22);
  expect((await request('token',{provider:'harbor'},{'X-Hearthroom-Request':''})).status).toBe(403);
  const r=await worker.fetch(new Request(origin+'/internal/auth/metrics',{headers:{Authorization:'Bearer metrics-test-only'}}),authEnv(),context);
  const text=await r.text();expect(text).toContain('hearthroom_auth_operations_total');expect(text).not.toContain('test-access');expect(text).not.toContain('22');
  const config=await worker.fetch(new Request('https://attacker.test/v1/auth/config'),authEnv(),context);
  expect(config.status).toBe(403);
});

async function expire(provider='harbor'){
  const row=await env.DB.prepare('SELECT * FROM account_credentials WHERE provider=?').bind(provider).first<any>();
  const purpose=`credential:${provider}:${row.external_id}:${row.generation}`;
  const pair=await openAuth<any>(authEnv(),purpose,row.payload);pair.expiresAt=0;
  await env.DB.prepare('UPDATE account_credentials SET expires_at=0,payload=? WHERE generation=?').bind(await sealAuth(authEnv(),purpose,pair),row.generation).run();
  return row;
}
it('uses edge-supported non-following requests for registration, exchange, refresh and revoke',async()=>{
  const p=providers();await login('harbor',22);await expire();
  expect((await request('token',{provider:'harbor'})).status).toBe(200);
  expect((await request('disconnect',{provider:'harbor'})).status).toBe(200);
  expect(p.network.mock.calls.map(([url])=>new URL(String(url)).pathname)).toEqual([
    '/oauth/register','/oauth/token','/oauth/token','/oauth/revoke',
  ]);
  for(const [,init] of p.network.mock.calls)expect(init?.redirect).toBe('manual');
});

it('rejects a provider registration redirect without creating a flow or sending another request',async()=>{
  const p=providers();
  p.network.mockResolvedValue(new Response(null,{status:307,headers:{Location:'https://attacker.test/receive'}}));
  expect((await request('start',{provider:'harbor'})).status).toBe(503);
  expect(p.network).toHaveBeenCalledTimes(1);
  expect(p.network.mock.calls[0][1]?.redirect).toBe('manual');
  expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM account_auth_attempts').first<any>()).n).toBe(0);
});

it('rejects a token endpoint redirect without sending the authorization code to its destination',async()=>{
  const p=providers();
  const started=await request('start',{provider:'harbor'});
  const state=new URL((await started.json() as any).url).searchParams.get('state');
  p.network.mockResolvedValue(new Response(null,{status:307,headers:{Location:'https://attacker.test/receive'}}));
  expect((await request('complete',{code:'private-code',state})).status).toBe(503);
  expect(p.network).toHaveBeenCalledTimes(2);
  expect(p.network.mock.calls[1][1]?.redirect).toBe('manual');
  expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM account_credentials').first<any>()).n).toBe(0);
});

it('serializes refresh across requests and rejects a late response after logout',async()=>{
  const p=providers();await login('harbor',22);await expire();
  const real=p.network.getMockImplementation()!;
  let release!:(r:Response)=>void,started!:()=>void;
  const entered=new Promise<void>(r=>{started=r;});
  p.network.mockImplementation(async(input,init)=>{
    if(String(input).endsWith('/oauth/token')){started();return new Promise<Response>(r=>{release=r;});}
    return real(input,init);
  });
  const refreshing=request('token',{provider:'harbor'});await entered;
  expect((await request('token',{provider:'harbor'})).status).toBe(503);
  await request('logout',{});
  release(Response.json({access_token:'late-access',refresh_token:'rotated-refresh',expires_in:3600}));
  expect((await refreshing).status).toBe(401);
  expect(p.network.mock.calls.filter(([url])=>String(url).endsWith('/oauth/token'))).toHaveLength(2); // login + one refresh
});

it('does not replay an ambiguously consumed refresh token after network failure',async()=>{
  const p=providers();await login('harbor',22);const old=await expire();
  p.network.mockRejectedValue(new TypeError('network unavailable'));
  expect((await request('token',{provider:'harbor'})).status).toBe(503);
  expect((await request('token',{provider:'harbor'})).status).toBe(503);
  const row=await env.DB.prepare('SELECT * FROM account_credentials WHERE generation=?').bind(old.generation).first<any>();
  expect(row.state).toBe('uncertain');expect(row.payload).not.toBe('');
  expect(p.network.mock.calls.filter(([url])=>String(url).endsWith('/oauth/token'))).toHaveLength(2);
});

it('old revocation work cannot erase a newly authorized generation',async()=>{
  const p=providers();await login('harbor',22);const old=await env.DB.prepare('SELECT generation FROM account_credentials').first<any>();
  await login('harbor',22);
  const current=await env.DB.prepare('SELECT generation FROM account_credentials').first<any>();
  expect(current.generation).not.toBe(old.generation);
  await accountAuthMaintenance(authEnv());
  expect((await env.DB.prepare('SELECT generation FROM account_credentials').first<any>()).generation).toBe(current.generation);
  expect((await request('token',{provider:'harbor'})).status).toBe(200);
});

it('rejects retired login before creating an authorization attempt',async()=>{
 const p=providers();expect((await request('start',{provider:'lunatalk'})).status).toBe(400);
 expect(p.network).not.toHaveBeenCalled();
});

it('requires a site session before exposing any provider credential', async()=>{
  const r=await request('token',{provider:'harbor'});
  expect(r.status).toBe(401);
  expect(await r.json()).toEqual({error:'site_session_required'});
});

it('exchanges a cookie-bound code on the backend and never returns refresh credentials', async()=>{
  vi.spyOn(upstream,'fetchMe').mockResolvedValue({accountNumId:22} as any);
  const network=vi.spyOn(globalThis,'fetch').mockImplementation(async(input,init)=>{
    const url=String(input);
    if(url.endsWith('/oauth/register'))return Response.json({client_id:'site-client'});
    if(url.endsWith('/oauth/token'))return Response.json({access_token:'access-private',refresh_token:'refresh-private',expires_in:3600});
    throw new Error('unexpected upstream');
  });
  const start=await request('start',{provider:'harbor',returnTo:'/me'});
  expect(start.status).toBe(200);
  const url=new URL((await start.json() as any).url);
  expect(url.origin).toBe('https://api.harperharbor.com');
  expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  const browserA={...cookies}; cookies={};
  expect((await request('complete',{code:'valid-code',state:url.searchParams.get('state')})).status).toBe(400);
  cookies=browserA;
  const complete=await request('complete',{code:'valid-code',state:url.searchParams.get('state')});
  expect(complete.status).toBe(200);
  const data=await complete.json() as any;
  expect(data.token.accessToken).toBe('access-private');
  expect(JSON.stringify(data)).not.toContain('refresh-private');
  expect(complete.headers.get('Set-Cookie')).toContain('HttpOnly');
  expect(complete.headers.get('Set-Cookie')).toContain('Secure');
  const rows=await env.DB.prepare('SELECT * FROM account_credentials').all();
  expect(JSON.stringify(rows)).not.toContain('refresh-private');
  expect(JSON.stringify(rows)).not.toContain('access-private');
  expect((await request('complete',{code:'valid-code',state:url.searchParams.get('state')})).status).toBe(400);
  expect((await request('token',{provider:'harbor'})).status).toBe(200);
  expect((await request('logout',{})).status).toBe(200);
  expect((await request('token',{provider:'harbor'})).status).toBe(401);
  expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM account_credentials').first<any>()).n).toBe(1);
  expect(network.mock.calls.some(([url])=>String(url).includes('/revoke'))).toBe(false);
});


it.each(['cancel','logout'])('cannot finish a login after %s while the code exchange is in flight',async(action)=>{
  const p=providers();
  const start=await request('start',{provider:'harbor'});
  const url=new URL((await start.json() as any).url);
  const real=p.network.getMockImplementation()!;
  let release!:(r:Response)=>void,entered!:()=>void;
  const started=new Promise<void>(r=>{entered=r;});
  p.network.mockImplementation(async(input,init)=>{
    if(String(input).endsWith('/oauth/token')){entered();return new Promise<Response>(r=>{release=r;});}
    return real(input,init);
  });
  const completing=request('complete',{code:'22',state:url.searchParams.get('state')});
  await started;await request(action,{});
  p.identity.set('cancelled-access',22);
  release(Response.json({access_token:'cancelled-access',refresh_token:'cancelled-refresh',expires_in:3600}));
  expect((await completing).status).toBe(400);
  expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM account_sessions').first<any>()).n).toBe(0);
  expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM account_credentials').first<any>()).n).toBe(0);
  expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM account_auth_revocations').first<any>()).n).toBe(1);
});


it('fails closed during a managed-auth rollback pause instead of returning to browser storage',async()=>{
  const response=await worker.fetch(new Request(origin+'/v1/auth/config'),{...authEnv(),AUTH_ENABLED:'paused'},context);
  expect(response.status).toBe(503);
  expect(await response.json()).not.toEqual({managed:false});
});

it('keeps authorization callback URLs out of referrers and caches',async()=>{
  const response=await worker.fetch(new Request(origin+'/auth/callback?code=synthetic&state=synthetic'),authEnv(),context);
  expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
  expect(response.headers.get('Cache-Control')).toContain('no-store');
});

// 客戶端決定授權與建的卡歸哪個應用。動態註冊一律落在開放生態，而且每個網域註冊出來都算
// 另一個應用：多一個網域，使用者的授權就多一張，建的卡也掉到別處。設了固定客戶端就只用它。
it('uses the configured Harbor client for every origin and never registers one',async()=>{
  envOverride={HARBOR_CLIENT_ID:'hh_client_hearthroom'};
  const {network}=providers();
  // 以前替這個網域註冊過的那顆還在表裡，也不能再拿來用
  await env.DB.prepare('INSERT INTO account_auth_clients VALUES(?,?,?,?)').bind(origin,'harbor','profile.read email.read role.read role.write chat.play','client-old-open').run();
  const start=await request('start',{provider:'harbor',returnTo:'/me'});
  expect(start.status).toBe(200);
  const url=new URL((await start.json() as any).url);
  expect(url.searchParams.get('client_id')).toBe('hh_client_hearthroom');
  const complete=await request('complete',{code:'22',state:url.searchParams.get('state')});
  expect(complete.status).toBe(200);
  const urls=network.mock.calls.map(([input])=>String(input));
  expect(urls.some(u=>u.endsWith('/oauth/register'))).toBe(false);
  const token=network.mock.calls.find(([input])=>String(input).endsWith('/oauth/token'));
  expect(new URLSearchParams(String(token?.[1]?.body)).get('client_id')).toBe('hh_client_hearthroom');
});

// 讀取複寫：第一次讀授權可能讀到複本上的舊版（src/d1-session.ts）。
function staleCredentialRead(db:D1Database,stale:Record<string,unknown>):D1Database{
  let served=false;
  const wrap=(target:any):any=>({
    prepare(query:string){
      if(!served&&query.startsWith('SELECT * FROM account_credentials')){
        served=true;
        return {bind:()=>({first:async()=>stale})};
      }
      return target.prepare(query);
    },
    batch:(statements:D1PreparedStatement[])=>target.batch(statements),
    getBookmark:()=>target.getBookmark?.()??null,
    withSession:(constraint:string)=>wrap(target.withSession(constraint)),
  });
  return wrap(db);
}
it('does not spend a rotated refresh token when a replica returns the credential from before another refresh',async()=>{
  const p=providers();await login('harbor',22);
  const current=await env.DB.prepare('SELECT * FROM account_credentials WHERE provider=?').bind('harbor').first<any>();
  const purpose=`credential:harbor:${current.external_id}:${current.generation}`;
  const live=await openAuth<any>(authEnv(),purpose,current.payload);
  // 舊版：已過期、帶著已經被換掉的 refresh token。主庫上的是換發後那份。
  const stale={...current,expires_at:0,payload:await sealAuth(authEnv(),purpose,{...live,refreshToken:'rotated-away',expiresAt:0})};
  const real=p.network.getMockImplementation()!;
  p.network.mockImplementation(async(input,init)=>{
    if(String(input).endsWith('/oauth/token')&&new URLSearchParams(String(init?.body)).get('refresh_token')==='rotated-away')
      return Response.json({error:'invalid_grant'},{status:400});
    return real(input,init);
  });
  const before=p.network.mock.calls.length;
  const response=await worker.fetch(new Request(origin+'/v1/auth/token',{method:'POST',
    headers:{Origin:origin,'X-Hearthroom-Request':'1',Cookie:cookieHeader(),'Content-Type':'application/json'},body:JSON.stringify({provider:'harbor'})}),
    {...authEnv(),DB:staleCredentialRead(env.DB,stale)} as any,context);
  expect(response.status).toBe(200);
  expect((await response.json() as any).accessToken).toBe(live.accessToken);
  expect(p.network.mock.calls.length).toBe(before);
  expect(await env.DB.prepare('SELECT 1 FROM account_credentials WHERE generation=?').bind(current.generation).first()).not.toBeNull();
});
it('extends the idle session deadline at most once a day',async()=>{
  providers();await login('harbor',22);
  const read=async()=>(await env.DB.prepare('SELECT expires_at FROM account_sessions').first<any>()).expires_at as number;
  const first=await read();
  expect((await request('session',{provider:'harbor'})).status).toBe(200);
  expect(await read()).toBe(first);
  await env.DB.prepare('UPDATE account_sessions SET expires_at=expires_at-?').bind(2*86400000).run();
  expect((await request('session',{provider:'harbor'})).status).toBe(200);
  expect(await read()).toBeGreaterThanOrEqual(first);
});
it('uses the refreshed credential when a replica still shows another refresh in progress',async()=>{
  const p=providers();await login('harbor',22);
  const current=await env.DB.prepare('SELECT * FROM account_credentials WHERE provider=?').bind('harbor').first<any>();
  const purpose=`credential:harbor:${current.external_id}:${current.generation}`;
  const live=await openAuth<any>(authEnv(),purpose,current.payload);
  // 複本停在別的請求換發到一半：舊的那份已過期、正在換。主庫上已經換好了。
  const stale={...current,expires_at:0,refresh_started:Date.now()-1000,payload:await sealAuth(authEnv(),purpose,{...live,refreshToken:'rotated-away',expiresAt:0})};
  const before=p.network.mock.calls.length;
  const response=await worker.fetch(new Request(origin+'/v1/auth/token',{method:'POST',
    headers:{Origin:origin,'X-Hearthroom-Request':'1',Cookie:cookieHeader(),'Content-Type':'application/json'},body:JSON.stringify({provider:'harbor'})}),
    {...authEnv(),DB:staleCredentialRead(env.DB,stale)} as any,context);
  expect(response.status).toBe(200);
  expect((await response.json() as any).accessToken).toBe(live.accessToken);
  expect(p.network.mock.calls.length).toBe(before);
});
it('still reports a refresh that is really in progress as temporarily unavailable',async()=>{
  providers();await login('harbor',22);await expire();
  await env.DB.prepare('UPDATE account_credentials SET refresh_started=?').bind(Date.now()).run();
  expect((await request('token',{provider:'harbor'})).status).toBe(503);
});

async function member(path:string,token:string,init:RequestInit={}){
  return worker.fetch(new Request(origin+path,{...init,headers:{Origin:origin,Cookie:cookieHeader(),Authorization:`Bearer ${token}`,'X-Provider':'harbor','Content-Type':'application/json',...(init.headers||{})}}),authEnv(),context);
}
it('identifies signed-in readers by the site session instead of asking the provider on every read',async()=>{
  providers();await login('harbor',22);
  const token=(await (await request('token',{provider:'harbor'})).json() as any).accessToken;
  const fetchMe=vi.mocked(upstream.fetchMe);fetchMe.mockClear();
  // 讀取：本站 session 就認得出來，不跨洋問供應商。
  expect((await member('/v1/review/me',token)).status).toBe(200);
  expect(fetchMe).not.toHaveBeenCalled();
  // 寫入：照舊驗 bearer，cookie 不替寫入認人。
  await member('/v1/me/cards/role-x/saves/slot',token,{method:'PUT',body:JSON.stringify({value:{a:1}})});
  expect(fetchMe).toHaveBeenCalledTimes(1);
  // 沒有 session 的讀取：照舊驗 bearer。
  fetchMe.mockClear();const saved=cookies;cookies={};
  expect((await member('/v1/review/me',token)).status).toBe(200);
  expect(fetchMe).toHaveBeenCalledTimes(1);
  // 登出之後，舊 cookie 不再認人。
  cookies=saved;expect((await request('logout',{})).status).toBe(200);cookies=saved;fetchMe.mockClear();
  await member('/v1/review/me',token);
  expect(fetchMe).toHaveBeenCalledTimes(1);
});
it('does not name a member after the handle when the reader was identified by the site session',async()=>{
  providers();await login('harbor',22);
  const token=(await (await request('token',{provider:'harbor'})).json() as any).accessToken;
  await env.DB.prepare('UPDATE members SET display_name=NULL').run();
  expect((await member('/v1/review/me',token)).status).toBe(200);
  expect((await env.DB.prepare('SELECT display_name FROM members').first<any>()).display_name).toBeNull();
});
it('returns the access token with the session only when asked, and not after the provider link is gone',async()=>{
  const p=providers();await login('harbor',22);
  const plain=await (await request('session',{provider:'harbor'})).json() as any;
  expect('token' in plain).toBe(false);
  const withToken=await (await request('session',{provider:'harbor',token:true})).json() as any;
  expect(p.identity.get(withToken.token.accessToken)).toBe(22);
  expect(withToken.token.refreshToken).toBeUndefined();
  // 供應商那邊的授權沒了：session 照樣回來，token 是 null，前端照舊處理。
  const real=p.network.getMockImplementation()!;
  p.network.mockImplementation(async(input,init)=>String(input).endsWith('/oauth/revoke')?new Response('',{status:200}):real(input,init));
  expect((await request('disconnect',{provider:'harbor'})).status).toBe(200);
  const after=await request('session',{provider:'harbor',token:true});
  expect(after.status).toBe(200);
  expect((await after.json() as any).token).toBeNull();
});
