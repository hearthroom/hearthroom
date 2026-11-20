import type {Env} from './types';
import type {RankZone} from '../shared/rank-honors';
import {reviewEnabled} from './providers';
import {REVIEW_ERA_START} from './card-reward';
import {cardRewardTransport} from './card-reward-service';
import {cohortOf,heatFormulaOf,isNov20DailyCohort,nov20RankExtension,rankScoreWindow,RANK_WINDOWS} from './rank-settlement';
import {periodOf,rankSnapshot,settleRankSnapshot,supplementRankSnapshot,type AwardEntrant} from './rank-awards';
import {bumpOp} from './ops-metrics';
import {annualMaintenance,annualPaymentMaintenance} from './annual-honors';
type RequestWindow={roleId:string;from:string;to:string;formula?:'v2'};
type Payment={key:string;accountNo:number;amount:number;campaignRef:string;contentRef:string};
type EligibleRow={id:number;hosted:string;published_at:number;talk_num:number;rating:string|null;author_num_id:number;member_id:string|null};
type CachedScore={card_id:number;from_at:number;to_at:number;heat:number;excluded:number};
export type PayoutReleaseResult={status:'settlement_incomplete'}|{status:'released'|'already_released';awardCount:number;totalAmount:number};
export const RANK_START=Date.parse('2026-09-24T00:00:00+08:00');
export const RANK_MONTH_START=Date.parse('2026-10-01T00:00:00+08:00');
export const RANK_PAYOUT_START=Date.parse('2026-10-17T00:00:00+08:00');
export const PRE_LAUNCH_SUPPLEMENT_KEY='pre-2026-10-17-v1';
export const RANK_CRON='23 16 * * *';
export const RANK_RETRY_CRON='* * * * *';
export const rankTransport={
 async heats(env:Env,windows:RequestWindow[]):Promise<((RequestWindow&{heat:number;complete:boolean})[]&{unavailable?:RequestWindow[]})>{
  const r=await fetch(`${env.PROVIDER_API_BASE_HARBOR}/open/v1/role/heat/windows`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({windows}),signal:AbortSignal.timeout(10000)});
  if(!r.ok)throw new Error('rank_heat_unavailable');const data=await r.json<{heat:unknown;unavailable?:RequestWindow[]}>();if(!Array.isArray(data.heat)||(data.unavailable!==undefined&&!Array.isArray(data.unavailable)))throw new Error('rank_heat_invalid');return Object.assign(data.heat,{unavailable:data.unavailable});
 },
 async pay(env:Env,token:string,input:Payment):Promise<{key:string;accountNo:number;amount:number}>{
  const r=await fetch(`${env.PROVIDER_API_BASE_HARBOR}/open/v1/campaign-pools/leaderboard/payouts`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(input),signal:AbortSignal.timeout(10000)});
  if(!r.ok)throw new Error('rank_payment_pending');const result=await r.json<{key:string;accountNo:number;amount:number;poolKey?:string}>();if(result.poolKey!=='leaderboard')throw new Error('rank_payment_wrong_pool');return result;
 }
};
/** Persist original first publication; re-review never updates an existing row. */
async function capturePublications(env:Env,now:number){
 const first="(SELECT MIN(COALESCE((SELECT x.original_decided_at FROM review_corrections x WHERE x.submission_id=s.id AND x.state='complete'),s.decided_at)) FROM review_submissions s WHERE s.card_id=c.id AND s.kind='first' AND (s.status='approved' OR EXISTS(SELECT 1 FROM review_corrections x WHERE x.submission_id=s.id AND x.state='complete')))";
 const early=`(SELECT MIN(r.registered_at) FROM card_registrations r WHERE r.provider=c.provider AND r.source_role_id=c.source_role_id AND r.registered_at<${REVIEW_ERA_START})`;
 await env.DB.prepare(`INSERT OR IGNORE INTO rank_publications(card_id,published_at,captured_at)
 SELECT id,published_at,? FROM (SELECT c.id,COALESCE(MIN(${first},${early}),${first},${early},
  ${reviewEnabled(env)?'NULL':'c.registered_at'}) AS published_at
 FROM cards c WHERE c.provider='harbor' AND c.status='approved'
  AND NOT EXISTS(SELECT 1 FROM rank_publications p WHERE p.card_id=c.id)) WHERE published_at IS NOT NULL`).bind(now).run();
}
/** Late community linking never changes payment ownership or an already assigned honor. */
async function linkUnassignedHonors(env:Env){
 const owner=`(SELECT m.id FROM members m WHERE m.id=COALESCE(
  (SELECT owner_member_id FROM member_connections WHERE provider='harbor' AND external_id=CAST(rank_awards.account_no AS TEXT)),
  (SELECT member_id FROM member_identities WHERE provider='harbor' AND external_id=CAST(rank_awards.account_no AS TEXT)))
  AND m.account_class='normal' AND NOT EXISTS(SELECT 1 FROM legacy_account_fence f WHERE f.member_id=m.id))`;
 const linked=(await env.DB.prepare(`UPDATE rank_awards SET member_id=${owner} WHERE id IN
  (SELECT id FROM rank_awards WHERE member_id IS NULL AND ${owner} IS NOT NULL LIMIT 200) RETURNING member_id`).all<{member_id:string}>()).results;
 if(!linked.length)return;
 const members=JSON.stringify([...new Set(linked.map(r=>r.member_id))]);
 await env.DB.batch([
  env.DB.prepare(`INSERT OR IGNORE INTO community_awards(member_id,badge,source,created_at)
   SELECT member_id,'rank_'||zone||'_'||window||'_'||band,'rank-v1',MIN(awarded_at) FROM rank_awards
   WHERE member_id IN(SELECT value FROM json_each(?)) GROUP BY member_id,zone,window,band`).bind(members),
  env.DB.prepare('UPDATE members SET public_cache_revision=lower(hex(randomblob(16))) WHERE id IN(SELECT value FROM json_each(?))').bind(members),
 ]);
}
async function hasUnknownPublication(env:Env):Promise<boolean>{
 return !!await env.DB.prepare(`SELECT 1 FROM cards c LEFT JOIN rank_publications p ON p.card_id=c.id
  WHERE c.provider='harbor' AND c.status='approved' AND c.board_hidden=0 AND c.public_blocked=0 AND c.registered_at>=? AND p.card_id IS NULL
  AND NOT EXISTS(SELECT 1 FROM work_copies cp WHERE cp.provider=c.provider AND cp.role_id=c.source_role_id)
  AND NOT EXISTS(SELECT 1 FROM members m WHERE m.id=COALESCE(
   (SELECT owner_member_id FROM member_connections WHERE provider=c.provider AND external_id=CAST(c.author_num_id AS TEXT)),
   (SELECT member_id FROM member_identities WHERE provider=c.provider AND external_id=CAST(c.author_num_id AS TEXT)))
   AND (m.account_class='test' OR EXISTS(SELECT 1 FROM legacy_account_fence f WHERE f.member_id=m.id))) LIMIT 1`).bind(RANK_START).first();
}
async function eligibleRankRows(env:Env):Promise<EligibleRow[]>{
 return (await env.DB.prepare(`SELECT c.id,COALESCE(c.approved_hosted_role_id,c.source_role_id) AS hosted,p.published_at,c.talk_num,c.rating,
 c.author_num_id,COALESCE(ac.owner_member_id,ai.member_id) AS member_id
 FROM cards c JOIN rank_publications p ON p.card_id=c.id
 LEFT JOIN member_identities ai ON ai.provider=c.provider AND ai.external_id=CAST(c.author_num_id AS TEXT)
 LEFT JOIN member_connections ac ON ac.provider=c.provider AND ac.external_id=CAST(c.author_num_id AS TEXT)
 WHERE p.published_at>=? AND c.status='approved' AND c.board_hidden=0 AND c.public_blocked=0 AND c.provider='harbor'
 AND NOT EXISTS(SELECT 1 FROM work_copies cp WHERE cp.provider=c.provider AND cp.role_id=c.source_role_id)
 AND NOT EXISTS(SELECT 1 FROM members m WHERE m.id=COALESCE(ac.owner_member_id,ai.member_id) AND (m.account_class='test' OR EXISTS(SELECT 1 FROM legacy_account_fence f WHERE f.member_id=m.id))) ORDER BY p.published_at,c.id`).bind(RANK_START)
 .all<EligibleRow>()).results;
}
export async function rankMaintenance(env:Env,now=Date.now(),heatBatchBudget=10):Promise<void>{
 await linkUnassignedHonors(env);
 let remaining=Math.max(1,Math.min(10,Math.trunc(heatBatchBudget)));
 await capturePublications(env,now);
 // Without the original date we cannot even know which cohort is incomplete.
 // Hold rather than silently dropping an otherwise eligible entrant.
 if(await hasUnknownPublication(env)){await bumpOp(env.DB,'rank_settlement','day','pending');return;}
 const rows=await eligibleRankRows(env);
 const settled=new Set((await env.DB.prepare('SELECT zone,window,period FROM rank_settlements').all<{zone:string;window:string;period:string}>()).results.map(r=>`${r.zone}:${r.window}:${r.period}`));
 const supplemented=new Set((await env.DB.prepare('SELECT zone,window,period FROM rank_settlement_supplements WHERE supplement_key=?').bind(PRE_LAUNCH_SUPPLEMENT_KEY).all<{zone:string;window:string;period:string}>()).results.map(r=>`${r.zone}:${r.window}:${r.period}`));
 const attempts=new Map((await env.DB.prepare('SELECT window,period,attempted_at FROM rank_attempts').all<{window:string;period:string;attempted_at:number}>()).results.map(r=>[`${r.window}:${r.period}`,r.attempted_at]));
 const extension=nov20RankExtension(env.NOV_20_DAILY_RANK_EXTENSION_MINUTES);
 const dueJobs:{window:typeof RANK_WINDOWS[number];period:string;entries:EligibleRow[];supplementZones:RankZone[]}[]=[];
 for(const window of RANK_WINDOWS){
  const start=window==='month'?RANK_MONTH_START:RANK_START;
  const groups=new Map<string,EligibleRow[]>();
  for(const row of rows){
   if(row.published_at<start)continue;
   const period=periodOf(cohortOf(row.published_at,window).at);
   const group=groups.get(period);if(group)group.push(row);else groups.set(period,[row]);
  }
  for(const [period,entries]of groups){
   if(!entries.every(r=>now>=rankScoreWindow(r.published_at,window,extension??0).due))continue;
   const unsettled=(['clean','all']as const).filter(z=>!settled.has(`${z}:${window}:${period}`));
   if(unsettled.length){
    if(extension===null&&isNov20DailyCohort(cohortOf(entries[0].published_at,window).at,window)){
     await bumpOp(env.DB,'rank_settlement','day','error');
     continue;
    }
    dueJobs.push({window,period,entries,supplementZones:[]});continue;
   }
   if(window==='month')continue;
   const preEntries=entries.filter(r=>r.published_at<RANK_PAYOUT_START);
   if(!preEntries.length||!entries.some(r=>r.published_at>=RANK_PAYOUT_START))continue;
   const supplementZones:RankZone[]=[];
   for(const zone of ['clean','all']as const){
    if(supplemented.has(`${zone}:${window}:${period}`))continue;
    const snap=await rankSnapshot(env,zone,window,period);
    const recorded=new Set([...(snap?.cards.map(c=>c.id)??[]),...(snap?.excludedCardIds??[])]);
    if(preEntries.some(r=>!recorded.has(r.id)))supplementZones.push(zone);
    else await env.DB.prepare('INSERT OR IGNORE INTO rank_settlement_supplements(supplement_key,zone,window,period,settled_at,receipt,snapshot) VALUES(?,?,?,?,?,?,?)').bind(PRE_LAUNCH_SUPPLEMENT_KEY,zone,window,period,now,'initial-complete',JSON.stringify({cards:snap?.cards??[],excludedCardIds:snap?.excludedCardIds??[],addedCardIds:[]})).run();
   }
   if(supplementZones.length)dueJobs.push({window,period,entries,supplementZones});
  }
 }
 for(const {window,period,entries,supplementZones}of dueJobs.sort((a,b)=>(attempts.get(`${a.window}:${a.period}`)??0)-(attempts.get(`${b.window}:${b.period}`)??0)).slice(0,3)){
   await env.DB.prepare('INSERT INTO rank_attempts(window,period,attempted_at) VALUES(?,?,?) ON CONFLICT(window,period) DO UPDATE SET attempted_at=excluded.attempted_at').bind(window,period,now).run();
   const extended=!!extension&&isNov20DailyCohort(cohortOf(entries[0].published_at,window).at,window);
   const windows=entries.map(r=>{
    const formula=heatFormulaOf(r.published_at,window);
    const {to}=rankScoreWindow(r.published_at,window,extension??0);
    const expected={roleId:r.hosted,from:new Date(r.published_at).toISOString(),to:new Date(to).toISOString(),...(formula?{formula}:{})};
    return {r,to,expected};
   });
   const scoreQuery=env.DB.prepare('SELECT card_id,from_at,to_at,heat,excluded FROM rank_window_scores WHERE window=? AND card_id IN(SELECT value FROM json_each(?))').bind(window,JSON.stringify(entries.map(r=>r.id)));
   const byCard=new Map(windows.map(item=>[item.r.id,item]));
   const scoresByCard=new Map<number,number>();
   const excluded=new Set<number>();
   const readScores=async()=>{
    const {results}=await scoreQuery.all<CachedScore>();
    scoresByCard.clear();
    excluded.clear();
    for(const cached of results){
     const expected=byCard.get(cached.card_id);
     if(!expected||cached.from_at!==expected.r.published_at||cached.to_at!==expected.to)continue;
     scoresByCard.set(cached.card_id,cached.heat);
     if(cached.excluded)excluded.add(cached.card_id);
    }
   };
   await readScores();
   const missing=windows.filter(({r})=>!scoresByCard.has(r.id));
   if(extended&&missing.length&&(['clean','all']as const).some(z=>settled.has(`${z}:${window}:${period}`))){
    // Preserve an existing snapshot and leave the other zone pending for reconciliation.
    await bumpOp(env.DB,'rank_settlement',window,'pending');continue;
   }
   try{
    for(let i=0;i<missing.length&&remaining>0;i+=200){
     remaining--;const chunk=missing.slice(i,i+200),scores=await rankTransport.heats(env,chunk.map(c=>c.expected));
     const completed=[];
     for(const {r,to,expected}of chunk){
      // An answer without the requested formula (a Provider before heat v2) is not a score for this window.
      const score=scores.find(s=>s.roleId===expected.roleId&&Date.parse(s.from)===Date.parse(expected.from)&&Date.parse(s.to)===Date.parse(expected.to)&&s.formula===expected.formula);
      const unavailable=scores.unavailable?.some(w=>w.roleId===expected.roleId&&Date.parse(w.from)===Date.parse(expected.from)&&Date.parse(w.to)===Date.parse(expected.to)&&w.formula===expected.formula);
      if(!score&&unavailable){completed.push({id:r.id,from:r.published_at,to,heat:0,excluded:1});scoresByCard.set(r.id,0);excluded.add(r.id);continue;}
      if(score?.complete!==true||!Number.isSafeInteger(score.heat)||score.heat<0)throw new Error('rank_incomplete');
      completed.push({id:r.id,from:r.published_at,to,heat:score.heat,excluded:0});scoresByCard.set(r.id,score.heat);
     }
     const insert=`INSERT OR IGNORE INTO rank_window_scores(card_id,window,from_at,to_at,heat,scored_at,excluded)
      SELECT json_extract(value,'$.id'),?,json_extract(value,'$.from'),json_extract(value,'$.to'),json_extract(value,'$.heat'),?,json_extract(value,'$.excluded') FROM json_each(?)`;
     const payload=JSON.stringify(completed);
     if(extended){
      await env.DB.prepare(`${insert} WHERE NOT EXISTS(SELECT 1 FROM rank_settlements WHERE window='day' AND period=? AND zone IN ('clean','all'))
       ON CONFLICT(card_id,window) DO UPDATE SET from_at=excluded.from_at,to_at=excluded.to_at,heat=excluded.heat,scored_at=excluded.scored_at,excluded=excluded.excluded
       WHERE rank_window_scores.from_at<>excluded.from_at OR rank_window_scores.to_at<>excluded.to_at`).bind(window,now,payload,period).run();
     }else await env.DB.prepare(insert).bind(window,now,payload).run();
    }
    if(extended&&missing.length)await readScores();
   }catch{await bumpOp(env.DB,'rank_settlement',window,'pending');continue;}
   if(scoresByCard.size!==entries.length){await bumpOp(env.DB,'rank_settlement',window,'pending');continue;}
   const cards:AwardEntrant[]=entries.filter(r=>!excluded.has(r.id)).map(r=>({
    id:r.id,registeredAt:r.published_at,talkNum:r.talk_num,heat:scoresByCard.get(r.id)!,adult:r.rating==='R',memberId:r.member_id,accountNo:r.author_num_id,
    ...(window!=='month'&&r.published_at<RANK_PAYOUT_START?{payoutHold:true}:{}),
   }));
   if(supplementZones.length){
    for(const zone of supplementZones)await supplementRankSnapshot(env,{supplementKey:PRE_LAUNCH_SUPPLEMENT_KEY,entrantCutoff:RANK_PAYOUT_START,zone,window,period,now,cards,excludedCardIds:[...excluded]});
   }else{
    for(const zone of ['clean','all']as const)if(!settled.has(`${zone}:${window}:${period}`))await settleRankSnapshot(env,{zone,window,period,now,cards,excludedCardIds:[...excluded]});
   }
 }
 await annualMaintenance(env,now,rows);
}
/**
 * Pre-reserved idempotent one-time step to release held pre-10/17 rank payouts once owner-approved.
 * Not executed unless RANK_PRE_LAUNCH_PAYOUTS_ENABLED === 'true' or invoked explicitly.
 */
