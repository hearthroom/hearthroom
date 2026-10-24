
const visibilityMocks=vi.hoisted(()=>({read:vi.fn(),change:vi.fn(),operation:vi.fn()}));
vi.mock('../src/lib/work-visibility',async original=>({...await original<typeof import('../src/lib/work-visibility')>(),fetchWorkVisibility:visibilityMocks.read,changeWorkVisibility:visibilityMocks.change,fetchVisibilityOperation:visibilityMocks.operation}));
vi.mock('../src/lib/share-ref',async original=>({...await original<typeof import('../src/lib/share-ref')>(),currentReferralCode:async()=>null}));
const visibilityPolicy=(extra:any={})=>({access:'private',effectiveAccess:'owner',review:'none',update:'none',everPublic:false,revisionState:'unknown',restorable:false,restoreReason:'no_approval',draftChanged:false,restriction:'none',policyRevision:'1',approvalRevision:'0',actions:['set_private','set_unlisted','submit_review'],syncState:'complete',...extra});
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, type App } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { i18n } from '../src/lib/i18n';
import { useSession } from '../src/lib/session';
import CardOwnerActions from '../src/components/CardOwnerActions.vue';
const mocks=vi.hoisted(()=>({draft:vi.fn(),register:vi.fn(),token:vi.fn(),confirm:vi.fn(),ask:vi.fn(),ratingDraft:vi.fn(),saveRating:vi.fn()}));
const TEEN={version:1,topics:{romance:'romance.dating'},other:'other.none'};
vi.mock('../src/lib/api',async original=>({...await original<typeof import('../src/lib/api')>(),fetchDraftState:mocks.draft,registerCard:mocks.register,fetchRatingDraft:mocks.ratingDraft,saveRatingDraft:mocks.saveRating}));
vi.mock('../src/lib/connections',async original=>({...await original<typeof import('../src/lib/connections')>(),accountToken:mocks.token}));
vi.mock('../src/lib/confirm',()=>({confirmDialog:mocks.confirm}));
vi.mock('../src/lib/rating',async original=>({...await original<typeof import('../src/lib/rating')>(),askRating:mocks.ask}));
let app:App;let root:HTMLElement;
const settle=async()=>{for(let i=0;i<30;i++)await Promise.resolve();await nextTick();};
const card={id:'100021',num:100021,provider:'harbor',roleId:'sealed',sourceRoleId:'draft',status:'approved',author:{accountNumId:22,name:'Fixture'}} as any;
beforeEach(()=>{vi.clearAllMocks();mocks.token.mockResolvedValue('token-harbor');mocks.confirm.mockResolvedValue(true);mocks.ratingDraft.mockResolvedValue(TEEN);mocks.ask.mockImplementation(async(a:unknown)=>a);mocks.saveRating.mockResolvedValue(undefined);mocks.register.mockImplementation(async()=>{visibilityMocks.read.mockResolvedValue({workVisibility:visibilityPolicy({access:'public',update:'pending',actions:['cancel_review']})});return {status:'approved'};});});
afterEach(()=>{app?.unmount();root?.remove();});
async function mount(c=card,me=22){const router=createRouter({history:createMemoryHistory(),routes:[{path:'/:p(.*)*',component:{template:'<div />'}}]});await router.push('/cards/100021');const pinia=createPinia();setActivePinia(pinia);const session=useSession();session.me={accountNumId:me,nickName:'F',avatar:''};session.profile={identities:[{provider:'harbor',externalId:me}]} as any;root=document.createElement('div');document.body.append(root);app=createApp({render:()=>h(CardOwnerActions,{card:c})}).use(pinia).use(i18n).use(router);app.mount(root);await settle();}
const text=(key:string)=>i18n.global.t(key);
const button=(key:string)=>[...root.querySelectorAll('button')].find(b=>b.textContent?.trim()===text(key));
// owner 2026-10-08：改了卡、卡片頁沒說，按遊玩玩到的還是過審那一版
it('gives the owner a draft playtest link, and says the draft was edited with a submit-update button',async()=>{
 mocks.draft.mockResolvedValue({status:'approved',draftChanged:true});visibilityMocks.read.mockResolvedValue({workVisibility:visibilityPolicy({access:'public',draftChanged:true,actions:['submit_update']})});
 await mount();
 expect(visibilityMocks.read).toHaveBeenCalledWith('draft','token-harbor','harbor');
 const play=[...root.querySelectorAll('a')].find(a=>a.textContent?.trim()===text('card.owner.playDraft'));
 expect(play?.getAttribute('href')).toContain('/play/100021?mode=source');
 expect(root.textContent).toContain(text('visibility.state.changed'));
 button('card.owner.submitUpdate')!.click();await settle();
 // 送審前先確認分級：帶出作者存過的評測
 expect(mocks.ask).toHaveBeenCalledWith(TEEN);
 expect(mocks.register).toHaveBeenCalledWith('draft','token-harbor',TEEN,[],'harbor',undefined,undefined,expect.objectContaining({policyRevision:'1'}));
 expect(button('card.owner.submitUpdate')).toBeUndefined();
 expect(root.textContent).toContain(text('visibility.state.updatePending'));
});
it('shows no notice and no submit-update when the draft matches the approved version or an update is already in review',async()=>{
 mocks.draft.mockResolvedValue({status:'approved',draftChanged:false});
 await mount();
 expect(root.textContent).not.toContain(text('visibility.state.changed'));
 expect(button('card.owner.submitUpdate')).toBeUndefined();
 app.unmount();root.remove();
 mocks.draft.mockResolvedValue({status:'approved',updateStatus:'pending',draftChanged:false});visibilityMocks.read.mockResolvedValue({workVisibility:visibilityPolicy({access:'public',update:'pending',actions:['cancel_review']})});
 await mount();
 expect(root.textContent).toContain(text('visibility.state.updatePending'));
 expect(button('card.owner.submitUpdate')).toBeUndefined();
});
it('renders nothing and asks nothing for someone who is not the owner',async()=>{
 await mount(card,99);
 expect(root.textContent?.trim()).toBe('');
 expect(mocks.draft).not.toHaveBeenCalled();
});
it('does not submit when the owner closes the rating questionnaire',async()=>{
 mocks.draft.mockResolvedValue({status:'approved',draftChanged:true});visibilityMocks.read.mockResolvedValue({workVisibility:visibilityPolicy({access:'public',draftChanged:true,actions:['submit_update']})});
 mocks.ask.mockResolvedValue(null);
 await mount();
 button('card.owner.submitUpdate')!.click();await settle();
 expect(mocks.confirm).not.toHaveBeenCalled();
 expect(mocks.register).not.toHaveBeenCalled();
});

beforeEach(()=>{visibilityMocks.read.mockResolvedValue({workVisibility:visibilityPolicy()});visibilityMocks.change.mockReset();visibilityMocks.operation.mockReset();});
