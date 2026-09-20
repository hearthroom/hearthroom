import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { createApp, nextTick, reactive, type App } from 'vue';
import { createPinia } from 'pinia';
import { createRouter, createMemoryHistory } from 'vue-router';
import { i18n } from '../src/lib/i18n';
const mock=vi.hoisted(()=>({request:vi.fn(),confirm:vi.fn(async()=>true)}));
vi.mock('../src/lib/moderation',()=>({moderationRequest:mock.request}));
let session:ReturnType<typeof reactive<{me:{accountNumId:number}|null;accessToken:()=>Promise<string>}>>;
vi.mock('../src/lib/session',()=>({useSession:()=>session}));
vi.mock('../src/lib/review',()=>({useReviewer:()=>({refresh:vi.fn(),role:'reviewer',pending:1})}));
vi.mock('../src/lib/confirm',()=>({confirmDialog:mock.confirm,settleConfirm:vi.fn()}));
import Page from '../src/pages/ModerationPage.vue';
let app:App,el:HTMLElement;
beforeEach(async()=>{
 session=reactive({accessToken:async()=>'reviewer',me:{accountNumId:2}});
 mock.request.mockImplementation(async(path:string)=>path.startsWith('/cases')?{items:[{id:'case1',title:'Sample work',action:'suspend',status:'pending',reason:'Specific issue',createdAt:Date.now(),canVote:true,canResolve:false,votes:[{vote:'confirm',reason:'Specific issue',at:Date.now()}]}],hasNext:false}:{items:[],hasNext:false});
 el=document.createElement('div');document.body.append(el);
 const router=createRouter({history:createMemoryHistory(),routes:[{path:'/:pathMatch(.*)*',component:Page}]});await router.push('/review/manage');
 app=createApp(Page).use(createPinia()).use(router).use(i18n);app.mount(el);await nextTick();
 await vi.waitFor(()=>expect(el.textContent).toContain('Sample work'));
});
afterEach(()=>{app?.unmount();el?.remove();vi.clearAllMocks();});
it('requires an independent reason and confirmation before voting, then refreshes durable state',async()=>{
 const open=el.querySelector<HTMLButtonElement>('[data-case="case1"]')!;open.click();await nextTick();
 const vote=el.querySelector<HTMLButtonElement>('[data-vote="confirm"]')!;expect(vote.disabled).toBe(true);
 const reason=el.querySelector<HTMLTextAreaElement>('#case-reason')!;reason.value='Confirmed after reading';reason.dispatchEvent(new Event('input'));await nextTick();
 vote.click();await vi.waitFor(()=>expect(mock.confirm).toHaveBeenCalled());
 await vi.waitFor(()=>expect(mock.request).toHaveBeenCalledWith('/cases/case1/vote','reviewer',{vote:'confirm',reason:'Confirmed after reading'}));
});
it('does not mutate when the confirmation is cancelled',async()=>{
 mock.confirm.mockResolvedValueOnce(false);el.querySelector<HTMLButtonElement>('[data-case="case1"]')!.click();await nextTick();
 const reason=el.querySelector<HTMLTextAreaElement>('#case-reason')!;reason.value='Reason';reason.dispatchEvent(new Event('input'));await nextTick();
 el.querySelector<HTMLButtonElement>('[data-vote="confirm"]')!.click();await nextTick();await nextTick();
 expect(mock.request.mock.calls.some(c=>c[0].endsWith('/vote'))).toBe(false);
});
it('invalidates a pending confirmation when the account changes',async()=>{
 let confirm!:(ok:boolean)=>void;mock.confirm.mockImplementationOnce(()=>new Promise<boolean>(r=>{confirm=r;}));
 el.querySelector<HTMLButtonElement>('[data-case="case1"]')!.click();await nextTick();
 const reason=el.querySelector<HTMLTextAreaElement>('#case-reason')!;reason.value='Old account';reason.dispatchEvent(new Event('input'));await nextTick();
 el.querySelector<HTMLButtonElement>('[data-vote="confirm"]')!.click();await nextTick();
 session.me={accountNumId:99};await nextTick();confirm(true);await nextTick();await nextTick();
 expect(mock.request.mock.calls.some(c=>c[0].endsWith('/vote'))).toBe(false);
 expect(el.querySelector('#case-reason')).toBeNull();
});
it('discards a delayed card response after changing tabs',async()=>{
 let finish!:(data:unknown)=>void;
 mock.request.mockImplementation(async(path:string)=>path.startsWith('/cards?')?{items:[{id:'card1',name:'Card one'}]}:path.startsWith('/cards/card1')?new Promise(r=>{finish=r;}):{items:[]});
 const tabs=()=>[...el.querySelectorAll<HTMLButtonElement>('.work-tabs button')];tabs()[1]!.click();await vi.waitFor(()=>expect(el.textContent).toContain('Card one'));
 el.querySelector<HTMLButtonElement>('.work-item')!.click();await vi.waitFor(()=>expect(finish).toBeDefined());tabs()[0]!.click();await nextTick();
 finish({card:{id:'card1',name:'Stale card',tags:[]},cases:[],events:[],reviews:[]});await nextTick();await nextTick();
 expect(el.textContent).not.toContain('Stale card');
});
