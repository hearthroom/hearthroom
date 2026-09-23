import { beforeEach, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick, reactive, watch } from 'vue';
const mock=vi.hoisted(()=>({summary:vi.fn()}));
vi.mock('../src/lib/api',()=>({fetchReviewMe:mock.summary}));
let session:ReturnType<typeof reactive<{me:{accountNumId:number}|null;accessToken:()=>Promise<string|null>}>>;
vi.mock('../src/lib/session',()=>({useSession:()=>session}));
import { useReviewer } from '../src/lib/review';
beforeEach(()=>{setActivePinia(createPinia());session=reactive({me:{accountNumId:1},accessToken:async()=>'synthetic'});mock.summary.mockReset().mockResolvedValue({reviewer:true,pending:5,reviews:2,cases:3,role:'manager'});});
it('separates card and case counts and clears both when access is lost',async()=>{
 const store=useReviewer();await store.refresh();
 expect([store.pending,store.pendingReviews,store.pendingCases]).toEqual([5,2,3]);
 mock.summary.mockResolvedValue({reviewer:false,pending:5,reviews:2,cases:3,role:'manager'});await store.refresh();
 expect([store.pending,store.pendingReviews,store.pendingCases,store.role]).toEqual([0,0,0,'reviewer']);
});
it('does not restore old counts after logout while a summary is still loading',async()=>{
 const store=useReviewer();await store.refresh();
 let finish!:(data:unknown)=>void;mock.summary.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
 const pending=store.refresh();await nextTick();
 session.me=null;await nextTick();finish({reviewer:true,pending:5,reviews:2,cases:3,role:'manager'});await pending;
 expect([store.reviewer,store.pending,store.pendingReviews,store.pendingCases]).toEqual([null,0,0,0]);
});

it('keeps an unchanged manager role stable during summary polling',async()=>{
 const store=useReviewer();await store.refresh();
 const roles:string[]=[];const stop=watch(()=>store.role,value=>roles.push(value),{flush:'sync'});
 await store.refresh();stop();
 expect(roles).toEqual([]);
});

it('loads featured capability for an app admin and clears it on denial or failure',async()=>{
 mock.summary.mockResolvedValue({reviewer:true,role:'reviewer',featured:{admin:true,featuredUsed:2,featuredQuota:50}});
 const store=useReviewer();await store.refresh();
 expect(store.featured).toEqual({admin:true,featuredUsed:2,featuredQuota:50});
 mock.summary.mockResolvedValue({reviewer:false});await store.refresh();expect(store.featured).toBeNull();
 mock.summary.mockResolvedValue({reviewer:true,featured:{admin:true,featuredUsed:2,featuredQuota:50}});await store.refresh();
 mock.summary.mockRejectedValue(new Error('unavailable'));await store.refresh();expect(store.featured).toBeNull();
});
it('does not restore featured access from a late response after logout',async()=>{
 const store=useReviewer();await store.refresh();
 let finish!:(data:unknown)=>void;mock.summary.mockImplementationOnce(()=>new Promise(r=>{finish=r;}));
 const pending=store.refresh();await nextTick();session.me=null;await nextTick();
 finish({reviewer:true,featured:{admin:true,featuredUsed:0,featuredQuota:50}});await pending;
 expect(store.featured).toBeNull();
});
it('clears featured access when refreshing the login fails',async()=>{
 mock.summary.mockResolvedValue({reviewer:true,featured:{admin:true,featuredUsed:0,featuredQuota:50}});
 const store=useReviewer();await store.refresh();
 session.accessToken=async()=>{throw new Error('login expired');};
 await expect(store.refresh()).resolves.toBe(false);expect(store.featured).toBeNull();
});
it('discards a capability reply when the account changed during the request',async()=>{
 const {setProvider}=await import('../src/lib/provider');setProvider('harbor');
 mock.summary.mockResolvedValue({reviewer:true,featured:{admin:true,featuredUsed:0,featuredQuota:50}});
 const store=useReviewer();await store.refresh();
 let finish!:(data:unknown)=>void;mock.summary.mockImplementationOnce(()=>new Promise(r=>{finish=r;}));
 const pending=store.refresh();await nextTick();mock.summary.mockResolvedValue({reviewer:false});session.me={accountNumId:2};await nextTick();
 finish({reviewer:true,featured:{admin:true,featuredUsed:0,featuredQuota:50}});await pending;
 expect(store.featured).toBeNull();
});
