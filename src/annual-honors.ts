import type {Env} from './types';
import type {RankZone} from '../shared/rank-honors';
import {ANNUAL_CROWN_REWARD,ANNUAL_FIRST_YEAR,ANNUAL_POINTS,ANNUAL_TOP,annualBadgeKey,annualSettlesAt,annualYearOf,annualYearRange,type AnnualBoard,type AnnualStanding} from '../shared/annual-honors';
import {cohortOf,RANK_WINDOWS} from './rank-settlement';
import {periodOf} from './rank-awards';
import {bumpOp} from './ops-metrics';
import {cardRewardTransport} from './card-reward-service';

export interface AnnualRow extends AnnualStanding {memberId:string|null;accountNo:number;reachedAt:number}
type AwardRow={member_id:string|null;account_no:number;window:'day'|'week'|'month';band:1|3|10;awarded_at:number;handle:string|null;display_name:string|null;avatar_url:string|null;author_name:string|null;author_avatar:string|null};
const ZONES:RankZone[]=['clean','all'];
/** 月榜從 10 月起才有；日、週榜從 9 月 24 日起。與 rank-maintenance 的 RANK_START／RANK_MONTH_START 一致。 */
const WINDOW_START={day:Date.parse('2026-09-24T00:00:00+08:00'),week:Date.parse('2026-09-24T00:00:00+08:00'),month:Date.parse('2026-10-01T00:00:00+08:00')};

/**
 * 作者的年度積分：當年首次發布的作品拿到的每一枚榮譽換分加總。作者以社群成員為準（帳號連結過的合成一位），
 * 沒有成員列的以發獎時的公開編號為準。同分先比第一名次數、再比前三次數、再比誰先達到最終分數。
 */
export async function annualStandings(env:Env,year:number,zone:RankZone):Promise<AnnualRow[]>{
 const {start,end}=annualYearRange(year);
 const rows=(await env.DB.prepare(`SELECT a.member_id,a.account_no,a.window,a.band,a.awarded_at,m.handle,m.display_name,m.avatar_url,c.author_name,c.author_avatar
  FROM rank_awards a JOIN rank_publications p ON p.card_id=a.card_id LEFT JOIN members m ON m.id=a.member_id LEFT JOIN cards c ON c.id=a.card_id
  WHERE a.zone=? AND p.published_at>=? AND p.published_at<? ORDER BY a.awarded_at,a.id`).bind(zone,start,end).all<AwardRow>()).results;
 const byAuthor=new Map<string,AnnualRow>();
 for(const r of rows){
  const key=r.member_id??`#${r.account_no}`;
  let s=byAuthor.get(key);
  if(!s){s={rank:0,points:0,firsts:0,top3:0,reachedAt:0,memberId:r.member_id,accountNo:r.account_no,author:{handle:null,name:'',avatar:''}};byAuthor.set(key,s);}
  s.points+=ANNUAL_POINTS[r.window][r.band];
  if(r.band===1)s.firsts++;
  if(r.band<=3)s.top3++;
  // 依發獎時間排序讀進來：最後一筆就是達到最終分數的時刻，帳號也取最新那筆的收款編號
  s.reachedAt=r.awarded_at;s.accountNo=r.account_no;
  s.author={handle:r.handle??null,name:r.display_name??r.author_name??s.author.name,avatar:(r.display_name?r.avatar_url:r.author_avatar)??s.author.avatar};
 }
 return [...byAuthor.values()].sort((x,y)=>y.points-x.points||y.firsts-x.firsts||y.top3-x.top3||x.reachedAt-y.reachedAt||x.accountNo-y.accountNo)
  .map((s,i)=>({...s,rank:i+1}));
}
const publicItem=({rank,points,firsts,top3,author}:AnnualRow):AnnualStanding=>({rank,points,firsts,top3,author});

export async function annualBoard(env:Env,year:number,zone:RankZone,limit=50):Promise<AnnualBoard>{
 const settled=await env.DB.prepare('SELECT snapshot FROM annual_settlements WHERE year=? AND zone=?').bind(year,zone).first<string>('snapshot');
 const items=settled?(JSON.parse(settled) as AnnualStanding[]):(await annualStandings(env,year,zone)).map(publicItem);
 return {year,zone,settled:!!settled,settlesAt:annualSettlesAt(year),items:items.slice(0,limit)};
}
export const isAnnualYear=(year:number,now=Date.now())=>Number.isSafeInteger(year)&&year>=ANNUAL_FIRST_YEAR&&year<=annualYearOf(now);

/** 一年的作品所屬的每一期（日、週、月）在兩個榜都結算了，年度才算得完。 */
async function yearComplete(env:Env,year:number,published:number[]):Promise<boolean>{
 const settled=new Set((await env.DB.prepare('SELECT zone,window,period FROM rank_settlements').all<{zone:string;window:string;period:string}>()).results.map(r=>`${r.zone}:${r.window}:${r.period}`));
 const {start,end}=annualYearRange(year);
 for(const at of published){
  if(at<start||at>=end)continue;
  for(const window of RANK_WINDOWS){
   if(at<WINDOW_START[window])continue;
   const period=periodOf(cohortOf(at,window).at);
   if(ZONES.some(z=>!settled.has(`${z}:${window}:${period}`)))return false;
  }
 }
 return true;
}

