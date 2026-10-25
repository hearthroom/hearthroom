/** Exclusion-only browser contexts. These are never account authentication. */
import { Hono } from 'hono';
import type { Env } from './types';

const COOKIE='hh_qa_context';
const encoder=new TextEncoder();
const excludedEnvs=new WeakSet<object>();
export function excludeQABrowser(env:Env):Env{
 const marked={...env,ANALYTICS_ENABLED:'false'};
 excludedEnvs.add(marked);
 return marked;
}
export function isQABrowser(env:Env):boolean{return excludedEnvs.has(env);}
const b64=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
function unb64(s:string):Uint8Array{
 if(!/^[A-Za-z0-9_-]+$/.test(s))throw new Error('invalid');
 return Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
}
function secret(env:Env):Uint8Array|null{
 const value=env.QA_BROWSER_CONTEXT_KEY??'';
 if(!/^(?:[0-9a-fA-F]{2}){32,128}$/.test(value))return null;
 return Uint8Array.from(value.match(/../g)!,v=>parseInt(v,16));
}
function validOrigin(value:string):boolean{
 try{const u=new URL(value);return u.origin===value&&!u.username&&!u.password&&(u.protocol==='https:'||(u.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname)));}catch{return false;}
}
type Claims={v:number;aud:string;purpose:string;iat:number;exp:number;nonce:string};
async function verify(env:Env,token:string,audience:string,purpose:'bootstrap'|'context'):Promise<Claims|null>{
 try{
  const rawKey=secret(env);if(!rawKey||token.length>1024||!validOrigin(audience))return null;
  const parts=token.split('.');if(parts.length!==2)return null;
  const key=await crypto.subtle.importKey('raw',rawKey,{name:'HMAC',hash:'SHA-256'},false,['verify']);
  if(!await crypto.subtle.verify('HMAC',key,unb64(parts[1]),encoder.encode(parts[0])))return null;
  const c=JSON.parse(new TextDecoder().decode(unb64(parts[0]))) as Claims;
  const now=Math.floor(Date.now()/1000),max=purpose==='bootstrap'?60:8*3600;
  if(!c||Array.isArray(c)||Object.keys(c).sort().join(',')!=='aud,exp,iat,nonce,purpose,v'||c.v!==1||c.aud!==audience||c.purpose!==purpose||!Number.isSafeInteger(c.iat)||!Number.isSafeInteger(c.exp)||c.iat>now||c.exp<=now||c.exp<=c.iat||c.exp-c.iat>max||typeof c.nonce!=='string'||unb64(c.nonce).length!==32)return null;
  return c;
 }catch{return null;}
}
async function contextCookie(env:Env,origin:string):Promise<string>{
 const now=Math.floor(Date.now()/1000);
 const body=b64(encoder.encode(JSON.stringify({v:1,aud:origin,purpose:'context',iat:now,exp:now+8*3600,nonce:b64(crypto.getRandomValues(new Uint8Array(32)))})));
 const key=await crypto.subtle.importKey('raw',secret(env)!,{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const signed=body+'.'+b64(new Uint8Array(await crypto.subtle.sign('HMAC',key,encoder.encode(body))));
 return `${COOKIE}=${signed}; Path=/; Max-Age=28800; HttpOnly; Secure; SameSite=Lax`;
}
export async function verifyQAContext(req:Request,env:Env):Promise<boolean>{
 const value=req.headers.get('Cookie')?.split(';').map(v=>v.trim()).find(v=>v.startsWith(COOKIE+'='))?.slice(COOKIE.length+1);
 return !!value&&!!await verify(env,value,new URL(req.url).origin,'context');
}
async function receipt(env:Env,result:'exchanged'|'rejected'){
 await env.DB.prepare('INSERT INTO qa_browser_receipt(result,n) VALUES(?,1) ON CONFLICT(result) DO UPDATE SET n=n+1').bind(result).run();
}
export const qaContextRoutes=new Hono<{Bindings:Env}>();
// This blank bootstrap document has no analytics/scripts and grants no identity.
qaContextRoutes.get('/internal/qa/browser-context',c=>{
 c.header('Cache-Control','private, no-store, no-transform');c.header('Referrer-Policy','no-referrer');
 return secret(c.env)?c.html('<!doctype html><title>QA</title>'):c.notFound();
});
qaContextRoutes.post('/internal/qa/browser-context',async c=>{
 c.header('Cache-Control','private, no-store, no-transform');
 if(!secret(c.env))return c.notFound();
 const origin=new URL(c.req.url).origin;
 if(c.req.header('Origin')!==origin||!c.req.header('Content-Type')?.startsWith('application/json'))return c.json({error:'invalid_qa_context'},401);
 const length=Number(c.req.header('Content-Length')??'0');if(length>2048)return c.json({error:'invalid_qa_context'},401);
 let token='';try{const raw=await c.req.text();if(raw.length<=2048){const body=JSON.parse(raw);if(typeof body.ticket==='string')token=body.ticket;}}catch{}
 const claims=await verify(c.env,token,origin,'bootstrap');
 if(!claims){await receipt(c.env,'rejected');return c.json({error:'invalid_qa_context'},401);}
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(claims.nonce))),n=>n.toString(16).padStart(2,'0')).join('');
 const consumed=await c.env.DB.prepare('INSERT OR IGNORE INTO qa_browser_nonce(nonce_hash,expires_at) VALUES(?,?)').bind(hash,claims.exp).run();
 if(consumed.meta.changes!==1){await receipt(c.env,'rejected');return c.json({error:'invalid_qa_context'},401);}
 const cookie=await contextCookie(c.env,origin);
 await receipt(c.env,'exchanged');
 c.header('Set-Cookie',cookie);
 return c.json({ready:true});
});
