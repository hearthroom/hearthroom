import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { createApp, nextTick, reactive, type App } from 'vue';
import { createPinia } from 'pinia';
import { createRouter, createMemoryHistory, type Router } from 'vue-router';
import { i18n } from '../src/lib/i18n';
const mock=vi.hoisted(()=>({request:vi.fn(),confirm:vi.fn(async()=>true)}));
vi.mock('../src/lib/moderation',()=>({moderationRequest:mock.request}));
let session:ReturnType<typeof reactive<{me:{accountNumId:number}|null;accessToken:()=>Promise<string>}>>;
vi.mock('../src/lib/session',()=>({useSession:()=>session}));
vi.mock('../src/lib/review',()=>({useReviewer:()=>({refresh:vi.fn(),role:'reviewer',pending:1})}));
vi.mock('../src/lib/confirm',()=>({confirmDialog:mock.confirm,settleConfirm:vi.fn()}));
import Page from '../src/pages/ModerationPage.vue';
let app:App,el:HTMLElement,router:Router;
beforeEach(async()=>{
 session=reactive({accessToken:async()=>'reviewer',me:{accountNumId:2}});
 mock.request.mockImplementation(async(path:string)=>path.startsWith('/cases')?{items:[{id:'case1',title:'Sample work',action:'suspend',status:'pending',reason:'Specific issue',createdAt:Date.now(),canVote:true,canResolve:false,votes:[{vote:'confirm',reason:'Specific issue',at:Date.now()}]}],hasNext:false}:{items:[],hasNext:false});
 el=document.createElement('div');document.body.append(el);
 router=createRouter({history:createMemoryHistory(),routes:['cases','cards','history'].map(tab=>({path:`/review/${tab}`,component:Page,meta:{managementTab:tab}}))});await router.push('/review/cases');
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
 await router.push('/review/cards');await vi.waitFor(()=>expect(el.textContent).toContain('Card one'));
 el.querySelector<HTMLButtonElement>('.work-item')!.click();await vi.waitFor(()=>expect(finish).toBeDefined());await router.push('/review/cases');await nextTick();
 finish({card:{id:'card1',name:'Stale card',tags:[]},cases:[],events:[],reviews:[]});await nextTick();await nextTick();
 expect(el.textContent).not.toContain('Stale card');
});
it('invalidates a pending vote confirmation when navigating to another management section',async()=>{
 let confirm!:(ok:boolean)=>void;mock.confirm.mockImplementationOnce(()=>new Promise<boolean>(r=>{confirm=r;}));
 el.querySelector<HTMLButtonElement>('[data-case="case1"]')!.click();await nextTick();
 const reason=el.querySelector<HTMLTextAreaElement>('#case-reason')!;reason.value='Checked';reason.dispatchEvent(new Event('input'));await nextTick();
 el.querySelector<HTMLButtonElement>('[data-vote="confirm"]')!.click();await nextTick();
 await router.push('/review/cards');await nextTick();confirm(true);await nextTick();await nextTick();
 expect(mock.request.mock.calls.some(c=>c[0].endsWith('/vote'))).toBe(false);
 expect(el.querySelector('#case-reason')).toBeNull();
});
it('keeps the new operation busy and owns its confirmation when an earlier tab request finishes',async()=>{
 let finishOld!:(value:unknown)=>void,finishConfirm!:(ok:boolean)=>void;
 mock.request.mockImplementation(async(path:string)=>{
  if(path.endsWith('/vote'))return new Promise(r=>{finishOld=r;});
  if(path.startsWith('/cards?'))return {items:[{id:'card1',name:'Card one'}]};
  if(path.startsWith('/cards/card1'))return {card:{id:'card1',name:'Card one',tags:[],boardHidden:false,publicBlocked:false},cases:[],events:[],reviews:[]};
  return {items:[]};
 });
 el.querySelector<HTMLButtonElement>('[data-case="case1"]')!.click();await nextTick();
 const oldReason=el.querySelector<HTMLTextAreaElement>('#case-reason')!;oldReason.value='First vote';oldReason.dispatchEvent(new Event('input'));await nextTick();
 el.querySelector<HTMLButtonElement>('[data-vote="confirm"]')!.click();await vi.waitFor(()=>expect(finishOld).toBeDefined());
 await router.push('/review/cards');await vi.waitFor(()=>expect(el.textContent).toContain('Card one'));
 el.querySelector<HTMLButtonElement>('.work-item')!.click();await vi.waitFor(()=>expect(el.querySelector('#card-reason')).not.toBeNull());
 const newReason=el.querySelector<HTMLTextAreaElement>('#card-reason')!;newReason.value='Second proposal';newReason.dispatchEvent(new Event('input'));await nextTick();
 mock.confirm.mockImplementationOnce(()=>new Promise<boolean>(r=>{finishConfirm=r;}));
 el.querySelector<HTMLButtonElement>('.work-submit')!.click();await vi.waitFor(()=>expect(finishConfirm).toBeDefined());
 finishOld({ok:true});await nextTick();await nextTick();
 expect(el.querySelector<HTMLButtonElement>('.work-submit')!.disabled).toBe(true);
 await router.push('/review/cases');await nextTick();
 const {settleConfirm}=await import('../src/lib/confirm');expect(settleConfirm).toHaveBeenCalledWith(false);
 finishConfirm(false);
});

