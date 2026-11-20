import type {Env} from './types';
import {HttpError} from './types';
import {bumpOp} from './ops-metrics';
export interface BadgeStats {accountNo:number;effectiveInvites:number;netTopupUsdMicros:number;consumedCredits:number;complete:boolean;invitesComplete?:boolean;spendingComplete?:boolean}
export const badgeStatsTransport={async read(env:Env,accounts:number[]):Promise<BadgeStats[]>{
 if(!env.HARBOR_BADGES_CLIENT_ID||!env.HARBOR_BADGES_CLIENT_SECRET)throw new Error('badge_stats_unconfigured');
 const tokenResponse=await fetch(`${env.PROVIDER_API_BASE_HARBOR}/oauth/token`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'client_credentials',client_id:env.HARBOR_BADGES_CLIENT_ID,client_secret:env.HARBOR_BADGES_CLIENT_SECRET,scope:'community.badges.read'}),signal:AbortSignal.timeout(5000)});
 if(!tokenResponse.ok)throw new Error('badge_stats_token_unavailable');const token=await tokenResponse.json<{access_token?:string}>();if(!token.access_token)throw new Error('badge_stats_token_unavailable');
 const response=await fetch(`${env.PROVIDER_API_BASE_HARBOR}/open/v1/community/badges/metrics`,{method:'POST',headers:{Authorization:`Bearer ${token.access_token}`,'Content-Type':'application/json'},body:JSON.stringify({accountNos:accounts}),signal:AbortSignal.timeout(10000)});
 if(!response.ok)throw new Error('badge_stats_unavailable');const result=await response.json<{items:BadgeStats[]}>();if(!Array.isArray(result.items))throw new Error('badge_stats_invalid');return result.items;
}};
export async function applyBadgeStats(env:Env,member:string,value:BadgeStats,now=Date.now(),refreshReceipt?:string):Promise<boolean>{
 const invitesComplete=value.invitesComplete===true||(value.invitesComplete===undefined&&value.complete===true);
 const spendingComplete=value.spendingComplete===true||(value.spendingComplete===undefined&&value.complete===true);
 if(!invitesComplete&&!spendingComplete)return false;
 if([value.accountNo,value.effectiveInvites,value.netTopupUsdMicros,value.consumedCredits].some(n=>!Number.isSafeInteger(n)||n<0)||value.accountNo===0)throw new HttpError(400,'badge_stats_invalid');
 const owns=await env.DB.prepare(`SELECT 1 FROM member_identities i LEFT JOIN member_connections c ON c.provider=i.provider AND c.external_id=i.external_id WHERE i.provider='harbor' AND i.external_id=? AND COALESCE(c.owner_member_id,i.member_id)=?`).bind(String(value.accountNo),member).first();if(!owns)throw new HttpError(409,'badge_stats_identity_changed');
 // A receipt protects concurrent refreshes without using wall-clock ordering.
 const receipt=refreshReceipt??crypto.randomUUID();
 if(!refreshReceipt)await env.DB.prepare('INSERT INTO badge_qualification_refresh(member_id,receipt,attempted_at) VALUES(?,?,?) ON CONFLICT(member_id) DO UPDATE SET receipt=excluded.receipt,attempted_at=excluded.attempted_at').bind(member,receipt,now).run();
 const guard=`EXISTS(SELECT 1 FROM badge_qualification_refresh WHERE member_id=? AND receipt=?)
  AND EXISTS(SELECT 1 FROM member_identities i LEFT JOIN member_connections c ON c.provider=i.provider AND c.external_id=i.external_id
   WHERE i.provider='harbor' AND i.external_id=? AND COALESCE(c.owner_member_id,i.member_id)=?)`;
 const guardArgs=[member,receipt,String(value.accountNo),member];
 const previous=(column:string)=>`COALESCE((SELECT ${column} FROM badge_qualifications WHERE member_id=?),0)`;
 const writes=[env.DB.prepare(`INSERT INTO badge_qualifications(member_id,account_no,effective_invites,net_topup_usd_micros,consumed_credits,verified_at)
 SELECT ?,?,CASE WHEN ? THEN ? ELSE ${previous('effective_invites')} END,
 CASE WHEN ? THEN ? ELSE ${previous('net_topup_usd_micros')} END,
 CASE WHEN ? THEN ? ELSE ${previous('consumed_credits')} END,? WHERE ${guard}
 ON CONFLICT(member_id) DO UPDATE SET account_no=excluded.account_no,effective_invites=excluded.effective_invites,net_topup_usd_micros=excluded.net_topup_usd_micros,consumed_credits=excluded.consumed_credits,verified_at=excluded.verified_at`)
 .bind(member,value.accountNo,Number(invitesComplete),value.effectiveInvites,member,Number(spendingComplete),value.netTopupUsdMicros,member,Number(spendingComplete),value.consumedCredits,member,now,...guardArgs)];
 const checks=[...(invitesComplete?[3,10,30,100].map(n=>({key:`invite_${n}`,earned:value.effectiveInvites>=n})):[]),...(spendingComplete?[5,50,200,1000].map((usd,i)=>({key:`spend_${i+1}`,earned:value.netTopupUsdMicros>=usd*1000000&&value.consumedCredits>=usd*6000})):[])];
 for(const check of checks)writes.push(check.earned?
  env.DB.prepare(`INSERT INTO community_awards(member_id,badge,source,created_at) SELECT ?,?,'badge-stats-v1',? WHERE ${guard} ON CONFLICT(member_id,badge) DO UPDATE SET revoked_at=NULL,created_at=CASE WHEN community_awards.revoked_at IS NOT NULL THEN excluded.created_at ELSE community_awards.created_at END`).bind(member,check.key,now,...guardArgs):
  env.DB.prepare(`UPDATE community_awards SET revoked_at=? WHERE member_id=? AND badge=? AND revoked_at IS NULL AND ${guard}`).bind(now,member,check.key,...guardArgs));
 const [saved]=await env.DB.batch(writes);return !!saved.meta.changes;
}
export async function badgeStatsMaintenance(env:Env,now=Date.now()):Promise<void>{
 const rows=(await env.DB.prepare(`SELECT member_id,account_no FROM (SELECT m.id AS member_id,CAST(i.external_id AS INTEGER) AS account_no,
 ROW_NUMBER() OVER(PARTITION BY m.id ORDER BY i.linked_at DESC,i.external_id) AS n,r.attempted_at
 FROM member_identities i LEFT JOIN member_connections c ON c.provider=i.provider AND c.external_id=i.external_id JOIN members m ON m.id=COALESCE(c.owner_member_id,i.member_id)
 LEFT JOIN badge_qualification_refresh r ON r.member_id=m.id WHERE i.provider='harbor' AND m.account_class='normal'
 AND NOT EXISTS(SELECT 1 FROM legacy_account_fence f WHERE f.member_id=m.id)) WHERE n=1 ORDER BY attempted_at IS NOT NULL,attempted_at,member_id LIMIT 8`).all<{member_id:string;account_no:number}>()).results;
 if(!rows.length)return;const receipt=crypto.randomUUID();
 await env.DB.batch(rows.map(r=>env.DB.prepare('INSERT INTO badge_qualification_refresh(member_id,receipt,attempted_at) VALUES(?,?,?) ON CONFLICT(member_id) DO UPDATE SET receipt=excluded.receipt,attempted_at=excluded.attempted_at').bind(r.member_id,receipt,now)));
 try{const values=await badgeStatsTransport.read(env,rows.map(r=>r.account_no));let applied=0;
  for(const row of rows){const value=values.find(v=>v.accountNo===row.account_no);if(value){const changed=await applyBadgeStats(env,row.member_id,value,now,receipt);if(changed&&(value.invitesComplete??value.complete)&&(value.spendingComplete??value.complete))applied++;}}
  await bumpOp(env.DB,'badge_stats','refresh',applied===rows.length?'success':'pending');
 }catch{await bumpOp(env.DB,'badge_stats','refresh','error');}
}
