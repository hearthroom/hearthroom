import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {createApp,type App} from 'vue';
import {createRouter,createMemoryHistory} from 'vue-router';
import {i18n} from '../src/lib/i18n';
const api=vi.hoisted(()=>({claimReview:vi.fn(async()=>({})),fetchReviewDetail:vi.fn(),releaseReview:vi.fn(),stampReview:vi.fn(),updateReviewTags:vi.fn(),ApiError:class extends Error{constructor(readonly status:number,message:string){super(message);}}}));
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

const pendingDetail=(stamps:{verdict:'approve'|'reject';note:string;at:number}[]=[])=>({
 submission:{id:'s1',kind:'re',status:'pending',contentHash:'version:v2',submittedAt:1,nsfw:false,claimedByMe:true,stampedByMe:false,claimGeneration:'g1',required:1,stamps},
 card:{id:'100001',roleId:'r1',tags:['冒險']},
 detail:{partial:false,document:{roleName:'Night Detective',roleDesc:'',roleAvatar:'',roleBackground:'',roleTag:'["冒險"]',userName:'',roleDetailDesc:'',roleType:'',roleSex:'',roleSpeech:'',language:'zh-Hant',talkExample:'',roleOutputContract:''},
  greetings:{welcome:'',alternates:[],prologue:[]},worldbook:null,worldbookAvailable:false,
  authorAsset:{rules:[],mountTrigger:'',mountLayer:'',pageMode:'classic',status:'',version:0},
  hashes:{card:'',welcome:'',worldbook:'',authorAsset:'',content:'version:v2'},
  costProfile:{personaChars:0,worldbookEntryCount:0,worldbookEnabledCount:0,worldbookConstantCount:0,worldbookChars:0,worldbookConstantChars:0,estimatedConstantTokens:0,estimatedMaxTokens:0}},
});
const remount=async()=>{
 app.unmount();
 const router=createRouter({history:createMemoryHistory(),routes:[{path:'/review/:id',component:Page}]});await router.push('/review/s1');app=createApp(Page).use(router).use(i18n);app.mount(el);
};

it('the reviewer holding the claim fixes a missing tag and the page shows the saved tags',async()=>{
 api.fetchReviewDetail.mockReset().mockResolvedValue(pendingDetail());
 api.updateReviewTags.mockResolvedValue({tags:['冒險','倫理']});
 await remount();
 await vi.waitFor(()=>expect(el.textContent).toContain(i18n.global.t('review.tags.edit')));
 [...el.querySelectorAll('button')].find(b=>b.textContent?.trim()===i18n.global.t('review.tags.edit'))!.click();
 await vi.waitFor(()=>expect(el.querySelector('.picker')).toBeTruthy());
 [...el.querySelectorAll<HTMLButtonElement>('.picker button')].find(b=>b.textContent?.trim()==='倫理')!.click();
 await vi.waitFor(()=>expect([...el.querySelectorAll('button')].some(b=>b.textContent?.trim()===i18n.global.t('review.tags.save'))).toBe(true));
 [...el.querySelectorAll('button')].find(b=>b.textContent?.trim()===i18n.global.t('review.tags.save'))!.click();
 await vi.waitFor(()=>expect(api.updateReviewTags).toHaveBeenCalledWith('s1','local-reviewer',{tags:['冒險','倫理'],generation:'g1'}));
 await vi.waitFor(()=>expect(el.textContent).toContain(i18n.global.t('review.tags.author',{tags:'冒險'})));
});

it('a long rejection note sits in its own block instead of a fixed-height chip',async()=>{
 const long='第一點：數值要整數化。\n'.repeat(40);
 api.fetchReviewDetail.mockReset().mockResolvedValue(pendingDetail([{verdict:'reject',note:long,at:2}]));
 await remount();
 await vi.waitFor(()=>expect(el.querySelector('.record__note')).toBeTruthy());
 expect(el.querySelector('.record__note')!.textContent).toBe(long);
 expect([...el.querySelectorAll('.chip')].some(c=>c.textContent?.includes('第一點'))).toBe(false);
});
