import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {createApp,type App} from 'vue';
import {createRouter,createMemoryHistory} from 'vue-router';
import {i18n} from '../src/lib/i18n';
import {confirmState,settleConfirm} from '../src/lib/confirm';
const api=vi.hoisted(()=>({claimReview:vi.fn(async()=>({})),fetchReviewDetail:vi.fn(),fetchReviewQueue:vi.fn(async()=>({items:[],claimTtlMs:1})),fetchReviewOriginality:vi.fn(),releaseReview:vi.fn(),stampReview:vi.fn(),holdReview:vi.fn(),unholdReview:vi.fn(),withdrawReopen:vi.fn(),correctReviewDecision:vi.fn(),updateReviewTags:vi.fn(),ApiError:class extends Error{constructor(readonly status:number,message:string,readonly code='',readonly reviewLength?:unknown){super(message);}}}));
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
// 2026-11-02：直接開連結撞到「請先領取」時自動再領一次，不再停在一顆領取鈕前
it('claims automatically after opening an unclaimed submission, then retries its detail',async()=>{
 await vi.waitFor(()=>expect(api.claimReview).toHaveBeenCalledWith('s1','local-reviewer'));
 await vi.waitFor(()=>expect(api.fetchReviewDetail).toHaveBeenCalledTimes(2));
 expect(api.claimReview).toHaveBeenCalledTimes(1);
});

