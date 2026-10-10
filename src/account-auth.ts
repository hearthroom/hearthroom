import { Hono, type Context } from 'hono';
import type { Pending } from './analytics';
import { getCookie, setCookie } from 'hono/cookie';
import { bodyLimit } from 'hono/body-limit';
import { HttpError, type Env } from './types';
import { apiBaseOf, parseProvider, requireConfigured, type ProviderId } from './providers';
import { connectedMemberId } from './connections';
import { confirmAdult, memberProfile, resolveMember, isReviewer } from './members';
import { ADULT_CONSENT_VERSION } from '../shared/adult-consent';
import { upstream } from './upstream';

/** Token-mediating backend. Only short-lived access tokens cross the browser boundary. */
type AuthContext={Bindings:Env;Variables:{ev:Pending}};
type C = Context<AuthContext>;
const DAY=86400000, ATTEMPT_TTL=10*60000, SESSION_IDLE=30*DAY, SESSION_MAX=180*DAY, SESSION_TOUCH=DAY;
const SESSION='__Host-hr-session', FLOW='__Host-hr-auth';
// profile.write：把本站的顯示名稱寫回 Harbor 當暱稱（見 syncNickname）。加這項之前，Harbor 那邊的固定客戶端要先登記它，
// 否則授權請求會因為超出客戶端的範圍被拒。
const scopes:Partial<Record<ProviderId,string>>={harbor:'profile.read profile.write email.read role.read role.write chat.play referral'};
type Pair={accessToken:string;refreshToken:string;clientId:string;expiresAt:number};
type Attempt={state_hash:string;browser_hash:string;origin:string;provider:ProviderId;source_session:string|null;payload:string;phase:string;expires_at:number};
type Session={token_hash:string;member_id:string;provider:ProviderId;external_id:string;origin:string;created_at:number;expires_at:number};
type Credential={provider:ProviderId;external_id:string;generation:string;payload:string;state:string;expires_at:number;refresh_started:number|null;updated_at:number};
type Flow={verifier:string;clientId:string;redirectUri:string;returnTo:string;linkFrom?:ProviderId;pair?:Pair;externalId?:number;resultSession?:string};
const bytes=(s:string)=>new TextEncoder().encode(s);
const base64=(a:Uint8Array)=>btoa(String.fromCharCode(...a));
const decode=(s:string)=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
const random=()=>base64(crypto.getRandomValues(new Uint8Array(32))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const hash=async(s:string)=>base64(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes(s)))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');

function ring(env:Env):{active:string;keys:Record<string,string>} {
  try {
    const r=JSON.parse(env.AUTH_KEYRING||'');
    if(!/^[a-zA-Z0-9_-]{1,32}$/.test(r.active)||!r.keys||decode(r.keys[r.active]).length!==32)throw new Error();
    return r;
  }catch{throw new HttpError(503,'auth_configuration_unavailable');}
}
export async function sealAuth(env:Env,purpose:string,value:unknown):Promise<string> {
  const r=ring(env), iv=crypto.getRandomValues(new Uint8Array(12));
  const key=await crypto.subtle.importKey('raw',decode(r.keys[r.active]),'AES-GCM',false,['encrypt']);
  const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:bytes(purpose)},key,bytes(JSON.stringify(value)));
  return JSON.stringify({key:r.active,iv:base64(iv),data:base64(new Uint8Array(ciphertext))});
}
export async function openAuth<T>(env:Env,purpose:string,payload:string):Promise<T> {
  try {
    const r=ring(env), p=JSON.parse(payload);
    const key=await crypto.subtle.importKey('raw',decode(r.keys[p.key]),'AES-GCM',false,['decrypt']);
    return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:decode(p.iv),additionalData:bytes(purpose)},key,decode(p.data))));
  }catch{throw new HttpError(503,'auth_credentials_unavailable');}
}
function origins(env:Env):string[]{return (env.AUTH_ALLOWED_ORIGINS||'').split(',').map(s=>s.trim()).filter(Boolean);}
function enabled(env:Env){
  if(env.AUTH_ENABLED!=='true')throw new HttpError(503,'auth_not_enabled');
  ring(env);
  if(!origins(env).length)throw new HttpError(503,'auth_configuration_unavailable');
}
function originOf(c:C){
  const origin=new URL(c.req.url).origin;
  if(!origin.startsWith('https://')||!origins(c.env).includes(origin))throw new HttpError(403,'auth_origin_denied');
  return origin;
}
function writeCookie(c:C,name:string,value:string,seconds:number){
  setCookie(c,name,value,{httpOnly:true,secure:true,sameSite:'Lax',path:'/',maxAge:seconds});
}
const publicPair=(pair:Pair)=>({accessToken:pair.accessToken,expiresAt:pair.expiresAt});
function providerOf(value:unknown,env:Env):ProviderId {
  if(typeof value!=='string'||!value)throw new HttpError(400,'auth_provider_required');
  return requireConfigured(env,parseProvider(value));
}
function safePath(raw:unknown):string {
  return typeof raw==='string'&&/^\/(?![\/\\])/.test(raw)&&!/[\x00-\x20\\]/.test(raw)?raw:'/';
}
export async function metric(env:Env,operation:string,provider:string,outcome:string){
  await env.DB.prepare('INSERT INTO account_auth_metrics VALUES(?,?,?,1) ON CONFLICT(operation,provider,outcome) DO UPDATE SET value=value+1').bind(operation,provider,outcome).run();
}
/**
 * 讀取請求由本站登入 session 認人，不必再跨洋問供應商「你是誰」。
 *
 * 本站 session 就是簽發供應商授權的依據（見 /v1/auth/token），所以它認出的人跟 token 是同一個；
 * 登出會當場刪掉 session，沒有「撤銷後還能用一陣子」的空窗。只給 GET／HEAD 用：寫入照舊驗
 * bearer，cookie 認人不會替寫入打開跨站請求的路。條件不符（沒開託管登入、沒 cookie、網域不對、
 * 供應商不同、綁定已換人）一律回 null，由呼叫端走原本的供應商驗證。只讀、不續期、不改 cookie。
 */
