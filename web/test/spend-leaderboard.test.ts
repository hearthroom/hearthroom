import {afterEach,expect,it,vi} from 'vitest';
import {createApp,nextTick,ref,type App} from 'vue';
import {i18n} from '../src/lib/i18n';
const mocks=vi.hoisted(()=>({board:vi.fn(),privacy:vi.fn(),save:vi.fn(),session:{me:{accountNumId:80001},profile:{handle:'abcdefgh'},accessToken:async()=> 'fixture',loggedIn:true}}));
vi.mock('../src/lib/spend-leaderboard',async original=>({...await original<typeof import('../src/lib/spend-leaderboard')>(),fetchSpendBoard:mocks.board,fetchBoardPrivacy:mocks.privacy,saveBoardPrivacy:mocks.save}));
vi.mock('../src/lib/session',async()=>{const {reactive}=await import('vue');mocks.session=reactive(mocks.session);return {useSession:()=>mocks.session}});
import CardSpendLeaderboard from '../src/components/CardSpendLeaderboard.vue';
import LeaderboardPrivacy from '../src/components/LeaderboardPrivacy.vue';
import {formatCredits,revealScope} from '../src/lib/spend-leaderboard';
let app:App|undefined;
afterEach(()=>{app?.unmount();document.body.innerHTML='';vi.clearAllMocks();vi.unstubAllGlobals();});
const flush=async()=>{for(let n=0;n<8;n++)await new Promise(r=>setTimeout(r,0));await nextTick();};
it('keeps exact integer credits and confirms the actual reveal scope',()=>{
 expect(formatCredits('9007199254740993','en')).toBe('9,007,199,254,740,993');
 expect(revealScope({anonymous:true,mode:'anonymous',revision:1},{anonymous:false,mode:'anonymous',revision:1})).toBe('revealGlobal');
 expect(revealScope({anonymous:true,mode:'anonymous',revision:1},{anonymous:false,mode:'public',revision:1})).toBe('revealBoth');
 expect(revealScope({anonymous:false,mode:'anonymous',revision:1},{anonymous:false,mode:'inherit',revision:1})).toBe('revealCard');
});
it('rejects a malformed success response before rendering a board',async()=>{
 const actual=await vi.importActual<typeof import('../src/lib/spend-leaderboard')>('../src/lib/spend-leaderboard');
 vi.stubGlobal('fetch',async()=>new Response(JSON.stringify({id:'card-instead-of-board'}),{status:200}));
 await expect(actual.fetchSpendBoard('fixture')).rejects.toThrow('leaderboard_invalid_response');
});
it('discards old card reads and shows anonymous players without profile links or initials',async()=>{
 let oldResolve:(v:unknown)=>void=()=>{};
 mocks.board.mockImplementation((id:string)=>id==='old'?new Promise(r=>oldResolve=r):Promise.resolve({list:[{rank:1,credits:'12',anonymous:true,isSelf:true}],self:{rank:1,credits:'12',anonymous:true,isSelf:true},selfState:'ranked',total:1,nextOffset:null,privacy:{anonymous:true,mode:'inherit',revision:1}}));
 const id=ref('old');const host=document.createElement('div');document.body.append(host);
 app=createApp({components:{CardSpendLeaderboard},setup:()=>({id}),template:'<CardSpendLeaderboard :card-id="id" />'});app.use(i18n);app.mount(host);
 id.value='new';await flush();
 oldResolve({list:[{rank:1,credits:'123',nickname:'Stale secret',anonymous:false,isSelf:false}],total:1});await flush();
 expect(host.textContent).not.toContain('Stale secret');
 expect(host.textContent).toContain(i18n.global.t('spendBoard.anon'));
 expect(host.querySelector('a[href*="authors"]')).toBeNull();
 expect(host.querySelector('[data-anonymous-avatar]')).not.toBeNull();
});
it('does not report an old-account save as a new-account success',async()=>{
 mocks.privacy.mockImplementation(async()=>({anonymous:false,mode:'inherit',revision:mocks.session.me.accountNumId===80002?10:0}));
 let resolve:(v:unknown)=>void=()=>{};mocks.save.mockImplementation(()=>new Promise(r=>resolve=r));
 const onSaved=vi.fn(),host=document.createElement('div');document.body.append(host);
 app=createApp(LeaderboardPrivacy,{onSaved});app.use(i18n);app.mount(host);await flush();
 expect(host.textContent).toContain(i18n.global.t('spendBoard.previewGlobalPublic'));
 const check=host.querySelector<HTMLInputElement>('input')!;check.checked=true;check.dispatchEvent(new Event('change'));await nextTick();
 host.querySelector<HTMLButtonElement>('.board-privacy>.btn')!.click();await flush();expect(mocks.save).toHaveBeenCalledTimes(1);
 mocks.session.me.accountNumId=80002;await flush();resolve({anonymous:true,mode:'inherit',revision:1});await flush();
 expect(onSaved).not.toHaveBeenCalled();expect(host.textContent).not.toContain(i18n.global.t('spendBoard.saved'));
});

it('closes with Escape after a disabled control leaves focus on the body and returns to the clicked opener',async()=>{
 vi.stubGlobal('ResizeObserver',class {observe(){}disconnect(){}});
 mocks.board.mockResolvedValue({list:[],self:null,selfState:'unranked',total:0,nextOffset:null});
 const host=document.createElement('div');host.id='app';document.body.append(host);
 app=createApp(CardSpendLeaderboard,{cardId:'fixture'});app.use(i18n);app.mount(host);await flush();
 const opener=host.querySelector<HTMLButtonElement>('.spend-mobile button')!;opener.click();await flush();
 expect(document.querySelector('.spend-sheet')).not.toBeNull();
 document.body.tabIndex=-1;document.body.focus();
 document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await flush();
 expect(document.querySelector('.spend-sheet')).toBeNull();expect(host.inert).toBe(false);expect(document.activeElement).toBe(opener);
});
