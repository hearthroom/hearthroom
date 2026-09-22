import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {createApp,type App} from 'vue';
import {createRouter,createMemoryHistory} from 'vue-router';
import {i18n} from '../src/lib/i18n';
const api=vi.hoisted(()=>({claimReview:vi.fn(async()=>({})),fetchReviewDetail:vi.fn(),releaseReview:vi.fn(),stampReview:vi.fn(),ApiError:class extends Error{constructor(readonly status:number,message:string){super(message);}}}));
vi.mock('../src/lib/api',()=>api);
vi.mock('../src/lib/session',()=>({useSession:()=>({accessToken:async()=> 'local-reviewer'})}));
import Page from '../src/pages/ReviewDetailPage.vue';
let app:App,el:HTMLElement;
let inactive=false;
beforeEach(async()=>{
 if(inactive)api.fetchReviewDetail.mockRejectedValue(new api.ApiError(410,'review no longer active'));
 else api.fetchReviewDetail.mockRejectedValueOnce(new api.ApiError(409,'claim this submission first')).mockRejectedValue(new Error('detail unavailable'));
 el=document.createElement('div');document.body.append(el);const router=createRouter({history:createMemoryHistory(),routes:[{path:'/review/:id',component:Page}]});await router.push('/review/s1');app=createApp(Page).use(router).use(i18n);app.mount(el);
});
afterEach(()=>{app.unmount();el.remove();vi.resetAllMocks();});
it('offers a claim action after opening an unclaimed submission, then retries its detail',async()=>{
 await vi.waitFor(()=>expect(el.textContent).toContain(i18n.global.t('review.claimFirst')));
 expect(el.textContent).not.toContain(i18n.global.t('review.revoked'));
 const button=[...el.querySelectorAll('button')].find(b=>b.textContent===i18n.global.t('review.action.claim'))!;expect(button).toBeDefined();button.click();
 await vi.waitFor(()=>expect(api.claimReview).toHaveBeenCalledWith('s1','local-reviewer'));
 await vi.waitFor(()=>expect(api.fetchReviewDetail).toHaveBeenCalledTimes(2));
});

it('terminal review link explains expiry and returns to the queue',async()=>{
 app.unmount(); inactive=true;api.fetchReviewDetail.mockRejectedValue(new api.ApiError(410,'review no longer active'));
 const router=createRouter({history:createMemoryHistory(),routes:[{path:'/review/:id',component:Page},{path:'/review',component:{template:'<p>Queue</p>'}}]});await router.push('/review/s1');app=createApp(Page).use(router).use(i18n);app.mount(el);
 await vi.waitFor(()=>expect(el.textContent).toContain(i18n.global.t('review.inactive')));
 expect(el.querySelector('a')?.getAttribute('href')).toBe('/review');inactive=false;
});
