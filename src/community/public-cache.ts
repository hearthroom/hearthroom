import type { Env } from '../types';
import { snapshot } from '../snapshot-cache';
import { publicCommunityViews } from './service';
/** One authoritative read for a whole page; only public projections reach shared caches. */
export async function publicIdentities(env:Env,handles:string[],ctx:Pick<ExecutionContext,'waitUntil'>) {
 const unique=[...new Set(handles)];
 const now=Date.now();
 const rows=unique.length?(await env.DB.prepare(`SELECT m.id,m.handle,m.public_cache_revision AS revision,
 (SELECT MIN(expires_at) FROM community_awards WHERE member_id=m.id AND revoked_at IS NULL AND expires_at>?) AS award_expiry,
 (SELECT verified_at+86400000 FROM community_discord_appearance WHERE member_id=m.id) AS appearance_expiry
 FROM members m WHERE handle IN (${unique.map(()=>'?').join(',')})`).bind(now,...unique).all<{id:string;handle:string;revision:string;award_expiry:number|null;appearance_expiry:number|null}>()).results:[];
 let cold:ReturnType<typeof publicCommunityViews>|undefined;
 const load=(id:string)=>(cold??=publicCommunityViews(env,rows.map(r=>r.id))).then(values=>values.get(id)??{badges:[]});
 const values=await Promise.all(unique.map(async handle=>{
  const row=rows.find(r=>r.handle===handle);
  if(!row)return {handle,value:{badges:[]},layer:'origin' as const};
  const expires=Math.min(now+300000,row.award_expiry??Infinity,row.appearance_expiry&&row.appearance_expiry>now?row.appearance_expiry:Infinity);
  const result=await snapshot(env,['identity',row.id,row.revision,env.COMMUNITY_ENABLED,row.award_expiry,!!row.appearance_expiry&&row.appearance_expiry>now],Math.max(.001,(expires-now)/1000),()=>load(row.id),ctx);
  return {handle,...result};
 }));
 return {members:Object.fromEntries(values.map(v=>[v.handle,v.value])),layer:values.some(v=>v.layer==='origin')?'origin':values.some(v=>v.layer==='kv')?'kv':'edge'};
}
