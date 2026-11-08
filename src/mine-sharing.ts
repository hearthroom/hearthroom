import {loadMine,mineCache,type MineFilter,type MineResult} from './mine';
import {type Env,HttpError} from './types';
import {upstream,type MyRole,type ProviderIdentity} from './upstream';
import {quotaFor} from './quota';
import {readOwnerVisibilities} from './work-sharing';
import type {WorkAccess} from './work-policy';
import {statusAmong} from './review';

// A filter sees the whole catalog in bounded batches before slicing a page. Raw
// inventory may be cached; current author permissions and review facts never are.
export async function loadSharingMine(env:Env,token:string,me:ProviderIdentity,opts:{page:number;pageSize:number;fresh:boolean;filter:MineFilter;q?:string;access?:WorkAccess}):Promise<MineResult>{
 const account=me.accountNumId;
 if(!opts.access){
  const result=await loadMine({...env,WORK_SHARING_ENABLED:'false'},token,me,{...opts,provider:'harbor'});
  const projections=await readOwnerVisibilities(env,result.body.items.map(r=>r.roleId),token);
  return {...result,body:{...result.body,items:result.body.items.map(r=>({...r,...(projections.get(r.roleId)!.access==='unlisted'?{rating:null}:{}),workVisibility:projections.get(r.roleId)!,draftChanged:projections.get(r.roleId)!.draftChanged}))}};
 }
 const all:MyRole[]=[],seen=new Set<string>();let source:MineResult['source']='hit';
 const cache=await caches.open(mineCache.namespace);
 for(let page=1;;page++){
  const key=new Request(`https://personae.internal/me/harbor/${account}/sharing?page=${page}&q=${encodeURIComponent(opts.q??'')}`);
  const cached=!opts.fresh?await cache.match(key):undefined;
  let catalog;
  if(cached)catalog=await cached.json() as Awaited<ReturnType<typeof upstream.fetchMyRoles>>;
  else{
   catalog=await upstream.fetchMyRoles(env,token,page,100,'harbor',opts.q??'');source=opts.fresh?'bypass':'miss';
   await cache.put(key,Response.json(catalog,{headers:{'Cache-Control':'max-age=60'}}));
  }
  for(const r of catalog.items){if(seen.has(r.roleId))throw new HttpError(503,'visibility_provider_unavailable');seen.add(r.roleId);}
  all.push(...catalog.items);
  if(!catalog.hasNext)break;
  if(!catalog.items.length)throw new HttpError(503,'visibility_provider_unavailable');
 }
 const [projections,submitted,quota]=await Promise.all([
  readOwnerVisibilities(env,all.map(r=>r.roleId),token),
  env.DB.prepare(`SELECT c.source_role_id FROM cards c WHERE c.provider='harbor' AND c.author_num_id=? AND
   (c.approved_version_id IS NOT NULL OR (c.status='approved' AND c.registered_at>0)
    OR EXISTS(SELECT 1 FROM card_registrations r WHERE r.provider=c.provider AND r.source_role_id=c.source_role_id)
    OR EXISTS(SELECT 1 FROM review_submissions s WHERE s.provider=c.provider AND (s.card_id=c.id OR s.id IN(SELECT submission_id FROM hosting_versions WHERE provider=c.provider AND source_role_id=c.source_role_id))))`).bind(account).all<{source_role_id:string}>(),
  quotaFor(env.DB,me,Date.now(),'harbor'),
 ]);
 const registered=new Set(submitted.results.map(r=>r.source_role_id));
 const rows=all.filter(r=>(!opts.access||projections.get(r.roleId)!.access===opts.access)
  &&(opts.filter==='listed'?registered.has(r.roleId):opts.filter==='unlisted'?!registered.has(r.roleId):true));
 const offset=(opts.page-1)*opts.pageSize;
 const page=rows.slice(offset,offset+opts.pageSize);
 // 重新審核中（審核員發起）不在 Harbor 的可見性裡，只在本站：這一頁照樣補上，不帶理由與發起人
 const review=await statusAmong(env.DB,page.map(r=>r.roleId));
 const items=page.map(({contentHash:_,...r})=>{
  const workVisibility=projections.get(r.roleId)!;
  return {...r,...(workVisibility.access==='unlisted'?{rating:null}:{}),registered:registered.has(r.roleId),workVisibility,draftChanged:workVisibility.draftChanged,...(review.get(r.roleId)?.reReview?{reReview:true}:{})};
 });
 return {source,body:{items,total:rows.length,registeredTotal:registered.size,quota,page:opts.page,pageSize:opts.pageSize,hasNext:offset+opts.pageSize<rows.length}};
}
