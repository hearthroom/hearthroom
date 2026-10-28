import { afterEach, expect, it, vi } from 'vitest';
import { SukiPet, type PetOptions } from '../src/pet/pet-ui';
import type { SidebarRect } from '../src/lib/sidebar-clearance';
let pet: SukiPet;
afterEach(() => { pet?.stop(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function setup(mobile = false, onSidebarMenuChange = vi.fn()) {
  let bounds: SidebarRect | null = { left: 792, right: 1056, top: 428, bottom: 568 };
  pet = new SukiPet({ base: '', skin: 'day', label: 'Suki', height: 220, line: key => key, mobile, onSidebarMenuChange, sidebarBounds: () => bounds } as PetOptions);
  const p = pet as unknown as { updateSidebar: () => void; box: () => object; place: (p: object) => void; fitPopups: () => void; driver: object; el: HTMLElement; bubble: HTMLElement; idleButton: HTMLButtonElement };
  vi.spyOn(p, 'box').mockReturnValue({ left: 909, top: 372, width: 146, height: 220, right: 1055 });
  vi.spyOn(p, 'place').mockImplementation(() => {});
  vi.spyOn(p, 'fitPopups').mockImplementation(() => {});
  p.driver = { state: { talking: false } };
  document.body.append(p.el);
  return { p, leave: () => { bounds = null; } };
}
it('starts as a silent corner avatar when the homepage sidebar has no clear operation row', () => {
  const { p } = setup(); p.updateSidebar();
  expect(p.idleButton.hidden).toBe(false);
  expect(p.el.classList.contains('suki-pet--sidebar-idle')).toBe(true);
  pet.on({ type: 'say', text: 'automatic greeting' });
  expect(p.bubble.hidden).toBe(true);
});
it('expands only on the avatar action and restores ordinary behavior after leaving the sidebar page', () => {
  const { p, leave } = setup(); p.updateSidebar(); p.idleButton.click();
  expect(p.el.classList.contains('suki-pet--sidebar-idle')).toBe(false);
  expect(p.idleButton.getAttribute('aria-expanded')).toBe('true');
  expect(p.place).toHaveBeenCalled();
  leave(); p.updateSidebar();
  expect(p.idleButton.hidden).toBe(true);
  expect(p.el.classList.contains('suki-pet--sidebar-idle')).toBe(false);
});
it('does not introduce the desktop avatar fallback on phone pages', () => {
  const { p } = setup(true); p.updateSidebar();
  expect(p.idleButton.hidden).toBe(true);
  expect(p.el.classList.contains('suki-pet--sidebar-idle')).toBe(false);
});

it('docks for partial rail overlap even when another operation row remains clear',()=>{
 const {p}=setup();vi.mocked(p.box).mockReturnValue({left:909,right:1055,top:500,width:146,height:220});
 p.updateSidebar();expect(p.idleButton.hidden).toBe(false);expect(p.el.classList.contains('suki-pet--sidebar-idle')).toBe(true);
});

it('announces explicit rail-menu ownership and releases it on Escape',()=>{
 const change=vi.fn();const {p}=setup(false,change);p.updateSidebar();p.idleButton.click();
 expect(change).toHaveBeenLastCalledWith(true);
 document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
 // The listener is registered on the next task; test the same close path directly.
 (pet as unknown as {closeMenu:()=>void}).closeMenu();
 expect(change).toHaveBeenLastCalledWith(false);expect(p.idleButton.getAttribute('aria-expanded')).toBe('false');
});
it('keeps a visible answer and overlay ownership for a deliberate topic action',()=>{
 const change=vi.fn();const {p}=setup(false,change);
 const manual=pet as unknown as {guide:object;menuEl:HTMLElement;bubble:HTMLElement;closeMenu:()=>void};
 manual.guide={id:'board',topics:[{q:'What is heat?',a:'Heat explains recent activity.'}]};
 p.updateSidebar();p.idleButton.click();
 [...manual.menuEl.querySelectorAll('button')].find(b=>b.textContent==='What is heat?')!.click();
 expect(manual.bubble.hidden).toBe(false);expect(manual.bubble.textContent).toBe('Heat explains recent activity.');
 expect(p.el.classList.contains('suki-pet--sidebar-idle')).toBe(false);expect(change).toHaveBeenLastCalledWith(true);
 manual.closeMenu();expect(manual.bubble.hidden).toBe(true);expect(change).toHaveBeenLastCalledWith(false);
});
it('waits for a manual async action before deciding whether to return to idle',async()=>{
 const change=vi.fn();const {p}=setup(false,change);
 const manual=pet as unknown as {opts:PetOptions;menuEl:HTMLElement;bubble:HTMLElement;closeMenu:()=>void};
 let resolve!:()=>void;const pending=new Promise<void>(r=>resolve=r);
 manual.opts.menu=()=>[{label:'Resume',run:async()=>{await pending;pet.say('No previous conversation.');}}];
 p.updateSidebar();p.idleButton.click();manual.menuEl.querySelector<HTMLButtonElement>('button')!.click();
 resolve();for(let i=0;i<5;i++)await Promise.resolve();
 expect(manual.bubble.hidden).toBe(false);expect(manual.bubble.textContent).toBe('No previous conversation.');
 expect(change).toHaveBeenLastCalledWith(true);manual.closeMenu();
});

it.each([false,true])('parks the homepage avatar for mouse/touch (%s) without automatic speech or saved-position writes',mobile=>{
 const {p,leave}=setup(mobile);let parking=true;
 const manual=pet as unknown as {opts:PetOptions;save:(pos:{x:number;y:number})=>void};manual.opts.parkOnHomepage=()=>parking;
 localStorage.setItem('suki.pet.pos','saved-user-position');p.updateSidebar();
 expect(p.idleButton.hidden).toBe(false);expect(p.el.classList.contains('suki-pet--home-parked')).toBe(true);
 pet.on({type:'say',text:'automatic greeting'});expect(p.bubble.hidden).toBe(true);
 manual.save({x:100,y:200});expect(localStorage.getItem('suki.pet.pos')).toBe('saved-user-position');
 parking=false;leave();p.updateSidebar();expect(p.idleButton.hidden).toBe(true);expect(p.el.classList.contains('suki-pet--home-parked')).toBe(false);
 localStorage.removeItem('suki.pet.pos');
});
it('releases temporary popup placement with the homepage lane',()=>{
 const {p,leave}=setup(true);let parking=true;
 const manual=pet as unknown as {opts:PetOptions;menuEl:HTMLElement};manual.opts.parkOnHomepage=()=>parking;p.updateSidebar();
 manual.menuEl.style.translate='100px 20px';manual.menuEl.style.maxHeight='400px';manual.menuEl.style.overflowY='auto';
 parking=false;leave();p.updateSidebar();
 expect(manual.menuEl.style.translate).toBe('');expect(manual.menuEl.style.maxHeight).toBe('');
});

it.each([false,true])('keeps the pet reachable after shrinking out of the homepage lane (%s)',mobile=>{
 const {p,leave}=setup(mobile);let parking=true;
 const manual=pet as unknown as {opts:PetOptions;pos:{x:number;y:number};size:()=>{w:number;h:number}};
 manual.opts.parkOnHomepage=()=>parking;
 vi.mocked(p.place).mockRestore();vi.spyOn(manual,'size').mockReturnValue({w:147,h:220});
 vi.stubGlobal('innerWidth',768);vi.stubGlobal('innerHeight',900);
 manual.pos={x:537.6,y:630};localStorage.setItem('suki.pet.pos','original-preference');p.updateSidebar();
 vi.stubGlobal('innerWidth',390);parking=false;leave();p.updateSidebar();
 expect(manual.pos.x).toBeGreaterThanOrEqual(0);expect(manual.pos.x+147).toBeLessThanOrEqual(390);
 expect(localStorage.getItem('suki.pet.pos')).toBe('original-preference');
 localStorage.removeItem('suki.pet.pos');vi.unstubAllGlobals();
});

it('suspends passive phone presentation without changing preferences and opens an explicit text menu',()=>{
 const {p}=setup(true);const manual=pet as unknown as {opts:PetOptions & {phoneClearance?:()=>unknown};openFrom:(opener:HTMLElement)=>void;menuEl:HTMLElement;closeMenu:()=>void;phoneOriginal:unknown};
 manual.opts.phoneClearance=()=>({top:60,bottom:900,obstacles:[{left:0,right:1200,top:60,bottom:900}]});
 localStorage.setItem('suki.pet.pos','preserve');p.updateSidebar();
 expect(p.el.classList.contains('suki-pet--phone-suspended')).toBe(true);expect(p.idleButton.hidden).toBe(true);
 const opener=document.createElement('button');document.body.append(opener);manual.openFrom(opener);
 expect(manual.menuEl.hidden).toBe(false);expect(p.el.classList.contains('suki-pet--phone-dialog')).toBe(true);
 manual.closeMenu();expect(manual.menuEl.hidden).toBe(true);expect(localStorage.getItem('suki.pet.pos')).toBe('preserve');
 opener.remove();localStorage.removeItem('suki.pet.pos');
});

it('keeps manual async phone answers readable and restores the passive policy afterwards',async()=>{
 const change=vi.fn();const {p}=setup(true,change);
 const manual=pet as unknown as {opts:PetOptions;openFrom:(opener:HTMLElement|null)=>void;menuEl:HTMLElement;closeMenu:()=>void};
 manual.opts.phoneClearance=()=>({top:60,bottom:900,obstacles:[{left:0,right:1200,top:60,bottom:900}]});
 let resolve!:()=>void;const pending=new Promise<void>(r=>resolve=r);
 manual.opts.menu=()=>[{label:'Resume',run:async()=>{await pending;pet.say('No previous conversation.');}}];
 p.updateSidebar();manual.openFrom(null);manual.menuEl.querySelector<HTMLButtonElement>('button')!.click();
 expect(change).toHaveBeenLastCalledWith(true);resolve();for(let i=0;i<5;i++)await Promise.resolve();
 expect(p.bubble.hidden).toBe(false);expect(change).toHaveBeenLastCalledWith(true);
 manual.closeMenu();expect(p.bubble.hidden).toBe(true);expect(change).toHaveBeenLastCalledWith(false);expect(p.el.classList.contains('suki-pet--phone-suspended')).toBe(true);
});

it('keeps a deliberate desktop drag visible while crossing the sidebar',()=>{
 const {p}=setup();
 const manual=pet as unknown as {drag:{moved:boolean}|null};
 manual.drag={moved:true};p.updateSidebar();
 expect(p.idleButton.hidden).toBe(true);
 expect(p.el.classList.contains('suki-pet--sidebar-idle')).toBe(false);
});

it.each(['left','right'] as const)('preserves the desktop %s edge peek after dropping beside the sidebar',edge=>{
 const {p}=setup();vi.stubGlobal('innerWidth',1440);vi.stubGlobal('innerHeight',900);
 const left=edge==='left'?-80:1360;
 vi.mocked(p.box).mockReturnValue({left,right:left+146,top:500,width:146,height:220});
 const manual=pet as unknown as {opts:PetOptions;drop:(event:PointerEvent,drag:{shake:number})=>void;tucked:boolean};
 manual.opts.sidebarBounds=()=>({left:edge==='left'?0:1300,right:edge==='left'?140:1440,top:428,bottom:800});
 manual.drop({clientX:edge==='left'?0:1440,clientY:500} as PointerEvent,{shake:0});
 expect(manual.tucked).toBe(true);expect(p.el.classList.contains('suki-pet--tucked')).toBe(true);
 p.updateSidebar();
 expect(p.idleButton.hidden).toBe(true);expect(p.el.classList.contains('suki-pet--sidebar-idle')).toBe(false);
 expect(p.place).toHaveBeenLastCalledWith({x:edge==='left'?-146*.62:1440-146*.38,y:500});
});

it('releases an expanded sidebar presentation for a deliberate drag without restoring its old position',()=>{
 const {p}=setup();p.updateSidebar();p.idleButton.click();
 const manual=pet as unknown as {drag:{moved:boolean}|null;sidebarDocked:boolean;sidebarPosition:{x:number;y:number}|null};
 manual.sidebarPosition={x:300,y:200};manual.drag={moved:true};vi.mocked(p.place).mockClear();
 p.updateSidebar();
 expect(p.idleButton.hidden).toBe(true);expect(manual.sidebarDocked).toBe(false);
 expect(p.el.classList.contains('suki-pet--sidebar-idle')).toBe(false);
 expect(p.el.classList.contains('suki-pet--sidebar-avatar')).toBe(false);
 expect(p.place).not.toHaveBeenCalled();
});

it('fades before relocating a passive phone pet and never restores a distant original slot while scrolling',()=>{
 const {p}=setup(true);vi.stubGlobal('innerWidth',390);vi.stubGlobal('innerHeight',844);
 const manual=pet as unknown as {opts:PetOptions;pos:{x:number;y:number};size:()=>{w:number;h:number};phoneOriginal:{x:number;y:number}|null};
 let now=0;vi.spyOn(performance,'now').mockImplementation(()=>now);
 let obstacles=[{left:0,right:390,top:400,bottom:800}];
 manual.opts.phoneClearance=()=>({top:121,bottom:836,obstacles});
 vi.mocked(p.place).mockRestore();manual.pos={x:270,y:478};
 vi.spyOn(manual,'size').mockReturnValue({w:88,h:132});
 vi.mocked(p.box).mockImplementation(()=>({left:manual.pos.x,right:manual.pos.x+88,top:manual.pos.y,width:88,height:132}));
 localStorage.setItem('suki.pet.pos','keep-user-preference');
 p.updateSidebar();
 expect(manual.pos.y).toBe(478);expect(p.el.classList.contains('suki-pet--phone-suspended')).toBe(true);expect(p.el.inert).toBe(true);
 now=100;p.updateSidebar();expect(manual.pos.y).toBe(478);
 now=300;p.updateSidebar();expect(manual.pos.y).toBe(260);expect(p.el.classList.contains('suki-pet--phone-suspended')).toBe(false);expect(p.el.inert).toBe(false);
 obstacles=[];now=350;p.updateSidebar();expect(manual.pos.y).toBe(260);
 expect(localStorage.getItem('suki.pet.pos')).toBe('keep-user-preference');localStorage.removeItem('suki.pet.pos');
});

it('cancels a pending phone relocation when scrolling clears the current slot',()=>{
 const {p}=setup(true);vi.stubGlobal('innerWidth',390);vi.stubGlobal('innerHeight',844);
 const manual=pet as unknown as {opts:PetOptions;pos:{x:number;y:number};size:()=>{w:number;h:number}};
 let now=0;vi.spyOn(performance,'now').mockImplementation(()=>now);
 let obstacles=[{left:0,right:390,top:400,bottom:800}];
 manual.opts.phoneClearance=()=>({top:121,bottom:836,obstacles});
 vi.mocked(p.place).mockRestore();manual.pos={x:270,y:478};
 vi.spyOn(manual,'size').mockReturnValue({w:88,h:132});
 vi.mocked(p.box).mockImplementation(()=>({left:manual.pos.x,right:manual.pos.x+88,top:manual.pos.y,width:88,height:132}));
 p.updateSidebar();obstacles=[];now=100;p.updateSidebar();
 expect(manual.pos.y).toBe(478);expect(p.el.classList.contains('suki-pet--phone-suspended')).toBe(false);expect(p.el.inert).toBe(false);
});

it.each([false,true])('opens the existing menu from preferences outside the phone policy (%s)',parking=>{
 const change=vi.fn();const {p,leave}=setup(false,change);leave();
 const manual=pet as unknown as {opts:PetOptions;openFrom:(opener:HTMLElement|null)=>void;menuEl:HTMLElement;closeMenu:()=>void};
 manual.opts.parkOnHomepage=()=>parking;
 if(parking)p.updateSidebar();
 const opener=document.createElement('button');document.body.append(opener);opener.focus();
 localStorage.setItem('suki.pet.pos','do-not-reset');vi.mocked(p.place).mockClear();
 manual.openFrom(opener);
 expect(manual.menuEl.hidden).toBe(false);expect(change).toHaveBeenLastCalledWith(true);
 p.updateSidebar();expect(manual.menuEl.hidden).toBe(false);expect(p.place).not.toHaveBeenCalled();
 expect(localStorage.getItem('suki.pet.pos')).toBe('do-not-reset');
 manual.closeMenu();expect(manual.menuEl.hidden).toBe(true);expect(change).toHaveBeenLastCalledWith(false);
 opener.remove();localStorage.removeItem('suki.pet.pos');
});

it('retains an explicit desktop answer until it closes',()=>{
 const change=vi.fn();const {p,leave}=setup(false,change);leave();
 const manual=pet as unknown as {guide:object;openFrom:(opener:HTMLElement|null)=>void;menuEl:HTMLElement;bubble:HTMLElement;closeMenu:()=>void};
 manual.guide={id:'board',topics:[{q:'What is heat?',a:'Heat explains recent activity.'}]};
 manual.openFrom(null);
 expect(manual.menuEl.hidden).toBe(false);
 [...manual.menuEl.querySelectorAll('button')].find(b=>b.textContent==='What is heat?')!.click();
 expect(manual.bubble.hidden).toBe(false);expect(change).toHaveBeenLastCalledWith(true);
 p.updateSidebar();expect(manual.bubble.hidden).toBe(false);
 manual.closeMenu();expect(manual.bubble.hidden).toBe(true);expect(change).toHaveBeenLastCalledWith(false);
});

it.each([1440,2560].flatMap(width=>['left','right'].flatMap(side=>[false,true].map(rail=>({width,side,rail})))))('keeps automatic desktop edge speech inside the $width viewport ($side, rail=$rail)',({width,side,rail})=>{
 const {p,leave}=setup();if(!rail)leave();vi.stubGlobal('innerWidth',width);vi.stubGlobal('innerHeight',900);
 vi.mocked(p.fitPopups).mockRestore();
 const manual=pet as unknown as {tucked:boolean};manual.tucked=true;
 const left=side==='left'?-91:width-60;
 vi.spyOn(p.bubble,'getBoundingClientRect').mockImplementation(()=>{
  const [dx=0,dy=0]=p.bubble.style.translate.split(' ').map(v=>parseFloat(v)||0);
  return new DOMRect(left+dx,405+dy,180,64);
 });
 pet.say('I am right here.');
 expect(p.bubble.hidden).toBe(false);expect(p.idleButton.hidden).toBe(true);
 const first=p.bubble.getBoundingClientRect();expect(first.left).toBeGreaterThanOrEqual(8);expect(first.right).toBeLessThanOrEqual(width-8);
 p.fitPopups();const second=p.bubble.getBoundingClientRect();
 expect(second.left).toBe(first.left);expect(second.right).toBe(first.right);
});

it.each([1440,2560].flatMap(width=>['left','right'].map(side=>({width,side}))))('returns the desktop $side peek to its saved stand on click ($width)',({width,side})=>{
 const {p}=setup();vi.stubGlobal('innerWidth',width);vi.stubGlobal('innerHeight',900);
 const manual=pet as unknown as {opts:PetOptions;desktopStand:{x:number;y:number};tucked:boolean;pos:{x:number;y:number};poke:(e:PointerEvent)=>void};
 manual.desktopStand={x:.4,y:.45};
 const bounds={left:width-300,right:width-20,top:250,bottom:880};manual.opts.sidebarBounds=()=>bounds;
 vi.mocked(p.place).mockRestore();manual.pos={x:side==='left'?-91:width-55,y:405};manual.tucked=true;p.el.classList.add('suki-pet--tucked');
 vi.mocked(p.box).mockImplementation(()=>({left:manual.pos.x,right:manual.pos.x+146,top:manual.pos.y,width:146,height:220}));
 vi.mocked(p.fitPopups).mockRestore();
 vi.spyOn(p.bubble,'getBoundingClientRect').mockImplementation(()=>{
  const [dx=0,dy=0]=p.bubble.style.translate.split(' ').map(v=>parseFloat(v)||0);
  const left=manual.pos.x+(p.el.classList.contains('suki-pet--right')?146-8-180:8);
  return new DOMRect(left+dx,manual.pos.y+14-64+dy,180,64);
 });
 manual.poke({clientX:side==='left'?20:width-20,clientY:450} as PointerEvent);
 expect(p.bubble.hidden).toBe(false);
 const popup=p.bubble.getBoundingClientRect();
 expect(popup.left).toBeGreaterThanOrEqual(8);expect(popup.right).toBeLessThanOrEqual(width-8);
 expect(popup.right<=bounds.left||popup.left>=bounds.right||popup.bottom<=bounds.top||popup.top>=bounds.bottom).toBe(true);
 p.updateSidebar();
 expect(manual.tucked).toBe(false);expect(p.el.classList.contains('suki-pet--tucked')).toBe(false);
 expect(p.idleButton.hidden).toBe(true);expect(p.el.classList.contains('suki-pet--sidebar-idle')).toBe(false);
 expect(manual.pos).toEqual({x:width*.4,y:405});
 localStorage.removeItem('suki.pet.pos');
});

it('keeps the ordinary desktop edge-return position when no rail is present',()=>{
 const {p,leave}=setup();leave();vi.stubGlobal('innerWidth',1440);vi.stubGlobal('innerHeight',900);
 const manual=pet as unknown as {tucked:boolean;pos:{x:number;y:number};poke:(e:PointerEvent)=>void};
 vi.mocked(p.place).mockRestore();manual.pos={x:1385,y:405};manual.tucked=true;
 vi.mocked(p.box).mockImplementation(()=>({left:manual.pos.x,right:manual.pos.x+146,top:manual.pos.y,width:146,height:220}));
 manual.poke({clientX:1420,clientY:450} as PointerEvent);p.updateSidebar();
 expect(manual.pos.x).toBe(1270);expect(p.idleButton.hidden).toBe(true);
 localStorage.removeItem('suki.pet.pos');
});

it.each([1440,2560].flatMap(width=>['left','right'].map(side=>({width,side}))))('keeps passive desktop speech in the viewport through a moving CSS anchor ($width, $side)',({width,side})=>{
 const {p}=setup();vi.stubGlobal('innerWidth',width);vi.stubGlobal('innerHeight',900);
 vi.mocked(p.fitPopups).mockRestore();
 const manual=pet as unknown as {tucked:boolean;pos:{x:number;y:number};rig:{params:Record<string,number>;kick:()=>void};driver:{state:object;update:()=>void};view:{draw:()=>void};playActivity:()=>void;brain:()=>void;frame:(dt:number,now:number)=>void};
 manual.tucked=true;manual.pos={x:side==='left'?-91:width-55,y:405};
 manual.rig={params:{},kick:vi.fn()};manual.driver={state:{talking:false},update:vi.fn()};manual.view={draw:vi.fn()};
 vi.spyOn(manual,'playActivity').mockImplementation(()=>{});vi.spyOn(manual,'brain').mockImplementation(()=>{});
 // The model already has its final coordinate while a CSS transition still
 // renders the anchor between the drop point and that destination.
 let renderedX=side==='left'?-50:width-74;
 vi.spyOn(p.bubble,'getBoundingClientRect').mockImplementation(()=>{
  const [dx=0,dy=0]=p.bubble.style.translate.split(' ').map(v=>parseFloat(v)||0);
  return new DOMRect(renderedX+(side==='left'?8:146-8-136)+dx,378+dy,136,41);
 });
 pet.say('I am right here.');
 for(const progress of [0,.25,.5,.75,1]){
  const start=side==='left'?-50:width-74;renderedX=start+(manual.pos.x-start)*progress;
  manual.frame(.016,performance.now());
  const r=p.bubble.getBoundingClientRect();
  expect(r.left,`transition progress ${progress}`).toBeGreaterThanOrEqual(8);
  expect(r.right,`transition progress ${progress}`).toBeLessThanOrEqual(width-8);
 }
});

it.each([false,true])('keeps a low edge-return popup clear of the rail before passive collision checks (reduced=%s)',reduced=>{
 const {p}=setup();vi.stubGlobal('innerWidth',1440);vi.stubGlobal('innerHeight',900);
 const manual=pet as unknown as {opts:PetOptions;desktopStand:{x:number;y:number};tucked:boolean;returningFromEdge:boolean;pos:{x:number;y:number};rig:{params:Record<string,number>;kick:()=>void};driver:{state:object;update:()=>void};view:{draw:()=>void};playActivity:()=>void;brain:()=>void;frame:(dt:number,now:number)=>void;poke:(e:PointerEvent)=>void};
 const rail={left:1140,right:1404,top:431,bottom:884};manual.opts.sidebarBounds=()=>rail;manual.opts.reducedMotion=reduced;
 vi.mocked(p.place).mockRestore();vi.mocked(p.fitPopups).mockRestore();
 manual.desktopStand={x:.4,y:585/900};manual.pos={x:1385,y:585};manual.tucked=true;p.el.classList.add('suki-pet--tucked');
 manual.rig={params:{},kick:vi.fn()};manual.driver={state:{talking:false},update:vi.fn()};manual.view={draw:vi.fn()};
 vi.spyOn(manual,'playActivity').mockImplementation(()=>{});vi.spyOn(manual,'brain').mockImplementation(()=>{});
 let renderedX=1385;
 vi.mocked(p.box).mockImplementation(()=>({left:manual.pos.x,right:manual.pos.x+146,top:manual.pos.y,width:146,height:220}));
 vi.spyOn(p.el,'getBoundingClientRect').mockImplementation(()=>new DOMRect(renderedX,585,146,220));
 vi.spyOn(p.bubble,'getBoundingClientRect').mockImplementation(()=>{
  const [dx=0,dy=0]=p.bubble.style.translate.split(' ').map(v=>parseFloat(v)||0);
  return new DOMRect(renderedX+146-8-136+dx,558+dy,136,41);
 });
 manual.poke({clientX:1420,clientY:625} as PointerEvent);
 for(const progress of reduced?[1]:[0,.25,.5,.75,1]){
  renderedX=1385+(manual.pos.x-1385)*progress;
  manual.frame(.016,performance.now());
  const popup=p.bubble.getBoundingClientRect();
  expect(popup.right,`transition progress ${progress}`).toBeLessThanOrEqual(rail.left-12);
  expect(p.idleButton.hidden).toBe(true);expect(p.el.classList.contains('suki-pet--sidebar-idle')).toBe(false);
 }
 expect(manual.returningFromEdge).toBe(false);
 // The settled return must release its temporary popup policy and leave the
 // existing rail-body collision policy active for later ordinary positions.
 manual.pos={x:1200,y:585};renderedX=1200;manual.frame(.016,performance.now());
 expect(p.idleButton.hidden).toBe(false);
 localStorage.removeItem('suki.pet.pos');
});

it('uses the applied popup translation while a reduced-motion CSS transition has not caught up',()=>{
 const {p}=setup();vi.stubGlobal('innerWidth',1440);vi.stubGlobal('innerHeight',900);vi.mocked(p.fitPopups).mockRestore();
 let applied=0;
 const computed=window.getComputedStyle.bind(window);
 vi.stubGlobal('getComputedStyle',(el:Element)=>{
  const style=computed(el);
  return el===p.bubble?new Proxy(style,{get:(target,key)=>key==='translate'?`${applied}px`:Reflect.get(target,key)}):style;
 });
 vi.spyOn(p.bubble,'getBoundingClientRect').mockImplementation(()=>new DOMRect(1380+applied,405,136,41));
 pet.say('I am right here.');expect(parseFloat(p.bubble.style.translate)).toBe(-84);
 for(const next of [0,-42,-84]){
  applied=next;p.fitPopups();
  expect(parseFloat(p.bubble.style.translate)).toBe(-84);
 }
});
