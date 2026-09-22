import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import { createApp,nextTick,reactive,type App } from 'vue';
import { createPinia } from 'pinia';
import { createMemoryHistory,createRouter,type Router } from 'vue-router';
import { i18n } from '../src/lib/i18n';
import { setProvider } from '../src/lib/provider';
const mock=vi.hoisted(()=>({summary:vi.fn(),mark:vi.fn(),request:vi.fn(),confirm:vi.fn()}));
vi.mock('../src/lib/api',()=>({fetchReviewMe:mock.summary,setCardFeatured:mock.mark,ApiError:class extends Error{constructor(readonly status:number,message:string,readonly code=''){super(message);}}}));
vi.mock('../src/lib/moderation',()=>({moderationRequest:mock.request}));
vi.mock('../src/lib/confirm',()=>({confirmDialog:mock.confirm,settleConfirm:vi.fn()}));
let session:any;
vi.mock('../src/lib/session',()=>({useSession:()=>session}));
import Page from '../src/pages/ModerationPage.vue';
import Layout from '../src/pages/CommunityManagementLayout.vue';
let app:App,host:HTMLElement,router:Router,featured:boolean,provider:string;
beforeEach(async()=>{
 setProvider('harbor');featured=false;provider='harbor';session=reactive({me:{accountNumId:3},accessToken:async()=>'synthetic-admin'});
 mock.summary.mockReset().mockResolvedValue({reviewer:true,role:'reviewer',featured:{admin:true,featuredUsed:2,featuredQuota:50}});
 mock.confirm.mockReset().mockResolvedValue(true);
 mock.mark.mockReset().mockImplementation(async(id,value)=>{featured=value;return {id,featured:value};});
 mock.request.mockReset().mockImplementation(async(path:string)=>{
  const card={id:'card-one',name:'Test card',provider,featured,tags:[],status:'approved',boardHidden:false,publicBlocked:false};
  return path.startsWith('/cards?')?{items:[card],hasNext:false}:path.startsWith('/cards/')?{card,cases:[],events:[],reviews:[]}:{items:[],hasNext:false};
 });
 host=document.createElement('div');document.body.append(host);
 router=createRouter({history:createMemoryHistory(),routes:[{path:'/review',component:Layout,children:['cards','cases','history'].map(tab=>({path:tab,component:Page,meta:{managementTab:tab}}))}]});
 await router.push('/review/cards');app=createApp(Layout).use(createPinia()).use(router).use(i18n);app.mount(host);await nextTick();
 await vi.waitFor(()=>expect(host.querySelector('.work-item')).not.toBeNull());
 host.querySelector<HTMLButtonElement>('.work-item')!.click();await vi.waitFor(()=>expect(host.querySelector('#card-reason')).not.toBeNull());
});
afterEach(()=>{app?.unmount();host?.remove();setProvider('lunatalk');vi.clearAllMocks();});
const button=()=>host.querySelector<HTMLButtonElement>('[data-feature-card]');
it('loads app-admin access in the workbench and marks/unmarks with confirmation and durable readback',async()=>{
 await vi.waitFor(()=>expect(button()).not.toBeNull());expect(button()!.textContent).toContain(i18n.global.t('card.featureAction'));
 button()!.click();await vi.waitFor(()=>expect(mock.mark).toHaveBeenCalledWith('card-one',true,'synthetic-admin','harbor'));
 await vi.waitFor(()=>expect(button()!.textContent).toContain(i18n.global.t('card.unfeatureAction')));
 button()!.click();await vi.waitFor(()=>expect(mock.mark).toHaveBeenCalledWith('card-one',false,'synthetic-admin','harbor'));
 expect(mock.confirm).toHaveBeenCalledTimes(2);expect(mock.request.mock.calls.filter(c=>c[0].startsWith('/cards/card-one')).length).toBeGreaterThanOrEqual(2);
});
it('hides featured controls and the workbench shortcut for ordinary reviewers',async()=>{
 mock.summary.mockResolvedValue({reviewer:true,role:'reviewer',featured:{admin:false,featuredUsed:0,featuredQuota:50}});
 session.me={accountNumId:4};await nextTick();await vi.waitFor(()=>expect(button()).toBeNull());
 expect(host.querySelector('[data-featured-entry]')).toBeNull();
});
it('does not offer another provider card to the current admin',async()=>{
 provider='lunatalk';host.querySelector<HTMLButtonElement>('.work-item')!.click();await nextTick();await nextTick();expect(button()).toBeNull();
});
it('keeps the current value and allows retry after an upstream failure',async()=>{
 mock.mark.mockRejectedValueOnce(new Error('internal upstream details'));
 await vi.waitFor(()=>expect(button()).not.toBeNull());button()!.click();
 await vi.waitFor(()=>expect(host.querySelector('[role="alert"]')).not.toBeNull());
 expect(host.textContent).not.toContain('internal upstream details');expect(button()!.disabled).toBe(false);expect(featured).toBe(false);
});
it('does not submit after cancelling or after changing accounts during confirmation',async()=>{
 mock.confirm.mockResolvedValueOnce(false);await vi.waitFor(()=>expect(button()).not.toBeNull());button()!.click();await nextTick();await nextTick();expect(mock.mark).not.toHaveBeenCalled();
 let finish!:(v:boolean)=>void;mock.confirm.mockImplementationOnce(()=>new Promise(r=>{finish=r;}));button()!.click();await vi.waitFor(()=>expect(finish).toBeDefined());
 session.me={accountNumId:7};await nextTick();finish(true);await nextTick();await nextTick();expect(mock.mark).not.toHaveBeenCalled();
});
it('shows the full quota without allowing another feature',async()=>{
 mock.summary.mockResolvedValue({reviewer:true,role:'reviewer',featured:{admin:true,featuredUsed:50,featuredQuota:50}});
 const {useReviewer}=await import('../src/lib/review');await useReviewer().refresh();await nextTick();
 expect(button()!.disabled).toBe(true);expect(host.textContent).toContain(i18n.global.t('card.featureQuotaFull'));expect(mock.mark).not.toHaveBeenCalled();
});