/**
 * 本站 session 認得出的讀者，連同他的成人內容設定，一次查完：session 有效、帳號仍歸這個成員、成員設定。
 * 分開問是三趟往返（每趟約 40 ms），而開頁的每支讀取都要先過這一關。
 * 只給讀取用（GET/HEAD）：寫入一律驗 Bearer，cookie 不開跨站寫入的路。
 */
export async function siteSessionReader(c:{env:Env;req:{header:(k:string)=>string|undefined;url:string;method:string}},provider:ProviderId):Promise<{accountNumId:number;memberId:string;showNsfw:number|null;ageVerifiedAt:number|null;adultConsentVersion:number|null}|null>{
  try{
    if(c.req.method!=='GET'&&c.req.method!=='HEAD')return null;
    if(c.env.AUTH_ENABLED!=='true')return null;
    const origin=new URL(c.req.url).origin;
    if(!origins(c.env).includes(origin))return null;
    const raw=(c.req.header('Cookie')||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(SESSION+'='))?.slice(SESSION.length+1);
    if(!raw)return null;
    // 歸屬的判斷跟 connectedMemberId 一樣：連結覆寫優先，沒有才用原始身分
    const row=await c.env.DB.prepare(`SELECT s.external_id,s.member_id,m.show_nsfw,m.age_verified_at,m.adult_consent_version
      FROM account_sessions s LEFT JOIN members m ON m.id=s.member_id
      WHERE s.token_hash=? AND s.origin=? AND s.expires_at>? AND s.created_at>? AND s.provider=?
        AND s.member_id=COALESCE(
          (SELECT owner_member_id FROM member_connections WHERE provider=s.provider AND external_id=s.external_id),
          (SELECT member_id FROM member_identities WHERE provider=s.provider AND external_id=s.external_id))`)
      .bind(await hash(raw),origin,Date.now(),Date.now()-SESSION_MAX,provider)
      .first<{external_id:string;member_id:string;show_nsfw:number|null;age_verified_at:number|null;adult_consent_version:number|null}>();
    if(!row)return null;
    return {accountNumId:Number(row.external_id),memberId:row.member_id,showNsfw:row.show_nsfw,ageVerifiedAt:row.age_verified_at,adultConsentVersion:row.adult_consent_version};
  }catch{return null;}
}
/**
 * 遊客的成年憑證（owner 2026-10-10：確認是成人就能看，確認不是成人就不能看，跟有沒有帳號無關）。
 * 遊客自己填生日＋同意聲明後，伺服器用 AUTH_KEYRING 封一份 {聲明版本, 驗證時間, 開關} 放進 httpOnly cookie。
 * 不放 localStorage 的旗標：榜單是伺服器在過濾，前端的旗標誰都能改。封裝帶用途（additionalData），
 * 別的地方封的東西換進來也解不開。解不開、格式不對一律當沒有。不查資料庫。
 * 生日只在確認那一下看一眼，不進憑證、不落庫。登入時帶進帳號，帶完就清掉（見 /v1/auth/complete）。
 */
const GUEST_ADULT='__Host-hr-adult', GUEST_ADULT_PURPOSE='guest-adult', GUEST_ADULT_MAX=SESSION_MAX;
type GuestAdult={consentVersion:number;verifiedAt:number;show:boolean};
export async function guestAdult(c:{env:Env;req:{header:(k:string)=>string|undefined}}):Promise<GuestAdult|null>{
  try{
    if(!c.env.AUTH_KEYRING)return null;
    const raw=(c.req.header('Cookie')||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(GUEST_ADULT+'='))?.slice(GUEST_ADULT.length+1);
    if(!raw)return null;
    const v=await openAuth<GuestAdult>(c.env,GUEST_ADULT_PURPOSE,decodeURIComponent(raw));
    if(typeof v?.consentVersion!=='number'||typeof v.verifiedAt!=='number'||typeof v.show!=='boolean')return null;
    return v;
  }catch{return null;}
}
/** 遊客現在看不看得到成人內容：驗過年齡、同意的是目前這一版聲明、開關開著。 */
export const guestAllowsNsfw=(g:GuestAdult|null)=>!!g&&g.show&&g.consentVersion===ADULT_CONSENT_VERSION;
const guestAdultView=(g:GuestAdult|null)=>({showNsfw:guestAllowsNsfw(g),ageVerified:!!g,adultConsent:g?.consentVersion===ADULT_CONSENT_VERSION});

