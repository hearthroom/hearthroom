import {cardsByIds,listCards,toCard,type CardRow,type ListOptions} from './cards';
import {hostingKey} from './hosting';
import {type Env,HttpError} from './types';
import {filterPublicRows,WORK_READ_BUDGET,type VisibilityReadSurface} from './work-read';

type Position={raw:number;trail:number[]};
interface Cursor extends Position {rank:number;binding:string;expires:number}
export interface PublicCandidates {version:1;ids:string[];rawOffset:number;more:boolean;total:number|null;filtered:boolean;partial?:boolean}
const encoder=new TextEncoder();
const base64=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
async function key(env:Env):Promise<CryptoKey|null>{
 const secret=hostingKey(env,'harbor');if(!secret)return null;
 const hash=await crypto.subtle.digest('SHA-256',encoder.encode('hearthroom-visibility-cursor-v1:'+secret));
 return crypto.subtle.importKey('raw',hash,'AES-GCM',false,['encrypt','decrypt']);
}
async function bindingOf(url:string,adult:boolean,context:string):Promise<string>{
 const parsed=new URL(url);for(const field of ['offset','cursor','lang'])parsed.searchParams.delete(field);parsed.searchParams.sort();
 const hash=await crypto.subtle.digest('SHA-256',encoder.encode(JSON.stringify([parsed.pathname,parsed.search,adult,context])));
 return base64(new Uint8Array(hash));
}
async function encode(env:Env,value:Cursor):Promise<string|undefined>{
 const secret=await key(env);if(!secret)return undefined;
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv},secret,encoder.encode(JSON.stringify(value)));
 return base64(new Uint8Array([...iv,...new Uint8Array(ciphertext)]));
}
export async function publicPosition(env:Env,url:string,rank:number,adult:boolean,context=''):Promise<Position&{binding:string}>{
 const binding=await bindingOf(url,adult,context),token=new URL(url).searchParams.get('cursor');
 if(!token)return {raw:rank,trail:[],binding};
 try{
  if(token.length>8192||!/^[A-Za-z0-9_-]+$/.test(token))throw new Error('invalid');
  const secret=await key(env);if(!secret)throw new Error('unavailable');
  const bytes=Uint8Array.from(atob(token.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));
  const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes.slice(0,12)},secret,bytes.slice(12));
  const value=JSON.parse(new TextDecoder().decode(plain)) as Cursor;
  const valid=(n:number)=>Number.isSafeInteger(n)&&n>=0&&n<=2_000_000;
  if(value.binding!==binding||value.rank!==rank||value.expires<Date.now()||!valid(value.raw)||!Array.isArray(value.trail)||value.trail.length>500||!value.trail.every(valid))throw new Error('invalid');
  return {...value,binding};
 }catch{throw new HttpError(400,'invalid_cursor');}
}
export async function publicCandidates(env:Env,opts:ListOptions,rawOffset:number):Promise<PublicCandidates>{
 const result=await listCards(env.DB,{...opts,limit:WORK_READ_BUDGET,offset:rawOffset});
 const filtered=!!(opts.favoritedBy!==undefined||opts.followedBy!==undefined||opts.q||opts.fandom||opts.tags?.length||opts.tagGroups?.length||opts.authorMemberId!==undefined||opts.since!==undefined||opts.maxRating);
 return {version:1,ids:result.rows.map(r=>String(r.id)),rawOffset,more:result.hasNext,total:result.total,filtered,...(result.partial?{partial:true}:{})};
}
export function parsePublicCandidates(body:string):PublicCandidates|null{
 try{
  const value=JSON.parse(body) as PublicCandidates;
  return value?.version===1&&Array.isArray(value.ids)&&value.ids.length<=WORK_READ_BUDGET&&value.ids.every(id=>typeof id==='string')&&Number.isSafeInteger(value.rawOffset)&&typeof value.more==='boolean'?value:null;
 }catch{return null;}
}
export async function publicCandidatePage(env:Env,candidates:PublicCandidates,position:Position&{binding:string},opts:{limit:number;offset:number;lang:string;allowNsfw:boolean;surface?:VisibilityReadSurface}){
 if(candidates.rawOffset!==position.raw)throw new HttpError(503,'visibility_provider_unavailable');
 const result=await cardsByIds(env.DB,candidates.ids);
 const found=new Map(result.filter(r=>r.status==='approved'&&!r.board_hidden&&!r.public_blocked).map(r=>[String(r.id),r]));
 const ordered=candidates.ids.map(id=>found.get(id)).filter((r):r is CardRow=>!!r&&(opts.allowNsfw||r.rating!=='R'));
 const visible=await filterPublicRows(env,ordered,opts.surface??'list');
 if(visible.rows.length<=opts.limit&&candidates.more)throw new HttpError(503,'visibility_read_budget_exceeded');
 const rows=visible.rows.slice(0,opts.limit),hasNext=!candidates.partial&&visible.rows.length>opts.limit;
 const managed=await env.DB.prepare('SELECT 1 FROM managed_work_access LIMIT 1').first();
 const nextRaw=rows.length?position.raw+candidates.ids.indexOf(String(rows.at(-1)!.id))+1:position.raw;
 const common={binding:position.binding,expires:Date.now()+60*60*1000};
 const nextCursor=hasNext?await encode(env,{...common,raw:nextRaw,rank:opts.offset+opts.limit,trail:[...position.trail,position.raw]}):undefined;
 if(hasNext&&nextRaw!==opts.offset+opts.limit&&!nextCursor)throw new HttpError(503,'visibility_provider_unavailable');
 const previousCursor=position.trail.length?await encode(env,{...common,raw:position.trail.at(-1)!,rank:Math.max(0,opts.offset-opts.limit),trail:position.trail.slice(0,-1)}):undefined;
 return {items:rows.map(r=>toCard(r,opts.lang)),total:managed||candidates.filtered&&hasNext?null:candidates.total,hasNext,limit:opts.limit,offset:opts.offset,...(candidates.partial?{partial:true}:{}),...(nextCursor?{nextCursor}:{}),...(previousCursor?{previousCursor}:{})};
}
