import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {createApp,defineComponent,h,nextTick,type App} from 'vue';
import {createRouter,createMemoryHistory,RouterView,type Router} from 'vue-router';
import {i18n,applyLocale} from '../src/lib/i18n';
const mock=vi.hoisted(()=>({request:vi.fn()}));
vi.mock('../src/lib/community',async original=>({...await original<object>(),communityRequest:mock.request}));
vi.mock('../src/lib/session',()=>({useSession:()=>({profile:{handle:'fixture'},accessToken:async()=>'fixture'})}));
import BadgesPage from '../src/pages/BadgesPage.vue';

let app:App|undefined,el:HTMLDivElement,router:Router;
const badge=(key:string,extra:Record<string,unknown>={})=>({key,icon:'compass',category:'play',titles:{en:key},descriptions:{en:'How'},state:'locked',earnedAt:null,expiresAt:null,...extra});
const collection=(explored:number,extra:Record<string,unknown>={})=>({featured:[],public:false,...extra,items:[
 badge('player_first_play',{state:'earned',earnedAt:1}),
 badge('player_explorer_10',{state:'earned',earnedAt:1,series:'explorer',progress:{value:10,target:10}}),
 badge('player_explorer_50',{series:'explorer',progress:{value:explored,target:50}}),
 badge('player_rater_50'),
 badge('sole_wanderer',{series:'explorer',progress:{value:Math.min(explored,500),target:500},...(explored>=500?{pausedMet:true}:{})}),
]});
/** 伺服器的樣子：只有成就頁帶 ?refresh=1 的那一次回 refreshing，之後的讀取回 next() */
function server(first:number,next:()=>unknown){
 let claimed=false;
 mock.request.mockImplementation(async(path:string)=>{
  if(path==='/me/community/badges?refresh=1'&&!claimed){claimed=true;return collection(first,{refreshing:true});}
  if(path.startsWith('/me/community/badges/'))return collection(first);
  return claimed?next():collection(first);
 });
}
const flush=async()=>{for(let i=0;i<6;i++){await nextTick();await vi.advanceTimersByTimeAsync(0);}};
async function open(path='/me/badges'){
 router=createRouter({history:createMemoryHistory(),routes:[{path:'/me/badges',component:BadgesPage},{path:'/authors/:handle/badges',component:BadgesPage},{path:'/:p(.*)*',component:{template:'<div/>'}}]});
 await router.push(path);app=createApp(defineComponent({render:()=>h(RouterView)})).use(router).use(i18n);app.mount(el);await flush();
}
const status=()=>el.querySelector('.badges-refresh')?.textContent??'';
const progressOf=(key:string)=>[...el.querySelectorAll('.badge-tile')].find(t=>t.textContent?.includes(key))?.querySelector('progress')?.getAttribute('value');
beforeEach(async()=>{vi.useFakeTimers();mock.request.mockReset();await applyLocale('en');el=document.createElement('div');document.body.append(el);});
afterEach(()=>{app?.unmount();app=undefined;el.remove();vi.useRealTimers();});

it('asks for the refresh only after the old badge address moves to the own author page, then rereads and announces a change',async()=>{
 server(3,()=>collection(5));
 await open();
 expect(router.currentRoute.value.path).toBe('/authors/fixture/badges');
 const paths=mock.request.mock.calls.map(c=>c[0]);
 expect(paths.filter(p=>p==='/me/community/badges?refresh=1')).toHaveLength(1);
 expect(progressOf('player_explorer_50')).toBe('3');expect(status()).toContain('Updating progress');
 await vi.advanceTimersByTimeAsync(4000);await flush();
 expect(mock.request).toHaveBeenLastCalledWith('/me/community/badges','fixture','GET',undefined);
 expect(progressOf('player_explorer_50')).toBe('5');expect(el.querySelector('[aria-live=polite]')?.textContent).toBe('Progress updated');
 await vi.advanceTimersByTimeAsync(3000);await flush();expect(status()).toBe('');
});

it('clears quietly when nothing changed or the reread fails',async()=>{
 server(3,()=>collection(3));
 await open();await vi.advanceTimersByTimeAsync(8000);await flush();
 expect(status()).toBe('');expect(el.querySelector('[role=alert]')).toBeNull();
 app!.unmount();mock.request.mockReset();
 server(3,()=>{throw new Error('offline')});
 await open();await vi.advanceTimersByTimeAsync(4000);await flush();
 expect(status()).toBe('');expect(el.querySelector('[role=alert]')).toBeNull();expect(progressOf('player_explorer_50')).toBe('3');
});

it('drops the status when the member leaves the page during the refresh',async()=>{
 server(3,()=>collection(5));
 await open();expect(status()).toContain('Updating progress');
 await router.push('/authors/someone/badges');await flush();
 await vi.advanceTimersByTimeAsync(8000);await flush();
 await router.push('/authors/fixture/badges');await flush();
 expect(status()).not.toContain('Updating progress');
});

it('does not paint a reread over a save made while it was in flight',async()=>{
 server(3,()=>collection(5));
 await open();
 el.querySelector<HTMLButtonElement>('[data-feature]')!.click();await flush();
 el.querySelector<HTMLButtonElement>('.btn--primary')!.click();await flush();
 expect(mock.request).toHaveBeenCalledWith('/me/community/badges/featured','fixture','PATCH',expect.anything());
 const before=mock.request.mock.calls.length;
 await vi.advanceTimersByTimeAsync(8000);await flush();
 expect(mock.request.mock.calls.length).toBe(before);expect(status()).toBe('');
});

it('keeps one series together under a heading and shows the paused note on a met wanderer',async()=>{
 mock.request.mockResolvedValue(collection(612));
 await open();
 const play=el.querySelector('.badge-section')!;
 expect(play.querySelectorAll('.badge-series')).toHaveLength(1);
 expect(play.querySelector('.badge-series__title')?.textContent).toBe('Explorer series');
 const order=[...play.querySelectorAll('.badge-tile h3')].map(h=>h.textContent);
 expect(order).toEqual(['player_first_play','player_explorer_10','player_explorer_50','sole_wanderer','player_rater_50']);
 const wanderer=[...el.querySelectorAll('.badge-tile')].find(t=>t.textContent?.includes('sole_wanderer'))!;
 expect(wanderer.querySelector('.badge-tile__paused')?.textContent).toBe('Condition met; awarding is currently paused');
 expect(wanderer.querySelector('progress')?.getAttribute('value')).toBe('500');
});