export async function siteSessionIdentity(c:{env:Env;req:{header:(k:string)=>string|undefined;url:string;method:string}},provider:ProviderId):Promise<{accountNumId:number}|null>{
  const reader=await siteSessionReader(c,provider);
  return reader?{accountNumId:reader.accountNumId}:null;
}
async function readSession(c:C,required=true):Promise<Session|null>{
  const raw=getCookie(c,SESSION);
  const row=raw?await c.env.DB.prepare('SELECT * FROM account_sessions WHERE token_hash=? AND origin=? AND expires_at>? AND created_at>?').bind(await hash(raw),originOf(c),Date.now(),Date.now()-SESSION_MAX).first<Session>():null;
  if(!row||row.provider!=='harbor'||await connectedMemberId(c.env.DB,row.provider,Number(row.external_id))!==row.member_id){
    if(required)throw new HttpError(401,'site_session_required');
    return null;
  }
  // 閒置期限一天最多往後推一次。每個請求都寫的話，讀取複寫的工作階段一寫就得跟主庫對齊，
  // 後面的查詢全都回到跨洋往返（d1-session.ts）。30 天的閒置期，晚一天推不影響任何人。
  const extended=Math.min(Date.now()+SESSION_IDLE,row.created_at+SESSION_MAX);
  if(extended-row.expires_at>=SESSION_TOUCH)await c.env.DB.prepare('UPDATE account_sessions SET expires_at=? WHERE token_hash=?').bind(extended,row.token_hash).run();
  writeCookie(c,SESSION,raw!,Math.floor(Math.min(SESSION_IDLE,row.created_at+SESSION_MAX-Date.now())/1000));
  return row;
}
// Workers supports manual redirects; callers reject non-2xx without forwarding credentials.
async function upstreamPost(env:Env,provider:ProviderId,path:string,body:Record<string,string>):Promise<Response>{
  return fetch(apiBaseOf(env,provider)+path,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(body),redirect:'manual',signal:AbortSignal.timeout(15000)});
}
async function exchange(env:Env,provider:ProviderId,clientId:string,body:Record<string,string>):Promise<Pair>{
  let response:Response;
  try{response=await upstreamPost(env,provider,'/oauth/token',{...body,client_id:clientId,resource:apiBaseOf(env,provider)+'/open/v1'});}
  catch{throw new HttpError(503,'auth_provider_unavailable');}
  if(!response.ok){
    const error=await response.json().catch(()=>({})) as {error?:string};
    if(response.status===400&&error.error==='invalid_grant')throw new HttpError(401,'auth_reauthorization_required');
    throw new HttpError(503,'auth_provider_unavailable');
  }
  const data=await response.json() as {access_token?:string;refresh_token?:string;expires_in?:number};
  if(!data.access_token||!data.refresh_token||!Number.isFinite(data.expires_in)||data.expires_in!<=0)throw new HttpError(503,'auth_provider_unavailable');
  return {accessToken:data.access_token,refreshToken:data.refresh_token,clientId,expiresAt:Date.now()+Math.max(0,data.expires_in!-60)*1000};
}
// 客戶端決定授權與建的卡歸哪個應用。動態註冊一律落在開放生態，而且每個網域註冊出來都是
// 另一個應用（2026-09-24：加了 sukisuki 兩個網域後，授權多出好幾張、卡片全掉進 open）。
// 設了 HARBOR_CLIENT_ID 就只用它，任何網域都一樣，絕不退回註冊；新網域加在它的回呼網址上。
// 沒設（分叉自架）才維持逐網域動態註冊。
async function registeredClient(c:C,provider:ProviderId,origin:string){
  const fixed=provider==='harbor'?(c.env.HARBOR_CLIENT_ID??'').trim():'';
  if(fixed)return fixed;
  const scope=scopes[provider]!;
  let row=await c.env.DB.prepare('SELECT client_id FROM account_auth_clients WHERE origin=? AND provider=? AND scope=?').bind(origin,provider,scope).first<{client_id:string}>();
  if(row)return row.client_id;
  const response=await fetch(apiBaseOf(c.env,provider)+'/oauth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client_name:'Hearthroom',redirect_uris:[origin+'/auth/callback'],grant_types:['authorization_code','refresh_token'],token_endpoint_auth_method:'none',...(scope?{scope}:{})}),redirect:'manual',signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new HttpError(503,'auth_provider_unavailable');
  const data=await response.json() as {client_id?:string};
  if(!data.client_id)throw new HttpError(503,'auth_provider_unavailable');
  await c.env.DB.prepare('INSERT OR IGNORE INTO account_auth_clients VALUES(?,?,?,?)').bind(origin,provider,scope,data.client_id).run();
  row=await c.env.DB.prepare('SELECT client_id FROM account_auth_clients WHERE origin=? AND provider=? AND scope=?').bind(origin,provider,scope).first<{client_id:string}>();
  return row!.client_id;
}
const credentialPurpose=(p:ProviderId,id:string,generation:string)=>`credential:${p}:${id}:${generation}`;
async function queueRevocation(env:Env,provider:ProviderId,pair:Pair,generation:string){
  await env.DB.prepare('INSERT OR IGNORE INTO account_auth_revocations VALUES(?,?,?,?)').bind(generation,provider,await sealAuth(env,'revoke:'+generation,pair),Date.now()).run();
}
async function credentialStatements(env:Env,provider:ProviderId,externalId:number,pair:Pair,guard?:{attempt:Attempt;session?:Session;phase?:string}):Promise<D1PreparedStatement[]> {
  const id=String(externalId),generation=random();
  const old=await env.DB.prepare('SELECT * FROM account_credentials WHERE provider=? AND external_id=?').bind(provider,id).first<Credential>();
  const statements:D1PreparedStatement[]=[];
  if(old){
    const previous=await openAuth<Pair>(env,credentialPurpose(provider,id,old.generation),old.payload);
    statements.push(env.DB.prepare('INSERT OR IGNORE INTO account_auth_revocations VALUES(?,?,?,?)').bind(old.generation,provider,await sealAuth(env,'revoke:'+old.generation,previous),Date.now()));
  }
  const gate=guard?` AND EXISTS(SELECT 1 FROM account_auth_attempts WHERE state_hash=? AND phase=? AND expires_at>?)${guard.session?' AND EXISTS(SELECT 1 FROM account_sessions WHERE token_hash=? AND member_id=? AND expires_at>?)':''}`:'';
  const gateArgs=guard?[guard.attempt.state_hash,guard.phase??'confirm',Date.now(),...(guard.session?[guard.session.token_hash,guard.session.member_id,Date.now()]:[])]:[];
  // A NOT NULL failure rolls the whole link+promotion transaction back when a concurrent grant won.
  statements.push(env.DB.prepare(`INSERT INTO account_credentials VALUES(?,?,
    CASE WHEN COALESCE((SELECT generation FROM account_credentials WHERE provider=? AND external_id=?),'')=?${gate} THEN ? ELSE NULL END,
    ?,'active',?,NULL,?) ON CONFLICT(provider,external_id) DO UPDATE SET generation=excluded.generation,payload=excluded.payload,state='active',expires_at=excluded.expires_at,refresh_started=NULL,updated_at=excluded.updated_at`)
    .bind(provider,id,provider,id,old?.generation??'',...gateArgs,generation,await sealAuth(env,credentialPurpose(provider,id,generation),pair),pair.expiresAt,Date.now()));
  if(guard)statements.push(env.DB.prepare("UPDATE account_auth_attempts SET phase='committed' WHERE state_hash=?").bind(guard.attempt.state_hash));
  return statements;
}
async function attemptFor(c:C,state?:string):Promise<Attempt>{
  const browser=getCookie(c,FLOW);
  if(!browser)throw new HttpError(400,'auth_state_invalid');
  const query=state?'state_hash=? AND browser_hash=?':'browser_hash=?';
  const values=state?[await hash(state),await hash(browser)]:[await hash(browser)];
  const row=await c.env.DB.prepare(`SELECT * FROM account_auth_attempts WHERE ${query} AND origin=? AND expires_at>?`).bind(...values,originOf(c),Date.now()).first<Attempt>();
  if(!row||row.provider!=='harbor'||row.source_session)throw new HttpError(400,'auth_state_invalid');
  if(row.source_session){const session=await readSession(c);if(session!.token_hash!==row.source_session)throw new HttpError(401,'site_session_required');}
  return row;
}

export const accountAuthRoutes=new Hono<AuthContext>();
accountAuthRoutes.use('/auth/callback',async(c,next)=>{
  await next();
  c.header('Cache-Control','private, no-store');c.header('Referrer-Policy','no-referrer');
});
accountAuthRoutes.onError((error,c)=>{
  if(error instanceof HttpError)return c.json({error:error.message},error.status);
  return c.json({error:'auth_provider_unavailable'},503);
});
accountAuthRoutes.use('/v1/auth/*',async(c,next)=>{
  const operation=c.req.path.split('/').pop()!;
  if(!['start','complete','session','token','commit','cancel','logout','disconnect'].includes(operation)||c.env.AUTH_ENABLED!=='true'){await next();return;}
  try{await next();}finally{
    const outcome=c.res.status>=500?'unavailable':c.res.status>=400?'denied':'ok';
    try{await metric(c.env,operation,'site',outcome);}catch{console.warn('Account authorization metric unavailable');}
  }
});
accountAuthRoutes.use('/v1/auth/*',async(c,next)=>{
  c.header('Cache-Control','private, no-store');c.header('Referrer-Policy','no-referrer');
  c.header('X-Content-Type-Options','nosniff');
  if(c.req.path==='/v1/auth/config'){await next();return;}
  enabled(c.env);originOf(c);
  if(c.req.method!=='POST'||c.req.header('Origin')!==new URL(c.req.url).origin||c.req.header('X-Hearthroom-Request')!=='1')throw new HttpError(403,'auth_origin_denied');
  await next();
});
accountAuthRoutes.use('/v1/auth/*',bodyLimit({maxSize:16384,onError:c=>c.json({error:'auth_input_invalid'},400)}));
accountAuthRoutes.get('/v1/auth/config',c=>{
  if(!c.env.AUTH_ENABLED||c.env.AUTH_ENABLED==='false')return c.json({managed:false});
  if(c.env.AUTH_ENABLED!=='true')throw new HttpError(503,'auth_configuration_unavailable');
  enabled(c.env);originOf(c);return c.json({managed:true});
});
accountAuthRoutes.post('/v1/auth/start',async c=>{
  const body=await c.req.json(),provider=providerOf(body.provider,c.env),origin=originOf(c);
  if(body.linkFrom)throw new HttpError(410,'service_retired');
  const browser=random(),state=random(),stateHash=await hash(state),verifier=random();
  const clientId=await registeredClient(c,provider,origin),redirectUri=origin+'/auth/callback';
  const flow:Flow={verifier,clientId,redirectUri,returnTo:safePath(body.returnTo)};
  await c.env.DB.prepare('INSERT INTO account_auth_attempts VALUES(?,?,?,?,?,?,?,?)').bind(stateHash,await hash(browser),origin,provider,null,await sealAuth(c.env,'attempt:'+stateHash,flow),'code',Date.now()+ATTEMPT_TTL).run();
  writeCookie(c,FLOW,browser,ATTEMPT_TTL/1000);
  const url=new URL(apiBaseOf(c.env,provider)+'/oauth/authorize');
  // 玩家在這裡用的介面語言：Harbor 的登入／同意頁用它，也記成成員的語言。只收像語言標籤的值。
  const locale=typeof body.locale==='string'&&/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8}){0,2}$/.test(body.locale)?body.locale:'';
  url.search=new URLSearchParams({response_type:'code',client_id:clientId,redirect_uri:redirectUri,state,code_challenge:await hash(verifier),code_challenge_method:'S256',resource:apiBaseOf(c.env,provider)+'/open/v1',...(scopes[provider]!?{scope:scopes[provider]!}:{}),...(locale?{ui_locales:locale}:{})}).toString();
  return c.json({url:url.toString()});
});
accountAuthRoutes.post('/v1/auth/complete',async c=>{
  const body=await c.req.json();
  if(typeof body.state!=='string'||typeof body.code!=='string'||body.code.length>4096||body.state.length>128)throw new HttpError(400,'auth_state_invalid');
  const a=await attemptFor(c,body.state);
  const consumed=await c.env.DB.prepare("UPDATE account_auth_attempts SET phase='exchanging' WHERE state_hash=? AND phase='code' RETURNING state_hash").bind(a.state_hash).first();
  if(!consumed)throw new HttpError(400,'auth_state_invalid');
  const flow=await openAuth<Flow>(c.env,'attempt:'+a.state_hash,a.payload);
  const pair=await exchange(c.env,a.provider,flow.clientId,{grant_type:'authorization_code',code:body.code,redirect_uri:flow.redirectUri,code_verifier:flow.verifier});
  const stored=await c.env.DB.prepare("UPDATE account_auth_attempts SET payload=? WHERE state_hash=? AND phase='exchanging' RETURNING state_hash").bind(await sealAuth(c.env,'attempt:'+a.state_hash,{...flow,pair}),a.state_hash).first();
  if(!stored){await queueRevocation(c.env,a.provider,pair,a.state_hash);throw new HttpError(400,'auth_state_invalid');}
  const me=await upstream.fetchMe(c.env,pair.accessToken,a.provider);
  if(!Number.isSafeInteger(me.accountNumId)||me.accountNumId<=0)throw new HttpError(503,'auth_provider_unavailable');
  if(a.source_session){
    const session=await readSession(c);
    if(session!.token_hash!==a.source_session)throw new HttpError(401,'site_session_required');
    const confirmed=await c.env.DB.prepare("UPDATE account_auth_attempts SET phase='confirm',payload=? WHERE state_hash=? AND phase='exchanging' AND expires_at>? RETURNING state_hash").bind(await sealAuth(c.env,'attempt:'+a.state_hash,{...flow,pair,externalId:me.accountNumId}),a.state_hash,Date.now()).first();
    if(!confirmed)throw new HttpError(400,'auth_state_invalid');
  }else{
    const member=await resolveMember(c.env.DB,a.provider,me.accountNumId,Date.now());
    const raw=random(),sessionHash=await hash(raw),old=getCookie(c,SESSION);
    const statements=await credentialStatements(c.env,a.provider,me.accountNumId,pair,{attempt:a,phase:'exchanging'});
    statements.push(
      c.env.DB.prepare('DELETE FROM account_sessions WHERE token_hash=?').bind(old?await hash(old):''),
      c.env.DB.prepare('INSERT INTO account_sessions VALUES(?,?,?,?,?,?,?)').bind(sessionHash,member,a.provider,String(me.accountNumId),originOf(c),Date.now(),Date.now()+SESSION_IDLE),
      c.env.DB.prepare('UPDATE account_auth_attempts SET payload=? WHERE state_hash=?').bind(await sealAuth(c.env,'attempt:'+a.state_hash,{...flow,pair,resultSession:sessionHash}),a.state_hash),
    );
    // 登入前以遊客身份確認過成年：帶進帳號，帳號從此算驗過，不必再填。同意的是舊版聲明的不帶，讓他重新同意。
    // 帳號原本就驗過的不覆寫驗證時間；遊客開著開關才替帳號打開，關著就保留帳號自己的開關。
    const guest=await guestAdult(c);
    const carried=guest&&guest.consentVersion===ADULT_CONSENT_VERSION;
    if(carried)statements.push(c.env.DB.prepare(`UPDATE members SET age_verified_at=COALESCE(age_verified_at,?),adult_consent_version=?,
      adult_consented_at=CASE WHEN adult_consent_version=? THEN adult_consented_at ELSE ? END,show_nsfw=CASE WHEN ? THEN 1 WHEN adult_consent_version=? THEN show_nsfw ELSE 0 END WHERE id=?`)
      .bind(guest.verifiedAt,ADULT_CONSENT_VERSION,ADULT_CONSENT_VERSION,Date.now(),guest.show?1:0,ADULT_CONSENT_VERSION,member));
    try{await c.env.DB.batch(statements);}catch{throw new HttpError(400,'auth_state_invalid');}
    if(guest)writeCookie(c,GUEST_ADULT,'',0);
    // 本站的顯示名稱跟 Harbor 的暱稱對不上就寫回去；舊授權沒有 profile.write 會被拒，重新授權後才補得上。
    if(a.provider==='harbor'){
      const shown=await c.env.DB.prepare('SELECT display_name FROM members WHERE id=?').bind(member).first<{display_name:string|null}>();
      const name=shown?.display_name?.trim();
      if(name&&name!==(me.nickName??'').trim())syncNickname(c,pair.accessToken,name);
    }
    writeCookie(c,SESSION,raw,SESSION_IDLE/1000);
    // Keep the receipt cookie until expiry: a concurrent logout must also invalidate this session.
  }
  return c.json({token:publicPair(pair),provider:a.provider,returnTo:flow.returnTo,...(flow.linkFrom?{linkFrom:flow.linkFrom}:{})});
});
accountAuthRoutes.post('/v1/auth/commit',async c=>{
  const a=await attemptFor(c);
  if(a.phase!=='committed')throw new HttpError(409,'auth_confirmation_required');
  writeCookie(c,FLOW,'',0);return c.json({ok:true});
});
async function cancelAttempt(c:C,logout=false){
  const browser=getCookie(c,FLOW);
  if(browser){
    // Fence first and retain the encrypted snapshot until revocation is durably queued.
    const a=await c.env.DB.prepare("UPDATE account_auth_attempts SET phase=CASE WHEN phase IN ('committed','closed') THEN 'closed' ELSE 'cancelled' END WHERE browser_hash=? AND origin=? RETURNING *").bind(await hash(browser),originOf(c)).first<Attempt>();
    if(a){
      const f=await openAuth<Flow>(c.env,'attempt:'+a.state_hash,a.payload);
      if(f.pair&&a.phase==='cancelled')await queueRevocation(c.env,a.provider,f.pair,a.state_hash);
      if(logout&&f.resultSession)await c.env.DB.prepare('DELETE FROM account_sessions WHERE token_hash=?').bind(f.resultSession).run();
      await c.env.DB.prepare("DELETE FROM account_auth_attempts WHERE state_hash=? AND phase IN ('closed','cancelled')").bind(a.state_hash).run();
    }
  }
  writeCookie(c,FLOW,'',0);
}
accountAuthRoutes.post('/v1/auth/cancel',async c=>{
  await cancelAttempt(c);return c.json({ok:true});
});
/**
 * 遊客的成人內容開關，對應成員的 /v1/me/settings 那一段。沒帶 showNsfw 就只回現況。
 * 開：沒驗過年齡要帶生日且滿 18，沒同意目前這一版聲明要帶 consentVersion，不符回對應的錯、不發憑證。
 * 關：只關開關，驗證與同意留著，下次開不必再填。只收同源 POST（上面的中介層已擋）。
 */
