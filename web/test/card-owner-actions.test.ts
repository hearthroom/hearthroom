import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, type App } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { i18n } from '../src/lib/i18n';
import { useSession } from '../src/lib/session';
import CardOwnerActions from '../src/components/CardOwnerActions.vue';
const mocks=vi.hoisted(()=>({draft:vi.fn(),register:vi.fn(),token:vi.fn(),confirm:vi.fn()}));
vi.mock('../src/lib/api',async original=>({...await original<typeof import('../src/lib/api')>(),fetchDraftState:mocks.draft,registerCard:mocks.register}));
vi.mock('../src/lib/connections',async original=>({...await original<typeof import('../src/lib/connections')>(),accountToken:mocks.token}));
vi.mock('../src/lib/confirm',()=>({confirmChoice:mocks.confirm,confirmDialog:vi.fn()}));
let app:App;let root:HTMLElement;
const settle=async()=>{for(let i=0;i<30;i++)await Promise.resolve();await nextTick();};
const card={id:'100021',num:100021,provider:'harbor',roleId:'sealed',sourceRoleId:'draft',status:'approved',author:{accountNumId:22,name:'Fixture'}} as any;
beforeEach(()=>{vi.clearAllMocks();mocks.token.mockResolvedValue('token-harbor');mocks.confirm.mockResolvedValue('sfw');mocks.register.mockResolvedValue({status:'approved'});});
afterEach(()=>{app?.unmount();root?.remove();});
async function mount(c=card,me=22){const router=createRouter({history:createMemoryHistory(),routes:[{path:'/:p(.*)*',component:{template:'<div />'}}]});await router.push('/cards/100021');const pinia=createPinia();setActivePinia(pinia);const session=useSession();session.me={accountNumId:me,nickName:'F',avatar:''};session.profile={identities:[{provider:'harbor',externalId:me}]} as any;root=document.createElement('div');document.body.append(root);app=createApp({render:()=>h(CardOwnerActions,{card:c})}).use(pinia).use(i18n).use(router);app.mount(root);await settle();}
const text=(key:string)=>i18n.global.t(key);
const button=(key:string)=>[...root.querySelectorAll('button')].find(b=>b.textContent?.trim()===text(key));
// owner 2026-10-08：改了卡、卡片頁沒說，按遊玩玩到的還是過審那一版
it('gives the owner a draft playtest link, and says the draft was edited with a submit-update button',async()=>{
 mocks.draft.mockResolvedValue({status:'approved',draftChanged:true});
 await mount();
 expect(mocks.draft).toHaveBeenCalledWith('draft','token-harbor','harbor');
 const play=[...root.querySelectorAll('a')].find(a=>a.textContent?.trim()===text('card.owner.playDraft'));
 expect(play?.getAttribute('href')).toContain('/play/100021?mode=source');
 expect(root.textContent).toContain(text('workspace.draftChanged'));
 button('card.owner.submitUpdate')!.click();await settle();
 expect(mocks.register).toHaveBeenCalledWith('draft','token-harbor',false,[],'harbor');
 expect(button('card.owner.submitUpdate')).toBeUndefined();
 expect(root.textContent).toContain(text('workspace.updatePending'));
});
it('shows no notice and no submit-update when the draft matches the approved version or an update is already in review',async()=>{
 mocks.draft.mockResolvedValue({status:'approved',draftChanged:false});
 await mount();
 expect(root.textContent).not.toContain(text('workspace.draftChanged'));
 expect(button('card.owner.submitUpdate')).toBeUndefined();
 app.unmount();root.remove();
 mocks.draft.mockResolvedValue({status:'approved',updateStatus:'pending',draftChanged:false});
 await mount();
 expect(root.textContent).toContain(text('workspace.updatePending'));
 expect(button('card.owner.submitUpdate')).toBeUndefined();
});
it('renders nothing and asks nothing for someone who is not the owner',async()=>{
 await mount(card,99);
 expect(root.textContent?.trim()).toBe('');
 expect(mocks.draft).not.toHaveBeenCalled();
});
