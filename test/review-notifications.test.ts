import { env, createExecutionContext } from 'cloudflare:test';
import { beforeEach, expect, it } from 'vitest';
import app from '../src/index';
import { sign } from '../src/community/crypto';
import { resetDb, makeReviewer } from './helpers';
import { claim, stamp } from '../src/review';
import type { Env } from '../src/types';
const settings=()=>({...env,COMMUNITY_ENABLED:'true',COMMUNITY_SITE_URL:'https://hearthroom.club',COMMUNITY_GUILD_ID:'123456789012345678',COMMUNITY_BRIDGE_KEY:'a'.repeat(64)}) as Env;
async function bridge(op:string,value:Record<string,unknown>={}, enabled=true) {
 const path='/internal/community/'+op, time=String(Date.now()), nonce=crypto.randomUUID(), body=JSON.stringify({guild:settings().COMMUNITY_GUILD_ID,...value});
 return app.fetch(new Request('https://hearthroom.club'+path,{method:'POST',body,headers:{'X-Community-Time':time,'X-Community-Nonce':nonce,'X-Community-Signature':await sign(settings().COMMUNITY_BRIDGE_KEY!,'POST',path,time,nonce,body)}}),{...settings(),COMMUNITY_ENABLED:enabled?'true':'false'},createExecutionContext());
}
async function submission(id='s1',now=Date.now(),nsfw=0){
 await env.DB.prepare("INSERT INTO cards(id,source_role_id,author_num_id,author_name,names,registered_at,last_synced_at,status) VALUES(?,?,999,'PRIVATE AUTHOR',?, ?,?,'pending')").bind(id,id,JSON.stringify({zh:'雨夜書店',en:'Rainy Bookshop'}),now,now).run();
 await env.DB.prepare("INSERT INTO review_submissions(id,card_id,provider,source_role_id,kind,status,submitted_at,nsfw) VALUES(?,?,'harbor',?,'first','pending',?,?)").bind(id,id,id,now,nsfw).run();
}
beforeEach(resetDb);
it('returns durable per-submission work and a blind projection, not just a global signal',async()=>{
 await submission();
 const r=await bridge('review-pending-v2');expect(r.status).toBe(200);
 const body=await r.json() as any;expect(body.version).toBe(2);expect(body.jobs).toContainEqual({id:'review:s1'});
 const projected=await bridge('review-project-v2',{id:'review:s1',channel:'223456789012345678',lang:'zh-Hant'});
 expect(projected.status).toBe(200);const p=await projected.json() as any;
 expect(p.projection).toMatchObject({title:'雨夜書店',status:'pending',approvals:0,required:2,claimant:null,path:'/review/s1'});
 expect(JSON.stringify(p)).not.toContain('PRIVATE AUTHOR');expect(JSON.stringify(p)).not.toContain('999');
});
import { maintainReviewNotifications, pendingReviewDeliveries, leaseReviewDelivery, finishReviewDelivery, checkReviewDelivery } from '../src/community/review-notifications';
import { release } from '../src/review';
it('leases exclude another worker; old acknowledgements cannot swallow newer review progress',async()=>{
 await submission();const now=Date.now(),channel='223456789012345678';
 const a=await leaseReviewDelivery(env.DB,'review:s1',channel,'en',now);
 await expect(leaseReviewDelivery(env.DB,'review:s1',channel,'en',now)).rejects.toThrow('busy');
 const m=await makeReviewer(2);await claim(env.DB,'s1',m,now);
 expect(await checkReviewDelivery(env.DB,a.id,a.lease,a.revision,now)).toBe(false);
 expect(await finishReviewDelivery(env.DB,{...a,channel,messageId:'323456789012345678'},now)).toEqual({accepted:false});
 const b=await leaseReviewDelivery(env.DB,'review:s1',channel,'en',now+120001);
 expect(b.projection).toMatchObject({title:'Rainy Bookshop',claimant:expect.any(String),expiresAt:now+45*60000});
 expect(await finishReviewDelivery(env.DB,{...b,channel,messageId:'323456789012345678'},now+120002)).toEqual({accepted:true});
 const reconcile=await leaseReviewDelivery(env.DB,b.id,channel,'en',now+120002+10*60000);expect(reconcile.changed).toBe(false);
});
it('reminders are one per live generation and disappear from delivery after completion or relinking',async()=>{
 await submission();const m=await makeReviewer(2),now=Date.now();
 await env.DB.prepare('INSERT INTO community_preferences(member_id,notifications,discord_dm) VALUES(?,1,1)').bind(m).run();
 await env.DB.prepare("INSERT INTO community_subjects(discord_id) VALUES('423456789012345678')").run();
 await env.DB.prepare("INSERT INTO discord_links(member_id,discord_id,name,version,created_at) VALUES(?,'423456789012345678','fixture','link-v1',?)").bind(m,now).run();
 await claim(env.DB,'s1',m,now-31*60000);
 await maintainReviewNotifications(env.DB,now);await maintainReviewNotifications(env.DB,now);
 const notes=await env.DB.prepare("SELECT id FROM community_notifications WHERE kind='review_reminder'").all<any>();expect(notes.results).toHaveLength(1);
 expect((await bridge('notification',{id:notes.results[0].id})).status).toBe(200);
 await env.DB.prepare("UPDATE discord_links SET version='link-v2' WHERE member_id=?").bind(m).run();
 expect((await bridge('notification',{id:notes.results[0].id})).status).toBe(404);
});
it('expired and revoked claims are released without generating reminders; adult titles stay private',async()=>{
 await submission('adult',Date.now(),1);const m=await makeReviewer(2),now=Date.now();
 await claim(env.DB,'adult',m,now-46*60000);await maintainReviewNotifications(env.DB,now);
 const p=await leaseReviewDelivery(env.DB,'review:adult','223456789012345678','zh-Hant',now);
 expect(p.projection).toMatchObject({adult:true,title:'',claimant:null,expiresAt:null});
 const s=await env.DB.prepare('SELECT claimed_by FROM review_submissions WHERE id=?').bind('adult').first<any>();expect(s.claimed_by).toBeNull();
});
it('digests use Taipei day, count work instead of votes and include wait-for-second separately',async()=>{
 const now=Date.parse('2026-09-22T02:00:00Z');await submission('old',now-3*86400000);await submission('second',now-3*86400000);
 await env.DB.prepare("INSERT INTO review_stamps(submission_id,member_id,verdict,created_at) VALUES('second','reviewed','approve',?)").bind(now-2*86400000).run();
 await pendingReviewDeliveries(env.DB,now-1);
 expect(await env.DB.prepare("SELECT id FROM review_deliveries WHERE kind='digest'").first()).toBeNull();
 const pending=await pendingReviewDeliveries(env.DB,now);expect(pending.jobs).toContainEqual({id:'digest:2026-09-22'});
 const d=await leaseReviewDelivery(env.DB,'digest:2026-09-22','223456789012345678','en',now);
 expect(d.digest).toMatchObject({total:2,claimed:0,second:1});expect(d.digest!.items).toHaveLength(2);
});
it('new claims fence delayed release and stamp requests from the previous claim',async()=>{
 await submission();const m=await makeReviewer(2),now=Date.now();
 const a=await claim(env.DB,'s1',m,now),b=await claim(env.DB,'s1',m,now+1);
 expect((a as any).claim_generation).not.toBe((b as any).claim_generation);
 await expect(release(env.DB,'s1',m,(a as any).claim_generation)).rejects.toThrow('claim changed');
 await expect(stamp(env.DB,{submissionId:'s1',memberId:m,verdict:'approve',note:'',now:now+2,generation:(a as any).claim_generation} as any)).rejects.toThrow('claim changed');
});
import { identities, bearer, restoreUpstream } from './helpers';
import { afterEach } from 'vitest';
afterEach(restoreUpstream);
it('HTTP callers must carry the claim generation they actually received',async()=>{
 await submission();await makeReviewer(2);identities({'reviewer-token':2});
 const request=(action:string,body:unknown)=>app.fetch(new Request('https://hearthroom.club/v1/review/s1/'+action,{method:'POST',headers:{...bearer('reviewer-token'),'Content-Type':'application/json'},body:JSON.stringify(body)}),settings(),createExecutionContext());
 const a=await (await request('claim',{})).json() as any;const b=await (await request('claim',{})).json() as any;
 expect((await request('stamp',{verdict:'approve'})).status).toBe(409);
 expect((await request('stamp',{verdict:'approve',generation:a.generation})).status).toBe(409);
 expect((await request('stamp',{verdict:'approve',generation:b.generation})).status).toBe(200);
});
it('queued reminders cannot be delivered after a stamp; the website shows them as expired',async()=>{
 await submission();const m=await makeReviewer(2),now=Date.now();identities({'reviewer-token':2});
 await env.DB.prepare('INSERT INTO community_preferences(member_id,notifications,discord_dm) VALUES(?,1,1)').bind(m).run();
 await env.DB.prepare("INSERT INTO community_subjects(discord_id) VALUES('423456789012345678')").run();
 await env.DB.prepare("INSERT INTO discord_links(member_id,discord_id,name,version,created_at) VALUES(?,'423456789012345678','fixture','v1',?)").bind(m,now).run();
 const claimed=await claim(env.DB,'s1',m,now-31*60000);await maintainReviewNotifications(env.DB,now);
 await stamp(env.DB,{submissionId:'s1',memberId:m,verdict:'approve',note:'',now,generation:claimed.claim_generation});
 const n=await env.DB.prepare("SELECT id FROM community_notifications WHERE kind='review_reminder'").first<any>();
 expect((await bridge('notification',{id:n.id})).status).toBe(404);
 const r=await app.fetch(new Request('https://hearthroom.club/v1/me/community/notifications',{headers:bearer('reviewer-token')}),settings(),createExecutionContext());
 expect(r.status).toBe(200);expect((await r.json() as any).items[0]).toMatchObject({kind:'review_reminder_expired',path:'/review'});
});
it('more than 200 submissions are drained in bounded batches without losing a submission',async()=>{
 const now=Date.now();const writes=[];
 for(let i=0;i<205;i++)writes.push(env.DB.prepare("INSERT INTO review_submissions(id,card_id,provider,source_role_id,kind,status,submitted_at) VALUES(?,?,'harbor',?,'first','pending',?)").bind('bulk-'+i,'missing','bulk-'+i,now));
 await env.DB.batch(writes);
 const seen=new Set<string>();
 for(let round=0;round<11;round++){
  const p=await pendingReviewDeliveries(env.DB,now);
  for(const j of p.jobs){seen.add(j.id);const d=await leaseReviewDelivery(env.DB,j.id,'223456789012345678','en',now);await finishReviewDelivery(env.DB,{...d,channel:'223456789012345678',messageId:'323456789012345678'},now);}
 }
 expect(seen.size).toBe(205);
},30000);
it('parallel claims have one winner, and superseding preserves the old message identity for closure',async()=>{
 await submission();const a=await makeReviewer(2),b=await makeReviewer(3),now=Date.now();
 const results=await Promise.allSettled([claim(env.DB,'s1',a,now),claim(env.DB,'s1',b,now)]);
 expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
 const d=await leaseReviewDelivery(env.DB,'review:s1','223456789012345678','en',now);
 await finishReviewDelivery(env.DB,{...d,channel:'223456789012345678',messageId:'323456789012345678'},now);
 await env.DB.prepare("UPDATE review_submissions SET status='superseded',claimed_by=NULL,claimed_at=NULL WHERE id='s1'").run();
 const next=await leaseReviewDelivery(env.DB,'review:s1','223456789012345678','en',now+1);
 expect(next.messageId).toBe('323456789012345678');expect(next.projection).toMatchObject({status:'superseded',claimant:null});
});

it('disabled community integration refuses v2 notification polling',async()=>{expect((await bridge('review-pending-v2',{},false)).status).toBe(503);});
