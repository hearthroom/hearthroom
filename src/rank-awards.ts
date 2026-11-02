import {HttpError,type Env} from './types';
import type {RankZone,RankWindow} from '../shared/rank-honors';
import {cohortOf,rankCohort,RANK_REWARDS,type RankEntrant} from './rank-settlement';
import {bumpOp} from './ops-metrics';
export interface AwardEntrant extends RankEntrant {memberId:string|null;accountNo:number}
export interface RankSnapshotInput {zone:RankZone;window:RankWindow;period:string;now:number;cards:AwardEntrant[]}
export const periodOf=(at:number)=>new Date(at+8*3600000).toISOString().slice(0,10);
export async function settleRankSnapshot(env:Env,input:RankSnapshotInput):Promise<void>{
 const {zone,window,period,now,cards}=input;
 const cohort=cohortOf(Date.parse(`${period}T00:00:00+08:00`),window);
 if(!Number.isFinite(cohort.at)||periodOf(cohort.at)!==period||new Set(cards.map(c=>c.id)).size!==cards.length||cards.some(c=>periodOf(cohortOf(c.registeredAt,window).at)!==period||!Number.isSafeInteger(c.heat)||c.heat<0))throw new HttpError(400,'rank_invalid_snapshot');
 if(cards.some(c=>now<cohortOf(c.registeredAt,window).due)||(!cards.length&&now<cohort.due))throw new HttpError(409,'rank_not_due');
 const receipt=crypto.randomUUID(),winners=rankCohort(cards,zone);
 const writes=[env.DB.prepare('INSERT OR IGNORE INTO rank_settlements(zone,window,period,settled_at,receipt,snapshot) VALUES(?,?,?,?,?,?)').bind(zone,window,period,now,receipt,JSON.stringify({cards}))];
 for(const c of winners){writes.push(env.DB.prepare(`INSERT OR IGNORE INTO rank_awards(id,card_id,zone,window,period,rank,band,member_id,account_no,amount,awarded_at)
  SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM rank_settlements WHERE zone=? AND window=? AND period=? AND receipt=?)`)
  .bind(`rank-${zone}-${window}-${period}-${c.id}`,c.id,zone,window,period,c.rank,c.band,c.memberId,c.accountNo,RANK_REWARDS[window][c.band],now,zone,window,period,receipt));
  if(c.memberId)writes.push(env.DB.prepare(`INSERT OR IGNORE INTO community_awards(member_id,badge,source,created_at)
   SELECT ?,?,'rank-v1',? WHERE EXISTS(SELECT 1 FROM rank_settlements WHERE zone=? AND window=? AND period=? AND receipt=?)`)
   .bind(c.memberId,`rank_${zone}_${window}_${c.band}`,now,zone,window,period,receipt));
 }
 const [saved]=await env.DB.batch(writes);
 if(saved.meta.changes)await bumpOp(env.DB,'rank_settlement',window,'success');
}
export async function rankSnapshot(env:Env,zone:RankZone,window:RankWindow,period:string):Promise<{cards:AwardEntrant[]}|null>{
 const value=await env.DB.prepare('SELECT snapshot FROM rank_settlements WHERE zone=? AND window=? AND period=?').bind(zone,window,period).first<string>('snapshot');
 return value?JSON.parse(value):null;
}
