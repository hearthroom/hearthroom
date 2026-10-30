import {expect,it} from 'vitest';
import {nearestClearPetY} from '../src/pet/home-clearance';
const frame={left:326,right:414,height:132,top:121,bottom:836,original:478,current:478};
it('keeps the original safe spot and otherwise preserves an already safe temporary spot',()=>{
 expect(nearestClearPetY({...frame,obstacles:[{left:0,right:300,top:100,bottom:800}]})).toBe(478);
 expect(nearestClearPetY({...frame,current:690,obstacles:[{left:0,right:390,top:400,bottom:680}]})).toBe(690);
});
it('moves the whole pet and catch outside content with eight pixels of clearance',()=>{
 expect(nearestClearPetY({...frame,obstacles:[{left:0,right:390,top:400,bottom:800}]})).toBe(260);
});
it('returns no passive location when hero, controls and card links fill the side',()=>{
 expect(nearestClearPetY({...frame,obstacles:[{left:16,right:374,top:185,bottom:407},{left:16,right:374,top:432,bottom:780},{left:16,right:374,top:791,bottom:1200}]})).toBeNull();
});
it('uses the current viewport and protects body width as well as the catcher',()=>{
 expect(nearestClearPetY({...frame,left:250,right:390,height:220,bottom:600,obstacles:[{left:250,right:280,top:150,bottom:600}]})).toBeNull();
});

// PM 2026-10-30（desk-pet-mobile-overlap 第二班 B）：首頁只讓可點的東西與封面圖；段落、標題、首頁面板不再算，
// 她在首頁頂部與頁尾看得到、拖得到。可點的東西由 standby-clearance 的 phoneControls 併進來。
it('protects cover art even when the carousel uses a boxless wrapper, and no longer text or the home panel',async()=>{
 const {homePhoneObstacles}=await import('../src/pet/home-clearance');
 const page=document.createElement('div');page.className='board-page';
 page.innerHTML='<div style="display:contents"><div class="carousel"><img class="carousel__img"></div></div><section class="home"></section><p class="lede"></p><main class="board-main"><article class="card"><div class="card__art"></div></article><h2></h2></main>';
 document.body.append(page);
 const box=(sel:string,r:DOMRect)=>{page.querySelector<HTMLElement>(sel)!.getBoundingClientRect=()=>r;};
 box('.carousel__img',new DOMRect(16,120,358,180));box('.card__art',new DOMRect(16,500,171,228));
 box('.home',new DOMRect(16,185,358,222));box('.lede',new DOMRect(16,420,358,40));box('h2',new DOMRect(16,460,358,30));
 expect(homePhoneObstacles()).toEqual([{left:16,right:374,top:120,bottom:300},{left:16,right:187,top:500,bottom:728}]);
 page.remove();
});

it('keeps the tablet lane ahead of the phone/coarse policy',async()=>{
 const {homePhoneMode}=await import('../src/pet/home-clearance');
 expect(homePhoneMode(390,false)).toBe(true);expect(homePhoneMode(768,true)).toBe(false);
 expect(homePhoneMode(1080,true)).toBe(true);expect(homePhoneMode(1080,false)).toBe(false);
});

it('keeps a safe temporary location when the original slot becomes free again',()=>{
 expect(nearestClearPetY({...frame,current:690,obstacles:[]})).toBe(690);
});