// 重新審核（審核員 2026-11-08）：已發布的卡從管理頁送回待審清單，跟處置案件分開走
it('a published card can be sent back for re-review with a reason; a card already in re-review cannot',async()=>{
 const history=(reviews:unknown[])=>({card:{id:'card1',name:'Card one',tags:[],status:'approved',boardHidden:false,publicBlocked:false},cases:[],events:[],reviews});
 let reviews:unknown[]=[];
 mock.request.mockImplementation(async(path:string)=>path.startsWith('/cards?')?{items:[{id:'card1',name:'Card one'}]}:path==='/cards/card1/reopen'?{id:'r1'}:path.startsWith('/cards/card1')?history(reviews):{items:[]});
 await router.push('/review/cards');await vi.waitFor(()=>expect(el.textContent).toContain('Card one'));
 el.querySelector<HTMLButtonElement>('.work-item')!.click();await vi.waitFor(()=>expect(el.querySelector('#case-action')).not.toBeNull());
 const select=el.querySelector<HTMLSelectElement>('#case-action')!;
 expect([...select.options].map(o=>o.value)).toContain('reopen');
 select.value='reopen';select.dispatchEvent(new Event('change'));await nextTick();
 expect(el.textContent).toContain(i18n.global.t('moderation.proposal.reopen'));
 const reason=el.querySelector<HTMLTextAreaElement>('#card-reason')!;reason.value='疑似盜用';reason.dispatchEvent(new Event('input'));await nextTick();
 el.querySelector<HTMLButtonElement>('.work-submit')!.click();
 await vi.waitFor(()=>expect(mock.request).toHaveBeenCalledWith('/cards/card1/reopen','reviewer',{reason:'疑似盜用'}));
 expect(mock.request.mock.calls.some(c=>c[0]==='/cases'&&c[2])).toBe(false);
 reviews=[{id:'r1',kind:'re',status:'pending',note:'疑似盜用',submittedAt:1,version:'version:v1',reopen:1}];
 await router.push('/review/cases');await router.push('/review/cards');await vi.waitFor(()=>expect(el.textContent).toContain('Card one'));
 el.querySelector<HTMLButtonElement>('.work-item')!.click();await vi.waitFor(()=>expect(el.querySelector('#case-action')).not.toBeNull());
 expect([...el.querySelector<HTMLSelectElement>('#case-action')!.options].map(o=>o.value)).not.toContain('reopen');
 expect(el.textContent).toContain(i18n.global.t('moderation.reReview'));
});
// 審核頁「這位作者的卡」連到作品管理時帶卡號：一打開就是那張卡（2026-11-08）
it('opens the works tab already searching the card number from the link',async()=>{
 app.unmount();mock.request.mockClear();
 await router.push('/review/cards?q=100003');
 app=createApp(Page).use(createPinia()).use(router).use(i18n);app.mount(el);
 await vi.waitFor(()=>expect(mock.request).toHaveBeenCalledWith(expect.stringMatching(/^\/cards\?q=100003&/),'reviewer'));
 expect(el.querySelector<HTMLInputElement>('input[type="search"], input')?.value).toBe('100003');
});
