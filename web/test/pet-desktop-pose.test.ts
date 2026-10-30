import { afterEach, expect, it, vi } from 'vitest';
import { SukiPet, type PetOptions } from '../src/pet/pet-ui';
let pet: SukiPet;
afterEach(()=>{pet?.stop();vi.restoreAllMocks();vi.unstubAllGlobals();localStorage.removeItem('suki.pet.pos');});
function setup(mobile=false,reducedMotion=false){
 vi.stubGlobal('innerWidth',1440);vi.stubGlobal('innerHeight',900);
 pet=new SukiPet({base:'',skin:'day',label:'Suki',height:100,line:k=>k,mobile,reducedMotion} as PetOptions);
 const p=pet as unknown as {opts:PetOptions;tucked:boolean;side:string;flip:number;pos:{x:number;y:number};clipped:boolean;canvas:HTMLCanvasElement;touch:HTMLElement;el:HTMLElement;bubble:HTMLElement;hit:{w:number;h:number;data:Uint8ClampedArray;names:string[]};rig:{params:Record<string,number>;kick:()=>void;model:{nodes:object[];size:number[]}};driver:{state:{look:number[]|null;talking:boolean};update:()=>void};view:{draw:()=>void;readRect:()=>{px:Uint8Array;w:number;h:number}};tuck:(side:'left'|'right',silent?:boolean)=>void;peekAt:(side:'left'|'right',pos:{x:number;y:number})=>void;drop:(e:PointerEvent,d:{shake:number})=>void;frame:(dt:number,now:number)=>void;region:(e:PointerEvent)=>string|null;playActivity:()=>void;brain:()=>void};
 const px=new Uint8Array(10*10*4);for(let y=0;y<10;y++)for(let x=1;x<3;x++)px[(y*10+x)*4+3]=255;
 Object.assign(p.canvas.style,{width:'180px',height:'124px',left:'-40px',top:'-12px'});
 vi.spyOn(p.touch,'clientWidth','get').mockReturnValue(100);vi.spyOn(p.touch,'clientHeight','get').mockReturnValue(100);
 p.rig={params:{},kick:vi.fn(),model:{nodes:[],size:[100,100]}};
 p.driver={state:{look:null,talking:false},update:()=>{p.rig.params.BodyZ=0;p.rig.params.AngleZ=0;}};
 p.view={draw:vi.fn(),readRect:()=>({px,w:10,h:10})};
 vi.spyOn(p,'playActivity').mockImplementation(()=>{});vi.spyOn(p,'brain').mockImplementation(()=>{});
 document.body.append(p.el);p.pos={x:500,y:300};
 const settle=()=>{for(let i=0;i<40;i++)p.frame(.016,performance.now()+i*16);};
 return{p,settle};
}
it.each([false,true].flatMap(mobile=>['left','right'].flatMap(side=>[false,true].map(reduced=>({mobile,side,reduced})))))('uses the same inward-facing peek pose and mirrored contour ($mobile, $side, reduced=$reduced)',({mobile,side,reduced})=>{
 const {p,settle}=setup(mobile,reduced);const edge=side as 'left'|'right';
 if(mobile)p.peekAt(edge,{x:side==='left'?-52:1392,y:300});else p.tuck(edge,true);
 settle();
 expect(p.side).toBe(side);expect(p.flip).toBe(side==='left'?-1:1);
 expect(p.canvas.style.transform).toBe(side==='left'?'scaleX(-1)':'');
 expect(p.driver.state.look).toEqual([-.8,.1]);expect(p.rig.params.BodyZ).toBeLessThan(0);expect(p.rig.params.AngleZ).toBeLessThan(0);
 expect(p.touch.style.clipPath).toContain(side==='left'?'M70 0':'M10 0');
});
it.each([1,-1])('maps hit regions to the same rendered orientation as the canvas (flip=%s)',flip=>{
 const {p}=setup();p.flip=flip;p.hit={w:2,h:1,data:new Uint8ClampedArray([1,0,0,255,2,0,0,255]),names:['left-region','right-region']};
 vi.spyOn(p.touch,'getBoundingClientRect').mockReturnValue(new DOMRect(0,0,200,100));
 expect(p.region({clientX:25,clientY:50} as PointerEvent)).toBe(flip<0?'right-region':'left-region');
});
it('returns an inward desktop drag to normal orientation and removes its peek contour',()=>{
 const {p,settle}=setup();p.tuck('left',true);settle();p.pos={x:200,y:300};
 p.drop({clientX:250,clientY:350} as PointerEvent,{shake:0});settle();
 expect(p.tucked).toBe(false);expect(p.el.classList.contains('suki-pet--tucked')).toBe(false);
 expect(p.flip).toBe(1);expect(p.canvas.style.transform).toBe('');expect(p.touch.style.clipPath).toBe('');
});
it('preserves the user release position when dragging a right peek back inside',()=>{
 const {p,settle}=setup();p.tuck('right',true);p.pos={x:1220,y:585};
 p.drop({clientX:1270,clientY:635} as PointerEvent,{shake:0});settle();
 // The chosen release is no longer moved left.
 expect(p.tucked).toBe(false);expect(p.pos.x).toBe(1220);
});
