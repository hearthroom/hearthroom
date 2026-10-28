import {beforeEach,expect,it,vi} from 'vitest';
import {createPinia,setActivePinia} from 'pinia';
import {reactive} from 'vue';
const identity=reactive({me:{accountNumId:1},accessToken:async()=> 'token'});
vi.mock('../src/lib/session',()=>({useSession:()=>identity}));
vi.mock('../src/lib/rewards',async original=>({...await original<any>(),fetchPanel:vi.fn(),fetchPlan:vi.fn(async()=>({version:1}))}));
import {fetchPanel} from '../src/lib/rewards';
import {useCheckin} from '../src/lib/checkin-store';
beforeEach(()=>{setActivePinia(createPinia());identity.me={accountNumId:1};vi.clearAllMocks();});
it('discards a late rewards response after switching member, while allowing the new read',async()=>{
 let resolve!:(p:any)=>void;
 vi.mocked(fetchPanel).mockImplementationOnce(()=>new Promise(r=>resolve=r)).mockResolvedValueOnce({checkin:{todayClaimed:true}} as any);
 const store=useCheckin();const old=store.load();await Promise.resolve();await Promise.resolve();
 identity.me={accountNumId:2};const fresh=store.load();
 resolve({checkin:{todayClaimed:false}});await Promise.all([old,fresh]);
 expect(store.panel?.checkin.todayClaimed).toBe(true);expect(fetchPanel).toHaveBeenCalledTimes(2);
});
