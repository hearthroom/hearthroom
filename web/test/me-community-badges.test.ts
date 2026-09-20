import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {createApp,nextTick,type App} from 'vue';
import {createMemoryHistory,createRouter,RouterView,type Router} from 'vue-router';
import {i18n,applyLocale} from '../src/lib/i18n';
const mock=vi.hoisted(()=>({request:vi.fn(),confirm:vi.fn(async()=>true)}));
vi.mock('../src/lib/community',async original=>({...await original<object>(),communityRequest:mock.request}));
vi.mock('../src/lib/confirm',()=>({confirmDialog:mock.confirm}));
vi.mock('../src/lib/session',()=>({useSession:()=>({me:{},displayName:'Fixture',avatarUrl:'',profile:{handle:'fixture',memberSince:0},accessToken:async()=>'fixture'})}));
vi.mock('../src/lib/review',()=>({useReviewer:()=>({reviewer:false})}));
vi.mock('../src/components/CommunityProfile.vue',()=>({default:{template:'<div />'}}));
vi.mock('../src/components/ConnectedAccounts.vue',()=>({default:{template:'<div />'}}));
import MePage from '../src/pages/MePage.vue';
import CommunityPage from '../src/pages/CommunityPage.vue';
let app:App,el:HTMLDivElement,router:Router;
const base={enabled:true,invite:'https://discord.gg/fixture',link:{name:'Linked',state:'synced'},xp:1,level:0,badges:['discord_linked','first_work'],xpEnabled:true,preferences:{public_badges:0,public_level:0,notifications:1,discord_dm:0,case_access:1}};
let view:typeof base;
const settle=async()=>{await nextTick();await new Promise(r=>setTimeout(r,0));};
beforeEach(async()=>{
 vi.clearAllMocks();await applyLocale('en');view=structuredClone(base);
 mock.request.mockImplementation(async(path:string,_token:string,method:string)=>{
  if(path.endsWith('/badges'))return {items:[{key:'first_work',icon:'award',category:'creation',titles:{en:'First approved work'},descriptions:{en:'First approval'},state:'earned',earnedAt:1,expiresAt:null}],featured:['first_work'],public:false};
  if(path.endsWith('/notifications'))return {items:[{id:'notice',kind:'review_result',path:'/me',created_at:1,read_at:null}]};
  if(method==='DELETE')view={...view,link:null as any,badges:['first_work']};
  return view;
 });
 router=createRouter({history:createMemoryHistory(),routes:[{path:'/me',component:MePage},{path:'/me/community',component:CommunityPage}]});await router.push('/me');
 el=document.createElement('div');document.body.append(el);app=createApp(RouterView).use(router).use(i18n);app.mount(el);await settle();
});
afterEach(()=>{app?.unmount();el.remove();});
it('keeps details off the profile while exposing a compact community entry',()=>{
 const header=el.querySelector('.me__who')!;
 expect(header.textContent).toContain('Level 0');
 expect(header.querySelectorAll('.community-badges svg')).toHaveLength(2);
 expect(header.querySelector('a[href="/me/community"]')).not.toBeNull();
 expect(el.querySelector('.community')).toBeNull();expect(el.querySelector('progress')).toBeNull();
 expect(el.querySelector('a[href="https://discord.gg/fixture"]')).toBeNull();
 expect(header.textContent).toContain(i18n.global.t('community.unreadCount',{count:1}));
});
it('opens settings through the profile entry and refreshes badges after unlinking',async()=>{
 el.querySelector<HTMLAnchorElement>('a[href="/me/community"]')!.click();await settle();
 expect(router.currentRoute.value.path).toBe('/me/community');expect(el.querySelector('progress')).not.toBeNull();
 expect(el.querySelector('a[href="https://discord.gg/fixture"]')).toBeNull();
 const unlink=[...el.querySelectorAll('button')].find(b=>b.textContent.trim()===i18n.global.t('community.unlink'))!;
 unlink.click();await settle();el.querySelector<HTMLAnchorElement>('.community-page__back')!.click();await settle();
 expect(el.querySelector('.me__who')!.textContent).not.toContain('Level 0');
 expect(el.querySelector('.me__who')!.textContent).toContain(i18n.global.t('community.badges.first_work'));
});
it.each(['synced','pending','failed','denied','cleanup'])('does not offer a redundant invitation in the %s state',async(state)=>{
 view.link.state=state;await router.push('/me/community');await settle();
 expect(el.querySelector('a[href="https://discord.gg/fixture"]')).toBeNull();
 expect(el.textContent).toContain(i18n.global.t('community.states.'+state));
});
it('offers an invitation when the service confirms non-membership',async()=>{
 view.link.state='not_member';await router.push('/me/community');await settle();
 expect(el.querySelector('a[href="https://discord.gg/fixture"]')).not.toBeNull();
});
it('guides unlinked members to connect first',async()=>{
 view.link=null as any;await router.push('/me/community');await settle();
 expect(el.querySelector('a[href="https://discord.gg/fixture"]')).toBeNull();
 expect(el.textContent).toContain(i18n.global.t('community.link'));
});
it('preserves legacy card-report entry points and their context',async()=>{
 await router.push('/me?reportCard=example');await settle();await settle();
 expect(router.currentRoute.value.fullPath).toBe('/me/community?reportCard=example');
 expect(el.textContent).toContain(i18n.global.t('community.newCase'));
});
