import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {createApp,nextTick,reactive,type App} from 'vue';
import {createPinia,setActivePinia} from 'pinia';
import {createMemoryHistory,createRouter} from 'vue-router';
import {useSession} from '../src/lib/session';
import {useCheckin} from '../src/lib/checkin-store';
import {headerOverlaysKey} from '../src/lib/site-links';
import {i18n} from '../src/lib/i18n';
import CheckinHint from '../src/components/CheckinHint.vue';
vi.mock('../src/lib/track',()=>({track:()=>{}}));
let app:App,root:HTMLElement;
const overlays=reactive(new Set<symbol>());
async function mount(){
 const router=createRouter({history:createMemoryHistory(),routes:[{path:'/:pathMatch(.*)*',component:{template:'<div/>'}}]});await router.push('/');
 root=document.createElement('div');document.body.append(root);app=createApp(CheckinHint).use(router).use(i18n).provide(headerOverlaysKey,overlays);app.mount(root);await nextTick();
}
beforeEach(()=>{vi.useFakeTimers();setActivePinia(createPinia());overlays.clear();useSession().me={accountNumId:1} as any;});
afterEach(()=>{app?.unmount();root?.remove();vi.useRealTimers();});
it('only shows a confirmed pending check-in and navigates without claiming',async()=>{
 const store=useCheckin();await mount();expect(root.querySelector('[data-checkin-hint]')).toBeNull();
 store.panel={checkin:{todayClaimed:false}} as any;await nextTick();expect(root.querySelector('a')?.getAttribute('href')).toBe('/checkin');
 await vi.advanceTimersByTimeAsync(8000);expect(root.querySelector('[data-checkin-hint]')).toBeNull();
 store.panel={checkin:{todayClaimed:false}} as any;await nextTick();expect(root.querySelector('[data-checkin-hint]')).toBeNull();
});
it.each(['loading','error','disabled','claimed'])('hides %s and preserves the persistent menu responsibility',async state=>{
 const store=useCheckin();store.panel={checkin:{todayClaimed:state==='claimed'}} as any;
 if(state==='loading')store.loading=true;if(state==='error')store.error=new Error('offline');if(state==='disabled')store.disabled=true;
 await mount();expect(root.querySelector('[data-checkin-hint]')).toBeNull();
});
it('dismisses on menu open or account change and never reopens on that page',async()=>{
 const store=useCheckin();store.panel={checkin:{todayClaimed:false}} as any;await mount();expect(root.querySelector('[data-checkin-hint]')).not.toBeNull();
 overlays.add(Symbol());await nextTick();expect(root.querySelector('[data-checkin-hint]')).toBeNull();overlays.clear();await nextTick();expect(root.querySelector('[data-checkin-hint]')).toBeNull();
 useSession().me={accountNumId:2} as any;store.panel={checkin:{todayClaimed:false}} as any;await nextTick();expect(root.querySelector('[data-checkin-hint]')).toBeNull();
});
