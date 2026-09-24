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

it('a reviewer reopening a card they already decided sees it read-only, without a claim prompt',async()=>{
 app.unmount();
 const empty={personaChars:0,worldbookEntryCount:0,worldbookEnabledCount:0,worldbookConstantCount:0,worldbookChars:0,worldbookConstantChars:0,estimatedConstantTokens:0,estimatedMaxTokens:0};
 api.fetchReviewDetail.mockReset().mockResolvedValue({
  submission:{id:'s1',kind:'first',status:'approved',contentHash:'version:v1',submittedAt:1,nsfw:false,claimedByMe:false,stampedByMe:true,required:1,stamps:[{verdict:'approve',note:'',at:2}]},
  card:{id:'100001',roleId:'r1'},
  detail:{partial:true,closed:true,document:{roleName:'Night Detective',roleDesc:'',roleAvatar:'',roleBackground:'',roleTag:'[]',userName:'',roleDetailDesc:'',roleType:'',roleSex:'',roleSpeech:'',language:'',talkExample:'',roleOutputContract:''},
   greetings:{welcome:'',alternates:[],prologue:[]},worldbook:null,worldbookAvailable:false,
   authorAsset:{rules:[],mountTrigger:'',mountLayer:'',pageMode:'classic',status:'',version:0},
   hashes:{card:'',welcome:'',worldbook:'',authorAsset:'',content:'version:v1'},costProfile:empty},
 });
 const router=createRouter({history:createMemoryHistory(),routes:[{path:'/review/:id',component:Page}]});await router.push('/review/s1');app=createApp(Page).use(router).use(i18n);app.mount(el);
 await vi.waitFor(()=>expect(el.textContent).toContain(i18n.global.t('review.closedPartial')));
 expect(el.textContent).toContain(i18n.global.t('review.stampedByMe'));
 expect(el.textContent).not.toContain(i18n.global.t('review.claimFirst'));
 expect([...el.querySelectorAll('button')].some(b=>b.textContent===i18n.global.t('review.action.claim'))).toBe(false);
});
