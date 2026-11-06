import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {createApp,nextTick,ref,type App} from 'vue';
import {createRouter,createMemoryHistory} from 'vue-router';
import {i18n} from '../src/lib/i18n';
import SpendPlayer from '../src/components/SpendPlayer.vue';
import SpendAvatar from '../src/components/SpendAvatar.vue';
import {clearAppearanceCache} from '../src/lib/community-appearance';
import type {SpendPlayer as Player} from '../src/lib/spend-leaderboard';
const api=vi.hoisted(()=>({request:vi.fn()}));
vi.mock('../src/lib/community',()=>({communityRequest:api.request}));
let app:App|undefined;let host:HTMLDivElement;
const player=():Player=>({rank:1,credits:'123',anonymous:false,isSelf:false,handle:'abcdefgh',nickname:'Synthetic Player',avatarUrl:'/site-avatar.png'});
const identity=()=>({members:{abcdefgh:{badges:[],appearance:{avatarUrl:'/public-avatar.png',decorationUrl:null,nameStyle:'aurora',frame:'hearth'}}}});
const settle=async()=>{for(let n=0;n<4;n++){await nextTick();await new Promise(r=>setTimeout(r,0))}};
async function mount(component:any,props:Record<string,unknown>){
 const router=createRouter({history:createMemoryHistory(),routes:[{path:'/',component:{template:'<div />'}}]});
 await router.push('/');await router.isReady();app=createApp(component,props).use(i18n).use(router);app.mount(host);await settle();
}
beforeEach(()=>{api.request.mockReset().mockResolvedValue(identity());clearAppearanceCache();host=document.createElement('div');document.body.append(host)});
afterEach(()=>{app?.unmount();host.remove();clearAppearanceCache()});
it('uses the comment name style and avatar frame with one batched public lookup',async()=>{
 await mount(SpendPlayer,{player:player(),podium:true});
 expect(host.querySelector('.community-name--aurora')).not.toBeNull();expect(host.querySelector('.community-avatar--hearth')).not.toBeNull();
 expect(host.querySelector('img')?.getAttribute('src')).toBe('/public-avatar.png');expect(api.request).toHaveBeenCalledTimes(1);
 const url=new URL(api.request.mock.calls[0]![0],'https://fixture.test');expect(url.pathname).toBe('/community/members');expect(url.searchParams.getAll('handle')).toEqual(['abcdefgh']);
});
it('uses the public frame in the compact avatar preview',async()=>{
 await mount(SpendAvatar,{player:player()});expect(host.querySelector('.community-avatar--hearth')).not.toBeNull();expect(api.request).toHaveBeenCalledTimes(1);
});
it('never renders or requests personal appearance for anonymous players',async()=>{
 await mount(SpendPlayer,{player:{...player(),anonymous:true}});expect(host.querySelector('[data-anonymous-avatar]')).not.toBeNull();
 expect(host.querySelector('.community-avatar,.community-name,img,a')).toBeNull();expect(host.textContent).not.toContain('Synthetic Player');expect(api.request).not.toHaveBeenCalled();
});
it('keeps the site identity usable when public appearance is unavailable',async()=>{
 api.request.mockRejectedValue(new Error('unavailable'));await mount(SpendPlayer,{player:player()});expect(host.textContent).toContain('Synthetic Player');
 expect(host.querySelector('img')?.getAttribute('src')).toBe('/site-avatar.png');expect(host.querySelector('.community-avatar--hearth,.community-name--aurora')).toBeNull();
});
it('does not reveal a late appearance after the player changes to anonymous',async()=>{
 let resolve!:(v:ReturnType<typeof identity>)=>void;api.request.mockImplementation(()=>new Promise(r=>resolve=r));
 const current=ref(player());await mount({components:{SpendPlayer},setup:()=>({current}),template:'<SpendPlayer :player="current" />'},{});
 expect(api.request).toHaveBeenCalledTimes(1);current.value={...current.value,anonymous:true};await settle();resolve(identity());await settle();
 expect(host.querySelector('.community-avatar,.community-name,img,a')).toBeNull();expect(host.querySelector('[data-anonymous-avatar]')).not.toBeNull();
 expect(host.textContent).not.toContain('Synthetic Player');expect(api.request).toHaveBeenCalledTimes(1);
});
it('links the player name in the same tab on the card page, and in a new tab to the main site inside the play info panel',async()=>{
 const {PLAY_PANEL_LINKS}=await import('../src/lib/play-social');
 await mount(SpendPlayer,{player:player()});
 const same=host.querySelector<HTMLAnchorElement>('.board-player__name a')!;
 expect(same.getAttribute('target')).toBeNull();expect(new URL(same.href).pathname).toBe('/authors/abcdefgh');
 app?.unmount();host.innerHTML='';
 const router=createRouter({history:createMemoryHistory(),routes:[{path:'/',component:{template:'<div />'}}]});await router.push('/');await router.isReady();
 app=createApp(SpendPlayer,{player:player()}).use(i18n).use(router);app.provide(PLAY_PANEL_LINKS,true);app.mount(host);await settle();
 const tab=host.querySelector<HTMLAnchorElement>('.board-player__name a')!;
 expect(tab.target).toBe('_blank');expect(tab.rel).toContain('noopener');expect(new URL(tab.href).pathname).toBe('/authors/abcdefgh');
});
