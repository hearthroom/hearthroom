import {existsSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {createApp,h,nextTick,type App} from 'vue';
import {createMemoryHistory,createRouter,RouterView,type Router} from 'vue-router';
import {i18n,applyLocale} from '../src/lib/i18n';
import {confirmState,settleConfirm} from '../src/lib/confirm';
import {pageAway} from '../src/pet/enabled';
const mock=vi.hoisted(()=>({list:vi.fn(),preview:vi.fn(),remove:vi.fn(),other:vi.fn(),visibility:vi.fn(),restoreBookmarks:vi.fn()}));
vi.mock('../src/lib/session',()=>({useSession:()=>({me:{accountNumId:1},accessToken:async()=> 'fixture'})}));
vi.mock('../src/lib/use-locale',async()=>{const{ref}=await import('vue');return{useLocalePath:()=>({locale:ref('zh-Hant'),lp:(path:string)=>path})};});
vi.mock('../src/lib/display-name',()=>({displayName:(name:string)=>name}));
vi.mock('../src/lib/library',async original=>({...await original<object>(),fetchConversations:mock.list,previewConversationDeletion:mock.preview,deleteConversations:mock.remove,libraryRequest:mock.other,setConversationHidden:mock.visibility,restoreFavoriteBookmarks:mock.restoreBookmarks}));
import LibraryPage from '../src/pages/LibraryPage.vue';
import ConfirmDialog from '../src/components/ConfirmDialog.vue';
let app:App,el:HTMLDivElement,router:Router;
const rows=[1,2].map(n=>({provider:'harbor',conversationRoleId:`role-${n}`,conversationId:`conv-${n}`,cardNumber:n,conversationTitle:`存檔 ${n}`,roleName:`合成卡 ${n}`,roleAvatar:'',canGenerate:n===1}));
const settle=async()=>{await nextTick();await new Promise(r=>setTimeout(r,0));await nextTick();};
const click=async(selector:string)=>{const b=document.querySelector<HTMLButtonElement>(selector);expect(b,selector).not.toBeNull();b!.click();await settle();};
beforeEach(async()=>{vi.clearAllMocks();await applyLocale('zh-Hant');mock.list.mockResolvedValue({conversations:[...rows],hasNextPage:false});mock.other.mockReset().mockResolvedValue({items:[],hasNext:false});mock.restoreBookmarks.mockResolvedValue({restoredIds:['1','2']});mock.visibility.mockResolvedValue({hidden:true});mock.preview.mockResolvedValue({selectionToken:'frozen-one',groups:[{roleId:'role-1',conversationId:'conv-1',count:1}],total:1});mock.remove.mockResolvedValue({results:[{roleId:'role-1',conversationId:'conv-1',status:'deleted',deletedCount:1}],deletedCount:1});router=createRouter({history:createMemoryHistory(),routes:[{path:'/library',component:LibraryPage}]});await router.push('/library');el=document.createElement('div');document.body.append(el);app=createApp({render:()=>[h(RouterView),h(ConfirmDialog)]}).use(router).use(i18n);app.mount(el);await settle();});
afterEach(()=>{settleConfirm(false);app?.unmount();el.remove();document.body.innerHTML='';vi.useRealTimers();});
it('offers separate hide/delete actions for closed cards and restores menu focus',async()=>{await click('[data-conversation-menu="conv-2"]');expect(document.querySelectorAll('[role="menuitem"]')).toHaveLength(2);expect(document.activeElement?.getAttribute('data-action')).toBe('hide');document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await settle();expect(document.querySelector('[role="menu"]')).toBeNull();expect(document.activeElement?.getAttribute('data-conversation-menu')).toBe('conv-2');expect(router.currentRoute.value.path).toBe('/library');});
it('keeps failed hides visible and supports retry then undo without deleting content',async()=>{mock.visibility.mockRejectedValueOnce(new Error('offline'));await click('[data-conversation-menu="conv-1"]');await click('[data-action="hide"]');expect(el.querySelectorAll('.conversation:not(.conversation-row-leave-active)')).toHaveLength(2);expect(mock.remove).not.toHaveBeenCalled();await click('[data-toast-action]');expect(el.querySelectorAll('.conversation:not(.conversation-row-leave-active)')).toHaveLength(1);expect(mock.visibility).toHaveBeenLastCalledWith('fixture',rows[0],true);mock.visibility.mockResolvedValue({hidden:false});await click('[data-toast-action]');expect(mock.visibility).toHaveBeenLastCalledWith('fixture',rows[0],false);expect(el.querySelectorAll('.conversation:not(.conversation-row-leave-active)')).toHaveLength(2);});
it('confirms one segment, keeps failure in the dialog and retries the frozen capability',async()=>{await click('[data-conversation-menu="conv-1"]');await click('[data-action="delete"]');expect(mock.preview).toHaveBeenCalledWith('fixture',[rows[0]],'current');expect(document.activeElement?.hasAttribute('data-cancel')).toBe(true);mock.remove.mockResolvedValueOnce({results:[{roleId:'role-1',conversationId:'conv-1',status:'busy',deletedCount:0}],deletedCount:0});await click('[data-confirm]');expect(confirmState.current).not.toBeNull();expect(document.querySelector('[role="alert"]')).not.toBeNull();mock.list.mockResolvedValue({conversations:[rows[1]],hasNextPage:false});await click('[data-confirm]');expect(mock.preview).toHaveBeenCalledTimes(1);expect(mock.remove).toHaveBeenLastCalledWith('fixture','frozen-one');expect(confirmState.current).toBeNull();expect(el.querySelectorAll('.conversation:not(.conversation-row-leave-active)')).toHaveLength(1);expect(el.querySelector('[data-toast-action]')).toBeNull();});
it('locks cancel and Escape while a delete request is pending',async()=>{let finish!:(value:unknown)=>void;mock.remove.mockImplementationOnce(()=>new Promise(r=>{finish=r;}));await click('[data-conversation-menu="conv-1"]');await click('[data-action="delete"]');await click('[data-confirm]');expect(document.querySelector<HTMLButtonElement>('[data-cancel]')!.disabled).toBe(true);document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await settle();expect(confirmState.current).not.toBeNull();finish({results:[{roleId:'role-1',conversationId:'conv-1',status:'error',deletedCount:0}],deletedCount:0});await settle();expect(confirmState.current).not.toBeNull();});
it('cancels only selected favorites, retains failed selection and retries only failures',async()=>{
 const favorites=[{unavailable:true,bookmarkId:'1'},{unavailable:true,bookmarkId:'2'}];
 mock.other.mockImplementation(async(path:string,_token:string,method='GET')=>{if(method==='GET')return{items:favorites,hasNext:false};if(path==='favorites/1')return{active:false,restoreToken:'undo-one'};throw new Error('offline');});
 await router.push('/library?tab=favorites');await settle();await click('[data-favorite-select]');await click('[data-favorite-all]');
 expect(el.querySelectorAll('[aria-checked="true"]')).toHaveLength(2);
 await click('[data-favorite-cancel]');expect(el.querySelectorAll('[role="checkbox"]')).toHaveLength(1);expect(el.querySelector('[role="checkbox"]')?.getAttribute('aria-checked')).toBe('true');expect(el.querySelector('[role="alert"]')).not.toBeNull();
 mock.other.mockClear();mock.other.mockResolvedValue({active:false,restoreToken:'undo-two'});await click('[data-favorite-cancel]');
 expect(mock.other).toHaveBeenCalledOnce();expect(mock.other).toHaveBeenCalledWith('favorites/2','fixture','DELETE');expect(el.querySelectorAll('[role="checkbox"]')).toHaveLength(0);
});
it('restores cancelled unavailable favorites using only issued capabilities and clears selection on paging',async()=>{
 const favorites=[{unavailable:true,bookmarkId:'1'},{unavailable:true,bookmarkId:'2'}];
 mock.other.mockImplementation(async(path:string,_token:string,method='GET')=>method==='GET'?{items:favorites,hasNext:true}:{active:false,restoreToken:`undo-${path.split('/')[1]}`});
 await router.push('/library?tab=favorites');await settle();await click('[data-favorite-select]');await click('[data-favorite-all]');await click('[data-favorite-cancel]');
 await click('[data-toast-action]');expect(mock.restoreBookmarks).toHaveBeenCalledWith('fixture',['undo-1','undo-2']);
 await click('[data-favorite-select]');await click('[data-favorite-all]');await router.push('/library?tab=favorites&page=2');await settle();
 expect(el.querySelector('[data-favorite-cancel]')).toBeNull();await click('[data-favorite-select]');expect(el.querySelectorAll('[aria-checked="true"]')).toHaveLength(0);
});
it('keeps the undo action when hiding the last row automatically returns to a previous page',async()=>{
 mock.list.mockImplementation(async(_token,_lang,n)=>({conversations:n===2?[rows[0]]:[rows[1]],hasNextPage:false}));
 await router.push('/library?page=2');await settle();await click('[data-conversation-menu="conv-1"]');await click('[data-action="hide"]');await settle();
 expect(router.currentRoute.value.query.page).toBeUndefined();expect(el.querySelector('[data-toast-action]')).not.toBeNull();
});
it('checks the list after an uncertain delete without submitting another destructive request',async()=>{
 mock.remove.mockRejectedValueOnce(new TypeError('offline'));
 await click('[data-conversation-menu="conv-1"]');await click('[data-action="delete"]');await click('[data-confirm]');
 expect(document.querySelector('[data-confirm]')?.textContent).toContain(i18n.global.t('library.recent.checkResult'));
 expect(document.querySelector('[role="alert"]')?.textContent).toContain(i18n.global.t('library.recent.resultPending'));
 mock.list.mockClear();await click('[data-confirm]');expect(mock.remove).toHaveBeenCalledOnce();expect(mock.list).toHaveBeenCalled();expect(confirmState.current).toBeNull();
});
it('does not promise content is retained when the Worker returns an uncertain segment result',async()=>{
 mock.remove.mockResolvedValueOnce({results:[{roleId:'role-1',conversationId:'conv-1',status:'error',deletedCount:0}],deletedCount:0});
 await click('[data-conversation-menu="conv-1"]');await click('[data-action="delete"]');await click('[data-confirm]');
 expect(document.querySelector('[role="alert"]')?.textContent).toContain(i18n.global.t('library.recent.resultPending'));
 expect(document.querySelector('[role="alert"]')?.textContent).not.toContain(i18n.global.t('library.recent.deleteFailed'));
});
it('labels a pending result check as a check while its read is in flight',async()=>{
 mock.remove.mockRejectedValueOnce(new TypeError('offline'));await click('[data-conversation-menu="conv-1"]');await click('[data-action="delete"]');await click('[data-confirm]');
 let finish!:(value:unknown)=>void;mock.list.mockImplementationOnce(()=>new Promise(r=>{finish=r;}));await click('[data-confirm]');
 expect(document.querySelector('[data-confirm]')?.textContent).toContain(i18n.global.t('library.recent.checkResult'));
 expect(document.querySelector('[data-confirm]')?.textContent).not.toContain(i18n.global.t('library.manage.deleting'));
 finish({conversations:rows,hasNextPage:false});await settle();
});
it('gives the second consecutive hidden row its own complete Undo window even with identical text',async()=>{
 vi.useFakeTimers();
 const clickFake=async(selector:string)=>{const b=document.querySelector<HTMLButtonElement>(selector);expect(b,selector).not.toBeNull();b!.click();await nextTick();await vi.advanceTimersByTimeAsync(0);await nextTick();};
 await clickFake('[data-conversation-menu="conv-1"]');await clickFake('[data-action="hide"]');await vi.advanceTimersByTimeAsync(5000);
 await clickFake('[data-conversation-menu="conv-2"]');await clickFake('[data-action="hide"]');await vi.advanceTimersByTimeAsync(5999);
 expect(el.querySelector('[data-toast-action]')).not.toBeNull();await vi.advanceTimersByTimeAsync(1);expect(el.querySelector('[data-toast-action]')).toBeNull();
});
it('keeps the pet away from recent-chat controls and restores it outside management',async()=>{
 expect(pageAway.value).toBeGreaterThan(0);
 mock.other.mockResolvedValue({items:[{unavailable:true,bookmarkId:'1'}],hasNext:false});await router.push('/library?tab=favorites');await settle();expect(pageAway.value).toBe(0);
 await click('[data-favorite-select]');expect(pageAway.value).toBeGreaterThan(0);
 await click('[data-favorite-select]');expect(pageAway.value).toBe(0);
 await router.push('/library');await settle();expect(pageAway.value).toBeGreaterThan(0);
 app.unmount();expect(pageAway.value).toBe(0);
});
it('clears an obsolete preview failure after retry opens a valid confirmation',async()=>{
 mock.preview.mockRejectedValueOnce(new Error('unavailable'));
 await click('[data-conversation-menu="conv-1"]');await click('[data-action="delete"]');expect(el.querySelector('.library__failure')).not.toBeNull();
 await click('.library__failure button');expect(confirmState.current).not.toBeNull();expect(el.querySelector('.library__failure')).toBeNull();
});

it('clears pending deletion feedback when a successful list check no longer contains the segment',async()=>{
 mock.remove.mockRejectedValueOnce(new TypeError('offline'));
 await click('[data-conversation-menu="conv-1"]');await click('[data-action="delete"]');await click('[data-confirm]');
 mock.list.mockResolvedValue({conversations:[],hasNextPage:false});await click('[data-confirm]');
 expect(confirmState.current).toBeNull();expect(el.querySelector('.library__empty')).not.toBeNull();
 expect(el.querySelector('.library__failure')).toBeNull();expect(mock.remove).toHaveBeenCalledOnce();
});
it('rechecks a pending segment from the banner without keeping stale feedback or deleting twice',async()=>{
 mock.remove.mockRejectedValueOnce(new TypeError('offline'));
 await click('[data-conversation-menu="conv-1"]');await click('[data-action="delete"]');await click('[data-confirm]');await click('[data-confirm]');
 expect(el.querySelector('.library__failure')?.textContent).toContain(i18n.global.t('library.recent.resultPending'));
 mock.list.mockRejectedValueOnce(new Error('offline'));await click('.library__failure button');
 expect(el.querySelector('.library__failure')).not.toBeNull();
 let finish!:(value:unknown)=>void;mock.list.mockImplementationOnce(()=>new Promise(r=>{finish=r;}));await click('.library__failure button');
 expect(el.querySelector<HTMLButtonElement>('.library__failure button')!.disabled).toBe(true);
 finish({conversations:[],hasNextPage:false});await settle();
 expect(el.querySelector('.library__failure')).toBeNull();expect(mock.remove).toHaveBeenCalledOnce();
});

it('keeps the selected count on one line with reachable actions across five mobile locales in Chrome',async()=>{
 const chrome=process.env.CHROME_BIN||['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/usr/bin/google-chrome','/usr/bin/chromium'].find(existsSync);
 expect(chrome,'Chrome is required for actual selection-bar layout').toBeTruthy();
 mock.other.mockResolvedValue({items:Array.from({length:24},(_,n)=>({unavailable:true,bookmarkId:String(n)})),hasNext:false});
 await router.push('/library?tab=favorites');await settle();await click('[data-favorite-select]');
 await click('[role="checkbox"]');await click('[role="checkbox"]:nth-child(2)');
 const styles=['src/styles/tokens.css','src/styles/base.css','src/pages/LibraryPage.vue'].map(file=>{const text=readFileSync(file,'utf8');return file.endsWith('.css')?text:[...text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m=>m[1]).join('\n');}).join('\n');
 const frames:string[]=[];
 for(const n of [2,24]){
  if(n===24)await click('[data-favorite-all]');
  for(const loc of ['zh-Hant','zh-Hans','en','ja','ko']){
   await applyLocale(loc);await nextTick();
   const html=el.querySelector('.library__bottom')!.outerHTML;
   for(const width of [320,390]){
    const doc=`<!doctype html><html lang="${loc}"><meta charset="utf-8"><style>${styles}</style><body>${html}</body></html>`;
    frames.push(`<iframe width="${width}" height="300" srcdoc="${doc.replace(/&/g,'&amp;').replace(/"/g,'&quot;')}" onload="const d=this.contentDocument,b=d.querySelector('.library__bottom'),s=b.querySelector('[role=status]'),r=s.getBoundingClientRect();window.results.push({label:'${loc}-${width}-${n}',oneLine:r.height<=parseFloat(this.contentWindow.getComputedStyle(s).lineHeight)+1,overflow:d.documentElement.scrollWidth>${width},actions:[...b.querySelectorAll('button')].every(e=>{const q=e.getBoundingClientRect();return q.height>=44&&q.left>=0&&q.right<=${width}&&e.scrollWidth<=e.clientWidth+1})});document.querySelector('#result').textContent=JSON.stringify(window.results)"></iframe>`);
   }
  }
 }
 const dir=mkdtempSync(join(tmpdir(),'library-mobile-layout-'));
 try{
  const file=join(dir,'fixture.html');writeFileSync(file,`<!doctype html><script>window.results=[]</script>${frames.join('')}<pre id="result"></pre>`);
  const run=spawnSync(chrome!,['--headless=new','--no-sandbox','--no-first-run','--no-default-browser-check',`--user-data-dir=${join(dir,'profile')}`,'--dump-dom','--virtual-time-budget=2000',`file://${file}`],{encoding:'utf8',timeout:30000,maxBuffer:8*1024*1024});
  expect(run.error,run.stderr).toBeUndefined();expect(run.status,run.stderr).toBe(0);
  const json=run.stdout.match(/<pre id="result">([^<]+)<\/pre>/)?.[1];expect(json,'Expected actual Chrome geometry').toBeTruthy();
  const results=JSON.parse(json!);expect(results).toHaveLength(20);
  for(const r of results){expect(r.oneLine,r.label+': selected count').toBe(true);expect(r.overflow,r.label+': overflow').toBe(false);expect(r.actions,r.label+': reachable actions').toBe(true);}
 }finally{rmSync(dir,{recursive:true,force:true});await applyLocale('zh-Hant');}
},40000);
