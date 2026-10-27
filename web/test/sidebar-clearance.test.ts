import { expect, it } from 'vitest';
import { sidebarClearance } from '../src/lib/sidebar-clearance';
const bounds={left:1032,right:1296,top:84,bottom:884};
it('only shortens the sidebar when a visible obstacle intersects its horizontal and vertical range',()=>{
 expect(sidebarClearance(bounds,[])).toEqual({top:84,bottom:884});
 expect(sidebarClearance(bounds,[{left:1300,right:1440,top:624,bottom:686}])).toEqual({top:84,bottom:884});
 expect(sidebarClearance(bounds,[{left:1148,right:1408,top:624,bottom:686}])).toEqual({top:84,bottom:612});
});
it('uses the highest intersecting obstacle, and restores the original range once obstacles leave',()=>{
 const bubble={left:1148,right:1408,top:624,bottom:686},body={left:1250,right:1400,top:680,bottom:900};
 expect(sidebarClearance(bounds,[body,bubble])).toEqual({top:84,bottom:612});
 expect(sidebarClearance(bounds,[body])).toEqual({top:84,bottom:668});
 expect(sidebarClearance(bounds,[])).toEqual({top:84,bottom:884});
});

it('uses the lower clear range only when the upper range cannot fit a complete row',()=>{
 expect(sidebarClearance(bounds,[{left:1148,right:1408,top:90,bottom:360}])).toEqual({top:372,bottom:884});
});
it('reports an impossible region rather than creating negative or zero-height controls',()=>{
 expect(sidebarClearance(bounds,[{left:1148,right:1408,top:20,bottom:900}])).toEqual({top:84,bottom:884,blocked:true});
});
