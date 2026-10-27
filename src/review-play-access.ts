import {Hono} from 'hono';
import {CLAIM_TTL_MS} from './review';
import {type Env,HttpError} from './types';
import {assertNormalMember} from './test-accounts';
import {bumpOp} from './ops-metrics';

/** Issuer-only, fresh authorization for one actual Provider viewer and sealed review version. */
export function reviewPlayAccessRoutes(){
 const app=new Hono<{Bindings:Env}>();
 app.get('/internal/review/:id/play-access',async c=>{
  c.header('Cache-Control','private, no-store');
  const expected=new TextEncoder().encode(c.env.HOSTING_SERVICE_KEY??'');
  const actual=new TextEncoder().encode(c.req.header('X-Hosting-Key')??'');
  if(!expected.length||actual.length!==expected.length||!crypto.subtle.timingSafeEqual(expected,actual))throw new HttpError(401,'unauthorized');
  let outcome:'allow'|'denied'|'unavailable'='denied';
  try{
   const account=c.req.query('accountNumId')??'',role=c.req.query('roleId')??'';
   if(!/^[1-9]\d*$/.test(account)||!role)throw new HttpError(403,'review_play_denied');
   const row=await c.env.DB.prepare(`SELECT s.claimed_by AS member_id,s.rating,m.age_verified_at
    FROM review_submissions s JOIN hosting_versions v ON v.submission_id=s.id
    JOIN members m ON m.id=s.claimed_by JOIN reviewers r ON r.member_id=m.id AND r.revoked_at IS NULL
    WHERE s.claimed_by=COALESCE(
      (SELECT owner_member_id FROM member_connections WHERE provider='harbor' AND external_id=?),
      (SELECT member_id FROM member_identities WHERE provider='harbor' AND external_id=?))
     AND s.id=? AND s.provider='harbor' AND s.status='pending' AND v.state='pending'
     AND s.source_role_id=? AND v.hosted_revision_id=s.source_role_id
     AND s.claimed_at IS NOT NULL AND s.claimed_at>? AND s.claimed_at<=?
     AND NOT EXISTS(SELECT 1 FROM review_agents a WHERE a.member_id=m.id AND a.revoked_at IS NULL)`)
    .bind(account,account,c.req.param('id'),role,Date.now()-CLAIM_TTL_MS,Date.now()).first<{member_id:string;rating:string;age_verified_at:number|null}>();
   if(!row||(row.rating==='R'&&row.age_verified_at===null))throw new HttpError(403,'review_play_denied');
   await assertNormalMember(c.env.DB,row.member_id);
   outcome='allow';return c.json({allowed:true,reviewId:c.req.param('id'),roleId:role,accountNumId:Number(account)});
  }catch(error){if(!(error instanceof HttpError&&error.status===403))outcome='unavailable';throw error;}
  finally{await bumpOp(c.env.DB,'review_play','admission',outcome);}
 });
 return app;
}
