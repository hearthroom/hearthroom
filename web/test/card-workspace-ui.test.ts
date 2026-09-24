import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp, nextTick, type App } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { i18n } from '../src/lib/i18n';
import { useSession } from '../src/lib/session';
import MyCardsPage from '../src/pages/MyCardsPage.vue';
const mocks=vi.hoisted(()=>({connect:vi.fn(),fetch:vi.fn(),register:vi.fn(),token:vi.fn(),copies:vi.fn(),synchronize:vi.fn(),confirm:vi.fn()}));
vi.mock('../src/lib/api',async original=>({...await original<typeof import('../src/lib/api')>(),fetchMeAt:async()=>({email:"fixture@example.test"}),fetchMyCards:mocks.fetch,registerCard:mocks.register}));
vi.mock('../src/lib/connections',async original=>({...await original<typeof import('../src/lib/connections')>(),accountToken:mocks.token,connectAccount:mocks.connect}));
vi.mock('../src/lib/confirm',()=>({confirmChoice:mocks.confirm}));
vi.mock('../src/lib/distribution',async original=>({...await original<typeof import('../src/lib/distribution')>(),copies:mocks.copies,synchronize:mocks.synchronize}));
vi.mock('../src/lib/provider-switch',()=>({availableProviders:async()=>[{id:'lunatalk',name:'LunaTalk'},{id:'harbor',name:'HarperHarbor'}]}));
let app:App;let root:HTMLElement;
const settle=async()=>{for(let i=0;i<30;i++)await Promise.resolve();await nextTick();};
const fixture={name:'Sample lighthouse',summary:'A quiet port at dawn.',avatarUrl:'/fixture.png',zone:'en',talkNum:0,visibility:'private',registered:false,game:false,workId:'work',num:100021,detailId:'100021',sourceProvider:'harbor',sourceRoleId:'original'};
const result=(items:any[])=>({items,total:1,registeredTotal:0,hasNext:false,page:1,pageSize:24,quota:{used:0,limit:3,weekStart:0,weekEnd:9999999999999}});
beforeEach(()=>{vi.clearAllMocks();mocks.token.mockImplementation(async p=>`token-${p}`);mocks.confirm.mockResolvedValue('sfw');mocks.register.mockResolvedValue({status:'pending'});mocks.copies.mockResolvedValue([{provider:'harbor',roleId:'original',status:'source'},{provider:'lunatalk',roleId:'copy',status:'synced'}]);mocks.fetch.mockImplementation(async(_t,{provider})=>result([{...fixture,roleId:provider==='harbor'?'original':'copy'}]));});
afterEach(()=>{app?.unmount();root?.remove();});
async function mount(){const router=createRouter({history:createMemoryHistory(),routes:[{path:'/:pathMatch(.*)*',component:{template:'<div />'}}]});await router.push('/mine');const pinia=createPinia();setActivePinia(pinia);const session=useSession();session.me={accountNumId:11,nickName:'Fixture',avatar:''};session.profile={identities:[{provider:'lunatalk',externalId:11},{provider:'harbor',externalId:22}]} as any;root=document.createElement('div');document.body.append(root);app=createApp(MyCardsPage).use(pinia).use(i18n).use(router);app.mount(root);await settle();}
function button(key:string){return [...root.querySelectorAll('button')].find(b=>b.textContent?.trim()===i18n.global.t(key))!;}
it('shows one work with direct actions and sends community review only to its original account',async()=>{await mount();expect(root.querySelectorAll('article.card')).toHaveLength(1);expect(root.textContent).toContain(fixture.summary);expect(root.querySelector('a[href*="single=1"]')).toBeNull();expect(root.querySelector('a[href*="100021/edit"]')?.getAttribute('href')).toContain('provider=harbor');button('mine.action.submit').click();await settle();expect(mocks.register).toHaveBeenCalledWith('original','token-harbor',false,[],'harbor');expect(root.textContent).toContain(i18n.global.t('mine.badge.pending'));});
it('links directly to the only playable provider without a chooser or empty footer', async () => {
 await mount();
 const play=[...root.querySelectorAll('.card__actions a')].find(a=>a.textContent?.trim()===i18n.global.t('mine.action.play'));
 expect(play?.getAttribute('href')).toBe('/play/100021?mode=source&provider=harbor');
 expect(root.querySelector('.play-choices')).toBeNull();
 expect(root.querySelector('.card__body')).toBeNull();
 expect(mocks.register).not.toHaveBeenCalled();
});
it('does not render a blank footer below ordinary draft or submitted cards', async () => {
 mocks.fetch.mockResolvedValue(result([
  {...fixture,roleId:'original'},
  {...fixture,roleId:'submitted',workId:'submitted-work',sourceRoleId:'submitted',num:100022,registered:true,status:'pending'},
 ]));
 await mount();
 expect(root.querySelectorAll('article.card')).toHaveLength(2);
 expect(root.querySelectorAll('.card__body')).toHaveLength(0);
});
it.each(['pending','rejected','superseded'])('keeps the review feedback footer for %s updates', async updateStatus => {
 mocks.fetch.mockResolvedValue(result([{...fixture,roleId:'original',registered:true,status:'approved',updateStatus,note:'Please revise the opening.'}]));
 await mount();
 expect(root.querySelector('.card__body .card__note')?.textContent?.trim()).toBeTruthy();
 if(updateStatus==='rejected')expect(root.querySelector('.card__body')?.textContent).toContain('Please revise the opening.');
});
it('keeps the rejection reason and resubmission action', async () => {
 mocks.fetch.mockResolvedValue(result([{...fixture,roleId:'original',registered:true,status:'rejected',note:'Please revise the opening.'}]));
 await mount();
 expect(root.querySelector('.card__body')?.textContent).toContain('Please revise the opening.');
 expect(button('mine.action.submit')).toBeDefined();
});
it('retains available works when another service is unavailable',async()=>{mocks.fetch.mockImplementation(async(_t,{provider})=>{if(provider==='lunatalk')throw Error('offline');return result([{...fixture,roleId:'original'}]);});await mount();expect(root.querySelectorAll('article.card')).toHaveLength(1);expect(mocks.fetch.mock.calls.every(c=>c[1].provider==='harbor')).toBe(true);});

