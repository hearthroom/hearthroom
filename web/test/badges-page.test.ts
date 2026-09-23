import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {createApp,nextTick,type App} from 'vue';
import {createRouter,createMemoryHistory} from 'vue-router';
import {i18n,applyLocale} from '../src/lib/i18n';
const mock=vi.hoisted(()=>({request:vi.fn()}));
vi.mock('../src/lib/community',async original=>({...await original<object>(),communityRequest:mock.request}));
vi.mock('../src/lib/session',()=>({useSession:()=>({profile:{handle:'fixture'},accessToken:async()=>'fixture'})}));
vi.mock('../src/components/BadgeManager.vue',()=>({default:{emits:['changed'],template:'<button data-manager-refresh @click="$emit(\'changed\')">Refresh manager results</button>'}}));
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
 const headings=[...el.querySelectorAll('.badge-section__title')].map(h=>h.textContent);
 expect(headings).toEqual(['Connection','Creation','Play']);
 expect(el.querySelectorAll('.badge-section')[1].querySelectorAll('.badge-tile')).toHaveLength(2);
});

it('preserves unsaved visibility when a management action refreshes the collection',async()=>{
 el.querySelector<HTMLButtonElement>('[data-feature]')!.click();await settle();
 mock.request.mockResolvedValueOnce({...wall(),canManage:true});el.querySelector<HTMLButtonElement>('.btn--primary')!.click();await settle();
 const input=el.querySelector<HTMLInputElement>('input[type=checkbox]')!;input.checked=true;input.dispatchEvent(new Event('change',{bubbles:true}));await settle();
 mock.request.mockResolvedValueOnce({...wall(),canManage:true});el.querySelector<HTMLButtonElement>('[data-manager-refresh]')!.click();await settle();
 expect(el.querySelector<HTMLInputElement>('input[type=checkbox]')!.checked).toBe(true);expect(el.textContent).toContain('unsaved changes');
});
