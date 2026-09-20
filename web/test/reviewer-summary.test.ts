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
