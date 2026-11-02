import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {createApp,nextTick,type App} from 'vue';
import {createRouter,createMemoryHistory} from 'vue-router';
import {i18n,applyLocale} from '../src/lib/i18n';
const mock=vi.hoisted(()=>({request:vi.fn()}));
vi.mock('../src/lib/community',async original=>({...await original<object>(),communityRequest:mock.request}));
vi.mock('../src/lib/session',()=>({useSession:()=>({profile:{handle:'fixture'},accessToken:async()=>'fixture'})}));
import BadgesPage from '../src/pages/BadgesPage.vue';
let app:App,el:HTMLDivElement;
const settle=async()=>{await nextTick();await new Promise(r=>setTimeout(r,0));};
const wall=()=>({items:[{key:'event_a',icon:'award',category:'event',titles:{en:'First event'},descriptions:{en:'Participate'},state:'earned',earnedAt:1000,expiresAt:null}],featured:[],public:false,canManage:false});
beforeEach(async()=>{vi.clearAllMocks();await applyLocale('en');mock.request.mockResolvedValue(wall());el=document.createElement('div');document.body.append(el);const router=createRouter({history:createMemoryHistory(),routes:[{path:'/:pathMatch(.*)*',component:BadgesPage}]});await router.push('/me/badges');app=createApp(BadgesPage).use(router).use(i18n);app.mount(el);await settle();});
afterEach(()=>{app.unmount();el.remove();});
it('saves selected badges and public visibility together and shows durable success',async()=>{
 el.querySelector<HTMLButtonElement>('[data-feature]')!.click();const input=el.querySelector<HTMLInputElement>('input[type=checkbox]')!;input.checked=true;input.dispatchEvent(new Event('change',{bubbles:true}));await settle();
 mock.request.mockResolvedValueOnce({...wall(),featured:['event_a'],public:true});el.querySelector<HTMLButtonElement>('.btn--primary')!.click();await settle();
 expect(mock.request).toHaveBeenLastCalledWith('/me/community/badges/featured','fixture','PATCH',{featured:['event_a'],public:true});expect(el.textContent).toContain('Display settings saved.');
});
it('retains the selection after failure and supports discard without writing',async()=>{
 el.querySelector<HTMLButtonElement>('[data-feature]')!.click();await settle();mock.request.mockRejectedValueOnce(new Error('offline'));el.querySelector<HTMLButtonElement>('.btn--primary')!.click();await settle();
 expect(el.querySelector('[data-feature]')?.getAttribute('aria-pressed')).toBe('true');expect(el.querySelector('[role=alert]')?.textContent).toContain('Changes were not saved');
 const reset=[...el.querySelectorAll('button')].find(b=>b.textContent==='Discard changes')!;reset.click();await settle();expect(el.querySelector('[data-feature]')?.getAttribute('aria-pressed')).toBe('false');
});
it('does not expose management controls to normal members',()=>{expect(el.querySelector('.badge-manager')).toBeNull();});
it('groups the catalog under category headings in catalog order',async()=>{
 const badge=(key:string,category:string)=>({key,icon:'star',category,titles:{en:key},descriptions:{en:'How'},state:'locked',earnedAt:null,expiresAt:null});
 app.unmount();mock.request.mockResolvedValue({...wall(),items:[badge('discord_linked','connection'),badge('creator_works_3','creation'),badge('creator_works_10','creation'),badge('player_first_play','play')]});
 const router=createRouter({history:createMemoryHistory(),routes:[{path:'/:pathMatch(.*)*',component:BadgesPage}]});await router.push('/me/badges');app=createApp(BadgesPage).use(router).use(i18n);app.mount(el);await settle();
 const headings=[...el.querySelectorAll('.badge-section__label')].map(h=>h.textContent);
 expect(headings).toEqual(['Connection','Creation','Play']);
 // 自己的頁面在類別名後面接「已取得 / 該類總數」
 expect([...el.querySelectorAll('.badge-section__count')].map(h=>h.textContent)).toEqual(['0 / 1','0 / 2','0 / 1']);
 expect(el.querySelectorAll('.badge-section')[1].querySelectorAll('.badge-tile')).toHaveLength(2);
});

