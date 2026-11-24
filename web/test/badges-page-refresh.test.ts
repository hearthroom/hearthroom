import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {createApp,nextTick,type App} from 'vue';
import {createRouter,createMemoryHistory} from 'vue-router';
import {i18n,applyLocale} from '../src/lib/i18n';
const mock=vi.hoisted(()=>({request:vi.fn()}));
vi.mock('../src/lib/community',async original=>({...await original<object>(),communityRequest:mock.request}));
vi.mock('../src/lib/session',()=>({useSession:()=>({profile:{handle:'fixture'},accessToken:async()=>'fixture'})}));
import BadgesPage from '../src/pages/BadgesPage.vue';

let app:App|undefined,el:HTMLDivElement;
const badge=(key:string,extra:Record<string,unknown>={})=>({key,icon:'compass',category:'play',titles:{en:key},descriptions:{en:'How'},state:'locked',earnedAt:null,expiresAt:null,...extra});
const collection=(explored:number,extra:Record<string,unknown>={})=>({featured:[],public:false,...extra,items:[
 badge('player_first_play',{state:'earned',earnedAt:1}),
 badge('player_explorer_10',{state:'earned',earnedAt:1,series:'explorer',progress:{value:10,target:10}}),
 badge('player_explorer_50',{series:'explorer',progress:{value:explored,target:50}}),
 badge('player_rater_50'),
 badge('sole_wanderer',{series:'explorer',progress:{value:Math.min(explored,500),target:500},...(explored>=500?{pausedMet:true}:{})}),
]});
const flush=async()=>{for(let i=0;i<4;i++){await nextTick();await vi.advanceTimersByTimeAsync(0);}};
async function open(){
 const router=createRouter({history:createMemoryHistory(),routes:[{path:'/me/badges',component:BadgesPage},{path:'/:p(.*)*',component:{template:'<div/>'}}]});
 await router.push('/me/badges');app=createApp(BadgesPage).use(router).use(i18n);app.mount(el);await flush();
}
const status=()=>el.querySelector('.badges-refresh')?.textContent??'';
const progressOf=(key:string)=>[...el.querySelectorAll('.badge-tile')].find(t=>t.textContent?.includes(key))?.querySelector('progress')?.getAttribute('value');
beforeEach(async()=>{vi.useFakeTimers();vi.clearAllMocks();mock.request.mockReset();await applyLocale('en');el=document.createElement('div');document.body.append(el);});
afterEach(()=>{app?.unmount();app=undefined;el.remove();vi.useRealTimers();});

it('shows the stored numbers first, rereads once the refresh lands and announces only a change',async()=>{
 mock.request.mockResolvedValueOnce(collection(3,{refreshing:true})).mockResolvedValueOnce(collection(5));
 await open();
 expect(progressOf('player_explorer_50')).toBe('3');expect(status()).toContain('Updating progress');
 await vi.advanceTimersByTimeAsync(4000);await flush();
 expect(mock.request).toHaveBeenLastCalledWith('/me/community/badges?reread=1','fixture','GET',undefined);
 expect(progressOf('player_explorer_50')).toBe('5');expect(el.querySelector('[aria-live=polite]')?.textContent).toBe('Progress updated');
 await vi.advanceTimersByTimeAsync(3000);await flush();expect(status()).toBe('');
});

it('clears quietly when nothing changed, when the reread fails, or when no refresh was started',async()=>{
 mock.request.mockResolvedValueOnce(collection(3,{refreshing:true})).mockResolvedValue(collection(3));
 await open();await vi.advanceTimersByTimeAsync(8000);await flush();
 expect(mock.request).toHaveBeenCalledTimes(3);expect(status()).toBe('');expect(el.querySelector('[role=alert]')).toBeNull();
 app!.unmount();mock.request.mockReset();mock.request.mockResolvedValueOnce(collection(3,{refreshing:true})).mockRejectedValue(new Error('offline'));
 await open();await vi.advanceTimersByTimeAsync(4000);await flush();
 expect(status()).toBe('');expect(el.querySelector('[role=alert]')).toBeNull();expect(progressOf('player_explorer_50')).toBe('3');
 app!.unmount();mock.request.mockReset();mock.request.mockResolvedValue(collection(3));
 await open();expect(status()).toBe('');await vi.advanceTimersByTimeAsync(8000);expect(mock.request).toHaveBeenCalledTimes(1);
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
