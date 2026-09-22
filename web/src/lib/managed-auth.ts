import { PROVIDERS, type ProviderId } from './provider';
import type { TokenPair } from './oauth';

let mode: boolean | undefined;
let loading: Promise<boolean> | undefined;
let epoch=0;
let loggedOut=false;
const stopped=new Set<ProviderId>();
const versions=new Map<ProviderId,number>();
const tokens=new Map<ProviderId,TokenPair>();
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
    if(change.action==='logout'){loggedOut=true;forgetManaged();}
    else if(change.action==='disconnect'&&PROVIDERS.some(p=>p.id===change.provider)){stopped.add(change.provider);forgetManaged(change.provider);}
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
  tokens.set(provider,{accessToken:pair.accessToken,expiresAt:pair.expiresAt});
  clearLegacyCredentials();
}
export function restoreManaged(provider:ProviderId){
  const pair=tokens.get(provider);
  return pair&&pair.expiresAt>Date.now()?pair:null;
}
export function forgetManaged(provider?:ProviderId){
  if(provider){tokens.delete(provider);versions.set(provider,(versions.get(provider)||0)+1);requests.delete(provider);}
  else{epoch++;tokens.clear();requests.clear();}
}
export async function managedToken(provider:ProviderId):Promise<TokenPair|null>{
  if(loggedOut||stopped.has(provider))return null;
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