it('explains a submission another reviewer holds and only offers the way back to the queue',async()=>{
 app.unmount();api.claimReview.mockClear();
 api.fetchReviewDetail.mockReset().mockRejectedValue(new api.ApiError(409,'x','claim this submission first'));
 api.claimReview.mockRejectedValueOnce(new api.ApiError(409,'x','claimed by another reviewer'));
 const router=createRouter({history:createMemoryHistory(),routes:[{path:'/review/:id',component:Page},{path:'/review',component:{template:'<p>Queue</p>'}}]});await router.push('/review/s1');app=createApp(Page).use(router).use(i18n);app.mount(el);
 await vi.waitFor(()=>expect(el.querySelector('[data-claim-taken]')?.textContent).toContain(i18n.global.t('review.claim.otherNote')));
 expect(el.querySelector('[data-claim-taken] a')?.getAttribute('href')).toBe('/review');
 expect([...el.querySelectorAll('button')].some(b=>b.textContent?.trim()===i18n.global.t('review.action.claim'))).toBe(false);
 expect(api.claimReview).toHaveBeenCalledTimes(1);
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
 // 回頭看自己審過的單：結果卡，不是可以再填的決定區
 expect(el.querySelector('[data-result-card]')).toBeTruthy();
 expect(el.textContent).toContain(i18n.global.t('review.result.now.approved'));
 expect(el.querySelector('#review-note')).toBeNull();
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

it('reveals a focused review tab before activation without changing the selected section', async () => {
 api.fetchReviewDetail.mockReset().mockResolvedValue(pendingDetail());
 await remount();
 // 八格都在分頁條上（owner 2026-11-02：不收進「更多」）
 await vi.waitFor(()=>expect(el.querySelectorAll('.tabs button')).toHaveLength(8));
 const tabs=el.querySelectorAll<HTMLButtonElement>('.tabs button');
 const reveal=vi.fn();
 tabs[4].scrollIntoView=reveal;
 tabs[4].focus();
 await vi.waitFor(()=>expect(reveal).toHaveBeenCalledWith({block:'nearest',inline:'nearest'}));
 expect(tabs[0].getAttribute('aria-pressed')).toBe('true');
 expect(tabs[4].getAttribute('aria-pressed')).toBe('false');
});

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

const correctionFailures=[
 ['review_correction_reward_pending','review.correction.rewardPending'],
 ['review_correction_unknown','review.correction.unknown'],
];
const readFailures=[
 [503,'temporary_failure','state.loadFailed'],
 [502,'unexpected_upstream_reason','state.loadFailed'],
 [0,'private network diagnostic','state.loadFailed'],
 [401,'unauthorized','auth.expired'],
 [403,'reviewer_required','state.forbidden'],
 [403,'age_verification_required','error.ageVerificationRequired'],
 [400,'invalid_arguments','error.invalidArguments'],
 [404,'snapshot not found','state.notFound'],
 [410,'review no longer active','review.inactive'],
 [409,'claim this submission first','review.claimFirst'],
] as const;
it.each(correctionFailures.flatMap(([code,key])=>readFailures.map(([status,readCode,readKey])=>({code,key,status,readCode,readKey}))))('keeps $code and subsequent $readCode read failures localized and actionable',async({code,key,status,readCode,readKey})=>{
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
 expect(confirmState.current!.message).toContain(i18n.global.t('review.confirm.row',{label:i18n.global.t('review.correction.reason'),value:'The setting needs more detail.'}));
 settleConfirm(true);
 await vi.waitFor(()=>expect(api.correctReviewDecision).toHaveBeenCalledTimes(1));
 await vi.waitFor(()=>expect(el.querySelector('.verdict [role="alert"]')?.textContent).toContain(i18n.global.t(key)));
 const notice=el.querySelector<HTMLElement>('.verdict [role="alert"]')!;
 await vi.waitFor(()=>expect(document.activeElement).toBe(notice));
 expect(input.value).toBe('The setting needs more detail.');
 api.fetchReviewDetail.mockRejectedValueOnce(status?new api.ApiError(status,'diagnostic ('+readCode+')',readCode):new Error(readCode));
 notice.querySelector('button')!.click();
 await vi.waitFor(()=>expect(el.querySelector('.verdict [role="alert"]')?.textContent).toContain(i18n.global.t(readKey)));
 expect(el.querySelector('.verdict [role="alert"]')!.textContent).not.toContain(readCode);
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
 const detail=pendingDetail([{verdict:'approve',note:'',at:1,mine:true} as any,{verdict:'reject',note:long,at:2}]);
 api.fetchReviewDetail.mockReset().mockResolvedValue({...detail,submission:{...detail.submission,claimedByMe:false,stampedByMe:true}});
 await remount();
 await vi.waitFor(()=>expect(el.querySelector('[data-other-stamps] .record__note')).toBeTruthy());
 expect(el.querySelector('[data-other-stamps] .record__note')!.textContent).toBe(long);
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

it('a resubmitted card shows which submission it is and the previous rejection; first submissions show neither',async()=>{
 const base=pendingDetail();
 api.fetchReviewDetail.mockReset().mockResolvedValue({...base,submission:{...base.submission,attempt:3,previous:{status:'rejected',note:'開場白還是空的\n世界書太長',submittedAt:Date.UTC(2026,10,1,8),decidedAt:Date.UTC(2026,10,1,9)}}});
 await remount();
 await vi.waitFor(()=>expect(el.querySelector('[data-attempt]')?.textContent?.trim()).toBe(i18n.global.t('review.attempt',{n:3})));
 const previous=el.querySelector('[data-previous-submission]')!;
 expect(previous.querySelector('summary')?.textContent?.trim()).toBe(i18n.global.t('review.previous.rejected',{reason:'開場白還是空的\n世界書太長'}));
 expect(previous.textContent).toContain(i18n.global.t('review.previous.submittedAt',{time:''}).trim());

 api.fetchReviewDetail.mockReset().mockResolvedValue({...base,submission:{...base.submission,attempt:2,previous:{status:'approved',note:'',submittedAt:1,decidedAt:2}}});
 await remount();
 await vi.waitFor(()=>expect(el.querySelector('[data-previous-submission]')?.textContent).toContain(i18n.global.t('review.previous.approved')));
 expect(el.querySelector('[data-previous-submission] summary')).toBeNull();

 api.fetchReviewDetail.mockReset().mockResolvedValue({...base,submission:{...base.submission,attempt:1,previous:null}});
 await remount();
 await vi.waitFor(()=>expect(el.querySelector('#review-note')).toBeTruthy());
 expect(el.querySelector('[data-attempt]')).toBeNull();
 expect(el.querySelector('[data-previous-submission]')).toBeNull();
});

// 審核工具第一批（2026-11-02）：字數門檻、常用理由、盲審、結果卡、讀卡分頁
const withLength=(total:number,extra:Record<string,unknown>={})=>{
 const d=pendingDetail();
 return {...d,submission:{...d.submission,...extra},detail:{...d.detail,reviewLength:{persona:total,constantWorldbook:0,total,required:3001,remaining:Math.max(0,3001-total),eligible:total>=3001,welcome:0}}};
};
const button=(text:string)=>[...el.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent?.trim()===text);

it('3,000 counted characters: approve is disabled with the gap explained; reject stays available',async()=>{
 api.fetchReviewDetail.mockReset().mockResolvedValue(withLength(3000));
 await remount();
 await vi.waitFor(()=>expect(el.querySelector('[data-approve-blocked]')).toBeTruthy());
 const approve=button(i18n.global.t('review.action.approve'))!;
 expect(approve.disabled).toBe(true);
 expect(approve.getAttribute('aria-describedby')).toBe('approve-blocked');
 expect(el.querySelector('#approve-blocked')!.textContent).toBe(i18n.global.t('review.decide.approveBlocked',{total:'3,000',gap:'1'}));
 const note=el.querySelector<HTMLTextAreaElement>('#review-note')!;
 note.value='開場也再補一點。';note.dispatchEvent(new Event('input'));
 // 「有效字數不足」只在未達標時出現；點了接在已打的字後面，另起一行
 el.querySelector<HTMLButtonElement>('[data-reason="count"]')!.click();
 await vi.waitFor(()=>expect(note.value).toBe('開場也再補一點。\n'+i18n.global.t('review.reason.count.text',{total:'3,000',gap:'1',required:'3,001'})));
 expect(button(i18n.global.t('review.action.reject'))!.disabled).toBe(false);
});

it('3,001 counted characters: approve is enabled and the count reason is not offered',async()=>{
 api.fetchReviewDetail.mockReset().mockResolvedValue(withLength(3001));
 await remount();
 await vi.waitFor(()=>expect(button(i18n.global.t('review.action.approve'))).toBeTruthy());
 expect(button(i18n.global.t('review.action.approve'))!.disabled).toBe(false);
 expect(el.querySelector('[data-approve-blocked]')).toBeNull();
 expect(el.querySelector('[data-reason="count"]')).toBeNull();
 el.querySelector<HTMLButtonElement>('[data-reason="rating"]')!.click();
 await vi.waitFor(()=>expect(el.querySelector<HTMLTextAreaElement>('#review-note')!.value).toBe(i18n.global.t('review.reason.rating.text')));
});

it('an unknown count does not block approval and says so',async()=>{
 const d=pendingDetail();
 api.fetchReviewDetail.mockReset().mockResolvedValue({...d,detail:{...d.detail,partial:true}});
 await remount();
 await vi.waitFor(()=>expect(el.textContent).toContain(i18n.global.t('review.decide.lengthUnknown')));
 expect(button(i18n.global.t('review.action.approve'))!.disabled).toBe(false);
});

it('the server refusing a short approval shows the count where the decision is made',async()=>{
 api.fetchReviewDetail.mockReset().mockResolvedValue(withLength(3600));
 api.stampReview.mockRejectedValue(new api.ApiError(400,'x','review_length_insufficient',{total:3000,required:3001,remaining:1,eligible:false} as any));
 await remount();
 await vi.waitFor(()=>expect(button(i18n.global.t('review.action.approve'))).toBeTruthy());
 button(i18n.global.t('review.action.approve'))!.click();
 await vi.waitFor(()=>expect(confirmState.current).toBeTruthy());settleConfirm(true);
 await vi.waitFor(()=>expect(el.querySelector('.verdict [role="alert"]')?.textContent).toContain(i18n.global.t('review.decide.errorLength',{total:'3,000',required:'3,001'})));
 expect(el.querySelector('[data-result-card]')).toBeNull();
});

it('after deciding, the decision area becomes a result card with my decision, the current result and the next card',async()=>{
 const before=withLength(3600);
 api.fetchReviewDetail.mockReset().mockResolvedValueOnce(before)
  .mockResolvedValue({...before,submission:{...before.submission,claimedByMe:false,stampedByMe:true,status:'approved',stamps:[{verdict:'approve',note:'',at:2,mine:true}]}});
 api.stampReview.mockResolvedValue({status:'approved',cardStatus:'approved'});
 api.fetchReviewQueue.mockResolvedValue({items:[{id:'s9',kind:'first',submittedAt:1,card:{id:'9',roleId:'r9',name:'下一張',summary:'',avatarUrl:null,zone:'zh',tags:[]},stamps:{approve:0,required:1},claim:'free',stampedByMe:false}],claimTtlMs:1});
 await remount();
 await vi.waitFor(()=>expect(button(i18n.global.t('review.action.approve'))).toBeTruthy());
 button(i18n.global.t('review.action.approve'))!.click();
 await vi.waitFor(()=>expect(confirmState.current).toBeTruthy());settleConfirm(true);
 await vi.waitFor(()=>expect(el.querySelector('[data-result-card]')).toBeTruthy());
 expect(el.textContent).toContain(i18n.global.t('review.result.mine.approve'));
 expect(el.textContent).toContain(i18n.global.t('review.result.now.approved'));
 await vi.waitFor(()=>expect(button(i18n.global.t('review.result.next',{n:1}))).toBeTruthy());
 expect(el.querySelector('#review-note')).toBeNull();
 api.claimReview.mockClear();
 button(i18n.global.t('review.result.next',{n:1}))!.click();
 await vi.waitFor(()=>expect(api.claimReview).toHaveBeenCalledWith('s9','local-reviewer'));
});

it('an empty queue after deciding offers only the way back',async()=>{
 const d=withLength(3600);
 api.fetchReviewDetail.mockReset().mockResolvedValue({...d,submission:{...d.submission,claimedByMe:false,stampedByMe:true,status:'rejected',stamps:[{verdict:'reject',note:'設定太少',at:2,mine:true}]}});
 await remount();
 await vi.waitFor(()=>expect(el.textContent).toContain(i18n.global.t('review.result.queueEmpty')));
 expect(el.textContent).toContain(i18n.global.t('review.result.now.rejected'));
 expect(el.textContent).toContain('設定太少');
 expect([...el.querySelectorAll('button')].some(b=>b.textContent?.includes(i18n.global.t('review.result.next',{n:0}).slice(0,3)))).toBe(false);
});

it('every section, including regex/layout and cost, sits directly in the tab bar',async()=>{
 api.fetchReviewDetail.mockReset().mockResolvedValue(withLength(3600));
 await remount();
 await vi.waitFor(()=>expect(button(i18n.global.t('review.section.cost'))).toBeTruthy());
 expect(el.querySelector('[data-more]')).toBeNull();
 expect(button(i18n.global.t('review.section.display'))).toBeTruthy();
 button(i18n.global.t('review.section.cost'))!.click();
 await vi.waitFor(()=>expect(button(i18n.global.t('review.section.cost'))!.getAttribute('aria-pressed')).toBe('true'));
 // 內容雜湊是內部識別碼，不給審核員看
 expect(el.textContent).not.toContain('version:v2');
});

it('an adult card the reviewer has not age-verified explains what to do instead of offering a claim that cannot work',async()=>{
 app.unmount();api.claimReview.mockClear();
 api.fetchReviewDetail.mockReset().mockRejectedValue(new api.ApiError(409,'x','claim this submission first'));
 api.claimReview.mockRejectedValueOnce(new api.ApiError(403,'x','age_verification_required'));
 const router=createRouter({history:createMemoryHistory(),routes:[{path:'/review/:id',component:Page},{path:'/review',component:{template:'<p>Queue</p>'}}]});await router.push('/review/s1');app=createApp(Page).use(router).use(i18n);app.mount(el);
 await vi.waitFor(()=>expect(el.textContent).toContain(i18n.global.t('error.ageVerificationRequired')));
 expect(button(i18n.global.t('review.action.claim'))).toBeUndefined();
});

it('opening the next card in the same page drops the previous card\'s similarity result',async()=>{
 const decided=withLength(3600,{claimedByMe:false,stampedByMe:true,status:'rejected',stamps:[{verdict:'reject',note:'x',at:2,mine:true}]});
 const next={...withLength(3600),submission:{...withLength(3600).submission,id:'s9'}};
 api.fetchReviewDetail.mockReset().mockImplementation(async(id:string)=>id==='s9'?next:decided);
 api.fetchReviewOriginality.mockReset().mockImplementation((id:string)=>id==='s1'?Promise.resolve({available:true,similarity:0.42,units:1,comparedCards:1,segments:[],sources:[]}):new Promise(()=>{}));
 api.fetchReviewQueue.mockResolvedValue({items:[{id:'s9',kind:'first',submittedAt:1,card:{id:'9',roleId:'r9',name:'下一張',summary:'',avatarUrl:null,zone:'zh',tags:[]},stamps:{approve:0,required:1},claim:'free',stampedByMe:false}],claimTtlMs:1});
 await remount();
 await vi.waitFor(()=>expect(el.querySelector('.tabs')?.textContent).toContain('42%'));
 await vi.waitFor(()=>expect(button(i18n.global.t('review.result.next',{n:1}))).toBeTruthy());
 button(i18n.global.t('review.result.next',{n:1}))!.click();
 await vi.waitFor(()=>expect(el.querySelector('#review-note')).toBeTruthy());
 expect(el.querySelector('.tabs')!.textContent).not.toContain('42%');
});

it('the phone bottom bar is for reaching the decision: gone once the card is decided',async()=>{
 api.fetchReviewDetail.mockReset().mockResolvedValue(withLength(3600));
 await remount();
 await vi.waitFor(()=>expect(el.querySelector('.dock')).toBeTruthy());
 app.unmount();
 const d=withLength(3600,{claimedByMe:false,stampedByMe:true,status:'rejected',stamps:[{verdict:'reject',note:'x',at:2,mine:true}]});
 api.fetchReviewDetail.mockReset().mockResolvedValue(d);
 await remount();
 await vi.waitFor(()=>expect(el.querySelector('[data-result-card]')).toBeTruthy());
 expect(el.querySelector('.dock')).toBeNull();
});

it('marks the count status so short and eligible look different, and writes confirm rows with the localized separator',async()=>{
 api.fetchReviewDetail.mockReset().mockResolvedValue(withLength(3000));
 await remount();
 await vi.waitFor(()=>expect(el.querySelector('[data-length-status]')).toBeTruthy());
 expect(el.querySelector('[data-length-status]')!.classList.contains('length-status--short')).toBe(true);
 const note=el.querySelector<HTMLTextAreaElement>('#review-note')!;note.value='x';note.dispatchEvent(new Event('input'));
 await vi.waitFor(()=>expect(button(i18n.global.t('review.action.reject'))!.disabled).toBe(false));
 button(i18n.global.t('review.action.reject'))!.click();
 await vi.waitFor(()=>expect(confirmState.current).toBeTruthy());
 expect(confirmState.current!.message).toContain(i18n.global.t('review.confirm.row',{label:i18n.global.t('review.confirm.card'),value:'Night Detective'}));
 settleConfirm(false);
});

it('a reason that would push the note past 2,000 characters is not added, and the page says why',async()=>{
 api.fetchReviewDetail.mockReset().mockResolvedValue(withLength(3600));
 await remount();
 await vi.waitFor(()=>expect(el.querySelector('#review-note')).toBeTruthy());
 const note=el.querySelector<HTMLTextAreaElement>('#review-note')!;
 expect(note.maxLength).toBe(2000);
 note.value='x'.repeat(1990);note.dispatchEvent(new Event('input'));
 el.querySelector<HTMLButtonElement>('[data-reason="setting"]')!.click();
 await vi.waitFor(()=>expect(el.querySelector('[data-note-full]')).toBeTruthy());
 expect(note.value).toBe('x'.repeat(1990));
 expect(el.querySelector('[data-note-full]')!.textContent).toBe(i18n.global.t('review.decide.noteFull',{max:'2,000'}));
 // 刪掉一些再點：放得下就照常接上，說明也收起
 note.value='x'.repeat(10);note.dispatchEvent(new Event('input'));
 el.querySelector<HTMLButtonElement>('[data-reason="setting"]')!.click();
 await vi.waitFor(()=>expect(note.value).toBe('x'.repeat(10)+'\n'+i18n.global.t('review.reason.setting.text')));
 expect(el.querySelector('[data-note-full]')).toBeNull();
});

// 冷凍並討論（審核員 2026-11-08）
const t=(k:string,p?:Record<string,unknown>)=>i18n.global.t(k,p??{});
const btn=(label:string)=>[...el.querySelectorAll('button')].find(b=>b.textContent?.trim()===label) as HTMLButtonElement|undefined;
const held=(hold:{holder:string;at:number;byMe:boolean;canRelease:boolean},claimedByMe=false)=>{const d=pendingDetail();return {...d,submission:{...d.submission,claimedByMe,hold}};};

it('a claimed reviewer can hold the card; the page then says nobody can decide, including them',async()=>{
 api.fetchReviewDetail.mockReset().mockResolvedValueOnce(pendingDetail()).mockResolvedValue(held({holder:'Mika',at:5,byMe:true,canRelease:true}));
 api.holdReview.mockResolvedValue({hold:{holder:'Mika',at:5,byMe:true,canRelease:true}});
 await remount();
 await vi.waitFor(()=>expect(el.querySelector('[data-hold]')).toBeTruthy());
 (el.querySelector('[data-hold]') as HTMLButtonElement).click();
 await vi.waitFor(()=>expect(api.holdReview).toHaveBeenCalledWith('s1','local-reviewer','g1'));
 await vi.waitFor(()=>expect(el.querySelector('[data-hold-notice]')?.textContent).toContain(t('review.hold.noticeMine')));
 expect(el.textContent).toContain(t('review.hold.done'));
 expect(btn(t('review.action.approve'))?.disabled).toBe(true);
 expect(btn(t('review.action.reject'))?.disabled).toBe(true);
 expect(el.querySelector('[data-hold-blocked]')).toBeTruthy();
 expect(el.querySelector('[data-hold]')).toBeNull();
 expect(el.querySelector('[data-hold-notice] [data-unhold]')).toBeTruthy();
});

it('another reviewer reading a held card sees who holds it, cannot decide and cannot release it',async()=>{
 api.fetchReviewDetail.mockReset().mockResolvedValue(held({holder:'Mika',at:5,byMe:false,canRelease:false},true));
 await remount();
 await vi.waitFor(()=>expect(el.querySelector('[data-hold-notice]')?.textContent).toContain(t('review.hold.noticeOther',{name:'Mika'})));
 expect(btn(t('review.action.approve'))?.disabled).toBe(true);
 expect(el.querySelector('[data-unhold]')).toBeNull();
 expect(el.querySelector('[data-hold]')).toBeNull();
 // 手機底部「前往決定」也收起：沒有可以決定的東西
 expect(el.querySelector('.dock')).toBeNull();
});

it('a manager releasing someone else\'s hold must write a reason first',async()=>{
 api.fetchReviewDetail.mockReset().mockResolvedValueOnce(held({holder:'Mika',at:5,byMe:false,canRelease:true},true)).mockResolvedValue(pendingDetail());
 api.unholdReview.mockResolvedValue({hold:null});
 await remount();
 await vi.waitFor(()=>expect(el.querySelector('[data-unhold]')).toBeTruthy());
 (el.querySelector('[data-unhold]') as HTMLButtonElement).click();
 await vi.waitFor(()=>expect(el.querySelector('#hold-reason')).toBeTruthy());
 expect(api.unholdReview).not.toHaveBeenCalled();
 expect((el.querySelector('[data-unhold]') as HTMLButtonElement).disabled).toBe(true);
 const box=el.querySelector('#hold-reason') as HTMLTextAreaElement;box.value='冷凍人已不在審核群';box.dispatchEvent(new Event('input'));
 await vi.waitFor(()=>expect((el.querySelector('[data-unhold]') as HTMLButtonElement).disabled).toBe(false));
 (el.querySelector('[data-unhold]') as HTMLButtonElement).click();
 await vi.waitFor(()=>expect(api.unholdReview).toHaveBeenCalledWith('s1','local-reviewer','冷凍人已不在審核群'));
 await vi.waitFor(()=>expect(el.querySelector('[data-hold-notice]')).toBeNull());
 expect(el.textContent).toContain(t('review.hold.released'));
});

it('a hold placed just before approving explains itself where the decision is made',async()=>{
 api.fetchReviewDetail.mockReset().mockResolvedValueOnce(pendingDetail()).mockResolvedValue(held({holder:'Mika',at:5,byMe:false,canRelease:false},true));
 api.stampReview.mockRejectedValue(new api.ApiError(409,'x','review_held'));
 await remount();
 await vi.waitFor(()=>expect(btn(t('review.action.approve'))).toBeTruthy());
 btn(t('review.action.approve'))!.click();
 await vi.waitFor(()=>expect(confirmState.current).toBeTruthy());
 settleConfirm(true);
 await vi.waitFor(()=>expect(el.textContent).toContain(t('review.hold.decideBlocked')));
 await vi.waitFor(()=>expect(el.querySelector('[data-hold-notice]')).toBeTruthy());
});

it('after the holder releases a card someone else is reading, the page stops saying it is held',async()=>{
 api.fetchReviewDetail.mockReset().mockResolvedValueOnce(held({holder:'Mika',at:5,byMe:true,canRelease:true})).mockRejectedValue(new api.ApiError(409,'x','claim this submission first'));
 api.claimReview.mockRejectedValue(new api.ApiError(409,'x','claimed by another reviewer'));
 api.unholdReview.mockResolvedValue({hold:null});
 await remount();
 await vi.waitFor(()=>expect(el.querySelector('[data-hold-notice] [data-unhold]')).toBeTruthy());
 // 冷凍人沒領著：標頭的領取鈕說「領取並查看」，說明欄不能填
 expect(btn(t('review.action.claimHeld'))).toBeTruthy();
 expect((el.querySelector('#review-note') as HTMLTextAreaElement).disabled).toBe(true);
 (el.querySelector('[data-unhold]') as HTMLButtonElement).click();
 await vi.waitFor(()=>expect(api.unholdReview).toHaveBeenCalledWith('s1','local-reviewer',undefined));
 await vi.waitFor(()=>expect(el.querySelector('[data-hold-notice]')).toBeNull());
 expect(el.textContent).toContain(t('review.hold.released'));
});

// 重新審核
const reopened=(manager:boolean)=>{const d=pendingDetail();return {...d,submission:{...d.submission,reopen:true,reopenReason:'疑似盜用他人設定',manager}};};

it('a re-review says the card is published, shows the reason, offers keep-approved and locks rejection for non-managers',async()=>{
 api.fetchReviewDetail.mockReset().mockResolvedValue(reopened(false));
 await remount();
 await vi.waitFor(()=>expect(el.querySelector('[data-reopen-notice]')?.textContent).toContain(t('review.reopen.notice')));
 expect(el.querySelector('[data-reopen-notice]')?.textContent).toContain('疑似盜用他人設定');
 expect(btn(t('review.action.keep'))).toBeTruthy();
 expect(btn(t('review.action.approve'))).toBeUndefined();
 expect(btn(t('review.action.reject'))?.disabled).toBe(true);
 expect(el.querySelector('[data-reject-locked]')?.textContent).toContain(t('review.reopen.rejectManager'));
 expect(el.querySelector('[data-withdraw]')).toBeNull();
});

it('a manager can withdraw a re-review after writing a reason',async()=>{
 api.fetchReviewDetail.mockReset().mockResolvedValueOnce(reopened(true)).mockResolvedValue({...reopened(true),submission:{...reopened(true).submission,status:'superseded'}});
 api.withdrawReopen=vi.fn(async()=>({status:'superseded'})) as any;
 await remount();
 await vi.waitFor(()=>expect(el.querySelector('[data-withdraw]')).toBeTruthy());
 (el.querySelector('[data-withdraw]') as HTMLButtonElement).click();
 await vi.waitFor(()=>expect(el.querySelector('#withdraw-reason')).toBeTruthy());
 const box=el.querySelector('#withdraw-reason') as HTMLTextAreaElement;box.value='確認是原作者';box.dispatchEvent(new Event('input'));
 await vi.waitFor(()=>expect((el.querySelector('[data-withdraw]') as HTMLButtonElement).disabled).toBe(false));
 (el.querySelector('[data-withdraw]') as HTMLButtonElement).click();
 await vi.waitFor(()=>expect(api.withdrawReopen).toHaveBeenCalledWith('s1','local-reviewer','確認是原作者'));
 await vi.waitFor(()=>expect(el.textContent).toContain(t('review.reopen.withdrawn')));
});
