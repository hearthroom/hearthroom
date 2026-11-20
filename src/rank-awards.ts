import {HttpError,type Env} from './types';
import type {RankZone,RankWindow} from '../shared/rank-honors';
import {cohortOf,isNov20DailyCohort,nov20RankExtension,rankCohort,rankScoreWindow,RANK_REWARDS,type RankEntrant} from './rank-settlement';
import {bumpOp} from './ops-metrics';
export interface AwardEntrant extends RankEntrant {memberId:string|null;accountNo:number;payoutHold?:boolean}
export interface RankSnapshotInput {zone:RankZone;window:RankWindow;period:string;now:number;cards:AwardEntrant[];excludedCardIds?:number[]}
export interface RankSupplementInput extends RankSnapshotInput {supplementKey:string;entrantCutoff:number}
export const periodOf=(at:number)=>new Date(at+8*3600000).toISOString().slice(0,10);
function validateSnapshotInput(env:Env,input:RankSnapshotInput){
 const {window,period,now,cards}=input;
 const cohort=cohortOf(Date.parse(`${period}T00:00:00+08:00`),window);
 if(!Number.isFinite(cohort.at)||periodOf(cohort.at)!==period||new Set(cards.map(c=>c.id)).size!==cards.length||cards.some(c=>periodOf(cohortOf(c.registeredAt,window).at)!==period||!Number.isSafeInteger(c.heat)||c.heat<0))throw new HttpError(400,'rank_invalid_snapshot');
 const extension=nov20RankExtension(env.NOV_20_DAILY_RANK_EXTENSION_MINUTES);
 if(extension===null&&isNov20DailyCohort(cohort.at,window))throw new HttpError(409,'rank_invalid_extension');
 if(cards.some(c=>now<rankScoreWindow(c.registeredAt,window,extension??0).due)||(!cards.length&&now<rankScoreWindow(cohort.at,window,extension??0).due))throw new HttpError(409,'rank_not_due');
}
export async function settleRankSnapshot(env:Env,input:RankSnapshotInput):Promise<void>{
 validateSnapshotInput(env,input);
 const {zone,window,period,now,cards}=input;
 const receipt=crypto.randomUUID(),winners=rankCohort(cards,zone);
 const writes=[env.DB.prepare('INSERT OR IGNORE INTO rank_settlements(zone,window,period,settled_at,receipt,snapshot) VALUES(?,?,?,?,?,?)').bind(zone,window,period,now,receipt,JSON.stringify({cards,excludedCardIds:input.excludedCardIds??[]}))];
 for(const c of winners){writes.push(env.DB.prepare(`INSERT OR IGNORE INTO rank_awards(id,card_id,zone,window,period,rank,band,member_id,account_no,amount,awarded_at,payout_hold)
  SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM rank_settlements WHERE zone=? AND window=? AND period=? AND receipt=?)`)
  .bind(`rank-${zone}-${window}-${period}-${c.id}`,c.id,zone,window,period,c.rank,c.band,c.memberId,c.accountNo,RANK_REWARDS[window][c.band],now,c.payoutHold?1:0,zone,window,period,receipt));
  if(c.memberId)writes.push(env.DB.prepare(`INSERT OR IGNORE INTO community_awards(member_id,badge,source,created_at)
   SELECT ?,?,'rank-v1',? WHERE EXISTS(SELECT 1 FROM rank_settlements WHERE zone=? AND window=? AND period=? AND receipt=?)`)
   .bind(c.memberId,`rank_${zone}_${window}_${c.band}`,now,zone,window,period,receipt));
 }
 const [saved]=await env.DB.batch(writes);
 if(saved.meta.changes)await bumpOp(env.DB,'rank_settlement',window,'success');
}
export async function supplementRankSnapshot(env:Env,input:RankSupplementInput):Promise<void>{
 validateSnapshotInput(env,input);
 const {supplementKey,entrantCutoff,zone,window,period,now,cards}=input;
 if(!supplementKey.trim()||!Number.isSafeInteger(entrantCutoff))throw new HttpError(400,'rank_invalid_snapshot');
 const receipt=crypto.randomUUID(),winners=rankCohort(cards,zone).filter(c=>c.registeredAt<entrantCutoff);
 const writes=[env.DB.prepare('INSERT OR IGNORE INTO rank_settlement_supplements(supplement_key,zone,window,period,settled_at,receipt,snapshot) VALUES(?,?,?,?,?,?,?)').bind(supplementKey,zone,window,period,now,receipt,JSON.stringify({cards,excludedCardIds:input.excludedCardIds??[],addedCardIds:winners.map(w=>w.id)}))];
 for(const c of winners){writes.push(env.DB.prepare(`INSERT OR IGNORE INTO rank_awards(id,card_id,zone,window,period,rank,band,member_id,account_no,amount,awarded_at,payout_hold)
  SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM rank_settlement_supplements WHERE supplement_key=? AND zone=? AND window=? AND period=? AND receipt=?)`)
  .bind(`rank-${zone}-${window}-${period}-${c.id}`,c.id,zone,window,period,c.rank,c.band,c.memberId,c.accountNo,RANK_REWARDS[window][c.band],now,c.payoutHold?1:0,supplementKey,zone,window,period,receipt));
  if(c.memberId)writes.push(env.DB.prepare(`INSERT OR IGNORE INTO community_awards(member_id,badge,source,created_at)
   SELECT ?,?,'rank-v1',? WHERE EXISTS(SELECT 1 FROM rank_settlement_supplements WHERE supplement_key=? AND zone=? AND window=? AND period=? AND receipt=?)`)
   .bind(c.memberId,`rank_${zone}_${window}_${c.band}`,now,supplementKey,zone,window,period,receipt));
 }
 const [saved]=await env.DB.batch(writes);
 if(saved.meta.changes)await bumpOp(env.DB,'rank_settlement',window,'success');
}
export async function rankSnapshot(env:Env,zone:RankZone,window:RankWindow,period:string):Promise<{cards:AwardEntrant[];excludedCardIds?:number[]}|null>{
 const value=await env.DB.prepare('SELECT snapshot FROM rank_settlements WHERE zone=? AND window=? AND period=?').bind(zone,window,period).first<string>('snapshot');
 return value?JSON.parse(value):null;
}
