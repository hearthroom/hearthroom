import { env } from 'cloudflare:test';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import worker from '../src/index';
import { upstream } from '../src/upstream';
import { resetDb } from './helpers';
import { accountAuthMaintenance, openAuth, sealAuth } from '../src/account-auth';

const origin = 'https://hearthroom.club';
const authEnv = () => ({ ...env, AUTH_ENABLED: 'true', AUTH_ALLOWED_ORIGINS: origin,
  AUTH_KEYRING: JSON.stringify({ active: 'test', keys: { test: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' } }),
  AUTH_METRICS_SECRET: 'metrics-test-only' });
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
beforeEach(async()=>{ await resetDb(); cookies={}; });
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
  return worker.fetch(new Request(origin+'/v1/me/connections'+path,{method:'POST',headers:{Origin:origin,Cookie:cookieHeader(),'X-Hearthroom-Request':'1','X-Provider':'lunatalk','Content-Type':'application/json'},body:JSON.stringify({provider,token,...choice})}),authEnv(),context);
}
async function linked(){
  await login('lunatalk',11);
  const target=await login('harbor',22,'lunatalk');
  const preview=await connection('/preview','harbor',target.token.accessToken);
  expect(preview.status).toBe(200);
  const data=await preview.json() as any;
  const choice={keepHandle:data.source.handle,sourceHandle:data.source.handle,targetHandle:data.target?.handle??null};
  const confirm=await connection('','harbor',target.token.accessToken,choice);
  expect(confirm.status).toBe(200);
  return {target,choice,profile:await confirm.json() as any};
}

it('a second clean device recovers both grants and a different account cannot retrieve either',async()=>{
  providers();const first=await linked();const browserA={...cookies};
  cookies={};await login('lunatalk',11);
  const result=await request('token',{provider:'harbor'});
  expect((await result.json() as any).accessToken).toBe(first.target.token.accessToken);
  cookies={};await login('lunatalk',99);
  expect((await request('token',{provider:'harbor'})).status).toBe(403);
  cookies=browserA;
  expect((await request('token',{provider:'harbor'})).status).toBe(200);
});

it('commits identity and credentials together, supports a lost confirmation response, and cannot cancel an already committed grant',async()=>{
  providers();const data=await linked();
  expect((await connection('','harbor',data.target.token.accessToken,data.choice)).status).toBe(200);
  expect((await request('cancel',{})).status).toBe(200);
  expect((await request('token',{provider:'harbor'})).status).toBe(200);
  expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM account_auth_revocations').first<any>()).n).toBe(0);
});

it('ciphertexts cannot be swapped between identities and retained keys decrypt older records',async()=>{
  const encrypted=await sealAuth(authEnv(),'credential:harbor:22:one',{secret:'private'});
  expect(encrypted).not.toContain('private');
  await expect(openAuth(authEnv(),'credential:lunatalk:22:one',encrypted)).rejects.toThrow('auth_credentials_unavailable');
  const rotated={...authEnv(),AUTH_KEYRING:JSON.stringify({active:'next',keys:{test:'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',next:btoa('b'.repeat(32))}})};
  expect(await openAuth(rotated,'credential:harbor:22:one',encrypted)).toEqual({secret:'private'});
});

it('stops one authorization without deleting the site session and keeps revocation retries durable',async()=>{
  const p=providers();await linked();
  const real=p.network.getMockImplementation()!;
  p.network.mockImplementation(async(input,init)=>String(input).endsWith('/oauth/revoke')?new Response('',{status:503}):real(input,init));
  const stop=await request('disconnect',{provider:'lunatalk'});
  expect(await stop.json()).toEqual({ok:true,pending:true});
  expect((await request('token',{provider:'lunatalk'})).status).toBe(401);
  expect((await request('token',{provider:'harbor'})).status).toBe(200);
  expect((await request('session',{provider:'lunatalk'})).status).toBe(200);
  expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM account_auth_revocations').first<any>()).n).toBe(1);
  p.network.mockImplementation(real);
  await env.DB.prepare('UPDATE account_auth_revocations SET retry_at=0').run();
  await accountAuthMaintenance(authEnv());
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

it('rolls the permanent link back if credential promotion fails',async()=>{
  providers();await login('lunatalk',11);const target=await login('harbor',22,'lunatalk');
  const preview=await (await connection('/preview','harbor',target.token.accessToken)).json() as any;
  await env.DB.exec("CREATE TRIGGER auth_test_reject BEFORE INSERT ON account_credentials WHEN NEW.provider='harbor' BEGIN SELECT RAISE(ABORT,'test credential failure'); END;");
  try{
    const r=await connection('','harbor',target.token.accessToken,{keepHandle:preview.source.handle,sourceHandle:preview.source.handle,targetHandle:null});
    expect(r.status).toBe(409);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM member_connections WHERE provider='harbor'").first<any>()).n).toBe(0);
    expect((await request('token',{provider:'harbor'})).status).toBe(403);
  }finally{await env.DB.exec('DROP TRIGGER auth_test_reject');}
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
