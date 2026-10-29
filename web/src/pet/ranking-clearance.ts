import type {PhoneClearance} from './home-clearance';

/** Ranking data and privacy limits stay readable while the enabled pet makes room. */
export function rankingClearance():PhoneClearance|null {
 const anchors=[...document.querySelectorAll<HTMLElement>('#leaderboard-privacy,.spend-summary,.page.role .spend-mobile,.page.role #comments,.page.role .version-history,.page.role .role__cta')].filter(el=>{const r=el.getBoundingClientRect();return r.width>1&&r.height>1&&r.bottom>0&&r.top<innerHeight;});
 if(!anchors.length)return null;
 // Relocation must not solve the new overlap by landing on an adjacent panel.
 const elements=new Set(anchors.flatMap(el=>[el,...(el.closest('.page')?.querySelectorAll<HTMLElement>('.panel')??[])]));
 const obstacles=[...elements].flatMap(el=>{
  const r=el.getBoundingClientRect();
  return r.width>1&&r.height>1&&r.bottom>0&&r.top<innerHeight?[{left:r.left,right:r.right,top:r.top,bottom:r.bottom}]:[];
 });
 if(!obstacles.length)return null;
 return {top:document.querySelector('.header')?.getBoundingClientRect().bottom??60,bottom:innerHeight,obstacles};
}