export async function releaseHeldRankPayouts(env:Env,now=Date.now(),releaseKey=PRE_LAUNCH_SUPPLEMENT_KEY):Promise<PayoutReleaseResult>{
 const existing=await env.DB.prepare('SELECT award_count,total_amount FROM rank_payout_releases WHERE release_key=?').bind(releaseKey).first<{award_count:number;total_amount:number}>();
 if(existing)return {status:'already_released',awardCount:existing.award_count,totalAmount:existing.total_amount};
 await capturePublications(env,now);
 if(await hasUnknownPublication(env))return {status:'settlement_incomplete'};
 const rows=await eligibleRankRows(env);
 const preRows=rows.filter(r=>r.published_at<RANK_PAYOUT_START);
 const settled=new Set((await env.DB.prepare('SELECT zone,window,period FROM rank_settlements').all<{zone:string;window:string;period:string}>()).results.map(r=>`${r.zone}:${r.window}:${r.period}`));
 const supplemented=new Set((await env.DB.prepare('SELECT zone,window,period FROM rank_settlement_supplements WHERE supplement_key=?').bind(releaseKey).all<{zone:string;window:string;period:string}>()).results.map(r=>`${r.zone}:${r.window}:${r.period}`));
 for(const window of ['day','week']as const){
  const periods=new Set(preRows.map(r=>periodOf(cohortOf(r.published_at,window).at)));
  for(const period of periods){
   for(const zone of ['clean','all']as const){
    if(!settled.has(`${zone}:${window}:${period}`))return {status:'settlement_incomplete'};
    const hasPost=rows.some(r=>r.published_at>=RANK_PAYOUT_START&&periodOf(cohortOf(r.published_at,window).at)===period);
    if(hasPost&&!supplemented.has(`${zone}:${window}:${period}`)){
     const snap=await rankSnapshot(env,zone,window,period);
     const recorded=new Set([...(snap?.cards.map(c=>c.id)??[]),...(snap?.excludedCardIds??[])]);
     if(preRows.some(r=>periodOf(cohortOf(r.published_at,window).at)===period&&!recorded.has(r.id)))return {status:'settlement_incomplete'};
    }
   }
  }
 }
 const receipt=crypto.randomUUID();
 const [saved]=await env.DB.batch([
  env.DB.prepare("INSERT OR IGNORE INTO rank_payout_releases(release_key,released_at,award_count,total_amount,receipt) SELECT ?,?,COUNT(*),COALESCE(SUM(amount),0),? FROM rank_awards WHERE status='pending' AND payout_hold=1").bind(releaseKey,now,receipt),
  env.DB.prepare("UPDATE rank_awards SET payout_hold=0 WHERE status='pending' AND payout_hold=1 AND EXISTS(SELECT 1 FROM rank_payout_releases WHERE release_key=? AND receipt=?)").bind(releaseKey,receipt),
 ]);
 const recorded=await env.DB.prepare('SELECT award_count,total_amount,receipt FROM rank_payout_releases WHERE release_key=?').bind(releaseKey).first<{award_count:number;total_amount:number;receipt:string}>();
 if(!recorded)throw new Error('rank_payout_release_missing');
 return {status:saved.meta.changes&&recorded.receipt===receipt?'released':'already_released',awardCount:recorded.award_count,totalAmount:recorded.total_amount};
}
export async function rankPaymentMaintenance(env:Env,now=Date.now()):Promise<void>{
 if(env.RANK_PRE_LAUNCH_PAYOUTS_ENABLED==='true')await releaseHeldRankPayouts(env,now);
 await annualPaymentMaintenance(env,now);
 const rows=(await env.DB.prepare(`SELECT id,account_no,amount,card_id,zone,window,period,attempted_at FROM rank_awards WHERE status='pending' AND payout_hold=0
  AND (attempted_at IS NULL OR attempted_at+MIN(3600000,60000*(1<<MIN(MAX(attempts-1,0),6)))<=?) ORDER BY attempted_at IS NOT NULL,attempted_at,awarded_at,id LIMIT 5`).bind(now)
  .all<{id:string;account_no:number;amount:number;card_id:number;zone:string;window:string;period:string;attempted_at:number|null}>()).results;
 if(!rows.length)return;
 let token:string;try{token=await cardRewardTransport.token(env)}catch{await bumpOp(env.DB,'rank_settlement','payout','pending');return;}
 for(const row of rows){
  const claim=await env.DB.prepare("UPDATE rank_awards SET attempts=attempts+1,attempted_at=? WHERE id=? AND status='pending' AND payout_hold=0 AND attempted_at IS ?").bind(now,row.id,row.attempted_at).run();if(!claim.meta.changes)continue;
  try{
   const paid=await rankTransport.pay(env,token,{key:row.id,accountNo:row.account_no,amount:row.amount,campaignRef:`rank:${row.zone}:${row.window}:${row.period}`,contentRef:String(row.card_id)});
   if(paid.key!==row.id||paid.accountNo!==row.account_no||paid.amount!==row.amount)throw new Error('rank_payment_mismatch');
   const saved=await env.DB.prepare("UPDATE rank_awards SET status='paid',paid_at=? WHERE id=? AND status='pending'").bind(now,row.id).run();
   if(saved.meta.changes)await bumpOp(env.DB,'rank_settlement','payout','success');
  }catch{await bumpOp(env.DB,'rank_settlement','payout','pending');}
 }
}
