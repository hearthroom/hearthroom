import { HttpError } from './types';
export type TransferCall=(path:string,body?:unknown,method?:string)=>Promise<Record<string,any>>;
export interface TransferBook { sourceId:string; metadata:Record<string,any>; entries:Record<string,any>[] }
export interface TransferProgress { books:Record<string,{id?:string;status:'creating'|'created'}> }
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
export async function writeBooks(call:TransferCall,roleId:string,books:TransferBook[],progress:TransferProgress,save:()=>Promise<void>,checkpoint:()=>Promise<void>,reorderMode:'whole-book'|'prepend-batches'='whole-book') {
 for(const book of books) {
  // LunaTalk assigns absolute positions and accepts at most 2,000 IDs.
  if(reorderMode==='whole-book' && book.entries.length>2000)throw new HttpError(409,'sync_unsupported_content');
  let state=progress.books[book.sourceId];
  if(state?.status==='creating'&&!state.id)throw new HttpError(409,'sync_create_unconfirmed');
  if(!state?.id) {
   progress.books[book.sourceId]={status:'creating'};
   await save(); // Persist uncertainty before a remote create can happen.
   const created=await call('/worldbook',{...book.metadata,visibility:'private'});
   if(typeof created.worldbookId!=='string')throw new HttpError(502,'sync_create_unconfirmed');
   state=progress.books[book.sourceId]={id:created.worldbookId,status:'created'};
   await save();
  }
  const old=await call(`/worldbook/entry/list?worldbookId=${encodeURIComponent(state.id!)}`);
  old.entries ??= old.list;
  if(!Array.isArray(old.entries)||old.hasNextPage||(typeof old.total==='number'&&old.total>old.entries.length))throw new HttpError(409,'sync_unsupported_content');
  // Hash normalization is not a wire format: restore defaults before API writes.
  const operations=[...old.entries.map((e:any)=>({op:'delete',entryId:e.entryId})),...book.entries.map(e=>({op:'create',...canonicalEntry(e,typeof e.priority==='number')}))];
  const createdIds:string[]=[];
  // Stay below both providers' document limits. A retry reads the mapped book
  // again and replaces its current entries, including any completed chunks.
  // Keep a readback checkpoint after every acknowledged write; an ambiguous
  // response still fails closed through the existing target-version guard.
  for(let offset=0;offset<Math.max(1,operations.length);offset+=100) {
   const result=await call(`/worldbook/${encodeURIComponent(state.id!)}/document`,{
    metadata:{...book.metadata,visibility:'private'},
    entries:operations.slice(offset,offset+100),
    binding:{roleId},
   });
   if(Array.isArray(result.createdEntryIds))createdIds.push(...result.createdEntryIds);
   await checkpoint();
  }
  if(createdIds.length) {
   // Harper moves listed IDs to the front, retaining the rest in order.
   // Prepend chunks from last to first to preserve the complete source order.
   // LunaTalk assigns absolute positions, so it must receive one complete list.
   const size=reorderMode==='prepend-batches'?100:createdIds.length;
   for(let offset=Math.floor((createdIds.length-1)/size)*size;offset>=0;offset-=size) {
    await call(`/worldbook/${encodeURIComponent(state.id!)}/entries/reorder`,{entryIds:createdIds.slice(offset,offset+size)});
    await checkpoint();
   }
  }
 }
}
