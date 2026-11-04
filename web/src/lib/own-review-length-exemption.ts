import { ref, watch, onScopeDispose, type Ref } from 'vue';
import { useSession } from './session';
import { currentProvider } from './provider';

/** Unknown/error is never treated as an exemption; clear before switching identities/cards. */
export function useOwnReviewLengthExemption(roleId:Ref<string>){
 const session=useSession(),enabled=ref(false);
 let generation=0;
 onScopeDispose(()=>{generation++;enabled.value=false;});
 watch(()=>[roleId.value,session.me?.accountNumId,currentProvider()],async()=>{
  const gen=++generation,id=roleId.value,provider=currentProvider();enabled.value=false;
  // The editor resolves its public number to the provider source role before this read.
  if(!id||/^[1-9]\d*$/.test(id)||!session.me)return;
  try{
   const token=await session.accessToken();if(!token||gen!==generation)return;
   const response=await fetch(`/v1/me/review-length-exemptions/${encodeURIComponent(id)}`,{headers:{Authorization:`Bearer ${token}`,'X-Provider':provider},cache:'no-store'});
   if(!response.ok)return;
   const body=await response.json() as {enabled?:unknown};
   if(gen===generation)enabled.value=body.enabled===true;
  }catch{/* The backend still enforces eligibility; failed reads cannot grant an exception. */}
 },{immediate:true,flush:'sync'});
 return enabled;
}
