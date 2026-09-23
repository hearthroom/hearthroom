import { afterEach, expect, it, vi } from 'vitest';
import { createApp, nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { i18n } from '../src/lib/i18n';
import { useSession } from '../src/lib/session';
import { currentProvider, setProvider } from '../src/lib/provider';
import PlayPage from '../src/pages/PlayPage.vue';
const mocks=vi.hoisted(()=>({stage:vi.fn(),preload:vi.fn(async()=>{}),token:vi.fn(),authorize:vi.fn(),connect:vi.fn()}));
vi.mock('../src/lib/stage-host',()=>({ensureStage:mocks.stage,preloadStage:mocks.preload,remergeStageMessages:vi.fn(),stageToasts:{list:[]}}));
vi.mock('../src/lib/connections',()=>({accountToken:mocks.token,connectAccount:mocks.connect}));
vi.mock('../src/lib/play-authorization',()=>({ensurePlayAuthorization:mocks.authorize}));
vi.mock('../src/lib/api',async original=>({...await original<typeof import('../src/lib/api')>(),fetchCard:async()=>({id:'100021',num:100021}),fetchCardPlatforms:async()=>[{provider:'harbor',roleId:'harbor-role',playable:true}],fetchMeAt:async()=>({accountNumId:22,nickName:'Second account',avatar:''})}));
let app:ReturnType<typeof createApp>;let root:HTMLElement;
afterEach(()=>{app?.unmount();root?.remove();});
it('passes the selected service credentials to the player while keeping the community session',async()=>{
 setProvider('harbor');mocks.token.mockResolvedValue('harbor-token');mocks.authorize.mockResolvedValue(true);mocks.stage.mockResolvedValue({template:'<div>Fixture player</div>'});
 const pinia=createPinia();setActivePinia(pinia);const session=useSession();
 session.me={accountNumId:11,nickName:'Community account',avatar:''};
 session.token={accessToken:'community-token',expiresAt:Date.now()+3600000} as any;
 session.profile={identities:[{provider:'harbor',externalId:11}]} as any;
 const router=createRouter({history:createMemoryHistory(),routes:[{path:'/play/:roleId',component:PlayPage}]});await router.push('/play/harbor-role?provider=harbor');
 root=document.createElement('div');document.body.append(root);app=createApp(PlayPage).use(pinia).use(i18n).use(router);app.mount(root);
 for(let i=0;i<40;i++)await Promise.resolve();await nextTick();
 const options=mocks.stage.mock.calls[0]![0];
 expect(options.provider).toBe('harbor');expect(options.player.accountNumId).toBe(11);
 expect(options.currentRoleId()).toBe('harbor-role');expect(await options.accessToken()).toBe('community-token');
 expect(mocks.authorize).toHaveBeenCalledWith('community-token','/play/harbor-role?provider=harbor','harbor');
 expect(currentProvider()).toBe('harbor');expect(session.me.accountNumId).toBe(11);expect(session.token.accessToken).toBe('community-token');expect(mocks.connect).not.toHaveBeenCalled();
});

it('preloads static player code while profile is pending, without initializing private APIs', async()=>{
 mocks.stage.mockClear(); mocks.preload.mockClear(); mocks.authorize.mockClear();
 const pinia=createPinia();setActivePinia(pinia);const session=useSession();
 let finish!:()=>void;
 vi.spyOn(session,'ensureProfile').mockImplementation(()=>new Promise<void>(resolve=>{finish=resolve}));
 const router=createRouter({history:createMemoryHistory(),routes:[{path:'/play/:roleId',component:PlayPage}]});await router.push('/play/fixture');
 root=document.createElement('div');document.body.append(root);app=createApp(PlayPage).use(pinia).use(i18n).use(router);app.mount(root);
 await nextTick();
 expect(mocks.preload).toHaveBeenCalledTimes(1);
 expect(mocks.stage).not.toHaveBeenCalled();expect(mocks.authorize).not.toHaveBeenCalled();
 app.unmount(); app=undefined as any; finish();
});

it('checks same-provider play permission while the community profile is pending, then waits before installing',async()=>{
 setProvider('harbor');mocks.stage.mockClear();mocks.authorize.mockClear();mocks.authorize.mockResolvedValue(true);
 const pinia=createPinia();setActivePinia(pinia);const session=useSession();
 session.me={accountNumId:11,nickName:'Community account',avatar:''};
 session.token={accessToken:'community-token',expiresAt:Date.now()+3600000} as any;
 let finish!:()=>void;vi.spyOn(session,'ensureProfile').mockImplementation(()=>new Promise<void>(r=>{finish=r}));
 const router=createRouter({history:createMemoryHistory(),routes:[{path:'/play/:roleId',component:PlayPage}]});await router.push('/play/fixture?provider=harbor');
 root=document.createElement('div');document.body.append(root);app=createApp(PlayPage).use(pinia).use(i18n).use(router);app.mount(root);
 for(let i=0;i<40;i++)await Promise.resolve();
 expect(mocks.authorize).toHaveBeenCalledWith('community-token','/play/fixture?provider=harbor','harbor');
 expect(mocks.stage).not.toHaveBeenCalled();finish();
 for(let i=0;i<40;i++)await Promise.resolve();await nextTick();
 expect(mocks.stage).toHaveBeenCalledTimes(1);
});

it.each(['denied','unmounted'])('never installs early for %s startup',async(mode)=>{
 setProvider(mode==='cross-provider'?'harbor':'harbor');mocks.stage.mockClear();mocks.authorize.mockClear();mocks.connect.mockClear();mocks.token.mockClear();
 mocks.authorize.mockResolvedValue(mode!=='denied');
 const pinia=createPinia();setActivePinia(pinia);const session=useSession();
 session.me={accountNumId:11,nickName:'Community account',avatar:''};
 session.token={accessToken:'community-token',expiresAt:Date.now()+3600000} as any;
 let finish!:()=>void;vi.spyOn(session,'ensureProfile').mockImplementation(()=>new Promise<void>(r=>{finish=r}));
 const router=createRouter({history:createMemoryHistory(),routes:[{path:'/play/:roleId',component:PlayPage}]});await router.push('/play/fixture?provider=harbor');
 root=document.createElement('div');document.body.append(root);app=createApp(PlayPage).use(pinia).use(i18n).use(router);app.mount(root);
 for(let i=0;i<40;i++)await Promise.resolve();
 expect(mocks.stage).not.toHaveBeenCalled();
 if(mode==='cross-provider'){expect(mocks.authorize).not.toHaveBeenCalled();expect(mocks.token).not.toHaveBeenCalled();}
 if(mode==='unmounted'){app.unmount();app=undefined as any;}
 finish();for(let i=0;i<40;i++)await Promise.resolve();await nextTick();
 expect(mocks.stage).not.toHaveBeenCalled();
 if(mode==='cross-provider')expect(mocks.connect).toHaveBeenCalledWith('harbor','/play/fixture?provider=harbor');
});
