import {afterEach,expect,it,vi} from 'vitest';
import {SukiPet,type PetOptions} from '../src/pet/pet-ui';
type Point={x:number;y:number};
type Harness={opts:PetOptions;pos:Point;tucked:boolean;el:HTMLElement;touch:HTMLElement;menuEl:HTMLElement;bubble:HTMLElement;driver:object;restore:()=>Point|null;place:(p:Point)=>void;save:(p:Point)=>void;tuck:(side:'left'|'right',silent?:boolean)=>void;poke:(e:PointerEvent)=>void;drop:(e:PointerEvent,d:unknown)=>void;refit:()=>void;updateClearance:()=>void;fitPopups:()=>void;daily:()=>void;act:()=>void;summon:()=>void;view:object;rig:object};
const pets:SukiPet[]=[];
afterEach(()=>{vi.clearAllTimers();vi.useRealTimers();for(const pet of pets.splice(0))pet.stop();localStorage.removeItem('suki.pet.pos');document.querySelectorAll('[data-qa04]').forEach(e=>e.remove());vi.unstubAllGlobals();vi.restoreAllMocks();});
function setup(width=1440,rail=true){
 vi.useFakeTimers();vi.stubGlobal('innerWidth',width);vi.stubGlobal('innerHeight',900);
 const pet=new SukiPet({base:'',skin:'day',label:'Suki',height:220,line:k=>k,menu:()=>[{label:'Existing action',run:()=>{}}]} as PetOptions);pets.push(pet);
 // 首頁右側欄：從邊上叫她回來時不落在側欄上
 if(rail){const aside=document.createElement('aside');aside.className='home-sidebar';aside.dataset.qa04='';vi.spyOn(aside,'getBoundingClientRect').mockReturnValue(new DOMRect(width-300,428,264,452));document.body.append(aside);}
 const p=pet as unknown as Harness;p.driver={state:{talking:false}};
 Object.defineProperty(p.touch,'clientWidth',{configurable:true,value:146});Object.defineProperty(p.touch,'clientHeight',{configurable:true,value:220});
 vi.spyOn(p,'fitPopups').mockImplementation(()=>{});vi.spyOn(p,'daily').mockImplementation(()=>{});vi.spyOn(p,'act').mockImplementation(()=>{});
 document.body.append(p.el);return p;
}
function startAt(p:Harness,pos:Point){localStorage.setItem('suki.pet.pos',JSON.stringify({x:pos.x/innerWidth,y:pos.y/innerHeight}));const restored=p.restore();if(restored)p.place(restored);}
function dragToEdge(p:Harness,side:'left'|'right'){
 const origin={...p.pos};p.place({x:side==='left'?-100:innerWidth-40,y:origin.y});
 p.drop({clientX:side==='left'?0:innerWidth,clientY:origin.y+40} as PointerEvent,{shake:0,ox:origin.x+40,oy:origin.y+40,dx:40,dy:40});
}
it.each(['left','right'] as const)('persists and restores the chosen stand after a %s tuck and reload',side=>{
 const p=setup();startAt(p,{x:576,y:405});dragToEdge(p,side);
 expect(p.tucked).toBe(true);const stored=localStorage.getItem('suki.pet.pos');
 const next=setup();const restored=next.restore();if(restored)next.place(restored);vi.runOnlyPendingTimers();
 next.poke({clientX:side==='left'?20:1420,clientY:445} as PointerEvent);next.updateClearance();
 expect(next.pos).toEqual({x:576,y:405});expect(next.tucked).toBe(false);
 expect(stored).toContain('stand');
});
it('keeps the release position when the user pulls inward instead of choosing a system landing',()=>{
 const p=setup();startAt(p,{x:576,y:405});dragToEdge(p,'right');p.place({x:1000,y:550});
 p.drop({clientX:1040,clientY:590} as PointerEvent,{shake:0,ox:1420,oy:445,dx:40,dy:40});
 expect(p.pos).toEqual({x:1000,y:550});expect(p.tucked).toBe(false);
});
it('refits the saved choice after resizing without replacing its persisted normalized position',()=>{
 const p=setup(2560);startAt(p,{x:1024,y:405});dragToEdge(p,'right');const saved=localStorage.getItem('suki.pet.pos');
 vi.stubGlobal('innerWidth',1440);p.refit();p.poke({clientX:1420,clientY:445} as PointerEvent);
 expect(p.pos).toEqual({x:576,y:405});expect(JSON.parse(localStorage.getItem('suki.pet.pos')!).stand).toEqual(JSON.parse(saved!).stand);
});
it('uses the existing refitted default for old edge data without a sidebar',()=>{
 const p=setup(768,false);localStorage.setItem('suki.pet.pos',JSON.stringify({x:2,y:.45}));const restored=p.restore();if(restored)p.place(restored);vi.runOnlyPendingTimers();p.poke({clientX:750,clientY:445} as PointerEvent);
 expect(p.tucked).toBe(false);expect(p.pos.x).toBeGreaterThanOrEqual(0);expect(p.pos.x+146).toBeLessThanOrEqual(768);expect(p.pos.y+220).toBeLessThanOrEqual(900);
});
it('keeps the visible peek and opens its existing menu when old data has no safe default',()=>{
 const p=setup();localStorage.setItem('suki.pet.pos',JSON.stringify({x:2,y:.45}));const restored=p.restore();if(restored)p.place(restored);vi.runOnlyPendingTimers();p.poke({clientX:1420,clientY:445} as PointerEvent);
 expect(p.tucked).toBe(true);expect(p.menuEl.hidden).toBe(false);expect(p.menuEl.textContent).toContain('Existing action');expect(p.act).not.toHaveBeenCalledWith(expect.objectContaining({say:'untuck'}),true);
});
it('does not restore a resized choice over the actual following control',()=>{
 const p=setup();startAt(p,{x:576,y:405});dragToEdge(p,'right');
 const following=document.createElement('button');following.className='sorts__mode';following.dataset.qa04='';vi.spyOn(following,'getBoundingClientRect').mockReturnValue(new DOMRect(600,428,46,30));document.body.append(following);
 p.poke({clientX:1420,clientY:445} as PointerEvent);expect(p.tucked).toBe(true);expect(p.menuEl.hidden).toBe(false);
});

it('preserves the last user stand while passive positions are saved',()=>{
 const p=setup();startAt(p,{x:576,y:405});p.save({x:700,y:600});
 expect(JSON.parse(localStorage.getItem('suki.pet.pos')!).stand).toEqual({x:.4,y:.45});
});
it('refits ordinary saved desktop coordinates on a narrower reload without replacing the preference',()=>{
 const p=setup(768,false);const preference=JSON.stringify({x:.9,y:.9});localStorage.setItem('suki.pet.pos',preference);const restored=p.restore()!;
 expect(restored.x+146).toBeLessThanOrEqual(768);expect(restored.y+220).toBeLessThanOrEqual(900);expect(localStorage.getItem('suki.pet.pos')).toBe(preference);
});

it('does not replace a normalized stand with a one-time reload clamp before tucking',()=>{
 const p=setup(768,false);startAt(p,{x:768*.9,y:900*.9});dragToEdge(p,'right');
 expect(JSON.parse(localStorage.getItem('suki.pet.pos')!).stand).toEqual({x:.9,y:.9});
});
it('clears the remembered desktop choice when the existing settings reset summons her',()=>{
 const p=setup(1440,false);startAt(p,{x:576,y:405});p.summon();
 expect(JSON.parse(localStorage.getItem('suki.pet.pos')!).stand).toBeUndefined();
});
