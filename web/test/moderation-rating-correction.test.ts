// 作品管理「更正分級」（管理員直接生效，owner 2026-11-24；UI 稿 ui-rating-correction.md v15：含只鎖定分級下限）
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
let rating='PG15',floor:string|null=null,events:{action:string;reason:string;beforeValue:string;afterValue:string;at:number}[]=[];
const detail=()=>({card:{id:'card1',provider:'harbor',name:'Sample card',tags:[],status:'approved',boardHidden:false,publicBlocked:false,version:'v1',featured:false,rating,cardNumber:100021,ratingFloor:floor},cases:[],events,reviews:[]});
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
 rating='PG15';floor=null;events=[];
 session=reactive({accessToken:async()=>'manager',me:{accountNumId:2}});
 reviewer=reactive({...mock.reviewer,role:'manager'});
 mock.request.mockImplementation(async(path:string,_t:string,body?:{rating:string;reason:string})=>{
  if(path.startsWith('/cards?'))return {items:[{id:'card1',name:'Sample card',tags:[]}],hasNext:false};
  if(path==='/cards/card1/rating'){
   // 同伺服器：分級一樣＝只鎖定下限（歷程 rating_floor，before 是原本的下限），否則更正分級；兩種都把下限設成新分級
   const before=rating,beforeFloor=floor,lockOnly=before===body!.rating;rating=body!.rating;floor=rating;
   events=[{action:lockOnly?'rating_floor':'rating',reason:body!.reason,beforeValue:lockOnly?beforeFloor??'':before,afterValue:rating,at:Date.now()}];
   return {cardId:'card1',before:{rating:before,versionRating:before,floor:beforeFloor},rating,floor:rating,lockOnly};
  }
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
 floor='PG15';
 await open();await chooseRating();
 expect($('[data-rating-current]')?.textContent).toBe('輔15級');
 expect($('[data-rating-floor]')?.textContent).toBe('輔15級');
 const select=$<HTMLSelectElement>('[data-rating-next]')!;
 // 目前那一級也能選（分級下限不同時要用來只鎖下限）
 expect([...select.options].find(o=>o.value==='PG15')?.disabled).toBe(false);
 // 分級和下限都已經是輔15級：說明沒有改變，按鈕停用
 expect($('[data-rating-unchanged]')?.textContent).toBe('分級沒有改變：目前分級和分級下限都已經是輔15級。');
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
 // 降級：沒有「誰看得到」那一條，只有兩條影響
 const opts=mock.confirm.mock.calls[0]![0] as {consequences:string[]};
 expect(opts.consequences).toEqual(['上架版本的分級一起改，分級下限鎖在輔12級：之後作者送審不能低於輔12級','不會通知作者']);
});

