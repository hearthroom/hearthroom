import type {SidebarRect} from '../lib/sidebar-clearance';
import type {PhoneClearance} from './home-clearance';
import type {Side} from './placement';

/**
 * 手機待機（探出）時不蓋住可點的東西（任務 2026-10-30 desk-pet-mobile-overlap）。
 * 390 寬的列表頁，列尾按鈕右緣在 358（頁邊 16＋面板內距 16），探出時 64 寬的接觸區（326–390）整個蓋住它，
 * 玩家點「更多操作」點到的是她。所以底下有可點的東西時，先在原高度把露出寬度連同接觸區縮到離它 8px；
 * 縮到 MIN_REACH 還碰到才換高度；都不行才暫時退場（沿用 phone-suspended）。
 * 先縮不先搬：捲動列表時每一列都有按鈕，換高度永遠找不到空位，只會一路閃；縮著不動比較安靜。
 * 縮窄時露出的全在曲面屏的不可點帶裡（390 寬只剩 358–390），曲面屏上點不到她；平面屏照常可點可拖，
 * 曲面屏靠選單與設定頁的「叫她出來」。
 */

/** 縮到這麼窄還碰到就不縮了：再窄只剩一條頭髮，認不出是她 */
export const MIN_REACH = 20;
/** 她和可點的東西之間至少留這麼多（與 nearestClearPetY 同一個數字） */
const GAP = 8;

/**
 * 待機的高度與露出寬度。reach＝她和接觸區從螢幕邊算起占多寬，null＝照舊（full）。回傳 null＝沒有地方，暫時退場。
 * original 是使用者選的高度，current 是她現在的高度：使用者的高度空出來就回去；否則留在現在的高度（原寬優先，
 * 再試縮窄），最後才找最近的空位。
 */
export function standbySpot(f:{w:number;side:Side;top:number;bottom:number;obstacles:SidebarRect[];height:number;full:number;original:number;current:number}):{y:number;reach:number|null}|null {
 const min=f.top+GAP,max=f.bottom-f.height-GAP;if(max<min)return null;
 const fits=(y:number)=>y>=min&&y<=max;
 // 在高度 y 時，從螢幕邊到最近一個上下重疊的東西還有多寬
 const room=(y:number)=>Math.floor(Math.min(f.full,...f.obstacles.filter(r=>r.bottom+GAP>y&&r.top-GAP<y+f.height).map(r=>f.side==='right'?f.w-r.right-GAP:r.left-GAP)));
 const pick=(ys:number[])=>{
  for(const y of ys)if(fits(y)&&room(y)>=f.full)return {y,reach:null};
  for(const y of ys)if(fits(y)&&room(y)>=MIN_REACH)return {y,reach:room(y)};
  return null;
 };
 if(fits(f.original)&&room(f.original)>=f.full)return {y:f.original,reach:null};
 const stay=pick([f.current,f.original]);if(stay)return stay;
 const near=[min,max,...f.obstacles.flatMap(r=>[r.top-f.height-GAP,r.bottom+GAP])].filter(fits).sort((a,b)=>Math.abs(a-f.current)-Math.abs(b-f.current));
 return pick(near);
}

// article.card：卡片整張可點，但連結本身只有標題（用 ::after 撐滿整張卡），量連結量不到整張卡
/**
 * 桌機站著時（PM 2026-10-30 第三班 A）：她的身體壓到可點的東西或關鍵數字，就沿現在這一排左右挪到最近的空位。
 * 回傳 x；null＝這一排沒有空位，暫時淡出。original 是她自己走到或使用者拖到的位置：空出來就回去。
 */
export function deskSpot(f:{minX:number;maxX:number;y:number;w:number;h:number;obstacles:SidebarRect[];original:number;current:number}):number|null {
 const row=f.obstacles.filter(r=>r.bottom+GAP>f.y&&r.top-GAP<f.y+f.h);
 const safe=(x:number)=>x>=f.minX&&x<=f.maxX&&row.every(r=>x+f.w+GAP<=r.left||x>=r.right+GAP);
 if(safe(f.original))return f.original;
 if(safe(f.current))return f.current;
 return [f.minX,f.maxX,...row.flatMap(r=>[r.left-f.w-GAP,r.right+GAP])].filter(safe).sort((a,b)=>Math.abs(a-f.current)-Math.abs(b-f.current))[0]??null;
}

const CONTROLS='a[href],button,input,select,textarea,summary,label,[role=button],[role=link],[role=switch],[role=checkbox],[role=tab],[tabindex]:not([tabindex="-1"]),article.card,[data-pet-avoid]';
const OWN='.suki-pet,.suki-pet__catch,.suki-pet__tab,.suki-pet__idle';

/**
 * 關鍵數字（data-pet-avoid）不能點，但要看得到；它們常是撐滿整格、靠右對齊的格子，量外框會把整格算進去，
 * 所以量字本身（Range），量不到才退回外框。
 */
function extent(el:HTMLElement):DOMRect {
 if(el.hasAttribute('data-pet-avoid')){
  const range=document.createRange();range.selectNodeContents(el);
  const r=range.getBoundingClientRect();if(r.width>1&&r.height>1)return r;
 }
 return el.getBoundingClientRect();
}

let key='',at=0,cache:PhoneClearance|null=null;
/**
 * 畫面上看得到、點得到的控制項，加上標了 data-pet-avoid 的關鍵數字（手機與桌機的讓路共用）。每一格都會問：捲動中最多每 100ms 重讀一次（慣性捲動時每格量整頁太貴），
 * 捲動、視窗、頁面高度都沒變時半秒重讀一次（清單非同步載入會改頁面高度，展開收合不一定會）。
 */
export function phoneControls():PhoneClearance|null {
 const now=performance.now(),k=[location.pathname,scrollY,innerWidth,innerHeight,document.documentElement.scrollHeight].join(':');
 if(cache&&now-at<(k===key?500:100))return cache;
 key=k;at=now;
 const obstacles=[...document.querySelectorAll<HTMLElement>(CONTROLS)].flatMap(el=>{
  if(el.closest(OWN)||el.closest('[inert]')||(el as HTMLButtonElement).disabled)return [];
  const r=extent(el);
  if(r.width<=1||r.height<=1||r.bottom<=0||r.top>=innerHeight)return [];
  const cs=getComputedStyle(el);
  if(cs.pointerEvents==='none'||cs.visibility==='hidden')return [];
  return [{left:r.left,right:r.right,top:r.top,bottom:r.bottom}];
 });
 cache={top:document.querySelector('.header')?.getBoundingClientRect().bottom??60,bottom:innerHeight,obstacles};
 return cache;
}
