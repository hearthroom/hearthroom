import {cleanupLegacy279,legacyCleanupProof} from './qa-legacy-cleanup';
/** Private orchestrator transport. It grants no browser identity or user scope. */
import {Hono} from 'hono';
import {bodyLimit} from 'hono/body-limit';
import {HttpError,type Env} from './types';
import {newHandle} from './members';
const path='/internal/qa/accounts',encoder=new TextEncoder();
const hex=(raw:ArrayBuffer)=>[...new Uint8Array(raw)].map(n=>n.toString(16).padStart(2,'0')).join('');
const hash=async(raw:string)=>hex(await crypto.subtle.digest('SHA-256',encoder.encode(raw)));
function unhex(value:string):Uint8Array{return Uint8Array.from(value.match(/../g)??[],v=>parseInt(v,16));}
type Change={requestId:string;action:'pause'|'reset'|'rotate'|'delete-legacy';oldPublicNo:number;newPublicNo:number;oldGeneration:number;newGeneration:number;stage:number;fresh:boolean};
type Member={id:string;account_class:string;test_generation:number};
export const qaAccountControlRoutes=new Hono<{Bindings:Env}>();
qaAccountControlRoutes.onError((error,c)=>error instanceof HttpError?c.json({error:error.message},error.status):c.json({error:'workflow_pending'},503));
qaAccountControlRoutes.use(path,bodyLimit({maxSize:2048,onError:c=>c.json({error:'invalid_arguments'},400)}));
qaAccountControlRoutes.post(path,async c=>{
 if(c.env.HARBOR_TEST_ACCOUNTS_ENABLED!=='1')return c.notFound();
 const secret=c.env.QA_ACCOUNT_CONTROL_KEY??'',stamp=c.req.header('X-QA-Time')??'',nonce=c.req.header('X-QA-Nonce')??'',signature=c.req.header('X-QA-Signature')??'';
 if(!/^(?:[0-9a-fA-F]{2}){32,128}$/.test(secret)||c.req.header('Origin')||!/^\d{10}$/.test(stamp)||Math.abs(Date.now()/1000-Number(stamp))>30||!/^[a-zA-Z0-9-]{64,128}$/.test(nonce)||!/^([a-f0-9]{2}){32}$/.test(signature)||c.req.header('Content-Type')!=='application/json')throw new HttpError(403,'forbidden');
 if(Number(c.req.header('Content-Length')??0)>2048)throw new HttpError(400,'invalid_arguments');
 const raw=await c.req.text();if(encoder.encode(raw).length>2048)throw new HttpError(400,'invalid_arguments');
 const digest=await hash(raw),key=await crypto.subtle.importKey('raw',unhex(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
 if(!await crypto.subtle.verify('HMAC',key,unhex(signature),encoder.encode([new URL(c.req.url).origin,'POST',path,stamp,nonce,digest].join('\n'))))throw new HttpError(403,'forbidden');
 let input:Change;try{input=JSON.parse(raw);}catch{throw new HttpError(400,'invalid_arguments');}
 const legacy=input?.action==='delete-legacy';
 if(legacy&&(input.oldPublicNo!==279||input.newPublicNo!==279||input.oldGeneration!==0||input.newGeneration!==0||input.stage!==0||input.fresh))throw new HttpError(403,'forbidden');
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).sort().join(',')!=='action,fresh,newGeneration,newPublicNo,oldGeneration,oldPublicNo,requestId,stage')throw new HttpError(400,'invalid_arguments');
 if(typeof input.requestId!=='string'||input.requestId.length<8||input.requestId.length>128||!['pause','reset','rotate','delete-legacy'].includes(input.action)||![input.oldPublicNo,input.newPublicNo].every(v=>Number.isSafeInteger(v)&&v>0)||!Number.isInteger(input.stage)||input.stage<0||input.stage>6||typeof input.fresh!=='boolean')throw new HttpError(400,'invalid_arguments');
 if(!legacy){
  if(![input.oldGeneration,input.newGeneration].every(v=>Number.isSafeInteger(v)&&v>0))throw new HttpError(400,'invalid_arguments');
  const consistent=input.fresh
   ? input.action==='reset'&&input.oldPublicNo!==input.newPublicNo&&input.newGeneration===input.oldGeneration+1
   : input.oldPublicNo===input.newPublicNo&&input.newGeneration===(input.action==='pause'?input.oldGeneration:input.oldGeneration+1);
  if(!consistent)throw new HttpError(400,'invalid_arguments');
 }
 // A valid signature is not reusable, including when the operation body replays.
 try{await c.env.DB.prepare('INSERT INTO qa_browser_nonce(nonce_hash,expires_at) VALUES(?,?)').bind(await hash('control:'+nonce),Date.now()+60000).run();}catch{throw new HttpError(403,'forbidden');}
 const previous=await c.env.DB.prepare('SELECT input_hash,result FROM qa_account_operation WHERE request_id=?').bind(input.requestId).first<{input_hash:string;result:string}>();
 if(previous){if(previous.input_hash!==digest)throw new HttpError(409,'operation_conflict');if(legacy)return c.json(await legacyCleanupProof(c.env));return c.json(JSON.parse(previous.result));}
 if(legacy)return c.json(await cleanupLegacy279(c.env,input.requestId,digest));
 const find=(n:number)=>c.env.DB.prepare(`SELECT m.id,m.account_class,m.test_generation FROM members m WHERE m.id=COALESCE(
  (SELECT owner_member_id FROM member_connections WHERE provider='harbor' AND external_id=?),
  (SELECT member_id FROM member_identities WHERE provider='harbor' AND external_id=?))`).bind(String(n),String(n)).first<Member>();
 const [old,next]=await Promise.all([find(input.oldPublicNo),find(input.newPublicNo)]);
 if((old&&(old.account_class!=='test'||old.test_generation!==input.oldGeneration))||(input.fresh&&next&&(next.account_class!=='test'||next.test_generation!==input.newGeneration)))throw new HttpError(403,'auth_connection_denied');
 if(old){
  const mixed=await c.env.DB.prepare(`SELECT 1 FROM member_identities WHERE member_id=? AND (provider<>'harbor' OR external_id<>?)
   UNION ALL SELECT 1 FROM member_connections WHERE (owner_member_id=? AND (provider<>'harbor' OR external_id<>?)) OR (provider='harbor' AND external_id=? AND owner_member_id<>?) LIMIT 1`).bind(old.id,String(input.oldPublicNo),old.id,String(input.oldPublicNo),String(input.oldPublicNo),old.id).first();
  if(mixed)throw new HttpError(409,'auth_connection_denied');
 }
 const id=next?.id??(input.fresh?crypto.randomUUID():old?.id);
 const statements:D1PreparedStatement[]=[];
 if(input.fresh&&!next){
  statements.push(c.env.DB.prepare("INSERT INTO members(id,handle,created_at,account_class,test_generation,test_state,qa_newcomer_stage) VALUES(?,?,?,'test',?,'active',?)").bind(id,newHandle(),Date.now(),input.newGeneration,input.stage));
  statements.push(c.env.DB.prepare("INSERT INTO member_identities(provider,external_id,member_id,linked_at) VALUES('harbor',?,?,?)").bind(String(input.newPublicNo),id,Date.now()));
 }
 if(old){
  statements.push(c.env.DB.prepare('DELETE FROM account_auth_attempts WHERE source_session IN(SELECT token_hash FROM account_sessions WHERE member_id=?)').bind(old.id));
  statements.push(c.env.DB.prepare('DELETE FROM account_route_handoffs WHERE source_session IN(SELECT token_hash FROM account_sessions WHERE member_id=?)').bind(old.id));
  statements.push(c.env.DB.prepare('DELETE FROM account_route_families WHERE token_hash IN(SELECT token_hash FROM account_sessions WHERE member_id=?)').bind(old.id));
  statements.push(c.env.DB.prepare('DELETE FROM account_sessions WHERE member_id=?').bind(old.id));
  statements.push(c.env.DB.prepare("DELETE FROM account_credentials WHERE provider='harbor' AND external_id=?").bind(String(input.oldPublicNo)));
  statements.push(c.env.DB.prepare("UPDATE members SET test_state=? WHERE id=? AND account_class='test' AND test_generation=?").bind(input.fresh?'retired':input.action==='pause'?'paused':'active',old.id,input.oldGeneration));
  if(input.action==='reset'){for(const table of ['member_update_state','checkin_prompts','suki_states'])statements.push(c.env.DB.prepare(`DELETE FROM ${table} WHERE member_id=?`).bind(old.id));}
  if(input.action==='reset')statements.push(c.env.DB.prepare('DELETE FROM community_notifications WHERE member_id=?').bind(old.id));
 }
 if(id)statements.push(c.env.DB.prepare("UPDATE members SET qa_newcomer_stage=?,test_generation=? WHERE id=? AND account_class='test' AND test_generation=?").bind(input.stage,input.newGeneration,id,input.fresh?input.newGeneration:input.oldGeneration));
 const result={ready:true,sessions:0,credentials:0};
 statements.push(c.env.DB.prepare('INSERT INTO qa_account_operation(request_id,input_hash,result,created_at) VALUES(?,?,?,?)').bind(input.requestId,digest,JSON.stringify(result),Date.now()));
 try{await c.env.DB.batch(statements);}catch{
  const raced=await c.env.DB.prepare('SELECT input_hash,result FROM qa_account_operation WHERE request_id=?').bind(input.requestId).first<{input_hash:string;result:string}>();
  if(raced?.input_hash===digest)return c.json(JSON.parse(raced.result));
  throw new HttpError(409,'operation_conflict');
 }
 // Durable receipt and deletions commit together. Read back scoped state before
 // allowing the PG orchestrator to reactivate this slot.
 const remaining=old?await c.env.DB.prepare(`SELECT (SELECT count(*) FROM account_sessions WHERE member_id=?)+(SELECT count(*) FROM account_credentials WHERE provider='harbor' AND external_id=?) AS n`).bind(old.id,String(input.oldPublicNo)).first<{n:number}>():{n:0};
 if(remaining?.n!==0)throw new HttpError(503,'workflow_pending');
 c.header('Cache-Control','private, no-store');return c.json(result);
});
