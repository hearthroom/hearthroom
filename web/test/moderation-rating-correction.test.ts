// 作品管理「更正分級」（管理員直接生效，owner 2026-11-24；UI 稿 ui-rating-correction.md v13）
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { createApp, nextTick, reactive, type App } from 'vue';
import { createPinia } from 'pinia';
import { createRouter, createMemoryHistory } from 'vue-router';
import { i18n } from '../src/lib/i18n';
import { ApiError } from '../src/lib/api';
const mock=vi.hoisted(()=>({request:vi.fn(),confirm:vi.fn(async(_o:unknown)=>true),reviewer:{refresh:()=>{},role:'manager' as string,pending:0}}));
vi.mock('../src/lib/moderation',()=>({moderationRequest:mock.request}));
vi.mock('../src/lib/session',()=>({useSession:()=>session}));
vi.mock('../src/lib/review',()=>({useReviewer:()=>reviewer}));
vi.mock('../src/lib/confirm',()=>({confirmDialog:mock.confirm,settleConfirm:vi.fn()}));
import Page from '../src/pages/ModerationPage.vue';
let session:{me:{accountNumId:number}|null;accessToken:()=>Promise<string>};
let reviewer:typeof mock.reviewer;
let app:App,el:HTMLElement;
let rating='PG15',events:{action:string;reason:string;beforeValue:string;afterValue:string;at:number}[]=[];
const detail=()=>({card:{id:'card1',provider:'harbor',name:'Sample card',tags:[],status:'approved',boardHidden:false,publicBlocked:false,version:'v1',featured:false,rating,cardNumber:100021,ratingFloor:null},cases:[],events,reviews:[]});
const $=<T extends Element=HTMLElement>(s:string)=>el.querySelector<T>(s);
const flush=async()=>{for(let i=0;i<6;i++)await nextTick();};
function input(sel:string,value:string){const x=$<HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement>(sel)!;x.value=value;x.dispatchEvent(new Event(x instanceof HTMLSelectElement?'change':'input'));}
async function open(){
 await vi.waitFor(()=>expect(el.textContent).toContain('Sample card'));
 $<HTMLButtonElement>('.work-item')!.click();await vi.waitFor(()=>expect($('#case-action')).not.toBeNull());
}
async function chooseRating(){input('#case-action','rating');await flush();}
const posts=()=>mock.request.mock.calls.filter(c=>String(c[0]).endsWith('/rating'));
beforeEach(async()=>{
 rating='PG15';events=[];
 session=reactive({accessToken:async()=>'manager',me:{accountNumId:2}});
 reviewer=reactive({...mock.reviewer,role:'manager'});
 mock.request.mockImplementation(async(path:string,_t:string,body?:{rating:string;reason:string})=>{
  if(path.startsWith('/cards?'))return {items:[{id:'card1',name:'Sample card',tags:[]}],hasNext:false};
  if(path==='/cards/card1/rating'){const before=rating;rating=body!.rating;events=[{action:'rating',reason:body!.reason,beforeValue:before,afterValue:rating,at:Date.now()}];return {cardId:'card1',before:{rating:before,versionRating:before},rating,floor:rating};}
  if(path.startsWith('/cards/card1'))return detail();
  return {items:[],hasNext:false};
 });
 el=document.createElement('div');document.body.append(el);
 const router=createRouter({history:createMemoryHistory(),routes:[{path:'/review/cards',component:Page,meta:{managementTab:'cards'}}]});await router.push('/review/cards');
 app=createApp(Page).use(createPinia()).use(router).use(i18n);app.mount(el);await flush();
});
afterEach(()=>{app?.unmount();el?.remove();vi.clearAllMocks();});

it('is not offered to reviewers who are not managers',async()=>{
 reviewer.role='reviewer';await flush();
 await open();
 const values=[...$<HTMLSelectElement>('#case-action')!.options].map(o=>o.value);
 expect(values).not.toContain('rating');
 expect($('[data-rating-correction]')).toBeNull();
});

