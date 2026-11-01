import {expect,it} from "vitest";
import {stickyRail,type Direction} from "../src/lib/sidebar-position";
const rail=(railTop:number,height:number,direction:Direction,parentHeight=5000)=>stickyRail({railTop,hostTop:-1000,height,parentHeight,top:84,bottom:520,viewport:600},direction);
it("short rail pins under the header with no spacer",()=>{
 expect(rail(84,300,"down")).toEqual({shift:0,top:"84px",bottom:"auto"});
 expect(rail(84,300,"up")).toEqual({shift:0,top:"84px",bottom:"auto"});
});
it("long rail keeps its place on reversal and pins the edge it travels toward",()=>{
 // Pinned at the bottom (520-800), reader scrolls up: it follows the page until its top reaches 84.
 expect(rail(-280,800,"up")).toEqual({shift:720,top:"auto",bottom:"-284px"});
 // Pinned at the top, reader scrolls down: it follows the page until its end reaches 520.
 expect(rail(84,800,"down")).toEqual({shift:1084,top:"-280px",bottom:"auto"});
});
it("spacer never pushes the rail out of its host",()=>{
 expect(rail(500,800,"down",1500).shift).toBe(700);
 expect(rail(-1200,800,"up").shift).toBe(0);
});
