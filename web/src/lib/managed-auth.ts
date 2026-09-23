import { PROVIDERS, type ProviderId } from './provider';
import type { TokenPair } from './oauth';
import { clearStageStorage } from './stage-storage';

let mode: boolean | undefined;
let loading: Promise<boolean> | undefined;
let epoch=0;
let loggedOut=false;
const stopped=new Set<ProviderId>();
const versions=new Map<ProviderId,number>();
const tokens=new Map<ProviderId,TokenPair&{issuedAt:number}>();
/**
 * 同一張 access token 在這段時間內直接重用，不再問伺服器。
 * 每次都問的代價是每個請求前多一趟往返：內嵌聊天的每支 API 都會先要 token，開場十幾支
 * 疊成十幾秒（玩家回報 2026-09-23）。供應商發的 token 以小時計，五分鐘內另一台設備換綁
 * 才會讓這張過時；那時供應商會拒絕它，由 dropManagedToken 丟掉再換。
 */
export const MANAGED_TOKEN_REUSE_MS=300_000;
/** 離到期不到這麼久就不重用，免得帶著一張馬上失效的 token 出門 */
const EXPIRY_MARGIN_MS=60_000;
const requests=new Map<ProviderId,Promise<TokenPair|null>>();
export class ManagedAuthUnavailable extends Error {}
export function isManagedAuth(){return mode===true;}

const changeKey='hearthroom.auth.change';
function notifyOtherTabs(action:'logout'|'disconnect',provider?:ProviderId){
  try{localStorage.setItem(changeKey,JSON.stringify({action,provider,nonce:crypto.randomUUID()}));}catch{/* Storage-disabled browsers keep the server-side fence. */}
}
if(typeof window!=='undefined')window.addEventListener('storage',event=>{
  if(mode!==true||event.key!==changeKey||!event.newValue)return;
  try{
    const change=JSON.parse(event.newValue);
    if(change.action==='logout'){
      loggedOut=true;forgetManaged();
      // 另一個分頁登出：這個分頁也刪掉舞台存的聊天快取（這個分頁開著的連線會讓位），再重新載入。
      void clearStageStorage().finally(()=>location.reload());
      return;
    }
    if(change.action==='disconnect'&&PROVIDERS.some(p=>p.id===change.provider)){stopped.add(change.provider);forgetManaged(change.provider);}
    else return;
    // A full reload also destroys access-token caches owned by the embedded stage.
    location.reload();
  }catch{/* Ignore unrelated or malformed browser events. */}
});


/** Remove both scoped credentials and old mirrors; never upload a legacy grant. */
export function clearLegacyCredentials(){
  try {
    for(const key of ['hearthroom.oauth.access','hearthroom.oauth.refresh','hearthroom.oauth.grant_client']){
      localStorage.removeItem(key);
      for(const p of PROVIDERS)localStorage.removeItem(`${key}.${p.id}`);
    }
  }catch{/* Storage may be disabled; managed credentials are never written here. */}
}
export async function managedAuth():Promise<boolean>{
  if(mode!==undefined)return mode;
  if(!loading)loading=(async()=>{
    const response=await fetch('/v1/auth/config',{credentials:'same-origin',cache:'no-store'});
    if(!response.ok)throw new ManagedAuthUnavailable('auth_provider_unavailable');
    const data=await response.json();
    if(typeof data.managed!=='boolean')throw new ManagedAuthUnavailable('auth_provider_unavailable');
    mode=data.managed;
    if(mode)clearLegacyCredentials();
    return mode!;
  })().finally(()=>{loading=undefined;});
  return loading;
}
export async function authRequest<T>(path:string,body:unknown):Promise<T>{
  const response=await fetch('/v1/auth/'+path,{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','X-Hearthroom-Request':'1'},body:JSON.stringify(body)});
  const data=await response.json();
  if(!response.ok){
    if(response.status>=500||response.status===429)throw new ManagedAuthUnavailable('auth_provider_unavailable');
    throw new Error(data.error||'auth_state_invalid');
  }
  return data as T;
}
export function rememberManaged(pair:TokenPair,provider:ProviderId){
  if(loggedOut||stopped.has(provider))return;
  tokens.set(provider,{accessToken:pair.accessToken,expiresAt:pair.expiresAt,issuedAt:Date.now()});
  clearLegacyCredentials();
}
export function restoreManaged(provider:ProviderId){
  const pair=tokens.get(provider);
  return pair&&pair.expiresAt>Date.now()?{accessToken:pair.accessToken,expiresAt:pair.expiresAt}:null;
}
/** 供應商拒絕了手上這張：丟掉，下一次向伺服器拿目前那一份。不是斷開連結，不動版本號。 */
export function dropManagedToken(provider:ProviderId,rejected?:string){
  const pair=tokens.get(provider);
  if(pair&&(rejected===undefined||pair.accessToken===rejected))tokens.delete(provider);
}
export function forgetManaged(provider?:ProviderId){
  if(provider){tokens.delete(provider);versions.set(provider,(versions.get(provider)||0)+1);requests.delete(provider);}
  else{epoch++;tokens.clear();requests.clear();}
}
export async function managedToken(provider:ProviderId):Promise<TokenPair|null>{
  if(loggedOut||stopped.has(provider))return null;
  const cached=tokens.get(provider),now=Date.now();
  if(cached&&now-cached.issuedAt<MANAGED_TOKEN_REUSE_MS&&cached.expiresAt-now>EXPIRY_MARGIN_MS)return {accessToken:cached.accessToken,expiresAt:cached.expiresAt};
  const running=requests.get(provider);if(running)return running;
  const started=epoch,version=versions.get(provider)||0;
  const request=(async()=>{
    try{
      const pair=await authRequest<TokenPair>('token',{provider});
      if(started!==epoch||version!==(versions.get(provider)||0))return null;
      if(typeof pair.accessToken!=='string'||!Number.isFinite(pair.expiresAt))throw new ManagedAuthUnavailable('auth_provider_unavailable');
      rememberManaged(pair,provider);return pair;
    }catch(e){
      if(e instanceof ManagedAuthUnavailable)throw e;
      tokens.delete(provider);return null;
    }
  })();
  requests.set(provider,request);
  void request.finally(()=>{if(requests.get(provider)===request)requests.delete(provider);}).catch(()=>{});
  return request;
}
export async function managedLogout(){
  loggedOut=true;forgetManaged();
  await authRequest('logout',{});
  notifyOtherTabs('logout');
}
export async function disconnectManaged(provider:ProviderId){
  stopped.add(provider);forgetManaged(provider);
  const result=await authRequest<{ok:boolean;pending:boolean}>('disconnect',{provider});
  notifyOtherTabs('disconnect',provider);
  return result;
}
export async function cancelManaged(){
  if(await managedAuth())await authRequest('cancel',{});
}
/** Tests select an explicit deployment mode; runtime never downgrades after a config error. */
export function resetManagedAuthForTest(value?:boolean){mode=value;loading=undefined;loggedOut=false;stopped.clear();forgetManaged();}
