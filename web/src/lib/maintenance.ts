import { ref, readonly } from 'vue';
import { maintenanceOff, parseMaintenance, MAINTENANCE_POLL_MS } from '../../../shared/maintenance';
export function formatMaintenanceTime(endsAt:number|null,locale:string,now=Date.now(),timeZone?:string):string|null {
 if(endsAt===null||endsAt<=now)return null;
 return new Intl.DateTimeFormat(locale,{dateStyle:'medium',timeStyle:'long',...(timeZone?{timeZone}:{})}).format(new Date(endsAt));
}
export function createMaintenanceMonitor(fetcher:typeof fetch=fetch,initiallyEnabled=false){
 const state=ref({...maintenanceOff(),enabled:initiallyEnabled}),busy=ref(false),failed=ref(false);
 let timer:ReturnType<typeof setInterval>|undefined;
 let pending:Promise<void>|undefined;
 function check():Promise<void>{
  if(pending)return pending;
  busy.value=true;
  pending=(async()=>{
   try {
    const response=await fetcher('/v1/maintenance',{cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(5000)});
    if(!response.ok)throw Error('Maintenance status unavailable');
    state.value=parseMaintenance(await response.json());failed.value=false;
   }catch{failed.value=true;}
   finally{busy.value=false;pending=undefined;}
  })();
  return pending;
 }
 const refresh=()=>{if(document.visibilityState!=='hidden')void check();};
 return {state:readonly(state),busy:readonly(busy),failed:readonly(failed),check,
  start(){if(timer)return;timer=setInterval(refresh,MAINTENANCE_POLL_MS);window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',refresh);},
  stop(){clearInterval(timer);timer=undefined;window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh);},
 };
}
export type MaintenanceMonitor=ReturnType<typeof createMaintenanceMonitor>;
