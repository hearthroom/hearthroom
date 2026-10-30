import type {SidebarRect} from '../lib/sidebar-clearance';
export interface PhoneClearance {top:number;bottom:number;obstacles:SidebarRect[]}
/** Keep the current safe location; otherwise use the nearest full-height gap on the same side. */
export function nearestClearPetY(f:PhoneClearance & {left:number;right:number;height:number;original:number;current:number}):number|null {
 const min=f.top+8,max=f.bottom-f.height-8;if(max<min)return null;
 const obstacles=f.obstacles.filter(r=>r.right+8>f.left&&r.left-8<f.right&&r.bottom>f.top&&r.top<f.bottom);
 const safe=(y:number)=>y>=min&&y<=max&&obstacles.every(r=>y+f.height+8<=r.top||y>=r.bottom+8);
 if(safe(f.current))return f.current;if(safe(f.original))return f.original;
 const candidates=[min,max,...obstacles.flatMap(r=>[r.top-f.height-8,r.bottom+8])].filter(safe);
 return candidates.sort((a,b)=>Math.abs(a-f.current)-Math.abs(b-f.current))[0]??null;
}
/**
 * 首頁手機上她只讓封面圖；可點的東西（含整張卡片）由 SukiPet 的 withControls 併進來（standby-clearance.ts）。
 * 原本連段落、標題、首頁面板都算，她在首頁從頭到尾都淡出；PM 2026-10-30（desk-pet-mobile-overlap 第二班 B）
 * 改成只讓可點與封面：卡片區照樣淡出，頂部與頁尾看得到、拖得到。
 */
export function homePhoneObstacles():SidebarRect[] {
 // 側欄（觸控寬螢幕）整塊照舊：幾乎都是入口，sticky 時會自己移動，首頁任務已簽過這個做法
 const selectors=['.board-page .carousel__img','.board-main .card__art','.home-sidebar'];
 return [...document.querySelectorAll<HTMLElement>(selectors.join(','))].flatMap(el=>{
  const r=el.getBoundingClientRect();return r.width>1&&r.height>1&&r.bottom>0&&r.top<innerHeight?[{left:r.left,right:r.right,top:r.top,bottom:r.bottom}]:[];
 });
}

/** 手機與觸控平板走手機避讓（跟其他頁一樣；首頁不另留平板的小頭像通道，owner 2026-10-30） */
export const homePhoneMode=(width:number,coarse:boolean)=>width<640||coarse;
