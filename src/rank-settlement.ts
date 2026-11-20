import type {RankWindow,RankZone,RankBand} from '../shared/rank-honors';
export const RANK_WINDOWS:RankWindow[]=['day','week','month'];
export const RANK_DURATION:Record<RankWindow,number>={day:86400000,week:7*86400000,month:30*86400000};
export const RANK_REWARDS:Record<RankWindow,Record<RankBand,number>>={day:{1:5000,3:2500,10:1000},week:{1:50000,3:25000,10:10000},month:{1:100000,3:50000,10:20000}};
const TAIPEI=8*3600000;
export const NOV_20_RANK_START = Date.parse('2026-11-20T00:00:00+08:00');
export const NOV_20_RANK_END = NOV_20_RANK_START + RANK_DURATION.day;

/** Invalid configuration is distinct from a deliberately disabled extension. */
export function nov20RankExtension(value: string | undefined): number | null {
  if (value === undefined || value === '0') return 0;
  if (!/^[1-9][0-9]*$/.test(value)) return null;
  const minutes = Number(value);
  const milliseconds = minutes * 60_000;
  // Harbor accepts a heat interval of at most 30 days.
  return minutes % 5 === 0 && milliseconds <= RANK_DURATION.month - RANK_DURATION.day
    ? milliseconds : null;
}

export function isNov20DailyCohort(cohortStart: number, window: RankWindow): boolean {
  return window === 'day' && cohortStart === NOV_20_RANK_START;
}
/** Heat v2 scores every period not yet settled when v2 shipped (Taipei): day 11-19, the week of 11-16 and November onward; settled periods keep their v1 scores. */
export const RANK_HEAT_V2_FROM:Record<RankWindow,number>={day:Date.parse('2026-11-19T00:00:00+08:00'),week:Date.parse('2026-11-16T00:00:00+08:00'),month:Date.parse('2026-11-01T00:00:00+08:00')};
/** The heat formula a card's window is scored with: decided by its cohort, so one period never mixes formulas. */
export function heatFormulaOf(publishedAt:number,window:RankWindow):'v2'|undefined{return cohortOf(publishedAt,window).at>=RANK_HEAT_V2_FROM[window]?'v2':undefined}
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
export function rankScoreWindow(publishedAt: number, window: RankWindow, nov20Extension: number) {
  const cohort = cohortOf(publishedAt, window);
  const extension = isNov20DailyCohort(cohort.at, window) ? nov20Extension : 0;
  const to = publishedAt + RANK_DURATION[window] + extension;
  return { to, due: Math.max(cohort.due, to) };
}
export interface RankEntrant {id:number;heat:number;talkNum:number;registeredAt:number;adult:boolean}
export function rankCohort<T extends RankEntrant>(cards:T[],zone:RankZone):(T&{rank:number;band:RankBand})[] {
 const entrants=cards.filter(c=>c.heat>0&&(zone==='all'||!c.adult));
 const limit=entrants.length<10?1:10;
 return entrants.filter(c=>c.heat>0).sort((a,b)=>b.heat-a.heat||b.talkNum-a.talkNum||b.registeredAt-a.registeredAt||b.id-a.id)
  .slice(0,limit).map((c,i)=>({...c,rank:i+1,band:i===0?1:i<3?3:10}));
}
