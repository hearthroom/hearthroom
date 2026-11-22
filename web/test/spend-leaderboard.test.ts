import {afterEach,expect,it,vi} from 'vitest';
import {createApp,nextTick,ref,type App} from 'vue';
import {i18n} from '../src/lib/i18n';
const mocks=vi.hoisted(()=>({board:vi.fn(),privacy:vi.fn(),save:vi.fn(),session:{me:{accountNumId:80001},profile:{handle:'abcdefgh'},accessToken:async()=> 'fixture',loggedIn:true}}));
vi.mock('../src/lib/spend-leaderboard',async original=>({...await original<typeof import('../src/lib/spend-leaderboard')>(),fetchSpendBoard:mocks.board,fetchBoardPrivacy:mocks.privacy,saveBoardPrivacy:mocks.save}));
vi.mock('../src/lib/session',async()=>{const {reactive}=await import('vue');mocks.session=reactive(mocks.session);return {useSession:()=>mocks.session}});
import CardSpendLeaderboard from '../src/components/CardSpendLeaderboard.vue';
import LeaderboardPrivacy from '../src/components/LeaderboardPrivacy.vue';
import {formatCredits,revealScope} from '../src/lib/spend-leaderboard';
import {hourMinute,monthDayTime} from '../src/lib/format';
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
it('accepts a zero live spend for the viewer but still rejects malformed live or ranked credits',async()=>{
 const actual=await vi.importActual<typeof import('../src/lib/spend-leaderboard')>('../src/lib/spend-leaderboard');
 const board=(extra:object)=>({list:[{rank:1,credits:'12',anonymous:true,isSelf:false}],self:null,total:1,offset:0,nextOffset:null,selfState:'unranked',updatedAt:'2026-11-22T06:17:00Z',...extra});
 const read=(body:object)=>{vi.stubGlobal('fetch',async()=>new Response(JSON.stringify(body),{status:200}));return actual.fetchSpendBoard('fixture')};
 expect((await read(board({viewerCredits:'0'}))).viewerCredits).toBe('0');
 expect((await read(board({viewerCredits:'9007199254740993'}))).viewerCredits).toBe('9007199254740993');
 for(const viewerCredits of ['-1','01','1.5',12])await expect(read(board({viewerCredits}))).rejects.toThrow('leaderboard_invalid_response');
 await expect(read(board({list:[{rank:1,credits:'0',anonymous:true,isSelf:false}]}))).rejects.toThrow('leaderboard_invalid_response');
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

it('keeps the compact excluded status short and preserves the complete author reason inside the board',async()=>{
 vi.stubGlobal('ResizeObserver',class {observe(){}disconnect(){}});
 mocks.board.mockResolvedValue({list:[],self:null,selfState:'author',total:0,nextOffset:null});
 const host=document.createElement('div');document.body.append(host);
 app=createApp(CardSpendLeaderboard,{cardId:'fixture'});app.use(i18n);app.mount(host);await flush();
 expect(host.querySelector('.spend-mobile__mine')?.textContent).toBe(i18n.global.t('spendBoard.excluded'));
 host.querySelector<HTMLButtonElement>('.spend-mobile button')!.click();await flush();
 expect(document.querySelector('.spend-mine>div')?.textContent).toContain(i18n.global.t('spendBoard.author'));
});
it('shows the author their own spend beside the board without a rank',async()=>{
 vi.stubGlobal('ResizeObserver',class {observe(){}disconnect(){}});
 const list=[{rank:1,credits:'500',anonymous:true,isSelf:false}];
 mocks.board.mockResolvedValue({list,self:null,selfState:'author',total:1,nextOffset:null,authorCredits:'1234'});
 const host=document.createElement('div');document.body.append(host);
 app=createApp(CardSpendLeaderboard,{cardId:'fixture'});app.use(i18n);app.mount(host);await flush();
 const spent=i18n.global.t('spendBoard.authorSpent',{amount:i18n.global.t('spendBoard.pointsAmount',{points:formatCredits('1234',i18n.global.locale.value)})});
 expect(host.querySelector('.spend-mobile__mine')?.textContent).toBe(spent);
 expect(host.querySelector('.spend-summary__mine')?.textContent).toBe(spent);
 host.querySelector<HTMLButtonElement>('.spend-mobile button')!.click();await flush();
 const mine=document.querySelector('.spend-mine>div')!;
 expect(mine.querySelector('p')?.textContent).toBe(i18n.global.t('spendBoard.author'));
 expect(mine.querySelector('span')?.textContent).toContain(formatCredits('1234',i18n.global.locale.value));
 expect(document.querySelectorAll('.spend-sheet .spend-list>li')).toHaveLength(1);
});
it('keeps the rank on the hourly board while the footer shows the viewer\'s live spend',async()=>{
 vi.stubGlobal('ResizeObserver',class {observe(){}disconnect(){}});
 const loc=i18n.global.locale.value,points=(v:string)=>i18n.global.t('spendBoard.pointsAmount',{points:formatCredits(v,loc)});
 const at=new Date();at.setHours(14,17,0,0);
 const self={rank:2,credits:'900',anonymous:true,isSelf:true};
 mocks.board.mockResolvedValue({list:[{rank:1,credits:'5000',anonymous:true,isSelf:false},self],self,selfState:'ranked',total:2,nextOffset:null,updatedAt:at.toISOString(),viewerCredits:'1350'});
 const host=document.createElement('div');document.body.append(host);
 app=createApp(CardSpendLeaderboard,{cardId:'fixture'});app.use(i18n);app.mount(host);await flush();
 const time=hourMinute(at.toISOString());
 expect(time).toBe('14:17');
 expect(host.querySelector('.spend-hourly')?.textContent).toBe(i18n.global.t('spendBoard.updated',{time}));
 expect(host.querySelector('.spend-summary__live')?.textContent).toContain(points('1350'));
 expect(host.querySelector('.spend-mobile__mine')?.textContent).toBe(i18n.global.t('spendBoard.myRank',{rank:2}));
 host.querySelector<HTMLButtonElement>('.spend-mobile button')!.click();await flush();
 const mine=document.querySelector('.spend-mine>div')!;
 expect(mine.querySelector('p')?.textContent).toBe(i18n.global.t('spendBoard.myRank',{rank:2})+' '+i18n.global.t('spendBoard.rankAsOf',{time}));
 expect(mine.querySelector('.spend-mine__live')?.textContent).toBe(i18n.global.t('spendBoard.spent',{amount:points('1350')})+' '+i18n.global.t('spendBoard.live'));
 expect(mine.querySelector('.spend-mine__hint')).toBeNull();
 expect(document.querySelector('.spend-mine')?.classList.contains('spend-mine--wide')).toBe(false);
 expect(document.querySelector('.spend-sheet .spend-list')?.textContent).toContain(points('900'));
 expect(document.querySelector('.spend-meta')?.textContent).toContain(i18n.global.t('spendBoard.updated',{time}));
});
it('tells an unranked spender they join at the next update, shows zero plainly, and dates a board from another day',async()=>{
 vi.stubGlobal('ResizeObserver',class {observe(){}disconnect(){}});
 const at=new Date(Date.now()-2*86400000);
 const open=async(viewerCredits:string,updatedAt?:string)=>{
  mocks.board.mockResolvedValue({list:[],self:null,selfState:'unranked',total:0,nextOffset:null,viewerCredits,...(updatedAt?{updatedAt}:{})});
  const host=document.createElement('div');document.body.append(host);
  app=createApp(CardSpendLeaderboard,{cardId:'fixture'});app.use(i18n);app.mount(host);await flush();
  host.querySelector<HTMLButtonElement>('.spend-mobile button')!.click();await flush();
  return host;
 };
 const host=await open('180',at.toISOString());
 expect(host.querySelector('.spend-hourly')?.textContent).toBe(i18n.global.t('spendBoard.updated',{time:monthDayTime(at.toISOString())}));
 expect(document.querySelector('.spend-mine p')?.textContent).toBe(i18n.global.t('spendBoard.shortUnranked'));
 expect(document.querySelector('.spend-mine__hint')?.textContent).toBe(i18n.global.t('spendBoard.pending'));
 expect(document.querySelector('.spend-empty p')?.textContent).toBe(i18n.global.t('spendBoard.pending'));
 app?.unmount();document.body.innerHTML='';
 const zero=await open('0');
 expect(zero.querySelector('.spend-hourly')?.textContent).toBe(i18n.global.t('spendBoard.updatedBare'));
 expect(document.querySelector('.spend-mine__live')?.textContent).toContain(i18n.global.t('spendBoard.pointsAmount',{points:'0'}));
 expect(document.querySelector('.spend-mine__hint')).toBeNull();
 expect(document.querySelector('.spend-empty p')?.textContent).toBe(i18n.global.t('spendBoard.emptyDesc'));
});
it('never shows a live spend line to the author or a test account',async()=>{
 vi.stubGlobal('ResizeObserver',class {observe(){}disconnect(){}});
 for(const selfState of ['author','test']){
  mocks.board.mockResolvedValue({list:[],self:null,selfState,total:0,nextOffset:null,viewerCredits:'77'});
  const host=document.createElement('div');document.body.append(host);
  app=createApp(CardSpendLeaderboard,{cardId:'fixture'});app.use(i18n);app.mount(host);await flush();
  host.querySelector<HTMLButtonElement>('.spend-mobile button')!.click();await flush();
  expect(document.querySelector('.spend-summary__live,.spend-mine__live,.spend-mine__hint')).toBeNull();
  expect(document.body.textContent).not.toContain(formatCredits('77',i18n.global.locale.value));
  app.unmount();document.body.innerHTML='';
 }
});
it('widens the footer by the live figure, not the shorter board figure',async()=>{
 vi.stubGlobal('ResizeObserver',class {observe(){}disconnect(){}});
 const self={rank:2,credits:'900',anonymous:true,isSelf:true};
 mocks.board.mockResolvedValue({list:[self],self,selfState:'ranked',total:1,nextOffset:null,viewerCredits:'123456789012'});
 const host=document.createElement('div');document.body.append(host);
 app=createApp(CardSpendLeaderboard,{cardId:'fixture'});app.use(i18n);app.mount(host);await flush();
 host.querySelector<HTMLButtonElement>('.spend-mobile button')!.click();await flush();
 expect(document.querySelector('.spend-mine')?.classList.contains('spend-mine--wide')).toBe(true);
});
