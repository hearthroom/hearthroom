import {afterEach,expect,it,vi} from 'vitest';
import {createApp,defineComponent,h,nextTick} from 'vue';
import {createMemoryHistory,createRouter} from 'vue-router';
import {i18n} from '../src/lib/i18n';
const state=vi.hoisted(()=>({events:[] as {type:string;key?:string;showIf?:()=>boolean}[]}));
vi.mock('../src/pet/pet-ui',()=>({SukiPet:class{
 async start(){} stop(){} on(e:{type:string;key?:string;showIf?:()=>boolean}){state.events.push(e);} setGuide(){} tuckAside(){} setSkin(){return Promise.resolve();}
}}));
vi.mock('../src/lib/session',()=>({useSession:()=>({ready:true,me:null,wallet:null,accessToken:async()=>null})}));
vi.mock('../src/lib/notifications',()=>({useNotifications:()=>({unread:0,items:[]}),noticeText:()=>''}));
vi.mock('../src/lib/review',()=>({useReviewer:()=>({pending:3})}));
import Pet from '../src/components/SukiPet.vue';
let app:ReturnType<typeof createApp>|undefined;
afterEach(()=>{app?.unmount();state.events.length=0;vi.unstubAllGlobals();});
const settle=async()=>{for(let i=0;i<5;i++){await new Promise(r=>setTimeout(r,0));await nextTick();}};
async function mount(path:string){
 vi.stubGlobal('requestIdleCallback',(f:()=>void)=>f());
 const page=defineComponent({render:()=>h('div')});
 const router=createRouter({history:createMemoryHistory(),routes:[{path:'/',component:page},{path:'/review',component:page,meta:{managementTab:'reviews'}},{path:'/review/:id',component:page,meta:{managementTab:'reviews',petQuietOnPhone:true}}]});
 await router.push(path);app=createApp(Pet).use(router).use(i18n);app.mount(document.createElement('div'));await settle();return router;
}
it('does not prompt a reviewer to open the queue while they are already reading a submission',async()=>{
 await mount('/review/s1');expect(state.events.filter(e=>e.type==='daily'&&e.key==='review')).toHaveLength(0);
});
// 2026-11-02：人已經在卡片審核的頁面上（佇列或詳情），就不再提醒「佇列有 N 張在等」
it('invalidates an already visible or queued queue reminder when entering any card-review page, and permits it again elsewhere',async()=>{
 const router=await mount('/');const reminder=state.events.find(e=>e.type==='daily'&&e.key==='review');
 expect(reminder?.showIf?.()).toBe(true);
 await router.push('/review');await settle();expect(reminder?.showIf?.()).toBe(false);
 await router.push('/review/s1');await settle();expect(reminder?.showIf?.()).toBe(false);
 await router.push('/');await settle();expect(reminder?.showIf?.()).toBe(true);
});
it('does not prompt a reviewer to open the queue while they are already on it',async()=>{
 await mount('/review');expect(state.events.filter(e=>e.type==='daily'&&e.key==='review')).toHaveLength(0);
});
