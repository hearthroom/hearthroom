import { afterEach, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({preload:vi.fn(async()=>{}),restore:vi.fn(async()=>{}),me:null as null|{accountNumId:number}}));
vi.mock('../src/lib/stage-preload',()=>({preloadStage:mocks.preload}));
vi.mock('../src/lib/session',()=>({useSession:()=>mocks}));
vi.mock('../src/lib/track',()=>({track:()=>{},currentSurface:()=>'',setSurface:()=>{}}));
vi.mock('../src/lib/i18n',()=>({LOCALE_CODES:['zh-Hant','zh-Hans','en','ja','ko'],SOURCE_LOCALE:'zh-Hant',applyLocale:async()=>{},detectLocale:()=> 'zh-Hant',pageTitle:()=> 'Fixture',updateHreflang:()=>{}}));
vi.mock('../src/pages/PlayPage.vue',()=>({default:{template:'<div />'}}));
vi.mock('../src/pages/LoginPage.vue',()=>({default:{template:'<div />'}}));
vi.mock('../src/pages/BoardPage.vue',()=>({default:{template:'<div />'}}));
import { router } from '../src/router';
afterEach(()=>{mocks.preload.mockClear();mocks.restore.mockReset();mocks.me=null;});
it('starts static preloading before session restoration finishes but still sends a signed-out visitor to login',async()=>{
 let finish!:()=>void;mocks.restore.mockImplementation(()=>new Promise<void>(r=>{finish=r}));
 const navigation=router.push('/play/fixture?provider=harbor');
 for(let i=0;i<40;i++)await Promise.resolve();
 expect(mocks.preload).toHaveBeenCalledTimes(1);
 expect(router.currentRoute.value.path).not.toBe('/play/fixture');
 finish();await navigation;
 expect(router.currentRoute.value.path).toBe('/login');
 expect(router.currentRoute.value.query.returnTo).toBe('/play/fixture?provider=harbor');
});
it('does not fetch the player for the board',async()=>{
 await router.push('/');expect(mocks.preload).not.toHaveBeenCalled();
});
