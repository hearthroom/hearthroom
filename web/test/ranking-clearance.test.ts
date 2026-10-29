import {afterEach,expect,it,vi} from 'vitest';
import {rankingClearance} from '../src/pet/ranking-clearance';
import {nearestClearPetY} from '../src/pet/home-clearance';
afterEach(()=>{document.body.innerHTML='';vi.unstubAllGlobals()});
it('uses current privacy geometry after async height changes and releases it offscreen',()=>{
 vi.stubGlobal('innerHeight',844);document.body.innerHTML='<section id="leaderboard-privacy"></section>';
 const panel=document.querySelector('section')!;let bottom=500;
 panel.getBoundingClientRect=()=>({left:16,right:374,top:170,bottom,width:358,height:bottom-170} as DOMRect);
 const frame={left:335,right:390,height:132,original:650,current:650};
 expect(nearestClearPetY({...rankingClearance()!,...frame})).toBe(650);
 bottom=844;expect(nearestClearPetY({...rankingClearance()!,...frame})).toBeNull();
 panel.getBoundingClientRect=()=>({left:16,right:374,top:900,bottom:1000,width:358,height:100} as DOMRect);
 expect(rankingClearance()).toBeNull();
});
it('protects the desktop compact board and ignores its hidden mobile duplicate',()=>{
 vi.stubGlobal('innerHeight',900);document.body.innerHTML='<section class="spend-summary"></section>';
 const panel=document.querySelector('section')!;
 panel.getBoundingClientRect=()=>({left:550,right:805,top:450,bottom:850,width:255,height:400} as DOMRect);
 expect(rankingClearance()?.obstacles).toHaveLength(1);
 panel.getBoundingClientRect=()=>({left:0,right:0,top:0,bottom:0,width:0,height:0} as DOMRect);
 expect(rankingClearance()).toBeNull();
});
