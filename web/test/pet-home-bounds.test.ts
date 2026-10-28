import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {createApp,nextTick,ref,type App} from 'vue';
import {createMemoryHistory,createRouter} from 'vue-router';
import {i18n} from '../src/lib/i18n';
import {petEnabled} from '../src/pet/enabled';
import {sidebarBoundsKey} from '../src/lib/site-links';
import type {PetOptions} from '../src/pet/pet-ui';
let captured:PetOptions;
vi.mock('../src/pet/pet-ui',()=>({SukiPet:class{
 constructor(options:PetOptions){captured=options;}
 async start(){}stop(){}on(){}setGuide(){}tuckAside(){}setSkin(){return Promise.resolve();}
}}));
vi.mock('../src/lib/session',()=>({useSession:()=>({ready:true,me:null,wallet:null,accessToken:async()=>null})}));
vi.mock('../src/lib/notifications',()=>({useNotifications:()=>({unread:0,items:[]}),noticeText:()=>''}));
vi.mock('../src/lib/review',()=>({useReviewer:()=>({pending:0})}));
import SukiPet from '../src/components/SukiPet.vue';
let app:App,root:HTMLElement,main:HTMLElement;
const settle=async()=>{for(let i=0;i<6;i++){await new Promise(r=>setTimeout(r,0));await nextTick();}};
beforeEach(()=>{
 petEnabled.value=true;vi.stubGlobal('innerWidth',768);vi.stubGlobal('innerHeight',900);
 vi.stubGlobal('requestIdleCallback',(f:()=>void)=>f());vi.spyOn(document,'readyState','get').mockReturnValue('complete');
 main=document.createElement('div');main.className='board-main';main.getBoundingClientRect=()=>new DOMRect(20,450,728,1600);document.body.append(main);
});
afterEach(()=>{app?.unmount();root?.remove();main.remove();i18n.global.locale.value='zh-Hant';vi.unstubAllGlobals();vi.restoreAllMocks();});
async function mount(path='/',rail=ref<any>(null)){
 const router=createRouter({history:createMemoryHistory(),routes:[{path:'/:locale(en|zh-Hans|ja|ko)?',children:[{path:'',component:{template:'<div/>'}},{path:':pathMatch(.*)*',component:{template:'<div/>'}}]}]});await router.push(path);
 root=document.createElement('div');document.body.append(root);app=createApp(SukiPet).use(router).use(i18n).provide(sidebarBoundsKey,rail);app.mount(root);await settle();return router;
}
it('protects the visible homepage main column when the tablet has no rail',async()=>{
 const router=await mount();const bounds=captured.sidebarBounds?.();
 expect(bounds).not.toBeNull();expect(bounds).toMatchObject({left:20,right:748});
 expect(bounds!.top).toBeLessThanOrEqual(700);expect(bounds!.bottom).toBeGreaterThan(729);
 await router.push('/blog');await nextTick();expect(captured.sidebarBounds?.()).toBeNull();
});
it('preserves the wide sidebar contract and only adds narrow-home protection',async()=>{
 vi.stubGlobal('innerWidth',1440);const bounds={left:1139,right:1403,top:84,bottom:820};await mount('/',ref(bounds));expect(captured.sidebarBounds?.()).toEqual(bounds);
});
it('recognizes the localized homepage without protecting an unrelated page',async()=>{
 i18n.global.locale.value='en';const router=await mount('/en/');expect(captured.sidebarBounds?.()).not.toBeNull();await router.push('/en/blog');await nextTick();expect(captured.sidebarBounds?.()).toBeNull();
});

it('selects homepage parking at the actual 640–1079 limits and follows the enabled preference',async()=>{
 await mount();for(const [width,expected]of [[639,false],[640,true],[1079,true],[1080,false]] as const){vi.stubGlobal('innerWidth',width);expect(captured.parkOnHomepage?.()).toBe(expected);}
 vi.stubGlobal('innerWidth',768);petEnabled.value=false;expect(captured.parkOnHomepage?.()).toBe(false);petEnabled.value=true;
});
