import {afterEach,it,expect,vi} from 'vitest';
import {createApp,nextTick,type App} from 'vue';
import {createRouter,createMemoryHistory} from 'vue-router';
import {i18n} from '../src/lib/i18n';
const api=vi.hoisted(()=>({claimReview:vi.fn(),fetchReviewDetail:vi.fn(),fetchReviewOriginality:vi.fn(),releaseReview:vi.fn(),stampReview:vi.fn(),ApiError:class extends Error{constructor(readonly status:number,readonly code:string){super('Request failed');}}}));
vi.mock('../src/lib/api',()=>api);
// 結果卡下方的 AI 揭曉區自己讀網路：這裡只驗審核頁本身，揭曉區由 review-ai.test.ts 管
vi.mock('../src/lib/review-ai-api',async(original)=>({...await original<object>(),fetchReviewAi:async()=>({suggestions:[],inaccurate:false})}));
vi.mock('../src/lib/session',()=>({useSession:()=>({accessToken:async()=> 'local-reviewer'})}));
import Page from '../src/pages/ReviewDetailPage.vue';

const persona='AAAA重複的第一段BBBB另一段CCCC';
const detail={
 submission:{id:'s1',kind:'first',status:'pending',contentHash:'version:v',submittedAt:0,rating:null,claimedByMe:true,claimGeneration:'g',required:2,stamps:[]},
 card:{id:'100001',roleId:'r'},
 detail:{document:{roleName:'Test',roleDesc:'',roleDetailDesc:persona,roleTag:'[]',talkExample:'[]'},greetings:{welcome:'',alternates:[],prologue:[]},worldbook:null,worldbooks:[],authorAsset:{rules:[]},costProfile:{}},
};
const seg=(s:string):[number,number]=>[persona.indexOf(s),persona.indexOf(s)+s.length];
let app:App|undefined,el:HTMLElement;
afterEach(()=>{app?.unmount();el?.remove();vi.resetAllMocks();});

async function mountPage(){
 el=document.createElement('div');document.body.append(el);
 const router=createRouter({history:createMemoryHistory(),routes:[{path:'/review/:id',component:Page},{path:'/review',component:{template:'<p/>'}},{path:'/cards/:id',component:{template:'<p/>'}}]});
 await router.push('/review/s1');app=createApp(Page).use(router).use(i18n);app.mount(el);
}

async function mount(){
 await mountPage();
 const tab=await vi.waitFor(()=>{const b=[...el.querySelectorAll('button')].find(b=>b.textContent?.startsWith(i18n.global.t('review.section.originality')));expect(b).toBeDefined();return b!;});
 tab.click();await nextTick();return tab;
}

it('shows the overall overlap in the tab, lists sources, and highlights the matched passages',async()=>{
 api.fetchReviewDetail.mockResolvedValue(detail);
 api.fetchReviewOriginality.mockResolvedValue({available:true,similarity:0.42,units:30,comparedCards:3,segments:[seg('重複的第一段'),seg('另一段')],sources:[
  {cardId:'100002',name:'Source A',status:'approved',firstSeenAt:1,earlier:true,similarity:0.3,segments:[seg('重複的第一段')]},
  {cardId:'100003',name:'Source B',status:'removed',firstSeenAt:2,earlier:false,similarity:0.1,segments:[seg('另一段')]},
 ]});
 const tab=await mount();
 await vi.waitFor(()=>expect(tab.textContent).toContain('42%'));
 expect(api.fetchReviewOriginality).toHaveBeenCalledWith('s1','local-reviewer');
 expect([...el.querySelectorAll('mark.hit')].map(m=>m.textContent)).toEqual(['重複的第一段','另一段']);
 expect(el.textContent).toContain('Source A');
 expect(el.textContent).toContain(i18n.global.t('review.originality.status.removed'));
 // 已下架的卡沒有可開的頁面
 expect([...el.querySelectorAll('a')].filter(a=>a.getAttribute('href')?.startsWith('/cards/')).map(a=>a.getAttribute('href'))).toEqual(['/cards/100002']);
 [...el.querySelectorAll('button.source')].find(b=>b.textContent?.includes('Source B'))!.dispatchEvent(new Event('click'));
 await nextTick();
 expect([...el.querySelectorAll('mark.hit')].map(m=>m.textContent)).toEqual(['另一段']);
 expect(el.querySelector('mark.hit')?.closest('pre')?.textContent).toBe(persona);
});

it('keeps the review controls unavailable until the author withdrawal is confirmed',async()=>{
 api.fetchReviewDetail
  .mockRejectedValueOnce(new api.ApiError(409,'review_withdrawal_pending'))
  .mockRejectedValueOnce(new api.ApiError(410,'review_author_withdrawn'));
 await mountPage();
 await vi.waitFor(()=>expect(el.querySelector('[role="alert"]')?.textContent).toContain(i18n.global.t('community.states.pending')));
 expect(el.querySelector('[data-submit-approve], [data-submit-reject]')).toBeNull();
 el.querySelector<HTMLButtonElement>('[role="alert"] button')!.click();
 await vi.waitFor(()=>expect(el.querySelector('[role="alert"]')?.textContent).toContain(i18n.global.t('review.authorWithdrawn')));
 expect(el.querySelector('[data-submit-approve], [data-submit-reject]')).toBeNull();
 expect(api.claimReview).not.toHaveBeenCalled();
});

it('says why a submission cannot be checked instead of showing 0%',async()=>{
 api.fetchReviewDetail.mockResolvedValue(detail);
 api.fetchReviewOriginality.mockResolvedValue({available:false,reason:'too_short'});
 await mount();
 await vi.waitFor(()=>expect(el.textContent).toContain(i18n.global.t('review.originality.unavailable.too_short')));
 expect(el.textContent).not.toContain('0%');
});
