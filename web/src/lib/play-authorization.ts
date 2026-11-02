import { apiBaseOf, currentProvider, type ProviderId } from './provider';
import { beginLogin } from './oauth';
import { isRegionUnavailable } from './country-region';

/** 剛帶去重新授權過、回來還是被拒：不再轉，免得 Harbor 出問題時玩家在登入頁之間繞圈。 */
const RECONSENT_KEY = 'hearthroom.play.reconsentAt';
const RECONSENT_WINDOW_MS = 2 * 60 * 1000;

/**
 * Existing links remain valid; only the chat permission needs fresh consent. A token the
 * provider rejects outright (the player revoked the app in the HarperHarbor console) also
 * goes back through consent instead of ending on "load failed".
 */
/*
 * cardReady：同時在讀的那張卡。授權要重做之前先等它：這個國家／地區不提供這張卡
 * （403 region_unavailable）就不把人帶去授權頁，讓頁面說「暫不提供」。
 * 其他讀卡失敗照舊去重新授權——撤銷了授權的人開舊聊天，讀紀錄本身也會被拒，那正是要重新授權的時候。
 */
export async function ensurePlayAuthorization(token:string,returnTo:string, provider:ProviderId=currentProvider(),cardReady?:Promise<unknown>):Promise<boolean> {
 if(provider!=='harbor')return true;
 let response:Response;
 try{response=await fetch(`${apiBaseOf(provider)}/open/v1/models`,{headers:{Authorization:`Bearer ${token}`},redirect:'error'});}
 catch(error){
  // 連不上帳號那邊：卡被地區擋下的話先說「暫不提供」，不說「載不進來」
  if(cardReady)await cardReady.catch(cardError=>{if(isRegionUnavailable(cardError))throw cardError;});
  throw error;
 }
 if(response.ok)return true;
 if(cardReady)await cardReady.catch(error=>{if(isRegionUnavailable(error))throw error;});
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