it('shows the unchanged state when the card already has that rating',async()=>{
 await open();await chooseRating();
 input('[data-rating-next]','R');input('[data-rating-reason]','Raise to adult');await flush();
 // 別人剛更正成限制級（伺服器只有分級和下限都一樣才回 rating_unchanged）
 mock.request.mockImplementationOnce(async()=>{rating='R';floor='R';throw new ApiError(409,'unchanged','rating_unchanged');});
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

it('locks only the floor when the new rating equals the current one and there is no floor yet',async()=>{
 await open();await chooseRating();
 // 沒有下限寫「無」；選單停在目前分級＝只鎖定下限
 expect($('[data-rating-floor]')?.textContent).toBe('無');
 expect($<HTMLSelectElement>('[data-rating-next]')!.value).toBe('PG15');
 expect($('[data-rating-unchanged]')).toBeNull();
 expect($('[data-rating-proposal]')?.textContent).toBe('只會鎖住分級下限：之後作者送審，分級不能低於輔15級。卡片目前的分級不變，不會通知作者。');
 const submit=$<HTMLButtonElement>('[data-rating-submit]')!;
 expect(submit.textContent).toBe('鎖定分級下限');
 expect(submit.disabled).toBe(true);
 input('[data-rating-reason]','Rated by hand before floors existed');await flush();
 expect(submit.disabled).toBe(false);
 submit.click();
 await vi.waitFor(()=>expect(posts()).toHaveLength(1));
 const opts=mock.confirm.mock.calls[0]![0] as {title:string;subject:string;message:string;consequences:string[];confirmText:string;danger:boolean;hint?:string};
 expect(opts.title).toBe('要鎖定分級下限嗎？');
 expect(opts.subject).toBe('Sample card（作品編號 100021）');
 expect(opts.message).toBe('分級：維持輔15級（不改）\n分級下限：無 → 輔15級\n理由：Rated by hand before floors existed');
 expect(opts.consequences).toEqual(['只鎖住分級下限（之後作者送審不能低於輔15級），上架版本的分級不變','不會通知作者']);
 expect(opts.confirmText).toBe('鎖定分級下限');
 expect(opts.hint).toBeUndefined();
 expect(opts.danger).toBe(true);
 const body=posts()[0]![2] as {rating:string;reason:string;operationId:string};
 expect(body.rating).toBe('PG15');expect(body.reason).toBe('Rated by hand before floors existed');
 // 結果卡照伺服器回的 lockOnly
 await vi.waitFor(()=>expect($('[data-rating-done]')).not.toBeNull());
 const done=$('[data-rating-done]')!.textContent!;
 expect(done).toContain('分級下限已鎖定');
 expect(done).toContain('分級：維持輔15級（不改）');
 expect(done).toContain('分級下限：無 → 輔15級');
 expect(done).toContain('作者沒有收到通知');
 expect(done).not.toContain('分級已更正');
 // 歷程：只鎖下限那一筆讀得懂
 expect($('.work-timeline')?.textContent).toContain('分級下限已鎖定');
 expect($('.work-timeline')?.textContent).toContain('分級下限：無 → 輔15級');
 // 再做一次：分級和下限都是輔15級了
 $<HTMLButtonElement>('[data-rating-again]')!.click();await flush();
 input('#case-action','rating');await flush();
 expect($('[data-rating-floor]')?.textContent).toBe('輔15級');
 expect($('[data-rating-unchanged]')?.textContent).toBe('分級沒有改變：目前分級和分級下限都已經是輔15級。');
 expect($<HTMLButtonElement>('[data-rating-submit]')!.textContent).toBe('更正分級');
});

it('locks only the floor when the floor differs from the current rating',async()=>{
 floor='PG12';
 await open();await chooseRating();
 expect($('[data-rating-floor]')?.textContent).toBe('輔12級');
 input('[data-rating-reason]','Floor should match the rating');await flush();
 $<HTMLButtonElement>('[data-rating-submit]')!.click();
 await vi.waitFor(()=>expect(posts()).toHaveLength(1));
 const opts=mock.confirm.mock.calls[0]![0] as {message:string};
 expect(opts.message.split('\n')[1]).toBe('分級下限：輔12級 → 輔15級');
 await vi.waitFor(()=>expect($('[data-rating-done]')?.textContent).toContain('分級下限：輔12級 → 輔15級'));
});

it('switches back to a normal correction when another rating is picked',async()=>{
 await open();await chooseRating();
 input('[data-rating-next]','PG12');await flush();
 expect($('[data-rating-proposal]')?.textContent).toBe('這會同時修改上架版本的分級，並鎖住分級下限：之後作者送審，分級不能低於這個分級。不會通知作者。');
 expect($<HTMLButtonElement>('[data-rating-submit]')!.textContent).toBe('更正分級');
});

it('lists no visibility line when leaving adults-only, and uses the page danger button',async()=>{
 rating='R';floor='R';
 await open();await chooseRating();
 const submit=$<HTMLButtonElement>('[data-rating-submit]')!;
 expect(submit.className).toContain('btn btn--danger work-submit');
 input('[data-rating-next]','PG15');input('[data-rating-reason]','No explicit content');await flush();
 submit.click();
 await vi.waitFor(()=>expect(posts()).toHaveLength(1));
 const opts=mock.confirm.mock.calls[0]![0] as {consequences:string[];danger:boolean};
 expect(opts.consequences).toEqual(['上架版本的分級一起改，分級下限鎖在輔15級：之後作者送審不能低於輔15級','不會通知作者']);
 expect(opts.danger).toBe(true);
});
