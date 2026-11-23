import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {createApp,type App} from 'vue';
import {createRouter,createMemoryHistory} from 'vue-router';
import {applyLocale,i18n,LOCALE_CODES} from '../src/lib/i18n';
import {confirmState,settleConfirm} from '../src/lib/confirm';
import {OPENING_SANDBOX,openingSrcdoc,OPENING_MESSAGE_TYPE} from 'stage-common/opening-page';
const api=vi.hoisted(()=>({claimReview:vi.fn(async()=>({})),fetchReviewDetail:vi.fn(),fetchReviewQueue:vi.fn(async()=>({items:[],claimTtlMs:1})),fetchReviewOriginality:vi.fn(),releaseReview:vi.fn(),stampReview:vi.fn(),holdReview:vi.fn(),unholdReview:vi.fn(),withdrawReopen:vi.fn(),correctReviewDecision:vi.fn(),updateReviewTags:vi.fn(),fetchReviewAuthorCards:vi.fn(),dropReview:vi.fn(async()=>({caseId:'k1'})),restoreReview:vi.fn(async()=>({restored:true})),markReviewAuthor:vi.fn(),fetchReviewGroup:vi.fn(),dropReviewBatch:vi.fn(),restoreReviewBatch:vi.fn(),ApiError:class extends Error{constructor(readonly status:number,message:string,readonly code='',readonly reviewLength?:unknown){super(message);}}}));
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
// 審卡 V2 決定區：三個選項都不預選，選了才展開；送出鈕跟著選項換
type Choice='approve'|'reject'|'drop';
const radio=(value:Choice)=>el.querySelector<HTMLInputElement>(`[data-decide-choices] input[name=decide][value=${value}]`);
const choose=async(value:Choice)=>{
 const input=radio(value);
 expect(input,`radio ${value}`).toBeTruthy();
 expect(input!.disabled,`radio ${value} disabled`).toBe(false);
 input!.click();
 expect(input!.checked).toBe(true);
 await vi.waitFor(()=>expect(el.querySelector(`[data-submit-${value}]`)).toBeTruthy());
};
const submit=(value:Choice)=>el.querySelector<HTMLButtonElement>(`[data-submit-${value}]`);
const reason=(code:string)=>el.querySelector<HTMLInputElement>(`[data-reason-picker] input[data-reason="${code}"]`);
const typeNote=(text:string)=>{const n=el.querySelector<HTMLTextAreaElement>('#review-note')!;n.value=text;n.dispatchEvent(new Event('input'));return n;};

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
 await vi.waitFor(()=>expect(el.querySelector('[data-decide-choices]')).toBeTruthy());
 await choose('approve');
 const approve=()=>submit('approve')!;
 expect(approve().textContent?.trim()).toBe(i18n.global.t('review.action.approve'));
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
 await vi.waitFor(()=>expect(el.querySelector('[data-decide-choices]')).toBeTruthy());
 await choose('reject');
 await vi.waitFor(()=>expect(el.querySelector('#review-note')).toBeTruthy());
 await router.push('/review/s2');
 await vi.waitFor(()=>expect(api.fetchReviewDetail).toHaveBeenCalledWith('s2','local-reviewer'));
 await vi.waitFor(()=>expect(el.querySelector('[data-decide-choices]')).toBeNull());
 expect(el.querySelector('#review-note')).toBeNull();
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
 await vi.waitFor(()=>expect(el.querySelector('[data-decide-choices]')).toBeTruthy());
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
 // 「通過」選項與送出鈕都不能按，差額寫在決定區
 expect(radio('approve')!.disabled).toBe(true);
 const approve=submit('approve')!;
 expect(approve.disabled).toBe(true);
 expect(approve.getAttribute('aria-describedby')).toBe('approve-blocked');
 expect(el.querySelector('#approve-blocked')!.textContent).toBe(i18n.global.t('review.decide.approveBlocked',{total:'3,000',gap:'1'}));
 // 駁回照樣可以：「有效字數不足」自動勾著、不能取消，其他理由不必再選
 await choose('reject');
 const count=reason('content.min_length')!;
 expect(count.checked).toBe(true);
 expect(count.disabled).toBe(true);
 count.click();
 expect(count.checked).toBe(true);
 expect(el.querySelector('[data-reason-preview]')?.textContent).toContain(i18n.global.t('review.reasons.content.min_length.name'));
 // 作者會看到的改法帶著實際字數與差額（QA 2026-11-23：曾經漏了差額）
 const fix=i18n.global.t('review.reasons.content.min_length.fixCount',{total:'3,000',gap:'1',required:'3,001'});
 expect(fix).toContain('3,000');
 expect(el.querySelector('[data-reason-preview]')?.textContent).toContain(fix);
 expect(submit('reject')!.disabled).toBe(false);
});

it('3,001 counted characters: approve is enabled and the count reason is not forced',async()=>{
 api.fetchReviewDetail.mockReset().mockResolvedValue(withLength(3001));
 await remount();
 await vi.waitFor(()=>expect(el.querySelector('[data-decide-choices]')).toBeTruthy());
 expect(el.querySelector('[data-approve-blocked]')).toBeNull();
 await choose('approve');
 expect(submit('approve')!.disabled).toBe(false);
 await choose('reject');
 const count=reason('content.min_length')!;
 expect(count.checked).toBe(false);
 expect(count.disabled).toBe(false);
 expect(el.querySelector('[data-reason-preview]')).toBeNull();
 expect(submit('reject')!.disabled).toBe(true);
});