/**
 * 年度結算：2 月 1 日（台北）之後、當年所有期別都結算完，才把前十名定案。重跑冪等：同一年、同一榜只寫一次。
 * `published` 是目前有資格上榜的作品首次發布時間（rank-maintenance 的 eligibleRankRows）。
 */
export async function annualMaintenance(env:Env,now:number,published:{published_at:number}[]):Promise<void>{
 for(let year=ANNUAL_FIRST_YEAR;annualSettlesAt(year)<=now;year++){
  const done=new Set((await env.DB.prepare('SELECT zone FROM annual_settlements WHERE year=?').bind(year).all<{zone:string}>()).results.map(r=>r.zone));
  if(ZONES.every(z=>done.has(z)))continue;
  if(!await yearComplete(env,year,published.map(p=>p.published_at))){await bumpOp(env.DB,'rank_settlement','year','pending');continue;}
  for(const zone of ZONES){
   if(done.has(zone))continue;
   const top=(await annualStandings(env,year,zone)).slice(0,ANNUAL_TOP);
   const receipt=crypto.randomUUID();
   const guard='EXISTS(SELECT 1 FROM annual_settlements WHERE year=? AND zone=? AND receipt=?)';
   const writes=[env.DB.prepare('INSERT OR IGNORE INTO annual_settlements(year,zone,settled_at,receipt,snapshot) VALUES(?,?,?,?,?)').bind(year,zone,now,receipt,JSON.stringify(top.map(publicItem)))];
   for(const s of top){
    const amount=s.rank===1?ANNUAL_CROWN_REWARD:0;
    writes.push(env.DB.prepare(`INSERT OR IGNORE INTO annual_awards(id,year,zone,rank,member_id,account_no,points,amount,awarded_at,status) SELECT ?,?,?,?,?,?,?,?,?,? WHERE ${guard}`)
     .bind(`annual-${zone}-${year}-${s.rank}`,year,zone,s.rank,s.memberId,s.accountNo,s.points,amount,now,amount?'pending':'none',year,zone,receipt));
    if(s.memberId)writes.push(env.DB.prepare(`INSERT OR IGNORE INTO community_awards(member_id,badge,source,created_at) SELECT ?,?,'annual-v1',? WHERE ${guard}
     AND EXISTS(SELECT 1 FROM community_badge_definitions WHERE key=?)`).bind(s.memberId,annualBadgeKey(zone,year,s.rank===1?1:10),now,year,zone,receipt,annualBadgeKey(zone,year,s.rank===1?1:10)));
   }
   const [saved]=await env.DB.batch(writes);
   if(saved.meta.changes)await bumpOp(env.DB,'rank_settlement','year','success');
  }
 }
}

/** 年冠獎金走榜單獎池，鍵固定（annual-<zone>-<year>），重試只會入帳一次。 */
export async function annualPaymentMaintenance(env:Env,now=Date.now()):Promise<void>{
 const rows=(await env.DB.prepare(`SELECT id,year,zone,account_no,amount,attempted_at FROM annual_awards WHERE status='pending'
  AND (attempted_at IS NULL OR attempted_at+MIN(3600000,60000*(1<<MIN(MAX(attempts-1,0),6)))<=?) ORDER BY attempted_at IS NOT NULL,attempted_at,id LIMIT 2`).bind(now)
  .all<{id:string;year:number;zone:RankZone;account_no:number;amount:number;attempted_at:number|null}>()).results;
 if(!rows.length)return;
 const {rankTransport}=await import('./rank-maintenance');
 let token:string;try{token=await cardRewardTransport.token(env)}catch{await bumpOp(env.DB,'rank_settlement','payout','pending');return;}
 for(const row of rows){
  const claim=await env.DB.prepare("UPDATE annual_awards SET attempts=attempts+1,attempted_at=? WHERE id=? AND status='pending' AND attempted_at IS ?").bind(now,row.id,row.attempted_at).run();if(!claim.meta.changes)continue;
  const key=`annual-${row.zone}-${row.year}`;
  try{
   const paid=await rankTransport.pay(env,token,{key,accountNo:row.account_no,amount:row.amount,campaignRef:`annual:${row.zone}:${row.year}`,contentRef:`year:${row.year}`});
   if(paid.key!==key||paid.accountNo!==row.account_no||paid.amount!==row.amount)throw new Error('annual_payment_mismatch');
   const saved=await env.DB.prepare("UPDATE annual_awards SET status='paid',paid_at=? WHERE id=? AND status='pending'").bind(now,row.id).run();
   if(saved.meta.changes)await bumpOp(env.DB,'rank_settlement','payout','success');
  }catch{await bumpOp(env.DB,'rank_settlement','payout','pending');}
 }
}