it('confirms with the card, change, reason and effects, posts once with an operation id, then shows the result and refreshed history',async()=>{
 await open();await chooseRating();
 expect($('[data-rating-current]')?.textContent).toBe('輔15級');
 const select=$<HTMLSelectElement>('[data-rating-next]')!;
 expect([...select.options].find(o=>o.value==='PG15')?.disabled).toBe(true);
 // 還在目前分級：說明不需要更正，按鈕停用
 expect($('[data-rating-unchanged]')?.textContent).toBe('分級沒有改變，不需要更正。');
 expect($<HTMLButtonElement>('[data-rating-submit]')!.disabled).toBe(true);
 input('[data-rating-next]','R');await flush();
 expect($('[data-rating-adult]')?.textContent).toBe('沒有開啟成人內容的玩家，之後在榜單、搜尋和卡片頁都看不到這張卡。');
 // 理由必填，上限 500
 expect($<HTMLButtonElement>('[data-rating-submit]')!.disabled).toBe(true);
 expect($<HTMLTextAreaElement>('[data-rating-reason]')!.maxLength).toBe(500);
 input('[data-rating-reason]','  Explicit scenes in the lorebook  ');await flush();
 $<HTMLButtonElement>('[data-rating-submit]')!.click();
 await vi.waitFor(()=>expect(posts()).toHaveLength(1));
 const opts=mock.confirm.mock.calls[0]![0] as {title:string;subject:string;message:string;consequences:string[];danger:boolean;hint:string};
 expect(opts.title).toBe('要更正這張卡的分級嗎？');
 expect(opts.subject).toBe('Sample card（作品編號 100021）');
 expect(opts.message).toBe('分級：輔15級 → 限制級\n理由：Explicit scenes in the lorebook');
 expect(opts.consequences[0]).toBe('沒有開啟成人內容的玩家會看不到這張卡');
 expect(opts.consequences).toContain('不會通知作者');
 expect(opts.danger).toBe(true);
 const body=posts()[0]![2] as {rating:string;reason:string;operationId:string};
 expect(body.rating).toBe('R');expect(body.reason).toBe('Explicit scenes in the lorebook');
 expect(body.operationId).toMatch(/^[0-9a-f-]{36}$/);
 await vi.waitFor(()=>expect($('[data-rating-done]')).not.toBeNull());
 expect($('[data-rating-done]')!.textContent).toContain('分級：輔15級 → 限制級');
 expect($('[data-rating-done]')!.textContent).toContain('分級下限已鎖在限制級');
 expect($('[data-rating-done]')!.textContent).toContain('作者沒有收到通知');
 // 選取沒被清掉，卡片詳情換成新的（歷程有這次更正，分級名稱可讀）
 expect($('.work-detail h2')?.textContent).toBe('Sample card');
 expect($('.work-timeline')?.textContent).toContain('更正分級');
 expect($('.work-timeline')?.textContent).toContain('輔15級 → 限制級');
 $<HTMLButtonElement>('[data-rating-again]')!.click();await flush();
 expect($<HTMLSelectElement>('#case-action')!.value).not.toBe('rating');
});

it('keeps the reason after a failure and retries with the same operation id',async()=>{
 await open();await chooseRating();
 mock.request.mockImplementationOnce(async()=>{throw new ApiError(500,'server','');});
 input('[data-rating-next]','PG12');input('[data-rating-reason]','Only mild romance');await flush();
 $<HTMLButtonElement>('[data-rating-submit]')!.click();
 await vi.waitFor(()=>expect($('[data-rating-failed]')).not.toBeNull());
 expect($('[data-rating-failed]')!.textContent).toContain('分級沒有改動，理由還在，可以再試一次。');
 expect($<HTMLTextAreaElement>('[data-rating-reason]')!.value).toBe('Only mild romance');
 const first=(mock.request.mock.calls.find(c=>c[0]==='/cards/card1/rating')![2] as {operationId:string}).operationId;
 $<HTMLButtonElement>('[data-rating-retry]')!.click();
 await vi.waitFor(()=>expect($('[data-rating-done]')).not.toBeNull());
 const all=mock.request.mock.calls.filter(c=>c[0]==='/cards/card1/rating').map(c=>(c[2] as {operationId:string}).operationId);
 expect(all).toEqual([first,first]);
 // 降級：不會出現「看不到」那一條
 const opts=mock.confirm.mock.calls[0]![0] as {consequences:string[]};
 expect(opts.consequences.join()).not.toContain('看不到');
});

it('shows the unchanged state when the card already has that rating',async()=>{
 await open();await chooseRating();
 input('[data-rating-next]','R');input('[data-rating-reason]','Raise to adult');await flush();
 // 別人剛更正成限制級
 mock.request.mockImplementationOnce(async()=>{rating='R';throw new ApiError(409,'unchanged','rating_unchanged');});
 $<HTMLButtonElement>('[data-rating-submit]')!.click();
 await vi.waitFor(()=>expect($('[data-rating-notice]')).not.toBeNull());
 expect($('[data-rating-notice]')!.textContent).toBe('這張卡已經是限制級，不需要更正。');
 expect($('[data-rating-current]')?.textContent).toBe('限制級');
 expect($('[data-rating-unchanged]')).not.toBeNull();
 expect($<HTMLButtonElement>('[data-rating-submit]')!.disabled).toBe(true);
 expect($('[data-rating-done]')).toBeNull();
});

it('does not post when the confirmation is cancelled',async()=>{
 await open();await chooseRating();
 mock.confirm.mockResolvedValueOnce(false);
 input('[data-rating-next]','G');input('[data-rating-reason]','Nothing mature');await flush();
 $<HTMLButtonElement>('[data-rating-submit]')!.click();await flush();
 expect(posts()).toHaveLength(0);
 expect($<HTMLTextAreaElement>('[data-rating-reason]')!.value).toBe('Nothing mature');
});
