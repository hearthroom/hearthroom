import {expect,it} from "vitest";
import {sidebarPosition,type SidebarPosition} from "../src/lib/sidebar-position";
const measure=(y:number,height=800,parentHeight=5000,prev?:SidebarPosition)=>sidebarPosition({scrollY:y,naturalTop:500-y,height,parentHeight,top:84,bottom:520},prev);
it("long rail travels naturally, pins bottom, reverses continuously, then pins top",()=>{
 let p=measure(0); expect(p.top).toBe(500);
 p=measure(650,800,5000,p);expect(p.top).toBe(-150);
 p=measure(1300,800,5000,p);expect(p.top).toBe(-280);
 p=measure(1950,800,5000,p);expect(p.top).toBe(-280);
 p=measure(1850,800,5000,p);expect(p.top).toBe(-180);
 p=measure(1350,800,5000,p);expect(p.top).toBe(84);
});
it("short rail pins top and never extends past a shorter parent",()=>{
 expect(measure(700,200).top).toBe(84);
 const p=measure(1200,200,850);expect(p.top+p.height).toBe(150);
});
it("resize and async size changes keep position then clamp to available geometry",()=>{
 let p=measure(1300);p=measure(1300,600,5000,p);expect(p.top).toBe(-80);
 p=measure(1300,200,5000,p);expect(p.top).toBe(84);
});
