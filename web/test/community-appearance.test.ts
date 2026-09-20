import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import {createApp,nextTick,type App} from 'vue';
import {i18n,applyLocale} from '../src/lib/i18n';
import CommunityAppearance from '../src/components/CommunityAppearance.vue';
import CommunityAvatar from '../src/components/CommunityAvatar.vue';
import CommunityBadgeList from '../src/components/CommunityBadgeList.vue';
const api=vi.hoisted(()=>({request:vi.fn()}));
vi.mock('../src/lib/community',()=>({communityRequest:api.request}));
vi.mock('../src/lib/session',()=>({useSession:()=>({displayName:'Member',avatarUrl:'/original.png',profile:{handle:'member'},accessToken:async()=> 'test'})}));
let app:App,el:HTMLDivElement;
const settle=async()=>{await nextTick();await new Promise(r=>setTimeout(r,0));};
const appearance=()=>({preferences:{avatarSource:'site',nameStyle:'none',frame:'none',publicAppearance:false},supporter:{active:true,verifiedAt:Date.now(),boostingSince:1,stale:false},available:{discordAvatar:'/discord.png',discordDecoration:'/frame.png'},effective:{avatarUrl:null,decorationUrl:null,nameStyle:'none',frame:'none'}});
beforeEach(async()=>{vi.resetAllMocks();el=document.createElement('div');document.body.append(el);await applyLocale('en');});
afterEach(()=>{app?.unmount();el.remove();});
it('previews choices without saving and restores them on cancel',async()=>{
 app=createApp(CommunityAppearance,{appearance:appearance(),linked:true,onSave:api.request}).use(i18n);app.mount(el);await settle();
 (el.querySelector('[data-action="edit-appearance"]') as HTMLButtonElement).click();await settle();
 const select=el.querySelector('[name="avatarSource"]') as HTMLSelectElement;select.value='discord';select.dispatchEvent(new Event('change'));await settle();
 expect(el.querySelector('.appearance-preview img')?.getAttribute('src')).toBe('/discord.png');expect(api.request).not.toHaveBeenCalled();
 (el.querySelector('[data-action="cancel-appearance"]') as HTMLButtonElement).click();await settle();
 (el.querySelector('[data-action="edit-appearance"]') as HTMLButtonElement).click();await settle();
 expect((el.querySelector('[name="avatarSource"]') as HTMLSelectElement).value).toBe('site');
});
it('disables supporter choices for non supporters but leaves linked avatar choice available',async()=>{
 const a=appearance();a.supporter.active=false;app=createApp(CommunityAppearance,{appearance:a,linked:true}).use(i18n);app.mount(el);await settle();
 (el.querySelector('[data-action="edit-appearance"]') as HTMLButtonElement).click();await settle();
 expect((el.querySelector('[name="nameStyle"]') as HTMLSelectElement).disabled).toBe(true);
 expect((el.querySelector('[name="avatarSource"]') as HTMLSelectElement).disabled).toBe(false);
});
it('renders supporter badge with an icon and labels it accurately',async()=>{
 app=createApp(CommunityBadgeList,{badges:['server_booster']}).use(i18n);app.mount(el);await settle();expect(el.textContent).toContain('Server supporter');expect(el.querySelector('svg')).not.toBeNull();
});
it('falls back to the site avatar when synced media fails to load',async()=>{
 app=createApp(CommunityAvatar,{src:'/original.png',name:'Member',appearance:{avatarUrl:'/discord.png',decorationUrl:null,nameStyle:'none',frame:'hearth'}}).use(i18n);app.mount(el);await settle();
 const image=el.querySelector('img')!;image.dispatchEvent(new Event('error'));await settle();expect(el.querySelector('img')?.getAttribute('src')).toBe('/original.png');
});
it('stops retrying after both Discord and site images fail',async()=>{
 app=createApp(CommunityAvatar,{src:'/original.png',name:'Member',appearance:{avatarUrl:'/discord.png',decorationUrl:null,nameStyle:'none',frame:'none'}}).use(i18n);app.mount(el);await settle();
 el.querySelector('img')!.dispatchEvent(new Event('error'));await settle();
 el.querySelector('img')!.dispatchEvent(new Event('error'));await settle();
 expect(el.querySelector('img')).toBeNull();expect(el.textContent).toContain('M');
});
it('lets an unlinked member restore the site avatar without resetting other preferences',async()=>{
 const a=appearance();a.preferences.avatarSource='discord';a.supporter.active=false;
 app=createApp(CommunityAppearance,{appearance:a,linked:false}).use(i18n);app.mount(el);await settle();
 (el.querySelector('[data-action="edit-appearance"]') as HTMLButtonElement).click();await settle();
 const select=el.querySelector('[name="avatarSource"]') as HTMLSelectElement;expect(select.disabled).toBe(false);
 expect((select.querySelector('[value="discord"]') as HTMLOptionElement).disabled).toBe(true);
 select.value='site';select.dispatchEvent(new Event('change'));await settle();
 expect(el.querySelector('.appearance-preview img')?.getAttribute('src')).toBe('/original.png');
});
