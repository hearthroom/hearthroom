import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp, nextTick, type App } from 'vue';
import { createPinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { i18n } from '../src/lib/i18n';
const fixtures = vi.hoisted(() => ({
  complete:vi.fn(), preview:vi.fn(), finish:vi.fn(), connect:vi.fn(),
  session:{me:{nickName:'New name',avatar:'',accountNumId:22},profile:{handle:'newxxxxx',identities:[{provider:'harbor',externalId:22,founding:true}]},adopt:vi.fn(),logout:vi.fn(),accessToken:vi.fn()},
}));
vi.mock('../src/lib/oauth',()=>({completeLogin:fixtures.complete}));
vi.mock('../src/lib/connections',()=>({previewConnection:fixtures.preview,finishConnection:fixtures.finish,connectAccount:fixtures.connect,disconnectAccount:vi.fn()}));
vi.mock('../src/lib/session',()=>({useSession:()=>fixtures.session}));
vi.mock('../src/lib/provider-switch',()=>({availableProviders:async()=>[{id:'lunatalk',name:'LunaTalk'},{id:'harbor',name:'HarperHarbor'}]}));
vi.mock('../src/lib/track',()=>({track:vi.fn()}));
import CallbackPage from '../src/pages/CallbackPage.vue';
import ConnectedAccounts from '../src/components/ConnectedAccounts.vue';
let app:App|undefined; let el:HTMLDivElement;
const settle=async()=>{await nextTick();await new Promise(r=>setTimeout(r,0));await nextTick()};
async function mount(component:any){
 const router=createRouter({history:createMemoryHistory(),routes:[{path:'/:pathMatch(.*)*',component}]});await router.push('/auth/callback');await router.isReady();
 el=document.createElement('div');document.body.append(el);app=createApp(component).use(createPinia()).use(router).use(i18n);app.mount(el);await settle();
}
beforeEach(()=>{
 vi.clearAllMocks(); localStorage.clear(); sessionStorage.clear();
 fixtures.complete.mockResolvedValue({provider:'lunatalk',linkFrom:'harbor',token:{accessToken:'fixture',expiresAt:Date.now()+60000},returnTo:'/me'});
 fixtures.preview.mockResolvedValue({source:{name:'New account',handle:'newxxxxx',memberSince:10,provider:'harbor'},target:{name:'Original account',handle:'oldxxxxx',memberSince:1,provider:'lunatalk'}});
 fixtures.finish.mockRejectedValue(new Error('connection_preview_changed'));
});
afterEach(()=>{app?.unmount();el?.remove();vi.restoreAllMocks()});
it('connects a platform to the current community without choosing a community to replace',async()=>{
 await mount(CallbackPage);
 expect(el.querySelectorAll('input[type=radio]')).toHaveLength(0);
 expect(el.textContent).toContain('newxxxxx');
 expect(fixtures.finish).not.toHaveBeenCalled();
 el.querySelector<HTMLButtonElement>('.link-actions button')!.click();await settle();
 expect(fixtures.finish).toHaveBeenCalledWith('lunatalk','harbor',expect.any(Object),{keepHandle:'newxxxxx',sourceHandle:'newxxxxx',targetHandle:'oldxxxxx'});
 expect(el.querySelector('[role=alert]')).not.toBeNull();
});
it('cancel returns to the original page without establishing a connection',async()=>{
 const replace=vi.spyOn(window.location,'replace').mockImplementation(()=>{});
 await mount(CallbackPage);el.querySelector<HTMLButtonElement>('.link-actions button:last-child')!.click();
 expect(fixtures.finish).not.toHaveBeenCalled();expect(replace).toHaveBeenCalledWith('/me');
});
it('shows the missing second platform and starts its linking flow',async()=>{
 await mount(ConnectedAccounts);
 const rows=el.querySelectorAll('.account');expect(rows).toHaveLength(2);
 const luna=[...rows].find(r=>r.textContent?.includes('LunaTalk'))!;
 expect(luna.textContent).toContain(i18n.global.t('linked.notConnected'));
 luna.querySelector<HTMLButtonElement>('button')!.click();await settle();
 expect(fixtures.connect).toHaveBeenCalledWith('lunatalk','/me');
});

it('never asks the user to activate one of their connected platforms',async()=>{
 fixtures.session.profile.identities=[{provider:'harbor',externalId:22,founding:true},{provider:'lunatalk',externalId:11,founding:false}];
 await mount(ConnectedAccounts);
 expect(el.textContent).not.toContain(i18n.global.t('linked.use'));
 expect(el.textContent).not.toContain(i18n.global.t('linked.current'));
 expect(el.querySelector('a[href*="provider="]')).toBeNull();
});