it('has no cross-service synchronization action',async()=>{await mount();expect(button('linked.sync')).toBeUndefined();expect(mocks.synchronize).not.toHaveBeenCalled();});


it('uses the portrait background before the avatar and keeps the card destination', async () => {
 mocks.fetch.mockImplementation(async (_t, {provider}) => result([{...fixture, roleId:provider==='harbor'?'original':'copy', backgroundUrl:'/portrait.png'}]));
 await mount();
 expect(root.querySelector('.card__art img')?.getAttribute('src')).toBe('/portrait.png');
 expect(root.querySelector('.card__art')?.getAttribute('href')).toBe('/cards/100021');
});
it('falls back to the avatar for old cards and failed backgrounds, then to a placeholder', async () => {
 mocks.fetch.mockImplementation(async (_t, {provider}) => result([{...fixture, roleId:provider==='harbor'?'original':'copy', backgroundUrl:'/portrait.png'}]));
 await mount();
 root.querySelector('.card__art img')!.dispatchEvent(new Event('error')); await settle();
 expect(root.querySelector('.card__art img')?.getAttribute('src')).toBe('/fixture.png');
 root.querySelector('.card__art img')!.dispatchEvent(new Event('error')); await settle();
 expect(root.querySelector('.card__art img')).toBeNull();
 expect(root.querySelector('.card__void')).not.toBeNull();
});
it('still shows an avatar when a legacy card has no background', async () => {
 await mount();
 expect(root.querySelector('.card__art img')?.getAttribute('src')).toBe('/fixture.png');
});

it('links a private work and its editor by its numeric identity', async () => {
 mocks.fetch.mockImplementation(async(_t,{provider})=>result([{...fixture,roleId:provider==='harbor'?'original':'copy',detailId:'100021',num:100021}]));
 await mount();
 expect(root.querySelector('.card__art')?.getAttribute('href')).toBe('/cards/100021');
 expect(root.querySelector('a[href*="/edit"]')?.getAttribute('href')).toBe('/cards/100021/edit?provider=harbor');
});

// 授權掉了就在原地重新授權，不要叫人去別的頁面找——找不到就卡住了。
it('offers one-tap reauthorization in place when the platform grant expired', async () => {
 mocks.token.mockResolvedValue(null);
 await mount();
 const alert=root.querySelector('[role=alert]')!;
 expect(alert.textContent).not.toContain(i18n.global.t('linked.retry'));
 expect(alert.querySelector('a')).toBeNull();
 const reauth=[...alert.querySelectorAll('button')].find(b=>b.textContent?.trim()===i18n.global.t('me.reauthorize'))!;
 reauth.click();await settle();
 expect(mocks.connect).toHaveBeenCalledWith('harbor','/mine');
});
it('keeps retry for failures that are not about authorization', async () => {
 mocks.fetch.mockRejectedValue(new Error('network_down'));
 await mount();
 const alert=root.querySelector('[role=alert]')!;
 expect([...alert.querySelectorAll('button')].map(b=>b.textContent?.trim())).toEqual([i18n.global.t('linked.retry')]);
});