it('an unknown count does not block approval and says so',async()=>{
 const d=pendingDetail();
 api.fetchReviewDetail.mockReset().mockResolvedValue({...d,detail:{...d.detail,partial:true}});
 await remount();
 await vi.waitFor(()=>expect(el.textContent).toContain(i18n.global.t('review.decide.lengthUnknown')));
 await choose('approve');
 expect(submit('approve')!.disabled).toBe(false);
});

it('the server refusing a short approval shows the count where the decision is made',async()=>{
 api.fetchReviewDetail.mockReset().mockResolvedValue(withLength(3600));
 api.stampReview.mockRejectedValue(new api.ApiError(400,'x','review_length_insufficient',{total:3000,required:3001,remaining:1,eligible:false} as any));
 await remount();
 await vi.waitFor(()=>expect(el.querySelector('[data-decide-choices]')).toBeTruthy());
 await choose('approve');
 submit('approve')!.click();
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
 await vi.waitFor(()=>expect(el.querySelector('[data-decide-choices]')).toBeTruthy());
 await choose('approve');
 submit('approve')!.click();
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

// owner 2026-11-23：「下一張」留在同一個分頁，那一頁審完了才換另一頁並說一聲
const queueItem=(id:string,kind:'first'|'re')=>({id,kind,submittedAt:1,card:{id:id.slice(1),roleId:'r'+id,name:'卡'+id,summary:'',avatarUrl:null,zone:'zh',tags:[]},stamps:{approve:0,required:1},claim:'free',stampedByMe:false});
const decidedAs=(type:'first'|'update')=>{const d=withLength(3600);return {...d,submission:{...d.submission,kind:type==='first'?'first':'re',type,claimedByMe:false,stampedByMe:true,status:'approved',stamps:[{verdict:'approve',note:'',at:2,mine:true}]}};};
it('next after an update stays on the updates tab while it has cards',async()=>{
 api.fetchReviewDetail.mockReset().mockResolvedValue(decidedAs('update'));
 api.fetchReviewQueue.mockReset().mockImplementation(async(_t:string,_l:string,tab?:string)=>({items:tab==='updates'?[queueItem('s7','re')]:[queueItem('s8','first')],claimTtlMs:1}));
 await remount();
 await vi.waitFor(()=>expect(button(i18n.global.t('review.result.next',{n:1}))).toBeTruthy());
 expect(api.fetchReviewQueue.mock.calls.map(c=>c[2])).toEqual(['updates']);
 expect(el.querySelector('[data-next-switched]')).toBeNull();
 api.claimReview.mockClear();
 button(i18n.global.t('review.result.next',{n:1}))!.click();
 await vi.waitFor(()=>expect(api.claimReview).toHaveBeenCalledWith('s7','local-reviewer'));
});
it('next after a new card stays on new cards; when that tab is empty it moves to updates and says so',async()=>{
 api.fetchReviewDetail.mockReset().mockResolvedValue(decidedAs('first'));
 api.fetchReviewQueue.mockReset().mockImplementation(async(_t:string,_l:string,tab?:string)=>({items:tab==='updates'?[queueItem('s7','re')]:[],claimTtlMs:1}));
 await remount();
 await vi.waitFor(()=>expect(el.querySelector('[data-next-switched]')).toBeTruthy());
 expect(api.fetchReviewQueue.mock.calls.map(c=>c[2])).toEqual(['new','updates']);
 expect(el.querySelector('[data-next-switched]')!.textContent).toBe(i18n.global.t('reviewV2.decide.nextSwitchedToUpdates'));
 api.claimReview.mockClear();
 button(i18n.global.t('review.result.next',{n:1}))!.click();
 await vi.waitFor(()=>expect(api.claimReview).toHaveBeenCalledWith('s7','local-reviewer'));
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
 await vi.waitFor(()=>expect(el.querySelector('[data-decide-choices]')).toBeTruthy());
 expect(el.querySelector('.tabs')!.textContent).not.toContain('42%');
 // 換卡時上一張的選擇也清掉：三個選項回到都不預選
 expect([...el.querySelectorAll<HTMLInputElement>('[data-decide-choices] input')].some(i=>i.checked)).toBe(false);
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
 await choose('reject');
 const note=typeNote('x');
 expect(note.maxLength).toBe(2000);
 await vi.waitFor(()=>expect(submit('reject')!.disabled).toBe(false));
 submit('reject')!.click();
 await vi.waitFor(()=>expect(confirmState.current).toBeTruthy());
 expect(confirmState.current!.message).toContain(i18n.global.t('review.confirm.row',{label:i18n.global.t('review.confirm.card'),value:'Night Detective'}));
 settleConfirm(false);
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
 expect(submit('approve')?.disabled).toBe(true);
 expect(radio('approve')?.disabled).toBe(true);
 expect(radio('reject')?.disabled).toBe(true);
 expect(radio('drop')?.disabled).toBe(true);
 expect(el.querySelector('[data-hold-blocked]')).toBeTruthy();
 expect(el.querySelector('[data-hold]')).toBeNull();
 expect(el.querySelector('[data-hold-notice] [data-unhold]')).toBeTruthy();
});

it('another reviewer reading a held card sees who holds it, cannot decide and cannot release it',async()=>{
 api.fetchReviewDetail.mockReset().mockResolvedValue(held({holder:'Mika',at:5,byMe:false,canRelease:false},true));
 await remount();
 await vi.waitFor(()=>expect(el.querySelector('[data-hold-notice]')?.textContent).toContain(t('review.hold.noticeOther',{name:'Mika'})));
 expect(submit('approve')?.disabled).toBe(true);
 expect(radio('approve')?.disabled).toBe(true);
 expect(radio('reject')?.disabled).toBe(true);
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
 await vi.waitFor(()=>expect(el.querySelector('[data-decide-choices]')).toBeTruthy());
 await choose('approve');
 submit('approve')!.click();
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
 // 冷凍人沒領著：標頭的領取鈕說「領取並查看」，駁回選不了，說明欄也就不會出現
 expect(btn(t('review.action.claimHeld'))).toBeTruthy();
 expect(radio('reject')?.disabled).toBe(true);
 expect(el.querySelector('#review-note')).toBeNull();
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
 expect(submit('approve')?.textContent?.trim()).toBe(t('review.action.keep'));
 expect(btn(t('review.action.approve'))).toBeUndefined();
 // 重新審核只有「維持通過」與「駁回」；駁回限管理員，也沒有「不受理」
 expect(radio('reject')?.disabled).toBe(true);
 expect(radio('drop')).toBeNull();
 await choose('approve');
 expect(submit('approve')!.disabled).toBe(false);
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

// 審核頁看得到原作者，並能一鍵展開他所有的卡（owner 2026-11-08）
const author={name:'月光',communityName:'小月',handle:'moon',accountNumId:10001,avatar:'',cardCount:4};
const authorCards=[
 {id:'100001',name:'Night Detective',coverUrl:null,adultHidden:false,status:'pending',publicBlocked:false,boardHidden:false,held:false,reReview:false,decided:0,rejected:0,latest:{id:'s1',status:'pending',submittedAt:1,decidedAt:null,reopen:false},current:true},
 {id:'100002',name:'雨城',coverUrl:null,adultHidden:false,status:'approved',publicBlocked:true,boardHidden:false,held:false,reReview:true,decided:2,rejected:1,latest:{id:'s9',status:'pending',submittedAt:5,decidedAt:null,reopen:true},current:false},
 {id:'100003',name:'舊作',coverUrl:null,adultHidden:false,status:'approved',publicBlocked:false,boardHidden:false,held:false,reReview:false,decided:1,rejected:0,latest:{id:'s8',status:'approved',submittedAt:3,decidedAt:4,reopen:false},current:false},
 {id:'100004',name:null,coverUrl:null,adultHidden:true,status:'rejected',publicBlocked:false,boardHidden:false,held:false,reReview:false,decided:1,rejected:1,latest:{id:'s7',status:'rejected',submittedAt:2,decidedAt:3,reopen:false},current:false},
];
it('shows the original author and lists every card of the same person on demand',async()=>{
 api.fetchReviewDetail.mockReset().mockResolvedValue({...pendingDetail(),author});
 api.fetchReviewAuthorCards.mockResolvedValue({items:authorCards,total:4});
 await remount();
 const t=(k:string,p?:Record<string,unknown>)=>i18n.global.t(k,p??{});
 await vi.waitFor(()=>expect(el.querySelector('[data-review-author]')).toBeTruthy());
 expect(el.querySelector('[data-author-name]')?.textContent).toBe('月光');
 expect(el.querySelector('[data-author-handle]')?.textContent).toBe('@moon');
 expect(el.querySelector('[data-author-account]')?.textContent).toBe(t('review.author.accountId',{id:10001}));
 expect(el.querySelector('[data-author-nickname]')?.textContent).toBe(t('review.author.nickname',{name:'小月'}));
 // 清單點開才讀
 expect(api.fetchReviewAuthorCards).not.toHaveBeenCalled();
 const toggle=el.querySelector<HTMLButtonElement>('[data-author-cards-toggle]')!;
 expect(el.querySelector(`#${toggle.getAttribute('aria-controls')}`)).toBeTruthy();
 expect(toggle.textContent?.trim()).toBe(t('review.author.showCards',{n:4}));
 expect(toggle.getAttribute('aria-expanded')).toBe('false');
 toggle.click();
 await vi.waitFor(()=>expect(el.querySelectorAll('[data-author-card]')).toHaveLength(4));
 expect(api.fetchReviewAuthorCards).toHaveBeenCalledWith('s1','local-reviewer',expect.any(String));
 expect(toggle.getAttribute('aria-expanded')).toBe('true');
 const card=(id:string)=>el.querySelector(`[data-author-card="${id}"]`)!;
 // 這張：標出來、不給連結
 expect(card('100001').textContent).toContain(t('review.author.current'));
 expect(card('100001').querySelector('a')).toBeNull();
 // 重審中的已發布卡：待審單優先，連到它的審核單；狀態與暫停公開都看得到；開新分頁
 const review=card('100002').querySelector<HTMLAnchorElement>('[data-author-card-review]')!;
 expect(review.getAttribute('href')).toBe('/review/s9');
 expect(review.getAttribute('target')).toBe('_blank');
 expect(card('100002').textContent).toContain(t('mine.badge.reReview'));
 expect(card('100002').textContent).toContain(t('moderation.blocked'));
 expect(card('100002').textContent).toContain(t('review.author.counts',{decided:2,rejected:1}));
 // 已發布、沒有待審：連到作品管理並帶卡號
 expect(card('100003').querySelector('[data-author-card-manage]')?.getAttribute('href')).toBe('/review/cards?q=100003');
 // 成人卡沒驗年齡：只說是成人卡，狀態照列，沒有連結
 expect(card('100004').querySelector('[data-adult-hidden]')?.textContent).toBe(t('review.author.adultHidden'));
 expect(card('100004').querySelector('[data-author-card-status]')?.textContent).toBe(t('review.author.status.rejected'));
 expect(card('100004').querySelector('a')).toBeNull();
 // 收起再展開不重讀
 // aria-controls 收起時也指得到東西
 const panel=el.querySelector<HTMLElement>(`#${toggle.getAttribute('aria-controls')}`)!;
 toggle.click();await vi.waitFor(()=>expect(panel.style.display).toBe('none'));
 expect(el.querySelector(`#${toggle.getAttribute('aria-controls')}`)).toBe(panel);
 toggle.click();await vi.waitFor(()=>expect(panel.style.display).toBe(''));
 expect(api.fetchReviewAuthorCards).toHaveBeenCalledTimes(1);
});

it('says the author has only this card instead of offering an empty list',async()=>{
 api.fetchReviewDetail.mockReset().mockResolvedValue({...pendingDetail(),author:{...author,communityName:null,handle:null,cardCount:1}});
 await remount();
 await vi.waitFor(()=>expect(el.querySelector('[data-author-only]')?.textContent).toBe(i18n.global.t('review.author.onlyThis')));
 expect(el.querySelector('[data-author-cards-toggle]')).toBeNull();
 expect(el.querySelector('[data-author-handle]')).toBeNull();
 expect(el.querySelector('[data-author-nickname]')).toBeNull();
});

it('keeps the author list retryable when it cannot load',async()=>{
 api.fetchReviewDetail.mockReset().mockResolvedValue({...pendingDetail(),author});
 api.fetchReviewAuthorCards.mockRejectedValueOnce(new Error('down')).mockResolvedValue({items:authorCards,total:4});
 await remount();
 await vi.waitFor(()=>expect(el.querySelector('[data-author-cards-toggle]')).toBeTruthy());
 el.querySelector<HTMLButtonElement>('[data-author-cards-toggle]')!.click();
 await vi.waitFor(()=>expect(el.querySelector('[role="alert"]')?.textContent).toContain(i18n.global.t('review.author.loadFailed')));
 el.querySelector<HTMLButtonElement>('[data-author-cards-retry]')!.click();
 await vi.waitFor(()=>expect(el.querySelectorAll('[data-author-card]')).toHaveLength(4));
});

it('labels the submission type from the server and drops the attempt count on a re-review',async()=>{
 const t=(k:string,p?:Record<string,unknown>)=>i18n.global.t(k,p??{});
 const base=pendingDetail();
 api.fetchReviewDetail.mockReset().mockResolvedValue({...base,submission:{...base.submission,kind:'first',type:'resubmit',attempt:2}});
 await remount();
 await vi.waitFor(()=>expect(el.querySelector('[data-type-label]')?.textContent).toBe(t('review.type.resubmit')));
 expect(el.querySelector('[data-attempt]')?.textContent?.trim()).toBe(t('review.attempt',{n:2}));
 api.fetchReviewDetail.mockReset().mockResolvedValue({...base,submission:{...base.submission,type:'reopen',reopen:true,attempt:3}});
 await remount();
 await vi.waitFor(()=>expect(el.querySelector('[data-type-label]')?.textContent).toBe(t('review.reopen.chip')));
 expect(el.querySelector('[data-attempt]')).toBeNull();
});

// 審核頁看得到開場網頁（風月卡／開場網頁形式，2026-11-10）
it('shows the opening page preview and expandable source in Dialogue for an opening-page card, and links to Dialogue from Display without duplicating the source',async()=>{
 const html='<div class="fy-intro"><h1>風月角色介紹</h1><p>開局說明</p></div>';
 const detail=pendingDetail();
 api.fetchReviewDetail.mockReset().mockResolvedValue({
  ...detail,
  detail:{
   ...detail.detail,
   greetings:{welcome:'',alternates:[],prologue:['推開房門','在門外聽一會']},
   authorAsset:{...detail.detail.authorAsset,cardFormat:'fengyue',openingPage:html},
  },
 });
 await remount();
 const t=(k:string,p?:Record<string,unknown>)=>i18n.global.t(k,p??{});
 await vi.waitFor(()=>expect(btn(t('editor.section.dialogue'))).toBeTruthy());
 expect(t('editor.section.dialogue')).not.toBe('editor.section.dialogue');
 btn(t('editor.section.dialogue'))!.click();
 const box=await vi.waitFor(()=>{
  const found=el.querySelector<HTMLElement>('[data-opening-page]');
  expect(found).toBeTruthy();
  return found!;
 });
 expect(box.querySelector('label')?.textContent).toBe(t('editor.opening.page'));
 const frame=box.querySelector<HTMLIFrameElement>('[data-opening-preview]')!;
 expect(frame).toBeTruthy();
 expect(frame.getAttribute('sandbox')).toBe(OPENING_SANDBOX);
 expect(frame.getAttribute('srcdoc')).toBe(openingSrcdoc(html));
 // 照視窗寫的頁面（min-height:100vh、position:fixed）回報的高度會跟著框長：框停在上限、在框裡捲，不撐開整頁
 const cap=`${Math.round(window.innerHeight*0.8)}px`;
 await vi.waitFor(()=>expect(frame.style.height).toBe(cap));
 window.dispatchEvent(new MessageEvent('message',{data:{type:OPENING_MESSAGE_TYPE,kind:'height',height:20000},source:frame.contentWindow}));
 await new Promise(r=>setTimeout(r,0));
 expect(frame.style.height).toBe(cap);
 window.dispatchEvent(new MessageEvent('message',{data:{type:OPENING_MESSAGE_TYPE,kind:'height',height:520},source:frame.contentWindow}));
 await vi.waitFor(()=>expect(frame.style.height).toBe('520px'));
 const source=box.querySelector<HTMLDetailsElement>('[data-opening-source]')!;
 expect(source.querySelector('summary')?.textContent).toBe(t('review.openingPage.source',{n:[...html].length}));
 expect(source.querySelector('pre')?.textContent).toBe(html);
 // 開場白空白時不另外畫空的「開場白」格；開場選項照舊列在下面
 expect([...el.querySelectorAll('label')].some(l=>l.textContent===t('editor.welcome'))).toBe(false);
 expect(el.textContent).toContain('推開房門');
 expect(el.textContent).toContain('在門外聽一會');

 // 「顯示」分頁不重複放大段原文，改給指向「對話」分頁的連結
 btn(t('review.section.display'))!.click();
 await vi.waitFor(()=>expect(btn(t('review.section.display'))!.getAttribute('aria-pressed')).toBe('true'));
 const link=el.querySelector<HTMLButtonElement>('[data-opening-page-link]')!;
 expect(link).toBeTruthy();
 expect(link.parentElement?.textContent).toContain(t('review.openingPage',{n:[...html].length}));
 expect([...el.querySelectorAll('pre')].filter(p=>p.textContent===html)).toHaveLength(1);
 link.click();
 await vi.waitFor(()=>expect(btn(t('editor.section.dialogue'))!.getAttribute('aria-pressed')).toBe('true'));
});

it('keeps greeting cards on the opening message field in Dialogue',async()=>{
 const detail=pendingDetail();
 api.fetchReviewDetail.mockReset().mockResolvedValue({
  ...detail,
  detail:{
   ...detail.detail,
   greetings:{welcome:'你好，旅人。',alternates:[],prologue:['點頭致意']},
  },
 });
 await remount();
 const t=(k:string,p?:Record<string,unknown>)=>i18n.global.t(k,p??{});
 await vi.waitFor(()=>expect(btn(t('editor.section.dialogue'))).toBeTruthy());
 btn(t('editor.section.dialogue'))!.click();
 await vi.waitFor(()=>expect(btn(t('editor.section.dialogue'))!.getAttribute('aria-pressed')).toBe('true'));
 expect(el.querySelector('[data-opening-page]')).toBeNull();
 expect([...el.querySelectorAll('label')].some(l=>l.textContent===t('editor.welcome'))).toBe(true);
 expect(el.textContent).toContain('你好，旅人。');
});

it('shows the empty-page note when an opening-page card only has first-line choices',async()=>{
 const detail=pendingDetail();
 api.fetchReviewDetail.mockReset().mockResolvedValue({
  ...detail,
  detail:{
   ...detail.detail,
   greetings:{welcome:'',alternates:[],prologue:['直接開始']},
   authorAsset:{...detail.detail.authorAsset,openingMode:'page',openingPage:''},
  },
 });
 await remount();
 const t=(k:string,p?:Record<string,unknown>)=>i18n.global.t(k,p??{});
 await vi.waitFor(()=>expect(btn(t('editor.section.dialogue'))).toBeTruthy());
 btn(t('editor.section.dialogue'))!.click();
 const box=await vi.waitFor(()=>{
  const found=el.querySelector<HTMLElement>('[data-opening-page]');
  expect(found).toBeTruthy();
  return found!;
 });
 expect(box.textContent).toContain(t('editor.opening.page.empty'));
 expect(box.querySelector('[data-opening-preview]')).toBeNull();
 expect(box.querySelector('[data-opening-source]')).toBeNull();
});

it('translates dialogue tab and opening-page review strings across all 5 locales',async()=>{
 for(const loc of LOCALE_CODES){
  await applyLocale(loc);
  const t=(k:string,p?:Record<string,unknown>)=>i18n.global.t(k,p??{});
  expect(t('editor.section.dialogue'),`${loc} editor.section.dialogue`).not.toBe('editor.section.dialogue');
  expect(t('review.openingPage',{n:128}),`${loc} review.openingPage`).toContain('128');
  expect(t('review.openingPage.source',{n:128}),`${loc} review.openingPage.source`).toContain('128');
  expect(t('review.openingPage.inDialogue'),`${loc} review.openingPage.inDialogue`).not.toBe('review.openingPage.inDialogue');
 }
 await applyLocale('zh-Hant');
});

// 審卡 V2 第一批：決定區（三選一不預選、結構化駁回理由、不受理）
const profile=(tier:'new'|'stable'|'top'|'general'|'unknown')=>({tier,autoTier:tier,batchSuspected:false,autoBatch:false,manual:{},
 basis:{works:1,decidedWorks:0,firstPassRate:null,qualityScore:null,memberSince:1,deviceAccounts:null,deviceRecentWorks:null,dropCases90d:null},pendingSameAuthor:null,pendingSameDevice:null});

it('nothing is preselected: approve stays disabled until chosen, and the note only appears for a rejection',async()=>{
 api.fetchReviewDetail.mockReset().mockResolvedValue(withLength(3600));
 await remount();
 await vi.waitFor(()=>expect(el.querySelector('[data-decide-choices]')).toBeTruthy());
 const inputs=[...el.querySelectorAll<HTMLInputElement>('[data-decide-choices] input[name=decide]')];
 expect(inputs.map(i=>i.value)).toEqual(['approve','reject','drop']);
 expect(inputs.some(i=>i.checked)).toBe(false);
 expect(el.querySelector('[data-decide-choices]')!.getAttribute('role')).toBe('radiogroup');
 expect(submit('approve')!.disabled).toBe(true);
 expect(submit('reject')).toBeNull();
 expect(submit('drop')).toBeNull();
 expect(el.querySelector('#review-note')).toBeNull();
 await choose('approve');
 expect(submit('approve')!.disabled).toBe(false);
 expect(el.querySelector('#review-note')).toBeNull();
 expect(el.querySelector('[data-reason-picker]')).toBeNull();
 await choose('reject');
 expect(submit('approve')).toBeNull();
 expect(el.querySelector('#review-note')).toBeTruthy();
 expect(el.querySelector('[data-reason-picker]')).toBeTruthy();
});

it('a rejection needs at least one reason, previews what the author sees, and sends the reason codes',async()=>{
 api.fetchReviewDetail.mockReset().mockResolvedValue(withLength(3600));
 api.stampReview.mockResolvedValue({status:'rejected',cardStatus:'rejected'});
 await remount();
 await vi.waitFor(()=>expect(el.querySelector('[data-decide-choices]')).toBeTruthy());
 await choose('reject');
 expect(submit('reject')!.disabled).toBe(true);
 expect(el.querySelector('[data-reason-preview]')).toBeNull();
 // 作者不是新人：沒有輔導那一行
 expect(el.querySelector('[data-coaching]')).toBeNull();
 reason('opening.no_reply_hook')!.click();
 await vi.waitFor(()=>expect(submit('reject')!.disabled).toBe(false));
 const preview=el.querySelector('[data-reason-preview]')!;
 expect(preview.textContent).toContain(i18n.global.t('reviewV2.decide.previewTitle'));
 expect(preview.textContent).toContain(i18n.global.t('review.reasons.opening.no_reply_hook.name'));
 expect(preview.textContent).toContain(i18n.global.t('reviewV2.decide.previewOpening'));
 submit('reject')!.click();
 await vi.waitFor(()=>expect(confirmState.current).toBeTruthy());
 expect(api.stampReview).not.toHaveBeenCalled();
 expect(confirmState.current!.message).toContain('・'+i18n.global.t('review.reasons.opening.no_reply_hook.name'));
 expect(confirmState.current!.message).not.toContain(i18n.global.t('reviewV2.decide.confirmCoaching'));
 settleConfirm(true);
 await vi.waitFor(()=>expect(api.stampReview).toHaveBeenCalledWith('s1','local-reviewer',{verdict:'reject',note:'',generation:'g1',reasons:['opening.no_reply_hook'],coaching:false}));
});

it('a new author gets coaching by default; the reviewer can switch it back to the normal fix',async()=>{
 api.fetchReviewDetail.mockReset().mockResolvedValue({...withLength(3600),authorProfile:profile('new')});
 api.stampReview.mockResolvedValue({status:'rejected',cardStatus:'rejected'});
 await remount();
 await vi.waitFor(()=>expect(el.querySelector('[data-author-profile]')).toBeTruthy());
 await choose('reject');
 const coaching=el.querySelector('[data-coaching]')!;
 expect(coaching.textContent).toContain(i18n.global.t('reviewV2.decide.coachingOn'));
 reason('character.setting_thin')!.click();
 await vi.waitFor(()=>expect(submit('reject')!.disabled).toBe(false));
 submit('reject')!.click();
 await vi.waitFor(()=>expect(confirmState.current).toBeTruthy());
 expect(confirmState.current!.message).toContain(i18n.global.t('reviewV2.decide.confirmCoaching'));
 settleConfirm(true);
 await vi.waitFor(()=>expect(api.stampReview).toHaveBeenCalledWith('s1','local-reviewer',{verdict:'reject',note:'',generation:'g1',reasons:['character.setting_thin'],coaching:true}));
 await vi.waitFor(()=>expect(confirmState.current).toBeNull());

 // 改回一般：送出的就是一般版
 api.stampReview.mockClear();
 api.fetchReviewDetail.mockReset().mockResolvedValue({...withLength(3600),authorProfile:profile('new')});
 await remount();
 await vi.waitFor(()=>expect(el.querySelector('[data-decide-choices]')).toBeTruthy());
 await choose('reject');
 button(i18n.global.t('reviewV2.decide.coachingOff'))!.click();
 await vi.waitFor(()=>expect(el.querySelector('[data-coaching]')?.textContent).not.toContain(i18n.global.t('reviewV2.decide.coachingOn')));
 reason('character.setting_thin')!.click();
 await vi.waitFor(()=>expect(submit('reject')!.disabled).toBe(false));
 submit('reject')!.click();
 await vi.waitFor(()=>expect(confirmState.current).toBeTruthy());settleConfirm(true);
 await vi.waitFor(()=>expect(api.stampReview).toHaveBeenCalledWith('s1','local-reviewer',expect.objectContaining({reasons:['character.setting_thin'],coaching:false})));
});

it('coaching is not offered for authors who are not new',async()=>{
 api.fetchReviewDetail.mockReset().mockResolvedValue({...withLength(3600),authorProfile:profile('stable')});
 await remount();
 await vi.waitFor(()=>expect(el.querySelector('[data-author-profile]')).toBeTruthy());
 await choose('reject');
 expect(el.querySelector('[data-coaching]')).toBeNull();
});

it('"other" needs a written note before the rejection can be sent',async()=>{
 api.fetchReviewDetail.mockReset().mockResolvedValue(withLength(3600));
 api.stampReview.mockResolvedValue({status:'rejected',cardStatus:'rejected'});
 await remount();
 await vi.waitFor(()=>expect(el.querySelector('[data-decide-choices]')).toBeTruthy());
 await choose('reject');
 expect(el.querySelector('label[for=review-note]')!.textContent).toBe(i18n.global.t('reviewV2.decide.noteLabel'));
 reason('other')!.click();
 await vi.waitFor(()=>expect(el.querySelector('label[for=review-note]')!.textContent).toBe(i18n.global.t('reviewV2.decide.noteLabelRequired')));
 expect(el.querySelector('#review-note')!.getAttribute('aria-required')).toBe('true');
 expect(submit('reject')!.disabled).toBe(true);
 typeNote('   ');
 await new Promise(r=>setTimeout(r,0));
 expect(submit('reject')!.disabled).toBe(true);
 typeNote('封面圖是別人的作品');
 await vi.waitFor(()=>expect(submit('reject')!.disabled).toBe(false));
 submit('reject')!.click();
 await vi.waitFor(()=>expect(confirmState.current).toBeTruthy());
 expect(confirmState.current!.message).toContain('封面圖是別人的作品');
 settleConfirm(true);
 await vi.waitFor(()=>expect(api.stampReview).toHaveBeenCalledWith('s1','local-reviewer',{verdict:'reject',note:'封面圖是別人的作品',generation:'g1',reasons:['other'],coaching:false}));
});

it('a short card always carries the locked length reason alongside the reviewer\'s picks',async()=>{
 api.fetchReviewDetail.mockReset().mockResolvedValue(withLength(3000));
 api.stampReview.mockResolvedValue({status:'rejected',cardStatus:'rejected'});
 await remount();
 await vi.waitFor(()=>expect(el.querySelector('[data-approve-blocked]')).toBeTruthy());
 await choose('reject');
 const count=reason('content.min_length')!;
 expect(count.checked).toBe(true);
 expect(count.disabled).toBe(true);
 expect(count.closest('label')!.textContent).toContain(i18n.global.t('reviewV2.decide.lengthAuto'));
 reason('opening.too_short')!.click();
 await vi.waitFor(()=>expect(reason('opening.too_short')!.checked).toBe(true));
 submit('reject')!.click();
 await vi.waitFor(()=>expect(confirmState.current).toBeTruthy());settleConfirm(true);
 await vi.waitFor(()=>expect(api.stampReview).toHaveBeenCalledTimes(1));
 const body=api.stampReview.mock.calls[0][2];
 expect(body).toMatchObject({verdict:'reject',generation:'g1',coaching:false});
 expect([...body.reasons].sort()).toEqual(['content.min_length','opening.too_short']);
});

it('a manager rejecting a re-review writes a note and sends no reason codes',async()=>{
 api.fetchReviewDetail.mockReset().mockResolvedValue(reopened(true));
 api.stampReview.mockResolvedValue({status:'rejected',cardStatus:'rejected'});
 await remount();
 await vi.waitFor(()=>expect(el.querySelector('[data-decide-choices]')).toBeTruthy());
 expect(radio('drop')).toBeNull();
 await choose('reject');
 expect(el.querySelector('[data-reason-picker]')).toBeNull();
 expect(submit('reject')!.disabled).toBe(true);
 typeNote('確認是盜用');
 await vi.waitFor(()=>expect(submit('reject')!.disabled).toBe(false));
 submit('reject')!.click();
 await vi.waitFor(()=>expect(confirmState.current).toBeTruthy());settleConfirm(true);
 await vi.waitFor(()=>expect(api.stampReview).toHaveBeenCalledWith('s1','local-reviewer',{verdict:'reject',note:'確認是盜用',generation:'g1'}));
});

it('drop works without a claim, needs no confirmation, and can be restored from the result',async()=>{
 const d=withLength(3600,{claimedByMe:false});
 api.fetchReviewDetail.mockReset().mockResolvedValue(d);
 await remount();
 await vi.waitFor(()=>expect(el.querySelector('[data-decide-choices]')).toBeTruthy());
 api.claimReview.mockClear();
 // 沒領取：通過、駁回不能選；不受理可以
 expect(radio('approve')!.disabled).toBe(true);
 expect(radio('reject')!.disabled).toBe(true);
 await choose('drop');
 expect(el.querySelector('[data-drop-info]')).toBeTruthy();
 submit('drop')!.click();
 await vi.waitFor(()=>expect(api.dropReview).toHaveBeenCalledWith('s1','local-reviewer'));
 expect(confirmState.current).toBeNull();
 await vi.waitFor(()=>expect(el.querySelector('[data-dropped-card]')?.textContent).toBe(i18n.global.t('reviewV2.decide.resultDropped')));
 expect(el.querySelector('[data-decide-choices]')).toBeNull();
 expect(api.claimReview).not.toHaveBeenCalled();
 expect(api.stampReview).not.toHaveBeenCalled();
 const reads=api.fetchReviewDetail.mock.calls.length;
 el.querySelector<HTMLButtonElement>('[data-restore]')!.click();
 await vi.waitFor(()=>expect(api.restoreReview).toHaveBeenCalledWith('s1','local-reviewer'));
 await vi.waitFor(()=>expect(el.querySelector('[data-decide-choices]')).toBeTruthy());
 expect(api.fetchReviewDetail.mock.calls.length).toBeGreaterThan(reads);
 expect(el.querySelector('[data-dropped-card]')).toBeNull();
 expect([...el.querySelectorAll<HTMLInputElement>('[data-decide-choices] input')].some(i=>i.checked)).toBe(false);
});

it('a card opened from the dropped list is read-only until restored',async()=>{
 api.fetchReviewDetail.mockReset().mockResolvedValueOnce({...withLength(3600),dropped:true}).mockResolvedValue(withLength(3600));
 await remount();
 await vi.waitFor(()=>expect(el.querySelector('[data-dropped-card]')).toBeTruthy());
 expect(el.querySelector('[data-dropped-card]')!.textContent).toBe(i18n.global.t('reviewV2.dropped.title'));
 expect(el.textContent).toContain(i18n.global.t('reviewV2.dropped.readonly'));
 expect(el.querySelector('[data-decide-choices]')).toBeNull();
 expect(el.querySelector('#review-note')).toBeNull();
 el.querySelector<HTMLButtonElement>('[data-restore]')!.click();
 await vi.waitFor(()=>expect(api.restoreReview).toHaveBeenCalledWith('s1','local-reviewer'));
 await vi.waitFor(()=>expect(el.querySelector('[data-decide-choices]')).toBeTruthy());
 expect(el.querySelector('[data-dropped-card]')).toBeNull();
});

it('a first submission opens on the dialogue tab; updates still open on the basic tab',async()=>{
 const d=withLength(3600);
 api.fetchReviewDetail.mockReset().mockResolvedValue({...d,submission:{...d.submission,kind:'first',type:'first'}});
 await remount();
 const tab=(s:string)=>button(i18n.global.t(`editor.section.${s}`));
 await vi.waitFor(()=>expect(tab('dialogue')?.getAttribute('aria-pressed')).toBe('true'));
 expect(tab('basic')!.getAttribute('aria-pressed')).toBe('false');
 api.fetchReviewDetail.mockReset().mockResolvedValue({...d,submission:{...d.submission,kind:'re',type:'update'}});
 await remount();
 await vi.waitFor(()=>expect(tab('basic')?.getAttribute('aria-pressed')).toBe('true'));
 expect(tab('dialogue')!.getAttribute('aria-pressed')).toBe('false');
});

it('shows the author profile to the reviewer when the detail carries one',async()=>{
 api.fetchReviewDetail.mockReset().mockResolvedValue({...withLength(3600),authorProfile:profile('new')});
 await remount();
 await vi.waitFor(()=>expect(el.querySelector('[data-author-profile]')).toBeTruthy());
 expect(el.querySelector('[data-profile-tier]')?.textContent).toBe(i18n.global.t('reviewV2.mark.tier.new'));
 api.fetchReviewDetail.mockReset().mockResolvedValue(withLength(3600));
 await remount();
 await vi.waitFor(()=>expect(el.querySelector('[data-decide-choices]')).toBeTruthy());
 expect(el.querySelector('[data-author-profile]')).toBeNull();
});
