import { cardsByIds } from '../cards';
import { currentCardsAccess } from '../work-read';
import type { Env } from '../types';

export interface UpdateNoticeRef {id:string;kind:string;extra:string|null;card_id:string|number|null}
/** New log snapshots retain their version, but never bypass current access or adult consent. */
export async function updateNoticeVisibility(env:Env,notes:UpdateNoticeRef[],allowAdult=false){
 const refs=notes.flatMap(n=>{
  if(n.kind!=='followed_work'||!n.extra)return [];
  try{const e=JSON.parse(n.extra);return e.event==='update'&&typeof e.version==='string'?[{id:n.id,card:String(n.card_id),version:e.version}]:[];}catch{return [];}
 });
 const newIds=new Set(refs.map(n=>n.id)),reachable=new Set<string>(),readable=new Set<string>();
 if(!refs.length)return {newIds,reachable,readable,unavailable:false};
 try{
  const versions=await env.DB.prepare('SELECT version_id,card_id,rating FROM hosting_versions WHERE version_id IN(SELECT value FROM json_each(?))')
   .bind(JSON.stringify([...new Set(refs.map(r=>r.version))])).all<{version_id:string;card_id:number;rating:string}>();
  const versionMap=new Map(versions.results.map(v=>[v.version_id,v]));
  const cards=await cardsByIds(env.DB,[...new Set(refs.map(r=>r.card))]);
  const cardMap=new Map(cards.map(c=>[String(c.id),c])),access=await currentCardsAccess(env,cards,'social');
  for(const ref of refs){
   const v=versionMap.get(ref.version),c=cardMap.get(ref.card),a=access.get(ref.card);
   if(!v||String(v.card_id)!==ref.card||!c||!a?.reachable)continue;
   reachable.add(ref.id);
   if(allowAdult||(v.rating!=='R'&&c.rating!=='R'&&a.access==='public'))readable.add(ref.id);
  }
  return {newIds,reachable,readable,unavailable:false};
 }catch{return {newIds,reachable,readable,unavailable:true};}
}
