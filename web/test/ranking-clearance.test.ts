import {afterEach,expect,it,vi} from 'vitest';
import {rankingClearance} from '../src/pet/ranking-clearance';
import {nearestClearPetY} from '../src/pet/home-clearance';
afterEach(()=>{document.body.innerHTML='';vi.unstubAllGlobals()});
it('keeps the fixed card action clear after scrolling past comments and versions',()=>{
 vi.stubGlobal('innerHeight',844);document.body.innerHTML='<main class="page role"><section id="comments"></section><section class="version-history"></section><div class="role__cta"></div></main>';
 for(const el of document.querySelectorAll<HTMLElement>('#comments,.version-history'))el.getBoundingClientRect=()=>({left:16,right:374,top:-400,bottom:-100,width:358,height:300} as DOMRect);
 document.querySelector<HTMLElement>('.role__cta')!.getBoundingClientRect=()=>({left:0,right:390,top:776,bottom:844,width:390,height:68} as DOMRect);
 const clearance=rankingClearance();expect(clearance).not.toBeNull();
 const y=nearestClearPetY({...clearance!,left:342,right:430,height:132,original:692,current:692});
 expect(y===null||y+132+8<=776).toBe(true);
 document.querySelector<HTMLElement>('.role__cta')!.getBoundingClientRect=()=>({left:0,right:0,top:0,bottom:0,width:0,height:0} as DOMRect);
 expect(rankingClearance()).toBeNull();
});
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
it('keeps card comments and version actions protected when the compact ranking is outside the viewport',()=>{
 vi.stubGlobal('innerHeight',844);document.body.innerHTML='<main class="page role"><section id="comments"><div class="panel"></div></section><section class="version-history"></section></main>';
 const comments=document.querySelector<HTMLElement>('#comments')!,versions=document.querySelector<HTMLElement>('.version-history')!;let commentTop=420,versionTop=950;
 comments.getBoundingClientRect=()=>({left:16,right:374,top:commentTop,bottom:commentTop+340,width:358,height:340} as DOMRect);
 versions.getBoundingClientRect=()=>({left:16,right:374,top:versionTop,bottom:versionTop+120,width:358,height:120} as DOMRect);
 expect(rankingClearance()?.obstacles.some(r=>r.top===420&&r.bottom===760)).toBe(true);
 const frame={left:335,right:390,height:132,original:650,current:650};expect(nearestClearPetY({...rankingClearance()!,...frame})).not.toBe(650);
 commentTop=950;versionTop=170;expect(rankingClearance()?.obstacles.some(r=>r.top===170&&r.bottom===290)).toBe(true);
 versionTop=950;expect(rankingClearance()).toBeNull();
});
