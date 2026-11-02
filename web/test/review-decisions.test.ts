/**
 * 我處理過的：搜尋卡名或卡號（2026-11-02）。搜尋交給伺服器搜全部紀錄，條件留在網址上。
 */
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {createApp,type App} from 'vue';
import {createPinia} from 'pinia';
import {createMemoryHistory,createRouter,type Router} from 'vue-router';
import {i18n} from '../src/lib/i18n';
const row=(id:string,name:string)=>({id,status:'rejected',kind:'first',verdict:'reject',note:'',at:2,submittedAt:1,decidedAt:2,versionId:null,card:{id:'1000'+id,name},canCorrect:false});
const api=vi.hoisted(()=>({fetchReviewDecisions:vi.fn(),fetchReviewMe:vi.fn(async()=>({reviewer:true,reviews:3}))}));
vi.mock('../src/lib/api',()=>api);
vi.mock('../src/lib/session',()=>({useSession:()=>({accessToken:async()=>'tok'})}));
import Page from '../src/pages/ReviewDecisionsPage.vue';
let app:App,el:HTMLElement,router:Router;
const mount=async(path:string)=>{
 el=document.createElement('div');document.body.append(el);
 router=createRouter({history:createMemoryHistory(),routes:[{path:'/review/decisions',component:Page},{path:'/:p(.*)*',component:{template:'<p />'}}]});
 await router.push(path);app=createApp(Page).use(createPinia()).use(router).use(i18n);app.mount(el);
};
beforeEach(()=>{api.fetchReviewDecisions.mockImplementation(async(_t:string,_l:string,_b?:number,q?:string)=>({items:q==='沒有'?[]:q?[row('2','月下')]:[row('1','夜行'),row('2','月下')],nextCursor:null}));});
afterEach(()=>{app.unmount();el.remove();vi.clearAllMocks();});

it('searches the whole history on the server after typing stops, keeps the query in the URL, and shows the card number',async()=>{
 await mount('/review/decisions');
 await vi.waitFor(()=>expect(el.textContent).toContain('夜行'));
 expect(el.textContent).toContain('#10001');
 const input=el.querySelector<HTMLInputElement>('input[type=search]')!;
 expect(input.placeholder).toBe(i18n.global.t('review.history.search.placeholder'));
 input.value='月下';input.dispatchEvent(new Event('input'));
 await vi.waitFor(()=>expect(router.currentRoute.value.query.q).toBe('月下'),{timeout:2000});
 await vi.waitFor(()=>expect(el.textContent).not.toContain('夜行'));
 expect(api.fetchReviewDecisions).toHaveBeenLastCalledWith('tok',expect.any(String),undefined,'月下');
});

it('a search with no match explains how matching works and clears back to the full list; reopening keeps the query',async()=>{
 await mount('/review/decisions?q=沒有');
 await vi.waitFor(()=>expect(el.querySelector('[data-search-empty]')).toBeTruthy());
 expect(el.querySelector<HTMLInputElement>('input[type=search]')!.value).toBe('沒有');
 expect(el.textContent).toContain(i18n.global.t('review.history.search.emptyHint'));
 expect(el.textContent).not.toContain(i18n.global.t('review.history.empty'));
 [...el.querySelectorAll('button')].find(b=>b.textContent?.trim()===i18n.global.t('review.history.search.clear'))!.click();
 await vi.waitFor(()=>expect(el.textContent).toContain('夜行'));
 expect(router.currentRoute.value.query.q).toBeUndefined();
 expect(el.querySelector<HTMLInputElement>('input[type=search]')!.value).toBe('');
});

it('the pending tab shows no number until the count is known, never a made-up 0',async()=>{
 api.fetchReviewMe.mockImplementationOnce(()=>new Promise(()=>{}));
 await mount('/review/decisions');
 await vi.waitFor(()=>expect(el.textContent).toContain('夜行'));
 const tab=el.querySelector('.review-tabs a')!;
 expect(tab.textContent?.trim()).toBe(i18n.global.t('review.queue.tab.pendingNoCount'));
});

it('each row states the current result as a label, without a sentence ending',async()=>{
 await mount('/review/decisions');
 await vi.waitFor(()=>expect(el.textContent).toContain('夜行'));
 expect(el.textContent).toContain(i18n.global.t('review.history.status.rejected'));
 expect(el.textContent).not.toContain(i18n.global.t('review.done.rejected'));
});

it('loading the next page keeps the button, disabled, and says it is loading',async()=>{
 let release!:(v:unknown)=>void;
 api.fetchReviewDecisions.mockReset()
  .mockResolvedValueOnce({items:[row('1','夜行')],nextCursor:5})
  .mockImplementationOnce(()=>new Promise((r)=>{release=r;}));
 await mount('/review/decisions');
 await vi.waitFor(()=>expect(el.querySelector('[data-load-more]')).toBeTruthy());
 const more=el.querySelector<HTMLButtonElement>('[data-load-more]')!;
 expect(more.textContent?.trim()).toBe(i18n.global.t('res.more'));
 more.click();
 await vi.waitFor(()=>expect(more.textContent?.trim()).toBe(i18n.global.t('state.loading')));
 expect(more.disabled).toBe(true);
 release({items:[row('2','月下')],nextCursor:null});
 await vi.waitFor(()=>expect(el.textContent).toContain('月下'));
 expect(el.querySelector('[data-load-more]')).toBeNull();
});
