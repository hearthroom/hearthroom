import { apiBaseOf, currentProvider, type ProviderId } from './provider';
import { beginLogin } from './oauth';

/** 剛帶去重新授權過、回來還是被拒：不再轉，免得 Harbor 出問題時玩家在登入頁之間繞圈。 */
const RECONSENT_KEY = 'hearthroom.play.reconsentAt';
const RECONSENT_WINDOW_MS = 2 * 60 * 1000;

/**
 * Existing links remain valid; only the chat permission needs fresh consent. A token the
 * provider rejects outright (the player revoked the app in the HarperHarbor console) also
 * goes back through consent instead of ending on "load failed".
 */
export async function ensurePlayAuthorization(token:string,returnTo:string, provider:ProviderId=currentProvider()):Promise<boolean> {
 if(provider!=='harbor')return true;
 const response=await fetch(`${apiBaseOf(provider)}/open/v1/models`,{headers:{Authorization:`Bearer ${token}`},redirect:'error'});
 if(response.ok)return true;
 let reconsent=response.status===401;
 if(response.status===403) {
  const body=await response.json() as {error?:string};
  reconsent=body.error==='insufficient_scope';
 }
 if(reconsent&&!recentlyReconsented()) {
  try{sessionStorage.setItem(RECONSENT_KEY,String(Date.now()));}catch{/* 存不了就不防繞圈 */}
  await beginLogin(returnTo,{provider,...(provider!==currentProvider()?{linkFrom:currentProvider()}:{})});
  return false;
 }
 throw new Error('chat_authorization_unavailable');
}

function recentlyReconsented():boolean {
 try{return Date.now()-Number(sessionStorage.getItem(RECONSENT_KEY)||0)<RECONSENT_WINDOW_MS;}catch{return false;}
}