accountAuthRoutes.post('/v1/auth/adult',async c=>{
  const body=await c.req.json().catch(()=>({})) as {showNsfw?:unknown;birthdate?:unknown;consentVersion?:unknown};
  const current=await guestAdult(c);
  if(typeof body.showNsfw!=='boolean')return c.json(guestAdultView(current));
  // 只記改開關的結果（account_auth_metrics，operation=adult：on／off／underage／invalid）。讀現況是每個訪客開首頁都會問的，不記。
  let next:GuestAdult, outcome='off';
  try{
    if(!body.showNsfw){
      if(!current)return c.json(guestAdultView(null));
      next={...current,show:false};
    }else{
      const verifiedAt=confirmAdult({ageVerifiedAt:current?.verifiedAt??null,adultConsent:current?.consentVersion===ADULT_CONSENT_VERSION},
        {birthdate:typeof body.birthdate==='string'?body.birthdate:undefined,consentVersion:typeof body.consentVersion==='number'?body.consentVersion:undefined},Date.now());
      next={consentVersion:ADULT_CONSENT_VERSION,verifiedAt,show:true};
      outcome='on';
    }
  }catch(error){
    outcome=error instanceof HttpError&&error.message==='underage'?'underage':'invalid';
    throw error;
  }finally{
    try{await metric(c.env,'adult','guest',outcome);}catch{console.warn('Guest adult metric unavailable');}
  }
  writeCookie(c,GUEST_ADULT,await sealAuth(c.env,GUEST_ADULT_PURPOSE,next),GUEST_ADULT_MAX/1000);
  return c.json(guestAdultView(next));
});
async function issueToken(c:C,session:Session,provider:ProviderId,externalId:number){
  const pair=await delegatedAccess(c.env,provider,externalId,session.member_id);
  // Logout may have completed while the provider was rotating its token.
  // Recheck membership and generation after the network wait; never release another account's token.
  const [alive,owner]=await Promise.all([
    c.env.DB.prepare('SELECT 1 FROM account_sessions WHERE token_hash=? AND expires_at>?').bind(session.token_hash,Date.now()).first(),
    connectedMemberId(c.env.DB,provider,externalId),
  ]);
  if(!alive)throw new HttpError(401,'site_session_required');
  if(owner!==session.member_id)throw new HttpError(403,'auth_connection_denied');
  return pair;
}
accountAuthRoutes.post('/v1/auth/session',async c=>{
  const started=Date.now(),phases:string[]=[];
  const session=(await readSession(c))!,body=await c.req.json();
  phases.push(`session;dur=${Date.now()-started}`);
  // 前端要求時把授權一起帶回：開頁本來是 session 回來才去要 token，兩趟往返串在一起。
  // 換不到授權（供應商那邊斷了）不影響本站 session，token 就是 null，前端照舊處理。
  // 換不到授權（供應商斷線、要重新授權）一律回 null：本站 session 不能因此失敗，否則前端會把人當成登出。
  const tokenFor=async(provider:string,externalId:number)=>{
    try{return await issueToken(c,session,providerOf(provider,c.env),externalId);}
    catch{return null;}
  };
  // 成員資料、審核人身分、授權三件事同時問。授權先用 session 上的身分開始換；
  // 成員資料回來後選出的身分若不是它（極少見：前端指定了別的供應商），再用選出的那個重換。
  const guess=body.token===true?tokenFor(session.provider,Number(session.external_id)):null;
  guess?.catch(()=>{});
  const [profile,reviewer]=await Promise.all([memberProfile(c.env.DB,session.member_id),isReviewer(c.env.DB,session.member_id)]);
  phases.push(`profile;dur=${Date.now()-started}`);
  const selected=profile!.identities.find(i=>i.provider===body.provider)??profile!.identities.find(i=>i.provider===session.provider);
  if(!selected)throw new HttpError(401,'site_session_required');
  let token:{accessToken:string;expiresAt:number}|null|undefined;
  if(guess){
    token=selected.provider===session.provider&&selected.externalId===Number(session.external_id)?await guess:await tokenFor(selected.provider,selected.externalId);
    phases.push(`token;dur=${Date.now()-started}`);
  }
  // 各段耗時（從請求開始算的毫秒數，不含任何資料），給量測開頁用。
  c.header('Server-Timing',phases.join(', '));
  return c.json({provider:selected.provider,me:{accountNumId:selected.externalId,nickName:profile!.displayName,avatar:profile!.avatarUrl},profile:{...profile!,reviewer},...(token===undefined?{}:{token})});
});
accountAuthRoutes.post('/v1/auth/token',async c=>{
  const session=(await readSession(c))!,body=await c.req.json(),provider=providerOf(body.provider,c.env);
  const profile=await memberProfile(c.env.DB,session.member_id),identity=profile?.identities.find(i=>i.provider===provider);
  if(!identity)throw new HttpError(403,'auth_connection_denied');
  return c.json(await issueToken(c,session,provider,identity.externalId));
});
accountAuthRoutes.post('/v1/auth/logout',async c=>{
  await cancelAttempt(c,true);
  const raw=getCookie(c,SESSION);
  if(raw)await c.env.DB.prepare('DELETE FROM account_sessions WHERE token_hash=?').bind(await hash(raw)).run();
  writeCookie(c,SESSION,'',0);return c.json({ok:true});
});
accountAuthRoutes.post('/v1/auth/disconnect',async c=>{
  const session=(await readSession(c))!,body=await c.req.json(),provider=providerOf(body.provider,c.env);
  const profile=await memberProfile(c.env.DB,session.member_id),identity=profile?.identities.find(i=>i.provider===provider);
  if(!identity)throw new HttpError(403,'auth_connection_denied');
  const row=await c.env.DB.prepare('SELECT * FROM account_credentials WHERE provider=? AND external_id=?').bind(provider,String(identity.externalId)).first<Credential>();
  let pending=false;
  if(row){
    const pair=await openAuth<Pair>(c.env,credentialPurpose(provider,row.external_id,row.generation),row.payload);
    // Queue first; an interrupted request is still revoked by maintenance, with generation isolation.
    await c.env.DB.batch([
      c.env.DB.prepare('INSERT OR IGNORE INTO account_auth_revocations VALUES(?,?,?,?)').bind(row.generation,provider,await sealAuth(c.env,'revoke:'+row.generation,pair),Date.now()),
      c.env.DB.prepare("UPDATE account_credentials SET state='revoked' WHERE generation=?").bind(row.generation),
    ]);
    pending=!await revokeQueued(c.env,row.generation);
  }
  return c.json({ok:true,pending});
});
async function revokeQueued(env:Env,generation:string):Promise<boolean>{
  const row=await env.DB.prepare('SELECT * FROM account_auth_revocations WHERE generation=?').bind(generation).first<{provider:ProviderId;payload:string}>();
  if(!row)return true;
  try{
    const pair=await openAuth<Pair>(env,'revoke:'+generation,row.payload);
    const response=await upstreamPost(env,row.provider,'/oauth/revoke',{token:pair.refreshToken,client_id:pair.clientId});
    if(!response.ok)throw new Error();
    await env.DB.batch([
      env.DB.prepare('DELETE FROM account_auth_revocations WHERE generation=?').bind(generation),
      env.DB.prepare("DELETE FROM account_credentials WHERE generation=? AND state='revoked'").bind(generation),
    ]);
    return true;
  }catch{
    await env.DB.prepare('UPDATE account_auth_revocations SET retry_at=? WHERE generation=?').bind(Date.now()+60000,generation).run();
    return false;
  }
}
export async function accountAuthMaintenance(env:Env){
  if(!env.AUTH_KEYRING)return;
  const expired=await env.DB.prepare("UPDATE account_auth_attempts SET phase=CASE WHEN phase IN ('committed','closed') THEN 'closed' ELSE 'cancelled' END WHERE state_hash IN (SELECT state_hash FROM account_auth_attempts WHERE provider='harbor' AND expires_at<=? ORDER BY expires_at LIMIT 50) RETURNING *").bind(Date.now()).all<Attempt>();
  for(const a of expired.results){
    const flow=await openAuth<Flow>(env,'attempt:'+a.state_hash,a.payload);
    if(flow.pair&&a.phase==='cancelled')await queueRevocation(env,a.provider,flow.pair,a.state_hash);
    await env.DB.prepare("DELETE FROM account_auth_attempts WHERE state_hash=? AND phase IN ('closed','cancelled')").bind(a.state_hash).run();
  }
  const jobs=await env.DB.prepare("SELECT generation FROM account_auth_revocations WHERE provider='harbor' AND retry_at<=? ORDER BY retry_at LIMIT 50").bind(Date.now()).all<{generation:string}>();
  for(const job of jobs.results)await revokeQueued(env,job.generation);
  await env.DB.prepare('DELETE FROM account_sessions WHERE expires_at<=? OR created_at<=?').bind(Date.now(),Date.now()-SESSION_MAX).run();
  await metric(env,'cleanup','site','ok');
}
accountAuthRoutes.get('/internal/auth/metrics',async c=>{
  if(!c.env.AUTH_METRICS_SECRET||c.req.header('Authorization')!==`Bearer ${c.env.AUTH_METRICS_SECRET}`)throw new HttpError(401,'unauthorized');
  const rows=await c.env.DB.prepare('SELECT * FROM account_auth_metrics').all<{operation:string;provider:string;outcome:string;value:number}>();
  c.header('Cache-Control','no-store');
  return c.text('# TYPE hearthroom_auth_operations_total counter\n'+rows.results.map(r=>`hearthroom_auth_operations_total{operation="${r.operation}",provider="${r.provider}",outcome="${r.outcome}"} ${r.value}`).join('\n')+'\n');
});

