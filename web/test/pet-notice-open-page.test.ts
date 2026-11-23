import {afterEach,expect,it,vi} from 'vitest';
import {createApp,defineComponent,h,nextTick} from 'vue';
import {createMemoryHistory,createRouter} from 'vue-router';
import {i18n} from '../src/lib/i18n';
const state=vi.hoisted(()=>({events:[] as {type:string}[]}));
vi.mock('../src/pet/pet-ui',()=>({SukiPet:class{
 async start(){} stop(){} on(e:{type:string}){state.events.push(e);} setGuide(){} tuckAside(){} setSkin(){return Promise.resolve();}
}}));
vi.mock('../src/lib/session',()=>({useSession:()=>({ready:true,me:null,wallet:null,accessToken:async()=>null})}));
vi.mock('../src/lib/notifications',()=>({useNotifications:()=>({unread:1,items:[{id:'n1',kind:'review_result',extra:{status:'rejected',kind:'first',reasons:['opening.too_short']},path:'/mine/reviews/s1',read_at:null}],load:async()=>null}),noticeText:()=>'卡片這次沒有通過審核'}));
vi.mock('../src/lib/review',()=>({useReviewer:()=>({pending:0})}));
import Pet from '../src/components/SukiPet.vue';
// 審卡 V2（PM 2026-11-23）：從駁回通知點進結果頁時，蘇綺不再用泡泡把同一則通知唸一次、蓋住第一張理由卡
let app:ReturnType<typeof createApp>|undefined;
afterEach(()=>{app?.unmount();state.events.length=0;vi.unstubAllGlobals();try{localStorage.clear();}catch{/* */}});
const settle=async()=>{for(let i=0;i<6;i++){await new Promise(r=>setTimeout(r,0));await nextTick();}};
async function mount(path:string){
 vi.stubGlobal('requestIdleCallback',(f:()=>void)=>f());
 const page=defineComponent({render:()=>h('div')});
 const router=createRouter({history:createMemoryHistory(),routes:[{path:'/',component:page},{path:'/mine/reviews/:id',component:page,meta:{petQuietOnPhone:true}}]});
 await router.push(path);app=createApp(Pet).use(router).use(i18n);app.mount(document.createElement('div'));await settle();
}
it('does not read out a notice whose page is already open',async()=>{
 await mount('/mine/reviews/s1');
 expect(state.events.filter(e=>e.type==='notice')).toHaveLength(0);
});
it('still tells the notice on other pages',async()=>{
 await mount('/');
 expect(state.events.filter(e=>e.type==='notice')).toHaveLength(1);
});
