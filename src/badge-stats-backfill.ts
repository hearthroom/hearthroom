import type {Env} from './types';
import {applyBadgeStats,badgeStatsTransport} from './badge-stats';
import {bumpOp} from './ops-metrics';

const job='invite-source-v2';
// Keep the normal ranking/payment rotation active while this snapshot drains.
export const BADGE_BACKFILL_BATCH=32;
const MAX_INCOMPLETE_READS=5;
interface Row {member_id:string;account_no:number}
async function currentOwner(env:Env,row:Row):Promise<boolean>{
 const account=await env.DB.prepare(`SELECT CAST(i.external_id AS INTEGER) account_no
 FROM member_identities i LEFT JOIN member_connections c ON c.provider=i.provider AND c.external_id=i.external_id
 JOIN members m ON m.id=COALESCE(c.owner_member_id,i.member_id)
 WHERE i.provider='harbor' AND m.id=? AND m.account_class='normal'
 AND NOT EXISTS(SELECT 1 FROM legacy_account_fence f WHERE f.member_id=m.id)
 ORDER BY i.linked_at DESC,i.external_id LIMIT 1`).bind(row.member_id).first<number>('account_no');
 return account===row.account_no;
}
export async function badgeStatsBackfill(env:Env,now=Date.now()):Promise<void>{
 const rows=(await env.DB.prepare(`SELECT member_id,account_no FROM badge_stats_backfill_members
 WHERE job_key=? AND status='pending' ORDER BY attempted_at IS NOT NULL,attempted_at,account_no LIMIT ?`)
 .bind(job,BADGE_BACKFILL_BATCH).all<Row>()).results;
 if(!rows.length)return;
 const receipt=crypto.randomUUID();
 const retry=(row:Row,reason:'unavailable'|'incomplete'|'retry')=>env.DB.prepare(`UPDATE badge_stats_backfill_members SET attempted_at=?,last_error=?,
 incomplete_reads=incomplete_reads+?,status=CASE WHEN incomplete_reads+?>=? THEN 'unavailable' ELSE status END
 WHERE job_key=? AND member_id=? AND status='pending'`).bind(now,reason,Number(reason!=='retry'),Number(reason!=='retry'),MAX_INCOMPLETE_READS,job,row.member_id).run();
 const changed=(row:Row)=>env.DB.prepare(`UPDATE badge_stats_backfill_members SET status='identity_changed',attempted_at=?,last_error=NULL WHERE job_key=? AND member_id=? AND status='pending'`).bind(now,job,row.member_id).run();
 try{
  const eligible:Row[]=[];
  for(const row of rows){if(await currentOwner(env,row))eligible.push(row);else await changed(row)}
  if(eligible.length){
   await env.DB.batch(eligible.map(row=>env.DB.prepare(`INSERT INTO badge_qualification_refresh(member_id,receipt,attempted_at) VALUES(?,?,?) ON CONFLICT(member_id) DO UPDATE SET receipt=excluded.receipt,attempted_at=excluded.attempted_at`).bind(row.member_id,receipt,now)));
   const values=await badgeStatsTransport.read(env,eligible.map(row=>row.account_no));
   for(const row of eligible){
    try{
     if(!await currentOwner(env,row)){await changed(row);continue}
     const value=values.find(value=>value.accountNo===row.account_no);
     if(!value){await retry(row,'unavailable');continue}
     if(!(value.invitesComplete??value.complete)){await retry(row,'incomplete');continue}
     if(!await applyBadgeStats(env,row.member_id,value,now,receipt)){await retry(row,'retry');continue}
     // Completion is tied to the same receipt that guarded the atomic award write.
     await env.DB.prepare(`UPDATE badge_stats_backfill_members SET status='done',attempted_at=?,applied_at=?,effective_invites=?,last_error=NULL
      WHERE job_key=? AND member_id=? AND status='pending'
      AND EXISTS(SELECT 1 FROM badge_qualification_refresh r WHERE r.member_id=? AND r.receipt=?)`)
      .bind(now,now,value.effectiveInvites,job,row.member_id,row.member_id,receipt).run();
    }catch{if(!await currentOwner(env,row))await changed(row);else await retry(row,'retry')}
   }
  }
  const pending=await env.DB.prepare("SELECT COUNT(*) n FROM badge_stats_backfill_members WHERE job_key=? AND status='pending'").bind(job).first<number>('n');
  const unavailable=await env.DB.prepare("SELECT COUNT(*) n FROM badge_stats_backfill_members WHERE job_key=? AND status='unavailable'").bind(job).first<number>('n');
  if(!pending)await env.DB.prepare('UPDATE badge_stats_backfill_runs SET completed_at=?,outcome=? WHERE job_key=? AND completed_at IS NULL').bind(now,unavailable?'incomplete':'complete',job).run();
  await bumpOp(env.DB,'badge_stats','backfill',pending?'pending':unavailable?'error':'success');
 }catch{
  for(const row of rows)await retry(row,'retry');
  await bumpOp(env.DB,'badge_stats','backfill','error');
 }
}
