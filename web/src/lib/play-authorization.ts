import { apiBaseOf, currentProvider, type ProviderId } from './provider';
import { beginLogin } from './oauth';
/** Existing links remain valid; only the chat permission needs fresh consent. */
export async function ensurePlayAuthorization(token:string,returnTo:string, provider:ProviderId=currentProvider()):Promise<boolean> {
 if(provider!=='harbor')return true;
 const response=await fetch(`${apiBaseOf(provider)}/open/v1/models`,{headers:{Authorization:`Bearer ${token}`},redirect:'error'});
 if(response.ok)return true;
 if(response.status===403) {
  const body=await response.json() as {error?:string};
  if(body.error==='insufficient_scope') {await beginLogin(returnTo,{provider,...(provider!==currentProvider()?{linkFrom:currentProvider()}:{})});return false;}
 }
 throw new Error('chat_authorization_unavailable');
}