/** Internal operator reuse of the same fenced credential refresh; never an HTTP token export. */
/** 背景寫回暱稱，不擋回應；結果記進 hearthroom_auth_operations_total{operation="nickname_sync"}。 */
export function syncNickname(c:{env:Env;executionCtx:{waitUntil(p:Promise<unknown>):void}},token:string,name:string){
  const done=upstream.setNickname(c.env,token,'harbor',name).then(outcome=>metric(c.env,'nickname_sync','harbor',outcome)).catch(()=>{});
  try{c.executionCtx.waitUntil(done);}catch{/* 沒有執行環境（測試）就讓它自己跑完 */}
}

/** 一次換發最久要多久；認領超過這個時間還沒放掉，就當那個請求已經死了。 */
const REFRESH_CLAIM_MS=30_000;
export async function delegatedAccess(env:Env,provider:ProviderId,externalId:number,memberId:string){
  const id=String(externalId);
  const read=()=>env.DB.prepare('SELECT * FROM account_credentials WHERE provider=? AND external_id=?').bind(provider,id).first<Credential>();
  // 兩件互不相依的讀取同時問，少一趟往返。
  const [owner,first]=await Promise.all([connectedMemberId(env.DB,provider,externalId),read()]);
  if(owner!==memberId)throw new HttpError(403,'auth_connection_denied');
  let row=first;
  // uncertain：上一次換發送出去了卻沒拿到回應，refresh token 可能已被用掉，不能重放；它自己也好不了，
  // 所以直接要求重新授權，而不是回一個看起來會好、其實永遠 503 的錯誤。
  if(!row||row.state==='revoked'||row.state==='uncertain')throw new HttpError(401,'auth_reauthorization_required');
  if(row.state!=='active')throw new HttpError(503,'auth_provider_unavailable');
  let pair=await openAuth<Pair>(env,credentialPurpose(provider,id,row.generation),row.payload);
  // 「換發中」只會出現在已過期的那份上。複本可能停在別人換到一半的時候，主庫其實早就換好了：
  // 交給下面的認領去問主庫——換好了就認領不到、重讀拿新的；真的還在換，重讀一樣是 503。
  if(row.refresh_started!==null&&pair.expiresAt>Date.now())throw new HttpError(503,'auth_provider_unavailable');
  if(pair.expiresAt<=Date.now()){
    // 這一列可能是複本上的舊版（讀取複寫，見 d1-session.ts）：別的請求也許已經換發過了。
    // 拿著舊的 refresh token 去換會被供應商拒絕，下面的 denied 分支就會把整份授權刪掉。
    // 所以認領時連 expires_at 一起比對——主庫上的已經不是我們讀到的那份，就認領不到；
    // 認領寫過主庫之後，同一個工作階段再讀一定是最新的，那份還有效就直接用。
    const claim=async(r:Credential)=>!!await env.DB.prepare("UPDATE account_credentials SET refresh_started=? WHERE provider=? AND external_id=? AND generation=? AND state='active' AND refresh_started IS NULL AND expires_at=? RETURNING generation").bind(Date.now(),provider,id,r.generation,r.expires_at).first();
    let claimed=await claim(row);
    if(!claimed){
      const fresh=await read();
      if(!fresh||fresh.state==='revoked'||fresh.state==='uncertain')throw new HttpError(401,'auth_reauthorization_required');
      // 認領超過換發的時限還沒放掉：那個請求死在半路，跟 uncertain 一樣不知道 refresh token 用掉沒。
      if(fresh.refresh_started!==null&&Date.now()-fresh.refresh_started>REFRESH_CLAIM_MS)throw new HttpError(401,'auth_reauthorization_required');
      if(fresh.state!=='active'||fresh.refresh_started!==null||fresh.generation!==row.generation)throw new HttpError(503,'auth_provider_unavailable');
      row=fresh;
      pair=await openAuth<Pair>(env,credentialPurpose(provider,id,row.generation),row.payload);
      if(pair.expiresAt<=Date.now())claimed=await claim(row);
      else claimed=true;
    }
    if(!claimed)throw new HttpError(503,'auth_provider_unavailable');
  }
  if(pair.expiresAt<=Date.now()){
    try{
      pair=await exchange(env,provider,pair.clientId,{grant_type:'refresh_token',refresh_token:pair.refreshToken});
      const saved=await env.DB.prepare("UPDATE account_credentials SET payload=?,expires_at=?,refresh_started=NULL,updated_at=? WHERE provider=? AND external_id=? AND generation=? AND state='active' RETURNING generation").bind(await sealAuth(env,credentialPurpose(provider,id,row.generation),pair),pair.expiresAt,Date.now(),provider,id,row.generation).first();
      if(!saved){await queueRevocation(env,provider,pair,random());throw new HttpError(401,'auth_reauthorization_required');}
      await metric(env,'refresh',provider,'ok');
    }catch(e){
      const denied=e instanceof HttpError&&e.status===401;
      if(denied)await env.DB.prepare('DELETE FROM account_credentials WHERE generation=?').bind(row.generation).run();
      else await env.DB.prepare("UPDATE account_credentials SET state='uncertain' WHERE generation=? AND state='active'").bind(row.generation).run();
      await metric(env,'refresh',provider,denied?'denied':'unavailable');throw e;
    }
  }
  const [ownerAfter,stillValid]=await Promise.all([
    connectedMemberId(env.DB,provider,externalId),
    env.DB.prepare("SELECT 1 FROM account_credentials WHERE provider=? AND external_id=? AND generation=? AND state='active'").bind(provider,id,row.generation).first(),
  ]);
  if(ownerAfter!==memberId)throw new HttpError(403,'auth_connection_denied');
  if(!stillValid)throw new HttpError(401,'auth_reauthorization_required');
  return publicPair(pair);
}
