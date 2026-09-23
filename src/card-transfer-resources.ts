import { HttpError } from './types';
export type TransferCall=(path:string,body?:unknown,method?:string)=>Promise<Record<string,any>>;
export interface TransferBook { sourceId:string; metadata:Record<string,any>; entries:Record<string,any>[] }
const string=(v:unknown)=>typeof v==='string'?v:'';
export function canonicalEntry(e:Record<string,any>,preservePriority=false):Record<string,any> {
 if(!e || typeof e.content!=='string' || typeof e.name!=='string')throw new HttpError(409,'sync_unsupported_content');
 return {...(preservePriority&&typeof e.priority==='number'?{priority:e.priority}:{}),name:e.name,content:e.content,keywords:e.keywords||[],secondaryKeywords:e.secondaryKeywords||[],category:e.category||'custom',triggerRegion:e.triggerRegion||'both',isEnabled:e.isEnabled!==false,isConstant:e.isConstant===true,matchOptions:e.matchOptions??null};
}
export function canonicalAsset(a:Record<string,any>) {
 return {rules:(a.rules||[]).map((r:any)=>({id:r.id,name:r.name,find:r.find,replace:r.replace,enabled:r.enabled!==false})),mountTrigger:string(a.mountTrigger),mountLayer:string(a.mountLayer),pageMode:a.pageMode==='sandbox'?'sandbox':'classic'};
}
export function hasAsset(a:ReturnType<typeof canonicalAsset>) { return !!(a.rules.length||a.mountTrigger||a.pageMode==='sandbox'); }
export async function readBooks(call:TransferCall,roleId:string,preserveExecution=false):Promise<TransferBook[]> {
 const bindings=await call(`/worldbook/bindings?roleId=${encodeURIComponent(roleId)}`);
 if(!Array.isArray(bindings.bindings))throw new HttpError(409,'sync_unsupported_content');
 const books:TransferBook[]=[];
 for(const b of bindings.bindings) {
  if(preserveExecution&&b.isActive===false)throw new HttpError(409,'sync_unsupported_content');
  if(typeof b.worldbookId!=='string')throw new HttpError(409,'sync_unsupported_content');
  const q=encodeURIComponent(b.worldbookId);
  const detail=await call(`/worldbook/detail?worldbookId=${q}`);
  const list=await call(`/worldbook/entry/list?worldbookId=${q}`);
  list.entries ??= list.list;
  if(typeof detail.name!=='string'||!Array.isArray(list.entries))throw new HttpError(409,'sync_unsupported_content');
  // Refuse a partial upstream page, never silently truncate a Lorebook.
  if(list.hasNextPage || (typeof list.total==='number'&&list.total>list.entries.length))throw new HttpError(409,'sync_unsupported_content');
  const tags=Array.isArray(detail.tags)?detail.tags:String(detail.tags||'').split(',').filter(Boolean);
  books.push({sourceId:b.worldbookId,metadata:{name:detail.name,description:string(detail.description),iconUrl:string(detail.iconUrl),tags,language:string(detail.language),format:string(detail.format)},entries:list.entries.map((e:Record<string,any>)=>canonicalEntry(e,preserveExecution))});
 }
 return books;
}