it('never shows management controls here: badge management lives in the community management workspace',async()=>{
 app.unmount();mock.request.mockResolvedValue(wall());
 const router=createRouter({history:createMemoryHistory(),routes:[{path:'/:pathMatch(.*)*',component:BadgesPage}]});await router.push('/me/badges');app=createApp(BadgesPage).use(router).use(i18n);app.mount(el);await settle();
 expect(el.querySelector('.badge-manager')).toBeNull();expect(el.querySelector('[data-badge-award]')).toBeNull();
});

const rank=(key:string,state='earned',extra:Record<string,unknown>={})=>({key,icon:'award',category:'rank',titles:{en:key},descriptions:{en:'Ranked'},state,earnedAt:state==='earned'?1000:null,expiresAt:null,...extra});
async function open(path:string,collection:unknown){
 app.unmount();mock.request.mockReset();mock.request.mockResolvedValue(collection);
 const router=createRouter({history:createMemoryHistory(),routes:[{path:'/me/badges',component:BadgesPage},{path:'/authors/:handle/badges',component:BadgesPage},{path:'/:p(.*)*',component:{template:'<div/>'}}]});
 await router.push(path);app=createApp(BadgesPage).use(router).use(i18n);app.mount(el);await settle();
}
it('shows a read-only public page from the author endpoint with only earned badges',async()=>{
 await open('/authors/moon/badges',{items:[rank('rank_clean_day_1','earned',{count:3,lastPeriod:'2026-11-03'})],featured:[]});
 expect(mock.request).toHaveBeenCalledWith('/community/members/moon/badges');
 expect(el.querySelector('.badge-curation')).toBeNull();expect(el.querySelector('[data-feature]')).toBeNull();expect(el.querySelector('.badge-filters')).toBeNull();
 expect(el.querySelector('.badge-tile h3')?.textContent).toBe('SFW Daily #1');
 expect(el.querySelector('.badge-tile__times')?.textContent).toBe('×3');
 expect(el.textContent).toContain('Earned 3 times, latest Nov 3');
 expect(el.querySelector('.badges-back')?.getAttribute('href')).toContain('/authors/moon');
});
it('says so plainly when an author has no public badges',async()=>{
 await open('/authors/moon/badges',{items:[],featured:[]});
 expect(el.querySelector('.badge-empty')?.textContent).toContain('No public badges');
});
it('folds board honors the member has not earned instead of listing all eighteen',async()=>{
 await open('/me/badges',{items:[rank('rank_all_day_1'),rank('rank_clean_day_1'),rank('rank_clean_week_3','locked'),rank('rank_clean_month_10','locked')],featured:[],public:true});
 const section=el.querySelector('.badge-section')!;
 expect([...section.querySelectorAll(':scope > .badge-wall .badge-tile h3')].map(h=>h.textContent)).toEqual(['SFW Daily #1','Overall Daily #1']);
 expect(section.querySelector('details summary')?.textContent).toBe('Board honors not yet earned (2)');
 expect(section.querySelectorAll('details .badge-tile')).toHaveLength(2);
 expect(section.querySelector('.badge-section__hint')?.textContent).toContain('24 hours after the day ends');
 expect(section.querySelector('.badge-section__hint')?.textContent).toContain('7 days after the week ends');
});
it('treats an author without a member profile as having no public badges',async()=>{
 await open('/authors/ghost/badges',{items:[],featured:[]});
 mock.request.mockReset();mock.request.mockRejectedValue(Object.assign(new Error('not found'),{status:404}));
 app.unmount();const router=createRouter({history:createMemoryHistory(),routes:[{path:'/authors/:handle/badges',component:BadgesPage},{path:'/:p(.*)*',component:{template:'<div/>'}}]});
 await router.push('/authors/ghost/badges');app=createApp(BadgesPage).use(router).use(i18n);app.mount(el);await settle();
 expect(el.querySelector('[role=alert]')).toBeNull();
 expect(el.querySelector('.badge-empty')?.textContent).toContain('No public badges');
});
