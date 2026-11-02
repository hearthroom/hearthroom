import type {RankWindow,RankZone,RankBand} from '../shared/rank-honors';
export const RANK_WINDOWS:RankWindow[]=['day','week','month'];
export const RANK_DURATION:Record<RankWindow,number>={day:86400000,week:7*86400000,month:30*86400000};
export const RANK_REWARDS:Record<RankWindow,Record<RankBand,number>>={day:{1:5000,3:2500,10:1000},week:{1:50000,3:25000,10:10000},month:{1:100000,3:50000,10:20000}};
const TAIPEI=8*3600000;
/** Calendar membership is Taipei-based; each card's scoring interval has fixed duration. */
export function cohortOf(at:number,window:RankWindow) {
 const d=new Date(at+TAIPEI);d.setUTCHours(0,0,0,0);
 if(window==='week')d.setUTCDate(d.getUTCDate()-((d.getUTCDay()+6)%7));
 if(window==='month')d.setUTCDate(1);
 const start=d.getTime()-TAIPEI;
 if(window==='month')d.setUTCMonth(d.getUTCMonth()+1);else d.setUTCDate(d.getUTCDate()+(window==='week'?7:1));
 const end=d.getTime()-TAIPEI;
 const maturityDay=new Date(at+RANK_DURATION[window]+TAIPEI);maturityDay.setUTCHours(0,0,0,0);maturityDay.setUTCDate(maturityDay.getUTCDate()+1);
 return {at:start,end,due:maturityDay.getTime()-TAIPEI};
}
export interface RankEntrant {id:number;heat:number;talkNum:number;registeredAt:number;adult:boolean}
export function rankCohort<T extends RankEntrant>(cards:T[],zone:RankZone):(T&{rank:number;band:RankBand})[] {
 const entrants=cards.filter(c=>c.heat>0&&(zone==='all'||!c.adult));
 const limit=entrants.length<10?1:10;
 return entrants.filter(c=>c.heat>0).sort((a,b)=>b.heat-a.heat||b.talkNum-a.talkNum||b.registeredAt-a.registeredAt||b.id-a.id)
  .slice(0,limit).map((c,i)=>({...c,rank:i+1,band:i===0?1:i<3?3:10}));
}
