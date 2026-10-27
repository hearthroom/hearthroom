import {shallowReactive} from 'vue';
import type {ProviderId} from './provider';

const pending=shallowReactive(new Set<string>());
export const publicationOperationKey=(provider:ProviderId,roleId:string)=>`hearthroom:publication:${provider}:${roleId}`;
export function notePublicationOperation(key:string,exists:boolean):void{
 if(exists)pending.add(key);else pending.delete(key);
}
/** A persisted operation can outlive the dialog and the tab. Reading it here
 * enables the existing edit/save recovery path without a fabricated draft edit. */
export function hasPublicationOperation(provider:ProviderId,roleId:string):boolean{
 const key=publicationOperationKey(provider,roleId);
 if(pending.has(key))return true;
 try{return !!localStorage.getItem(key);}catch{return false;}
}
