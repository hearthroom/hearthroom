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
it('starts static preloading as soon as the player route is entered, and lets a signed-out visitor in (owner 2026-10-10)',async()=>{
 const navigation=router.push('/play/fixture?provider=harbor');
 for(let i=0;i<40;i++)await Promise.resolve();
 expect(mocks.preload).toHaveBeenCalledTimes(1);
 await navigation;
 expect(router.currentRoute.value.path).toBe('/play/fixture');
});
it('does not fetch the player for the board',async()=>{
 await router.push('/');expect(mocks.preload).not.toHaveBeenCalled();
});
