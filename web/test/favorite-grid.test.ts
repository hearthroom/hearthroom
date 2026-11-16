import {createApp,h,nextTick,ref,type App} from 'vue';
import {createMemoryHistory,createRouter} from 'vue-router';
import {afterEach,beforeEach,it,expect,vi} from 'vitest';
import {i18n} from '../src/lib/i18n';
const f=vi.hoisted(()=>({request:vi.fn(),session:{accessToken:async()=> 'fixture'}}));
vi.mock('../src/lib/library',()=>({libraryRequest:f.request,isUnavailableFavorite:(value:any)=>value.unavailable===true}));
vi.mock('../src/lib/session',()=>({useSession:()=>f.session}));
vi.mock('../src/lib/display-name',()=>({displayName:(name:string)=>name}));
vi.mock('../src/lib/use-locale',()=>({useLocalePath:()=>({locale:ref('zh-Hant'),lp:(path:string)=>path})}));
vi.mock('../src/lib/community-appearance',()=>({usePublicAppearance:()=>ref(null)}));
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

it('selects both visible and unavailable favorites without following card, tag or author links',async()=>{
 const selected=ref<string[]>([]);
 const router=createRouter({history:createMemoryHistory(),routes:[{path:'/:pathMatch(.*)*',component:{template:'<div />'}}]});
 await router.push('/library');
 const card={id:'100002',num:100002,name:'合成收藏',summary:'合成內容',tags:['合成標籤'],author:{name:'合成作者',handle:'fixture-author'},rating:'G',avatarUrl:'',provider:'harbor'};
 app=createApp({render:()=>h(FavoriteGrid,{items:[card as any,{unavailable:true,bookmarkId:'100001'}],managing:true,selected:selected.value,'onUpdate:selected':(ids:string[])=>selected.value=ids})}).use(router).use(i18n);
 app.mount(el);await settle();
 const boxes=[...el.querySelectorAll<HTMLElement>('[role=checkbox]')];
 expect(boxes).toHaveLength(2);expect(boxes[0].getAttribute('aria-label')).toBe('合成收藏');
 expect(boxes[0].querySelector('[inert]')).not.toBeNull();
 const link=boxes[0].querySelector('a')!;
 const event=new MouseEvent('click',{bubbles:true,cancelable:true});link.dispatchEvent(event);await settle();
 expect(event.defaultPrevented).toBe(true);expect(router.currentRoute.value.path).toBe('/library');
 expect(selected.value).toEqual(['100002']);expect(boxes[0].getAttribute('aria-checked')).toBe('true');
 const otherLinks=[...boxes[0].querySelectorAll('a')].slice(1);expect(otherLinks).toHaveLength(2);
 for(const other of otherLinks){const click=new MouseEvent('click',{bubbles:true,cancelable:true});other.dispatchEvent(click);await settle();expect(click.defaultPrevented).toBe(true);expect(router.currentRoute.value.path).toBe('/library');}
 expect(selected.value).toEqual(['100002']);
 boxes[1].dispatchEvent(new KeyboardEvent('keydown',{key:' ',bubbles:true,cancelable:true}));await settle();
 expect(selected.value).toEqual(['100002','100001']);
 boxes[0].dispatchEvent(new KeyboardEvent('keydown',{key:' ',bubbles:true,cancelable:true}));await settle();
 expect(selected.value).toEqual(['100001']);expect(f.request).not.toHaveBeenCalled();
});

it('blocks selection and single-card removal while the batch is locked',async()=>{
 const changed=vi.fn();
 app=createApp(FavoriteGrid,{items:[{unavailable:true,bookmarkId:'100001'}],managing:true,selected:[],locked:true,'onUpdate:selected':changed}).use(i18n);
 app.mount(el);await settle();
 const box=el.querySelector<HTMLElement>('[role=checkbox]')!;
 expect(box.getAttribute('aria-disabled')).toBe('true');
 box.click();box.dispatchEvent(new KeyboardEvent('keydown',{key:' ',bubbles:true}));await settle();
 expect(changed).not.toHaveBeenCalled();expect(f.request).not.toHaveBeenCalled();
 expect(box.querySelector('button')).toBeNull();
});
