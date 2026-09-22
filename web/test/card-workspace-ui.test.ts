import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp, nextTick, type App } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { i18n } from '../src/lib/i18n';
import { useSession } from '../src/lib/session';
import MyCardsPage from '../src/pages/MyCardsPage.vue';
const mocks=vi.hoisted(()=>({fetch:vi.fn(),register:vi.fn(),token:vi.fn(),copies:vi.fn(),synchronize:vi.fn(),confirm:vi.fn()}));
vi.mock('../src/lib/api',async original=>({...await original<typeof import('../src/lib/api')>(),fetchMeAt:async()=>({email:"fixture@example.test"}),fetchMyCards:mocks.fetch,registerCard:mocks.register}));
vi.mock('../src/lib/connections',()=>({accountToken:mocks.token}));
vi.mock('../src/lib/confirm',()=>({confirmChoice:mocks.confirm}));
vi.mock('../src/lib/distribution',async original=>({...await original<typeof import('../src/lib/distribution')>(),copies:mocks.copies,synchronize:mocks.synchronize}));
vi.mock('../src/lib/provider-switch',()=>({availableProviders:async()=>[{id:'lunatalk',name:'LunaTalk'},{id:'harbor',name:'HarperHarbor'}]}));
let app:App;let root:HTMLElement;
const settle=async()=>{for(let i=0;i<30;i++)await Promise.resolve();await nextTick();};
const fixture={name:'Sample lighthouse',summary:'A quiet port at dawn.',avatarUrl:'/fixture.png',zone:'en',talkNum:0,visibility:'private',registered:false,game:false,workId:'work',sourceProvider:'harbor',sourceRoleId:'original'};
const result=(items:any[])=>({items,total:1,registeredTotal:0,hasNext:false,page:1,pageSize:24,quota:{used:0,limit:3,weekStart:0,weekEnd:9999999999999}});
beforeEach(()=>{vi.clearAllMocks();mocks.token.mockImplementation(async p=>`token-${p}`);mocks.confirm.mockResolvedValue('sfw');mocks.register.mockResolvedValue({status:'pending'});mocks.copies.mockResolvedValue([{provider:'harbor',roleId:'original',status:'source'},{provider:'lunatalk',roleId:'copy',status:'synced'}]);mocks.fetch.mockImplementation(async(_t,{provider})=>result([{...fixture,roleId:provider==='harbor'?'original':'copy'}]));});
afterEach(()=>{app?.unmount();root?.remove();});
async function mount(){const router=createRouter({history:createMemoryHistory(),routes:[{path:'/:pathMatch(.*)*',component:{template:'<div />'}}]});await router.push('/mine');const pinia=createPinia();setActivePinia(pinia);const session=useSession();session.me={accountNumId:11,nickName:'Fixture',avatar:''};session.profile={identities:[{provider:'lunatalk',externalId:11},{provider:'harbor',externalId:22}]} as any;root=document.createElement('div');document.body.append(root);app=createApp(MyCardsPage).use(pinia).use(i18n).use(router);app.mount(root);await settle();}
function button(key:string){return [...root.querySelectorAll('button')].find(b=>b.textContent?.trim()===i18n.global.t(key))!;}
it('shows one work with direct actions and sends community review only to its original account',async()=>{await mount();expect(root.querySelectorAll('article.card')).toHaveLength(1);expect(root.textContent).toContain(fixture.summary);expect(root.querySelector('a[href*="single=1"]')).toBeNull();expect(root.querySelector('a[href*="original/edit"]')?.getAttribute('href')).toContain('provider=harbor');button('mine.action.submit').click();await settle();expect(mocks.register).toHaveBeenCalledWith('original','token-harbor',false,[{provider:'lunatalk',token:'token-lunatalk'}],'harbor');expect(root.textContent).toContain(i18n.global.t('mine.badge.pending'));});
it('offers the actual copies for playtesting without navigation or publication on open',async()=>{await mount();button('mine.action.play').click();await settle();const choices=root.querySelectorAll('.play-choices a');expect(choices).toHaveLength(2);expect([...choices].map(a=>a.getAttribute('href'))).toEqual(expect.arrayContaining(['/play/original?provider=harbor','/play/copy?provider=lunatalk']));expect(mocks.register).not.toHaveBeenCalled();});
it('retains available works when another service is unavailable',async()=>{mocks.fetch.mockImplementation(async(_t,{provider})=>{if(provider==='lunatalk')throw Error('offline');return result([{...fixture,roleId:'original'}]);});await mount();expect(root.querySelectorAll('article.card')).toHaveLength(1);expect(root.querySelector('[role=alert]')?.textContent).toContain('offline');});

it('synchronizes hosting copies without offering a second platform review',async()=>{await mount();expect(root.textContent).not.toContain(i18n.global.t('linked.submitToo'));mocks.synchronize.mockResolvedValue({provider:'lunatalk',roleId:'copy',status:'synced'});button('linked.sync').click();await settle();expect(mocks.synchronize).toHaveBeenCalledWith('original','harbor','lunatalk',false);});


it('uses the portrait background before the avatar and keeps the card destination', async () => {
 mocks.fetch.mockImplementation(async (_t, {provider}) => result([{...fixture, roleId:provider==='harbor'?'original':'copy', backgroundUrl:'/portrait.png'}]));
 await mount();
 expect(root.querySelector('.card__art img')?.getAttribute('src')).toBe('/portrait.png');
 expect(root.querySelector('.card__art')?.getAttribute('href')).toBe('/cards/work');
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
