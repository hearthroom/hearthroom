import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import { i18n } from '../src/lib/i18n';
import PlayPage from '../src/pages/PlayPage.vue';
const mocks = vi.hoisted(() => ({card:vi.fn(),platforms:vi.fn(),stage:vi.fn(),copies:vi.fn(),review:vi.fn(),resume:vi.fn(),playApp:false}));
vi.mock('../src/lib/library', () => ({libraryRequest:mocks.resume}));
vi.mock('../src/lib/api', () => ({fetchReviewDetail:mocks.review,fetchCard:mocks.card,fetchCardPlatforms:mocks.platforms,fetchMeAt:async()=>({accountNumId:22})}));
vi.mock('../src/lib/distribution', () => ({copies:mocks.copies}));
vi.mock('../src/lib/session', () => ({useSession:()=>({ensureProfile:async()=>{},accessToken:async()=>'community',me:{accountNumId:11},profile:{identities:[{provider:'harbor',externalId:22}]}})}));
vi.mock('../src/lib/connections', () => ({accountToken:async()=>'host',connectAccount:vi.fn()}));
vi.mock('../src/lib/play-authorization', () => ({ensurePlayAuthorization:async()=>true}));
vi.mock('../src/lib/stage-host', () => ({ensureStage:mocks.stage,preloadStage:async()=>{},remergeStageMessages:async()=>{},stageToasts:{list:[]}}));
vi.mock('../src/lib/card-manifest', () => ({applyCardHead:vi.fn()}));
vi.mock('../src/lib/site', () => ({SITE:{name:'Hearthroom'},isPlayHost:()=>mocks.playApp,communityHost:()=> 'hearthroom.club'}));
vi.mock('../src/lib/track', () => ({track:vi.fn()}));
let app:ReturnType<typeof createApp>, root:HTMLElement;
const settle=async()=>{for(let i=0;i<50;i++)await Promise.resolve();await nextTick();};
beforeEach(()=>{vi.clearAllMocks();mocks.playApp=false;mocks.card.mockResolvedValue({id:'100021',num:100021,provider:'lunatalk',sourceRoleId:'source'});mocks.platforms.mockResolvedValue([{provider:'lunatalk',roleId:'luna-copy',playable:true},{provider:'harbor',roleId:'harbor-copy',playable:true}]);mocks.copies.mockResolvedValue([{provider:'harbor',roleId:'draft-copy',status:'synced'}]);mocks.stage.mockResolvedValue(defineComponent({props:['roleId'],setup:p=>()=>h('div',{'data-role':p.roleId})}));});
afterEach(()=>{app?.unmount();root?.remove();});
async function mount(path:string){const router=createRouter({history:createMemoryHistory(),routes:[{path:'/play/:roleId',component:PlayPage},{path:'/en/play/:roleId',component:PlayPage},{path:'/:roleId/',component:PlayPage}]});await router.push(path);root=document.createElement('div');document.body.append(root);app=createApp({template:'<RouterView />'}).use(i18n).use(router);app.mount(root);await settle();return router;}
it('resolves a numeric URL to the selected provider copy, never passing the number to Stage',async()=>{await mount('/play/100021?provider=harbor');expect(root.querySelector('[data-role]')?.getAttribute('data-role')).toBe('harbor-copy');expect(mocks.stage.mock.calls[0][0].currentRoleId()).toBe('harbor-copy');});
it('canonicalizes an old link and keeps its language, provider, query and fragment',async()=>{const router=await mount('/en/play/harbor-copy?provider=harbor&conversationId=archive#last');await vi.waitFor(()=>expect(router.currentRoute.value.fullPath).toBe('/en/play/100021?provider=harbor&conversationId=archive#last'));expect(root.querySelector('[data-role]')?.getAttribute('data-role')).toBe('harbor-copy');});
it('canonicalizes card app links within the numeric app scope',async()=>{mocks.playApp=true;const router=await mount('/harbor-copy/?provider=harbor&lang=en');await vi.waitFor(()=>expect(router.currentRoute.value.path).toBe('/100021/'));expect(router.currentRoute.value.query).toEqual({provider:'harbor',lang:'en'});});
it('does not launch a different provider when the selected copy is unavailable',async()=>{mocks.platforms.mockResolvedValue([{provider:'lunatalk',roleId:'luna-copy',playable:true}]);await mount('/play/100021?provider=harbor');expect(mocks.stage).not.toHaveBeenCalled();expect(root.querySelector('[role=alert]')).not.toBeNull();});
it('author playtests resolve owned source copies instead of the approved snapshot',async()=>{await mount('/play/100021?provider=harbor&mode=source');expect(mocks.copies).toHaveBeenCalledWith('source','lunatalk');expect(root.querySelector('[data-role]')?.getAttribute('data-role')).toBe('draft-copy');});
it('rejects source playtests when the ownership API denies access',async()=>{mocks.copies.mockRejectedValue(new Error('not_owner'));await mount('/play/100021?provider=harbor&mode=source');expect(mocks.stage).not.toHaveBeenCalled();});
it('discards a delayed card resolution after navigating to another card',async()=>{let finish!:(v:unknown)=>void;mocks.card.mockImplementationOnce(()=>new Promise(r=>{finish=r}));const router=await mount('/play/100020?provider=harbor');await router.push('/play/100021?provider=harbor');await settle();finish({id:'100020',num:100020,provider:'lunatalk',sourceRoleId:'old'});await settle();expect(router.currentRoute.value.path).toBe('/play/100021');expect(root.querySelector('[data-role]')?.getAttribute('data-role')).toBe('harbor-copy');});

it('plays the claimed review snapshot by numeric card URL without substituting a published version',async()=>{mocks.review.mockResolvedValue({card:{id:'100021',roleId:'review-snapshot'}});await mount('/play/100021?review=submission');expect(mocks.review).toHaveBeenCalledWith('submission','community');expect(mocks.card).not.toHaveBeenCalled();expect(root.querySelector('[data-role]')?.getAttribute('data-role')).toBe('review-snapshot');});

it('resumes the recorded revision instead of silently switching an existing conversation to the latest copy',async()=>{mocks.resume.mockResolvedValue({cardNumber:100021,provider:'harbor',roleId:'previous-revision'});await mount('/play/100021?provider=harbor&resume=existing-chat');expect(root.querySelector('[data-role]')?.getAttribute('data-role')).toBe('previous-revision');});
it('does not resume a conversation belonging to another card or provider',async()=>{mocks.resume.mockResolvedValue({cardNumber:100020,provider:'harbor',roleId:'wrong-card'});await mount('/play/100021?provider=harbor&resume=existing-chat');expect(mocks.stage).not.toHaveBeenCalled();});
it('reloads before changing the host of an installed player',async()=>{const assign=vi.spyOn(window.location,'assign').mockImplementation(()=>{});const router=await mount('/play/100021?provider=harbor');await router.push('/play/100021?provider=lunatalk');await settle();expect(assign).not.toHaveBeenCalled();expect(root.querySelector('[role=alert]')).not.toBeNull();expect(mocks.stage).toHaveBeenCalledTimes(1);assign.mockRestore();});
