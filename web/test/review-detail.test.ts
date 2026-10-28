import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {createApp,type App} from 'vue';
import {createRouter,createMemoryHistory} from 'vue-router';
import {i18n} from '../src/lib/i18n';
import {confirmState,settleConfirm} from '../src/lib/confirm';
const api=vi.hoisted(()=>({claimReview:vi.fn(async()=>({})),fetchReviewDetail:vi.fn(),releaseReview:vi.fn(),stampReview:vi.fn(),correctReviewDecision:vi.fn(),updateReviewTags:vi.fn(),ApiError:class extends Error{constructor(readonly status:number,message:string,readonly code=''){super(message);}}}));
vi.mock('../src/lib/api',()=>api);
vi.mock('../src/lib/session',()=>({useSession:()=>({accessToken:async()=> 'local-reviewer'})}));
import Page from '../src/pages/ReviewDetailPage.vue';
let app:App,el:HTMLElement;
let inactive=false;
beforeEach(async()=>{
 if(inactive)api.fetchReviewDetail.mockRejectedValue(new api.ApiError(410,'review no longer active'));
 else api.fetchReviewDetail.mockRejectedValueOnce(new api.ApiError(409,i18n.global.t('state.requestFailed'),'claim this submission first')).mockRejectedValue(new Error('detail unavailable'));
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
  submission:{id:'s1',kind:'first',status:'approved',contentHash:'version:v1',submittedAt:1,rating:null,claimedByMe:false,stampedByMe:true,required:1,stamps:[{verdict:'approve',note:'',at:2}]},
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
 submission:{id:'s1',kind:'re',status:'pending',contentHash:'version:v2',submittedAt:1,rating:null,claimedByMe:true,stampedByMe:false,claimGeneration:'g1',required:1,stamps},
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

it('requires confirmation before approval, cancels without POST, and snapshots the reviewed decision',async()=>{
 api.fetchReviewDetail.mockReset().mockResolvedValue(pendingDetail());
 api.stampReview.mockResolvedValue({status:'approved',cardStatus:'approved'});
 await remount();
 await vi.waitFor(()=>expect(el.querySelector('#review-note')).toBeTruthy());
 const approve=()=>[...el.querySelectorAll('button')].find(b=>b.textContent?.trim()===i18n.global.t('review.action.approve'))!;
 approve().click();
 await vi.waitFor(()=>expect(confirmState.current).toBeTruthy());
 expect(api.stampReview).not.toHaveBeenCalled();
 expect(confirmState.current!.message).toContain('Night Detective');
 settleConfirm(false);
 await vi.waitFor(()=>expect(approve().disabled).toBe(false));expect(api.stampReview).not.toHaveBeenCalled();
 approve().click();await vi.waitFor(()=>expect(confirmState.current).toBeTruthy());
 settleConfirm(true);
 await vi.waitFor(()=>expect(api.stampReview).toHaveBeenCalledWith('s1','local-reviewer',{verdict:'approve',note:'',generation:'g1'}));
});

it('clears the old actionable submission immediately while the next route detail is still loading',async()=>{
 app.unmount();
 let release!:(value:any)=>void;
 api.fetchReviewDetail.mockReset().mockImplementation((id:string)=>id==='s1'?Promise.resolve(pendingDetail()):new Promise(resolve=>{release=resolve;}));
 const router=createRouter({history:createMemoryHistory(),routes:[{path:'/review/:id',component:Page}]});
 await router.push('/review/s1');
 app=createApp({template:'<router-view />'}).use(router).use(i18n);app.mount(el);
 await vi.waitFor(()=>expect(el.querySelector('#review-note')).toBeTruthy());
 await router.push('/review/s2');
 await vi.waitFor(()=>expect(api.fetchReviewDetail).toHaveBeenCalledWith('s2','local-reviewer'));
 await vi.waitFor(()=>expect(el.querySelector('#review-note')).toBeNull());
 expect(confirmState.current).toBeNull();
 release({...pendingDetail(),submission:{...pendingDetail().submission,id:'s2'}});
});

it.each([
 ['review_correction_reward_pending','review.correction.rewardPending'],
 ['review_correction_unknown','review.correction.unknown'],
])('focuses the correction error and offers a read-only reload after %s',async(code,key)=>{
 const detail=pendingDetail();
 api.fetchReviewDetail.mockReset().mockResolvedValue({...detail,submission:{...detail.submission,status:'approved',canCorrect:true,claimedByMe:false,stampedByMe:true}});
 api.correctReviewDecision.mockRejectedValue(new api.ApiError(503,'request failed',code));
 await remount();
 const action=()=>[...el.querySelectorAll('button')].find(b=>b.textContent?.trim()===i18n.global.t('review.correction.action'))!;
 await vi.waitFor(()=>expect(action()).toBeTruthy());action().click();
 await vi.waitFor(()=>expect(el.querySelector('#correction-note')).toBeTruthy());
 const input=el.querySelector<HTMLTextAreaElement>('#correction-note')!;
 input.value='The setting needs more detail.';input.dispatchEvent(new Event('input',{bubbles:true}));
 await vi.waitFor(()=>expect([...el.querySelectorAll('button')].filter(b=>b.textContent?.trim()===i18n.global.t('review.correction.action')).at(-1)?.disabled).toBe(false));
 [...el.querySelectorAll('button')].filter(b=>b.textContent?.trim()===i18n.global.t('review.correction.action')).at(-1)!.click();
 await vi.waitFor(()=>expect(confirmState.current).toBeTruthy());
 expect(confirmState.current!.message).toContain(i18n.global.t('review.correction.reason')+': The setting needs more detail.');
 settleConfirm(true);
 await vi.waitFor(()=>expect(api.correctReviewDecision).toHaveBeenCalledTimes(1));
 await vi.waitFor(()=>expect(el.querySelector('.verdict [role="alert"]')?.textContent).toContain(i18n.global.t(key)));
 const notice=el.querySelector<HTMLElement>('.verdict [role="alert"]')!;
 await vi.waitFor(()=>expect(document.activeElement).toBe(notice));
 expect(input.value).toBe('The setting needs more detail.');
 api.fetchReviewDetail.mockRejectedValueOnce(new Error('reload unavailable'));
 notice.querySelector('button')!.click();
 await vi.waitFor(()=>expect(el.querySelector('.verdict [role="alert"]')?.textContent).toContain('reload unavailable'));
 await vi.waitFor(()=>expect(document.activeElement).toBe(el.querySelector('.verdict [role="alert"]')));
 expect(api.correctReviewDecision).toHaveBeenCalledTimes(1);
 expect(input.value).toBe('The setting needs more detail.');
 el.querySelector<HTMLButtonElement>('.verdict [role="alert"] button')!.click();
 await vi.waitFor(()=>expect(el.querySelector('.verdict [role="alert"]')).toBeNull());
 expect(api.fetchReviewDetail).toHaveBeenCalledTimes(4);
 expect(api.correctReviewDecision).toHaveBeenCalledTimes(1);
});

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
 await vi.waitFor(()=>expect(api.updateReviewTags).toHaveBeenCalledWith('s1','local-reviewer',{tags:['冒險','倫理'],fandom:'',generation:'g1'}));
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

// owner 2026-10-10：審核頁加一個分頁看作者自填的分級問卷，對照內容是不是他說的那樣
it('shows the author\'s rating answers in their own tab, including the types the author said are absent',async()=>{
 const detail=pendingDetail();
 api.fetchReviewDetail.mockReset().mockResolvedValue({...detail,submission:{...detail.submission,rating:'PG15',ratingDescriptors:['violence'],ratingAnswers:{version:1,topics:{violence:'violence.bloody',romance:'romance.dating'},other:'other.none'}}});
 await remount();
 await vi.waitFor(()=>expect(el.querySelector('.head .rating-chip--PG15')).toBeTruthy());
 [...el.querySelectorAll('.tabs button')].find(b=>b.textContent?.trim()===i18n.global.t('review.section.rating'))!.click();
 await vi.waitFor(()=>expect(el.querySelector('[data-rating-answers] [data-rating-mark] img')?.getAttribute('src')).toBe('/rating/gsrr-PG15.png'));
 const pane=el.querySelector<HTMLElement>('[data-rating-answers]')!;
 expect(pane.textContent).toContain('血腥的攻擊或殺戮，未達殘虐程度');
 expect(pane.textContent).toContain('與角色戀愛、交往或結婚的玩法');
 expect(pane.textContent).toContain(i18n.global.t('review.rating.notPicked'));
});

it('explains that a submission from before the questionnaire only has the general or adult choice',async()=>{
 api.fetchReviewDetail.mockReset().mockResolvedValue(pendingDetail());
 await remount();
 await vi.waitFor(()=>expect(el.textContent).toContain(i18n.global.t('review.section.rating')));
 [...el.querySelectorAll('.tabs button')].find(b=>b.textContent?.trim()===i18n.global.t('review.section.rating'))!.click();
 await vi.waitFor(()=>expect(el.querySelector('[data-rating-answers]')?.textContent).toContain(i18n.global.t('review.rating.legacy')));
});

it('shows the two server-calculated parts, strict minimum and informational opening count before the content tabs',async()=>{
 const detail=pendingDetail();
 const length={persona:2000,constantWorldbook:1001,total:3001,required:3001,remaining:0,eligible:true,welcome:99};
 api.fetchReviewDetail.mockReset().mockResolvedValue({...detail,detail:{...detail.detail,reviewLength:length}});
 await remount();
 await vi.waitFor(()=>expect(el.querySelector('[data-review-length]')).toBeTruthy());
 const text=el.querySelector('[data-review-length]')!.textContent!;
 expect(text).toContain(i18n.global.t('reviewLength.persona',{persona:'2,000'}));
 expect(text).toContain(i18n.global.t('reviewLength.constantWorldbook',{constantWorldbook:'1,001'}));
 expect(text).toContain(i18n.global.t('reviewLength.total',{total:'3,001',required:'3,001'}));
 expect(text).toContain(i18n.global.t('reviewLength.eligible'));
 expect(text).toContain(i18n.global.t('reviewLength.welcome',{welcome:'99'}));
});

it('shows unknown counts for older or closed reviews without classifying them as insufficient',async()=>{
 api.fetchReviewDetail.mockReset().mockResolvedValue(pendingDetail());
 await remount();
 await vi.waitFor(()=>expect(el.querySelector('[data-review-length]')).toBeTruthy());
 const text=el.querySelector('[data-review-length]')!.textContent!;
 expect(text).toContain(i18n.global.t('reviewLength.unavailable'));
 expect(text).not.toContain(i18n.global.t('reviewLength.ineligible'));
});
