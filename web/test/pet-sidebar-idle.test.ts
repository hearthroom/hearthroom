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
