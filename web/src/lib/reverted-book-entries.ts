import type { WorldbookDraft } from './worldbook-draft';
import type { WorldbookEntryDraft } from './role-draft';

/** Map sealed entry identities to their editable copies when saving a revert. */
export function revertedBookEntries(beforeId:string,targetId:string,before:WorldbookEntryDraft[],target:WorldbookEntryDraft[],edited:WorldbookEntryDraft[]):WorldbookEntryDraft[]{
 if(beforeId===targetId)return edited.map(entry=>({...entry}));
 const ids=new Map(before.map((entry,i)=>[entry.entryId,target[i]?.entryId]));
 return edited.map(entry=>({...entry,entryId:entry.entryId?ids.get(entry.entryId):undefined}));
}

const copied=<T,>(value:T):T=>JSON.parse(JSON.stringify(value));
const bookKeys = ['id','name','desc','meta','format','entries','original','otherBoundBooks','pending','bindPending','boundId','loading','loadFailed'] as const;
export type BookSnapshot = Pick<WorldbookDraft,typeof bookKeys[number]>;
export function bookSnapshot(book:WorldbookDraft):BookSnapshot {
 return copied(Object.fromEntries(bookKeys.map(key=>[key,book[key]]))) as BookSnapshot;
}
export function mergeRevertedBookEdits(target:WorldbookDraft,before:BookSnapshot,edited:BookSnapshot){
 const content=(b:BookSnapshot)=>JSON.stringify([b.id,b.name,b.desc,b.format,b.entries]);
 if(content(before)===content(edited))return;
 // The existing diff engine must compare library edits with what this page
 // originally read, so another tab's additions/edits do not become our writes.
 if(before.id===target.id){Object.assign(target,{format:undefined},copied(edited));return;}
 if(edited.id!==before.id){const bound=target.boundId;const others=target.otherBoundBooks;Object.assign(target,copied(edited));target.boundId=bound;target.otherBoundBooks=others;target.bindPending=Boolean(target.id);return;}
 target.name=edited.name;target.desc=edited.desc;target.format=edited.format;
 target.entries=revertedBookEntries(before.id,target.id,before.entries,target.entries,copied(edited.entries));
}
