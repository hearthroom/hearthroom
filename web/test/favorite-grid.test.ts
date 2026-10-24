import {createApp,nextTick,type App} from 'vue';
import {afterEach,beforeEach,it,expect,vi} from 'vitest';
import {i18n} from '../src/lib/i18n';
const f=vi.hoisted(()=>({request:vi.fn(),session:{accessToken:async()=> 'fixture'}}));
vi.mock('../src/lib/library',()=>({libraryRequest:f.request,isUnavailableFavorite:(value:any)=>value.unavailable===true}));
vi.mock('../src/lib/session',()=>({useSession:()=>f.session}));
import FavoriteGrid from '../src/components/FavoriteGrid.vue';
let app:App,el:HTMLDivElement;
const settle=async()=>{await nextTick();await new Promise(r=>setTimeout(r,0));};
beforeEach(()=>{vi.clearAllMocks();el=document.createElement('div');document.body.append(el);});
afterEach(()=>{app?.unmount();el.remove();});
it('shows a generic non-link placeholder and removes only after confirmed success',async()=>{
 f.request.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({active:false});const removed=vi.fn();
 app=createApp(FavoriteGrid,{items:[{unavailable:true,bookmarkId:'100001'}],onRemoved:removed}).use(i18n);app.mount(el);await settle();
 expect(el.querySelector('a')).toBeNull();expect(el.querySelector('img')).toBeNull();expect(el.textContent).toContain(i18n.global.t('library.historyClosed'));
 const button=el.querySelector('button')!;button.click();await settle();expect(removed).not.toHaveBeenCalled();expect(el.querySelector('[role=alert]')).not.toBeNull();
 button.click();await settle();expect(f.request.mock.calls[1]).toEqual(['favorites/100001','fixture','DELETE']);expect(removed).toHaveBeenCalledWith('100001');
});
it('prevents duplicate removals while the original result is unknown',async()=>{
 let finish!:(value:unknown)=>void;f.request.mockImplementation(()=>new Promise(r=>{finish=r;}));
 app=createApp(FavoriteGrid,{items:[{unavailable:true,bookmarkId:'100001'}]}).use(i18n);app.mount(el);await settle();
 const button=el.querySelector('button')!;button.click();await settle();expect(button.disabled).toBe(true);button.click();expect(f.request).toHaveBeenCalledTimes(1);
 finish({active:false});await settle();expect(button.disabled).toBe(false);
});
