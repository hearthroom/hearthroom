import {Hono} from 'hono';
import {type Env,HttpError} from './types';
import {assertNormalMember} from './test-accounts';
import {bumpOp} from './ops-metrics';
import {queuePush} from './community/push';
import {isEnforcementKind} from '../shared/enforcement-notice';

/** The appeal page lives on the HarperHarbor console; a notice may point nowhere else. */
const CONSOLE_HOST='console.harperharbor.com';
const consoleOrigins=(env:Env)=>new Set([`https://${CONSOLE_HOST}`,...(env.ENFORCEMENT_CONSOLE_ORIGINS??'').split(',').map(s=>s.trim()).filter(Boolean)]);

const parseUrl=(value:unknown)=>{if(typeof value!=='string')return null;try{return new URL(value);}catch{return null;}};

type Outcome='delivered'|'duplicate'|'no_member'|'dry_run'|'denied'|'invalid'|'error';

/**
 * Harbor drops a platform account notice (account action, appeal result) into a member's
 * notification list. Server-to-server only, authenticated like the review play-access callback.
 *
 * This is the platform speaking about the member's account, so it is delivered even when the member
 * turned site notifications off; test and retired accounts stay excluded. The row only carries the
 * appeal page link and the deadline or decision; the notice itself lives on the console, so the
 * 30-day notification purge loses nothing durable.
 */
export function enforcementNoticeRoutes(){
 const app=new Hono<{Bindings:Env}>();
 app.post('/internal/enforcement/notices',async c=>{
  c.header('Cache-Control','private, no-store');
  const expected=new TextEncoder().encode(c.env.HOSTING_SERVICE_KEY??'');
  const actual=new TextEncoder().encode(c.req.header('X-Hosting-Key')??'');
  if(!expected.length||actual.length!==expected.length||!crypto.subtle.timingSafeEqual(expected,actual))throw new HttpError(401,'unauthorized');
  let operation='notice',outcome:Outcome='error';
  try{
   const b=await c.req.json().catch(()=>null) as Record<string,unknown>|null;
   if(!b||typeof b!=='object'||!isEnforcementKind(b.kind)||typeof b.accountNumId!=='number'||!Number.isSafeInteger(b.accountNumId)||b.accountNumId<=0){outcome='invalid';throw new HttpError(400,'enforcement_input');}
   const dryRun=b.dryRun===true;
   operation=dryRun?'dry_run':b.kind==='enforcement_result'?'result':'notice';
   // Harbor's dry run (picking the email language) sends only the account and kind.
   let insert:{eventKey:string;url:string;extra:string}|null=null;
   if(!dryRun){
    const url=parseUrl(b.url);
    const deadline=typeof b.deadline==='string'?Date.parse(b.deadline):NaN;
    const valid=typeof b.eventKey==='string'&&b.eventKey.length>0&&b.eventKey.length<=128
     &&url!==null&&url.protocol==='https:'&&!url.username&&!url.password&&consoleOrigins(c.env).has(url.origin)&&String(b.url).length<=512
     &&(b.kind==='enforcement_notice'?b.deadline===undefined||Number.isFinite(deadline):b.decision==='maintained'||b.decision==='revoked');
    if(!valid){outcome='invalid';throw new HttpError(400,'enforcement_input');}
    insert={eventKey:b.eventKey as string,url:url!.href,
     extra:JSON.stringify(b.kind==='enforcement_notice'?(Number.isFinite(deadline)?{deadline:new Date(deadline).toISOString()}:{}):{decision:b.decision})};
   }
   const account=String(b.accountNumId);
   const member=await c.env.DB.prepare(`SELECT id,locale FROM members WHERE id=COALESCE(
     (SELECT owner_member_id FROM member_connections WHERE provider='harbor' AND external_id=?),
     (SELECT member_id FROM member_identities WHERE provider='harbor' AND external_id=?))`)
    .bind(account,account).first<{id:string;locale:string|null}>();
   if(!member){outcome='no_member';return c.json({delivered:false,member:false,locale:''});}
   try{await assertNormalMember(c.env.DB,member.id);}catch(error){outcome='denied';throw error;}
   const locale=member.locale??'';
   if(!insert){outcome='dry_run';return c.json({delivered:false,member:true,locale});}
   // No "notifications off" filter here, unlike community notices: this is an account notice.
   const result=await c.env.DB.prepare(`INSERT OR IGNORE INTO community_notifications(event_key,member_id,kind,path,created_at,extra) VALUES(?,?,?,?,?,?)`)
    .bind(insert.eventKey,member.id,b.kind,insert.url,Date.now(),insert.extra).run();
   outcome=result.meta.changes?'delivered':'duplicate';
   if(result.meta.changes)queuePush(c);
   return c.json({delivered:true,member:true,locale});
  }finally{await bumpOp(c.env.DB,'enforcement_notice',operation,outcome);}
 });
 return app;
}
