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
/** Coarse geometry protects entire content surfaces, including hero art and card links. */
export function homePhoneObstacles():SidebarRect[] {
 const selectors=['.board-page > :not(.board-layout)','.board-page .home','.board-page .welcome','.board-page .carousel','.board-page :is(a,button,input,textarea,select,p,h1,h2,h3,summary)','.board-main .sorts','.board-main .discovery-tags','.board-main .count-row','.board-main .card','.board-main .ghost','.board-main .empty','.board-main .notice','.board-main .stream-end','.board-main p','.board-main h2','.checkin-hint','.mobile-library-nav','.footer__inner','.home-sidebar'];
 return [...document.querySelectorAll<HTMLElement>(selectors.join(','))].flatMap(el=>{
  const r=el.getBoundingClientRect();return r.width>1&&r.height>1&&r.bottom>0&&r.top<innerHeight?[{left:r.left,right:r.right,top:r.top,bottom:r.bottom}]:[];
 });
}

/** Keep the approved tablet lane ahead of the existing coarse/phone caller. */
export const homePhoneMode=(width:number,coarse:boolean)=>(width<640||coarse)&&!(width>=640&&width<1080);
