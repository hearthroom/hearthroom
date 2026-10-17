import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { gateInventory } from './draft-transfer-inventory';
import { bumpOp } from './ops-metrics';
import { HttpError, type Env } from './types';

type Gate = { seq:number; request_id:string; scope:string; provider:string; source_role_id:string; card_num:number; operation:string; generation:number; phase:string; baseline_digest:string; receipt_hash:string; evidence_hash:string; payload:string };
const hash = async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),x=>x.toString(16).padStart(2,'0')).join('');
const validId=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_-]{8,100}$/.test(v);
const validHash=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
export const isTransferHeld=(error:unknown)=>String(error).includes('draft_transfer_held');

/** Private rows never leave the worker. One D1 batch gives a single snapshot of the closure. */
async function inventory(db:D1Database,gate:Gate){
 const results=await db.batch(gateInventory.map(([table,predicate])=>db.prepare(`SELECT t.* FROM ${table} t WHERE ${predicate.replace('WHERE node IN','WHERE gate_seq=? AND node IN')}`).bind(gate.seq)));
 const rows=results.map((r,i)=>[gateInventory[i][0],r.results.map(row=>JSON.stringify(row)).sort()] as const);
 const counts=Object.fromEntries(rows.map(([table,r])=>[table,r.length]));
 const identity=results[0].results;
 if(identity.length!==1)throw new HttpError(409,'draft_transfer_identity_changed');
 const blockers=Object.entries(counts).filter(([table,count])=>table!=='card_numbers'&&count>0).map(([table])=>table);
 return {digest:await hash(JSON.stringify(rows)),counts,blockers};
}

/** Called only by the dedicated secret-authenticated operator route. No ordinary author control surface. */
export async function controlTransferGate(db:D1Database,scope:string,input:unknown){
 if(!input||typeof input!=='object'||Array.isArray(input))throw new HttpError(400,'draft_transfer_input');
 const b=input as Record<string,unknown>;
 if(b.scope!==scope||b.provider!=='harbor'||!validId(b.sourceRoleId)||!Number.isSafeInteger(b.cardNum)||Number(b.cardNum)<=0||!validId(b.operation)||!Number.isSafeInteger(b.generation)||Number(b.generation)<1||!['status','held','prepared','released'].includes(String(b.action)))throw new HttpError(400,'draft_transfer_input');
 const current=()=>db.prepare('SELECT * FROM draft_transfer_gate_latest WHERE provider=? AND source_role_id=?').bind(b.provider,b.sourceRoleId).first<Gate>();
 let gate=await current();
 if(b.action==='status'){
  if(!gate||gate.scope!==scope||gate.card_num!==b.cardNum||gate.operation!==b.operation||gate.generation!==b.generation)throw new HttpError(409,'draft_transfer_gate_conflict');
  return {phase:gate.phase,generation:gate.generation,baselineDigest:gate.baseline_digest,receiptHash:gate.receipt_hash,evidenceHash:gate.evidence_hash,...(gate.phase==='released'?{}:await inventory(db,gate))};
 }
 if(!validId(b.requestId))throw new HttpError(400,'draft_transfer_input');
 const payload=JSON.stringify([scope,b.provider,b.sourceRoleId,b.cardNum,b.operation,b.generation,b.action,b.baselineDigest??'',b.receiptHash??'',b.evidenceHash??'',b.resolution??'']);
 const replay=await db.prepare('SELECT payload FROM draft_transfer_gate_events WHERE request_id=?').bind(b.requestId).first<{payload:string}>();
 if(replay){if(replay.payload!==payload)throw new HttpError(409,'draft_transfer_gate_conflict');return {replayed:true,phase:gate?.phase,generation:gate?.generation};}
 let baseline='';
 if(b.action!=='held'){
  if(!gate||gate.scope!==scope||gate.card_num!==b.cardNum||gate.operation!==b.operation||gate.generation!==b.generation)throw new HttpError(409,'draft_transfer_gate_conflict');
  const state=await inventory(db,gate);baseline=state.digest;
  if(b.baselineDigest!==baseline)throw new HttpError(409,'draft_transfer_baseline_changed');
  if(b.action==='released'&&(!validHash(b.receiptHash)||!validHash(b.evidenceHash)||!['verified_forward','verified_recovery','verified_no_apply'].includes(String(b.resolution))))throw new HttpError(400,'draft_transfer_release_evidence');
 }
 try{
  await db.prepare(`INSERT INTO draft_transfer_gate_events(request_id,scope,provider,source_role_id,card_num,operation,generation,phase,baseline_digest,receipt_hash,evidence_hash,payload,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
   .bind(b.requestId,scope,b.provider,b.sourceRoleId,b.cardNum,b.operation,b.generation,b.action,baseline,b.receiptHash??'',b.evidenceHash??'',payload,Date.now()).run();
 }catch(error){
  const retry=await db.prepare('SELECT payload FROM draft_transfer_gate_events WHERE request_id=?').bind(b.requestId).first<{payload:string}>();
  if(!retry||retry.payload!==payload){
   if(String(error).includes('draft_transfer_gate_conflict')||String(error).includes('UNIQUE constraint'))throw new HttpError(409,'draft_transfer_gate_conflict');
   throw error;
  }
 }
 gate=await current();
 return {phase:gate!.phase,generation:gate!.generation,...(gate!.phase==='released'?{}:await inventory(db,gate!))};
}

export const transferGateRoutes=new Hono<{Bindings:Env}>();
transferGateRoutes.post('/internal/community/draft-transfer-gate',bodyLimit({maxSize:8192}),async c=>{
 c.header('Cache-Control','no-store');
 try{
  const secret=c.env.DRAFT_TRANSFER_CONTROL_SECRET,scope=c.env.DRAFT_TRANSFER_CONTROL_SCOPE;
  if(!secret||secret.length<32||!scope||!c.env.DRAFT_TRANSFER_CONTROL_CARD_NUM)throw new HttpError(503,'draft_transfer_control_unavailable');
  const actual=c.req.header('Authorization')??'';
  const [a,b]=await Promise.all([hash(actual),hash('Bearer '+secret)]);let difference=0;
  for(let i=0;i<a.length;i++)difference|=a.charCodeAt(i)^b.charCodeAt(i);
  if(difference)throw new HttpError(403,'draft_transfer_control_denied');
  // Never use d1-session's fallback to an unconstrained replica for operator decisions.
  const db=c.env.DB.withSession('first-primary') as unknown as D1Database;
  const input=await c.req.json().catch(()=>{throw new HttpError(400,'draft_transfer_input');});
  if(!input||typeof input!=='object'||String((input as Record<string,unknown>).cardNum)!==c.env.DRAFT_TRANSFER_CONTROL_CARD_NUM)throw new HttpError(403,'draft_transfer_scope_denied');
  return c.json(await controlTransferGate(db,scope,input));
 }catch(error){
  await bumpOp(c.env.DB,'draft_transfer_gate','transition',error instanceof HttpError&&error.status<500?'denied':'error');
  return c.json({error:error instanceof HttpError?error.message:'draft_transfer_control_error'},error instanceof HttpError?error.status:503);
 }
});
