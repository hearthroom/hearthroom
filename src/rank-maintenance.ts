import type {Env} from './types';
import {reviewEnabled} from './providers';
import {REVIEW_ERA_START} from './card-reward';
import {cardRewardTransport} from './card-reward-service';
import {cohortOf,RANK_DURATION,RANK_WINDOWS} from './rank-settlement';
import {periodOf,settleRankSnapshot,type AwardEntrant} from './rank-awards';
import {bumpOp} from './ops-metrics';
type RequestWindow={roleId:string;from:string;to:string};
type Payment={key:string;accountNo:number;amount:number;campaignRef:string;contentRef:string};
export const RANK_START=Date.parse('2026-10-17T00:00:00+08:00');
export const RANK_CRON='23 16 * * *';
export const RANK_RETRY_CRON='* * * * *';
export const rankTransport={
 async heats(env:Env,windows:RequestWindow[]):Promise<(RequestWindow&{heat:number;complete:boolean})[]>{
  const r=await fetch(`${env.PROVIDER_API_BASE_HARBOR}/open/v1/role/heat/windows`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({windows}),signal:AbortSignal.timeout(10000)});
  if(!r.ok)throw new Error('rank_heat_unavailable');const data=await r.json<{heat:unknown}>();if(!Array.isArray(data.heat))throw new Error('rank_heat_invalid');return data.heat;
 },
 async pay(env:Env,token:string,input:Payment):Promise<{key:string;accountNo:number;amount:number}>{
  const r=await fetch(`${env.PROVIDER_API_BASE_HARBOR}/open/v1/campaign-pools/leaderboard/payouts`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(input),signal:AbortSignal.timeout(10000)});
  if(!r.ok)throw new Error('rank_payment_pending');const result=await r.json<{key:string;accountNo:number;amount:number;poolKey?:string}>();if(result.poolKey!=='leaderboard')throw new Error('rank_payment_wrong_pool');return result;
 }
};
/** Persist original first publication; re-review never updates an existing row. */
async function capturePublications(env:Env,now:number){
 const first="(SELECT MIN(s.decided_at) FROM review_submissions s WHERE s.card_id=c.id AND s.kind='first' AND s.status='approved')";
 const early=`(SELECT MIN(r.registered_at) FROM card_registrations r WHERE r.provider=c.provider AND r.source_role_id=c.source_role_id AND r.registered_at<${REVIEW_ERA_START})`;
 await env.DB.prepare(`INSERT OR IGNORE INTO rank_publications(card_id,published_at,captured_at)
 SELECT id,published_at,? FROM (SELECT c.id,COALESCE(MIN(${first},${early}),${first},${early},
  ${reviewEnabled(env)?'NULL':'c.registered_at'}) AS published_at
 FROM cards c WHERE c.provider='harbor' AND c.status='approved') WHERE published_at IS NOT NULL`).bind(now).run();
}
export async function rankMaintenance(env:Env,now=Date.now(),heatBatchBudget=10):Promise<void>{
 let remaining=Math.max(1,Math.min(10,Math.trunc(heatBatchBudget)));
 await capturePublications(env,now);
 // Without the original date we cannot even know which cohort is incomplete.
 // Hold rather than silently dropping an otherwise eligible entrant.
 const unknown=await env.DB.prepare(`SELECT 1 FROM cards c LEFT JOIN rank_publications p ON p.card_id=c.id
  WHERE c.provider='harbor' AND c.status='approved' AND c.board_hidden=0 AND c.public_blocked=0 AND c.registered_at>=? AND p.card_id IS NULL
  AND NOT EXISTS(SELECT 1 FROM work_copies cp WHERE cp.provider=c.provider AND cp.role_id=c.source_role_id) LIMIT 1`).bind(RANK_START).first();
 if(unknown){await bumpOp(env.DB,'rank_settlement','day','pending');return;}
 const rows=(await env.DB.prepare(`SELECT c.id,COALESCE(c.approved_hosted_role_id,c.source_role_id) AS hosted,p.published_at,c.talk_num,c.rating,
 c.author_num_id,COALESCE(ac.owner_member_id,ai.member_id) AS member_id
 FROM cards c JOIN rank_publications p ON p.card_id=c.id
 LEFT JOIN member_identities ai ON ai.provider=c.provider AND ai.external_id=CAST(c.author_num_id AS TEXT)
 LEFT JOIN member_connections ac ON ac.provider=c.provider AND ac.external_id=CAST(c.author_num_id AS TEXT)
 WHERE p.published_at>=? AND c.status='approved' AND c.board_hidden=0 AND c.public_blocked=0 AND c.provider='harbor'
 AND NOT EXISTS(SELECT 1 FROM work_copies cp WHERE cp.provider=c.provider AND cp.role_id=c.source_role_id)
 AND NOT EXISTS(SELECT 1 FROM members m WHERE m.id=COALESCE(ac.owner_member_id,ai.member_id) AND (m.account_class='test' OR EXISTS(SELECT 1 FROM legacy_account_fence f WHERE f.member_id=m.id))) ORDER BY p.published_at,c.id`).bind(RANK_START)
 .all<{id:number;hosted:string;published_at:number;talk_num:number;rating:string|null;author_num_id:number;member_id:string|null}>()).results;
 const settled=new Set((await env.DB.prepare('SELECT zone,window,period FROM rank_settlements').all<{zone:string;window:string;period:string}>()).results.map(r=>`${r.zone}:${r.window}:${r.period}`));
 const attempts=new Map((await env.DB.prepare('SELECT window,period,attempted_at FROM rank_attempts').all<{window:string;period:string;attempted_at:number}>()).results.map(r=>[`${r.window}:${r.period}`,r.attempted_at]));
 const dueJobs:{window:typeof RANK_WINDOWS[number];period:string;entries:typeof rows}[]=[];
 for(const window of RANK_WINDOWS){
  const groups=new Map<string,typeof rows>();
  for(const row of rows){const cohort=cohortOf(row.published_at,window);if(now<cohort.due)continue;const period=periodOf(cohort.at);if(['clean','all'].every(z=>settled.has(`${z}:${window}:${period}`)))continue;const group=groups.get(period);if(group)group.push(row);else groups.set(period,[row]);}
  for(const [period,entries]of groups)dueJobs.push({window,period,entries});
 }
 for(const {window,period,entries}of dueJobs.sort((a,b)=>(attempts.get(`${a.window}:${a.period}`)??0)-(attempts.get(`${b.window}:${b.period}`)??0)).slice(0,3)){
   await env.DB.prepare('INSERT INTO rank_attempts(window,period,attempted_at) VALUES(?,?,?) ON CONFLICT(window,period) DO UPDATE SET attempted_at=excluded.attempted_at').bind(window,period,now).run();
   const windows=entries.map(r=>({roleId:r.hosted,from:new Date(r.published_at).toISOString(),to:new Date(r.published_at+RANK_DURATION[window]).toISOString()}));
   const cached=(await env.DB.prepare('SELECT card_id,from_at,to_at,heat FROM rank_window_scores WHERE window=? AND card_id IN(SELECT value FROM json_each(?))').bind(window,JSON.stringify(entries.map(r=>r.id))).all<{card_id:number;from_at:number;to_at:number;heat:number}>()).results;
   const publishedByCard=new Map(entries.map(r=>[r.id,r.published_at]));
   const scoresByCard=new Map(cached.filter(c=>publishedByCard.get(c.card_id)===c.from_at&&c.from_at+RANK_DURATION[window]===c.to_at).map(c=>[c.card_id,c.heat]));
   const missing=entries.map((r,i)=>({r,expected:windows[i]})).filter(({r})=>!scoresByCard.has(r.id));
   try{
    for(let i=0;i<missing.length&&remaining>0;i+=200){
     remaining--;const chunk=missing.slice(i,i+200),scores=await rankTransport.heats(env,chunk.map(c=>c.expected));
     const completed=[];
     for(const {r,expected}of chunk){
      const score=scores.find(s=>s.roleId===expected.roleId&&Date.parse(s.from)===Date.parse(expected.from)&&Date.parse(s.to)===Date.parse(expected.to));
      if(score?.complete!==true||!Number.isSafeInteger(score.heat)||score.heat<0)throw new Error('rank_incomplete');
      completed.push({id:r.id,from:r.published_at,to:r.published_at+RANK_DURATION[window],heat:score.heat});scoresByCard.set(r.id,score.heat);
     }
     await env.DB.prepare(`INSERT OR IGNORE INTO rank_window_scores(card_id,window,from_at,to_at,heat,scored_at) SELECT json_extract(value,'$.id'),?,json_extract(value,'$.from'),json_extract(value,'$.to'),json_extract(value,'$.heat'),? FROM json_each(?)`).bind(window,now,JSON.stringify(completed)).run();
    }
   }catch{await bumpOp(env.DB,'rank_settlement',window,'pending');continue;}
   if(scoresByCard.size!==entries.length){await bumpOp(env.DB,'rank_settlement',window,'pending');continue;}
   const cards:AwardEntrant[]=entries.map(r=>({id:r.id,registeredAt:r.published_at,talkNum:r.talk_num,heat:scoresByCard.get(r.id)!,adult:r.rating==='R',memberId:r.member_id,accountNo:r.author_num_id}));
   for(const zone of ['clean','all']as const)if(!settled.has(`${zone}:${window}:${period}`))await settleRankSnapshot(env,{zone,window,period,now,cards});
 }
}
export async function rankPaymentMaintenance(env:Env,now=Date.now()):Promise<void>{
 const rows=(await env.DB.prepare(`SELECT id,account_no,amount,card_id,zone,window,period,attempted_at FROM rank_awards WHERE status='pending'
  AND (attempted_at IS NULL OR attempted_at+MIN(3600000,60000*(1<<MIN(MAX(attempts-1,0),6)))<=?) ORDER BY attempted_at IS NOT NULL,attempted_at,awarded_at,id LIMIT 5`).bind(now)
  .all<{id:string;account_no:number;amount:number;card_id:number;zone:string;window:string;period:string;attempted_at:number|null}>()).results;
 if(!rows.length)return;
 let token:string;try{token=await cardRewardTransport.token(env)}catch{await bumpOp(env.DB,'rank_settlement','payout','pending');return;}
 for(const row of rows){
  const claim=await env.DB.prepare("UPDATE rank_awards SET attempts=attempts+1,attempted_at=? WHERE id=? AND status='pending' AND attempted_at IS ?").bind(now,row.id,row.attempted_at).run();if(!claim.meta.changes)continue;
  try{
   const paid=await rankTransport.pay(env,token,{key:row.id,accountNo:row.account_no,amount:row.amount,campaignRef:`rank:${row.zone}:${row.window}:${row.period}`,contentRef:String(row.card_id)});
   if(paid.key!==row.id||paid.accountNo!==row.account_no||paid.amount!==row.amount)throw new Error('rank_payment_mismatch');
   const saved=await env.DB.prepare("UPDATE rank_awards SET status='paid',paid_at=? WHERE id=? AND status='pending'").bind(now,row.id).run();
   if(saved.meta.changes)await bumpOp(env.DB,'rank_settlement','payout','success');
  }catch{await bumpOp(env.DB,'rank_settlement','payout','pending');}
 }
}
