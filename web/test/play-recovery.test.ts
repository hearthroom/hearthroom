import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp, nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { i18n } from '../src/lib/i18n';
import { useSession } from '../src/lib/session';
import { setProvider } from '../src/lib/provider';
import PlayPage from '../src/pages/PlayPage.vue';

const mocks=vi.hoisted(()=>({card:vi.fn(),platforms:vi.fn(),copies:vi.fn(),stage:vi.fn(),playApp:false,managed:true}));
vi.mock('../src/lib/managed-auth',async original=>({...await original<typeof import('../src/lib/managed-auth')>(),isManagedAuth:()=>mocks.managed}));
vi.mock('../src/lib/stage-host',()=>({ensureStage:mocks.stage,preloadStage:async()=>{},remergeStageMessages:vi.fn(),stageToasts:{list:[]}}));
vi.mock('../src/lib/play-authorization',()=>({ensurePlayAuthorization:async()=>true}));
vi.mock('../src/lib/connections',()=>({accountToken:async()=>'fixture-token',connectAccount:vi.fn()}));
vi.mock('../src/lib/distribution',async original=>({...await original<typeof import('../src/lib/distribution')>(),copies:mocks.copies}));
vi.mock('../src/lib/site',async original=>({...await original<typeof import('../src/lib/site')>(),isPlayHost:()=>mocks.playApp}));
vi.mock('../src/lib/api',async original=>({...await original<typeof import('../src/lib/api')>(),fetchCard:mocks.card,fetchCardPlatforms:mocks.platforms}));
vi.mock('../src/lib/share-ref',()=>({currentReferralCode:async()=>null}));
vi.mock('../src/lib/card-manifest',()=>({applyCardHead:vi.fn()}));
vi.mock('../src/lib/play-share',()=>({resolveShareToken:async()=>null,setPlayShare:vi.fn(),setPlayShareRef:vi.fn(),shareContextOf:()=>null,shareTokenOf:()=>null}));

let app:ReturnType<typeof createApp>|undefined,root:HTMLElement;
const settle=async()=>{for(let i=0;i<12;i++)await new Promise(r=>setTimeout(r,0));await nextTick();};
async function mount(path='/play/490001',signedIn=true){
 const pinia=createPinia();setActivePinia(pinia);const session=useSession();session.ready=true;
 if(signedIn){session.me={accountNumId:11,nickName:'Fixture author',avatar:''};session.profile={identities:[]} as never;session.token={accessToken:'fixture-token',expiresAt:Date.now()+3600000} as never;}
 const router=createRouter({history:createMemoryHistory(),routes:[{path:'/play/:roleId',component:PlayPage},{path:'/:roleId/',component:PlayPage},{path:'/login',component:{template:'<div />'}}]});
 await router.push(path);root=document.createElement('div');document.body.append(root);app=createApp(PlayPage).use(pinia).use(i18n).use(router);app.mount(root);await settle();return router;
}
const trial=()=>root.querySelector<HTMLAnchorElement>('a[href*="mode=source"]');
beforeEach(()=>{
 setProvider('harbor');mocks.playApp=false;mocks.managed=false;
 mocks.card.mockReset().mockResolvedValue({id:'490001',num:490001,roleId:'fixture-source',provider:'harbor',author:{accountNumId:11},status:'unshared'});
 mocks.platforms.mockReset().mockRejectedValue({status:404,code:'card not found'});
 mocks.copies.mockReset().mockResolvedValue([{provider:'harbor',roleId:'fixture-source',status:'source'}]);
 mocks.stage.mockReset().mockResolvedValue({template:'<div class="fixture-player">Player</div>'});
});
afterEach(()=>{app?.unmount();app=undefined;root?.remove();vi.restoreAllMocks();});

it('offers an explicit draft entrance only after backend ownership verification; strips share/install',async()=>{
 const router=await mount('/play/490001?share=context&install=1#scene');
 expect(mocks.copies).toHaveBeenCalledWith('fixture-source','harbor');
 expect(trial()?.getAttribute('href')).toBe('/play/490001?mode=source&provider=harbor');
 expect(trial()?.textContent).toContain(i18n.global.t('card.owner.playDraft'));
 expect(router.currentRoute.value.query.mode).toBeUndefined();expect(mocks.stage).not.toHaveBeenCalled();
 // Opening the offered URL still goes through the normal source resolver.
 await router.push(trial()!.getAttribute('href')!);await settle();
 expect(mocks.stage).toHaveBeenCalledTimes(1);expect(root.textContent).toContain('Player');
});

it('does not trust public author metadata when the ownership API denies access',async()=>{
 mocks.copies.mockRejectedValue({status:403});await mount();
 expect(mocks.copies).toHaveBeenCalled();expect(trial()).toBeNull();
 expect(root.textContent).toContain(i18n.global.t('play.loadFailed'));
 expect(root.querySelector('a[href*="/login"]')).toBeNull();
});

it('lets a guest sign in and return to the exact failed entrance without checking authorship',async()=>{
 mocks.managed=true;const path='/play/490001?provider=harbor#scene';await mount(path,false);
 expect(root.querySelector('a[href*="/login"]')?.getAttribute('href')).toBe(`/login?returnTo=${encodeURIComponent(path)}`);
 expect(trial()).toBeNull();expect(mocks.copies).not.toHaveBeenCalled();
});

it('does not offer the managed sign-in entrance on a self-hosted deployment',async()=>{
 mocks.managed=false;await mount('/play/490001',false);
 expect(root.querySelector('a[href*="/login"]')).toBeNull();
 expect(root.textContent).toContain(i18n.global.t('play.loadFailed'));
});

it('keeps the original failure when the draft itself cannot load',async()=>{
 mocks.card.mockRejectedValue({status:404});await mount('/play/490001?mode=source');
 expect(trial()).toBeNull();expect(mocks.copies).not.toHaveBeenCalled();
});

it('does not probe on successful public play',async()=>{
 mocks.platforms.mockResolvedValue([{provider:'harbor',roleId:'fixture-public',playable:true}]);await mount();
 expect(mocks.stage).toHaveBeenCalledTimes(1);expect(mocks.copies).not.toHaveBeenCalled();
});

it('keeps the original loading cover until authorship settles and ignores a late result after changing cards',async()=>{
 let finish!:(value:unknown)=>void;mocks.copies.mockImplementationOnce(()=>new Promise(r=>{finish=r}));
 const router=await mount();expect(root.textContent).not.toContain(i18n.global.t('play.loadFailed'));
 expect(root.querySelector('.play-cover')).not.toBeNull();
 mocks.platforms.mockResolvedValue([{provider:'harbor',roleId:'other-public',playable:true}]);await router.push('/play/490002');await settle();
 finish([{provider:'harbor',roleId:'fixture-source',status:'source'}]);await settle();
 expect(trial()).toBeNull();expect(root.textContent).toContain('Player');
});

it('uses the card-app route when offering a draft from the play host',async()=>{
 mocks.playApp=true;await mount('/490001/?lang=zh-Hant');
 expect(trial()?.getAttribute('href')).toBe('/490001/?mode=source&lang=zh-Hant&provider=harbor');
});
