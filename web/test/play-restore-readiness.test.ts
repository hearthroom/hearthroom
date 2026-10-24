import {afterEach,expect,it,vi} from 'vitest';
import {createApp,nextTick} from 'vue';
import {createPinia,setActivePinia} from 'pinia';
import {createMemoryHistory,createRouter} from 'vue-router';
import {i18n} from '../src/lib/i18n';
import {useSession} from '../src/lib/session';
import {setProvider} from '../src/lib/provider';
import PlayPage from '../src/pages/PlayPage.vue';
const mocks=vi.hoisted(()=>({stage:vi.fn(),resolve:vi.fn(),authorize:vi.fn(),connect:vi.fn()}));
vi.mock('../src/lib/stage-host',()=>({ensureStage:mocks.stage,preloadStage:async()=>{},remergeStageMessages:vi.fn(),stageToasts:{list:[]}}));
vi.mock('../src/lib/play-card',()=>({resolvePlayCard:mocks.resolve}));
vi.mock('../src/lib/connections',()=>({accountToken:vi.fn(),connectAccount:mocks.connect}));
vi.mock('../src/lib/play-authorization',()=>({ensurePlayAuthorization:mocks.authorize}));
let app:ReturnType<typeof createApp>,root:HTMLElement;
const settle=async()=>{for(let i=0;i<40;i++)await Promise.resolve();await nextTick();};
afterEach(()=>{app?.unmount();root?.remove();vi.restoreAllMocks();vi.clearAllMocks();});
it.each(['resume=saved','mode=source','review=submission'])('waits for cold session restore before reading credentials for %s',async query=>{
 setProvider('harbor');const pinia=createPinia();setActivePinia(pinia);const session=useSession();
 let finish!:()=>void;
 const restoring=new Promise<void>(r=>{finish=()=>{session.ready=true;session.me={accountNumId:11,nickName:'Synthetic',avatar:''};r();};});
 vi.spyOn(session,'restore').mockReturnValue(restoring);
 const access=vi.spyOn(session,'accessToken').mockImplementation(async()=>session.ready?'saved-access':null);
 vi.spyOn(session,'ensureProfile').mockResolvedValue();
 mocks.resolve.mockResolvedValue({number:'100001',roleId:'saved-role',conversationId:'saved',readOnly:true,reason:'author_private',title:'Saved history'});
 mocks.authorize.mockResolvedValue(true);mocks.stage.mockResolvedValue({template:'<div>Saved history</div>'});
 const router=createRouter({history:createMemoryHistory(),routes:[{path:'/play/:roleId',component:PlayPage}]});await router.push('/play/100001?provider=harbor&'+query);
 // App's restore is already in flight when the same-document library anchor
 // opens a fresh PlayPage. The saved access token needs no refresh token.
 void session.restore();root=document.createElement('div');document.body.append(root);
 app=createApp(PlayPage).use(pinia).use(i18n).use(router);app.mount(root);
 try{
  await settle();expect(access).not.toHaveBeenCalled();expect(mocks.connect).not.toHaveBeenCalled();expect(mocks.stage).not.toHaveBeenCalled();
  finish();await settle();
  expect(mocks.authorize).toHaveBeenCalledWith('saved-access',expect.any(String),'harbor');
  expect(mocks.stage).toHaveBeenCalledOnce();expect(mocks.connect).not.toHaveBeenCalled();
  if(query.startsWith('resume'))expect(mocks.resolve.mock.calls[0][5]).toEqual({id:'saved',token:'saved-access',providerToken:'saved-access'});
 }finally{finish();}
});
