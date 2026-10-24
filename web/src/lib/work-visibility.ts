import { COMMUNITY_API } from './config';
import type { ProviderId } from './provider';

export type WorkAccess = 'private' | 'unlisted' | 'public';
export type VisibilityAction = 'set_private' | 'set_unlisted' | 'restore_public' | 'submit_review' | 'submit_update' | 'cancel_review';
export interface WorkVisibility {
 access: WorkAccess;
 effectiveAccess: 'owner' | 'link' | 'public' | 'denied' | 'unavailable';
 review: 'none' | 'pending' | 'rejected' | 'needs_review' | 'revoked';
 update: 'none' | 'pending' | 'rejected';
 everPublic: boolean;
 revisionState: 'same' | 'changed' | 'unknown';
 restorable: boolean;
 restoreReason: 'none' | 'no_approval' | 'content_changed' | 'revision_unknown' | 'restricted' | 'unavailable';
 draftChanged: boolean;
 restriction: 'none' | 'delisted' | 'suspended' | 'takedown';
 reviewNote?: string;
 restrictionNote?: string;
 policyRevision: string;
 approvalRevision: string;
 actions: VisibilityAction[];
 syncState: 'complete' | 'changing' | 'unavailable';
}
export interface VisibilityOperation { operationId: string; state: 'pending' | 'complete' | 'conflict'; error?: string }
export interface VisibilityResult { workVisibility?: WorkVisibility; operation?: VisibilityOperation }
export type VisibilityRevision = Pick<WorkVisibility, 'policyRevision' | 'approvalRevision'>;
export type VisibilityCommand = {
 operationId: string; expectedPolicyRevision: string; expectedApprovalRevision: string;
} & ({ action?: 'set_access'; targetAccess: WorkAccess } | { action: 'cancel_review' });
export class VisibilityError extends Error {
 readonly code:string;
 constructor(readonly status:number, readonly result:VisibilityResult & {error?:string}) {
  super('Visibility request could not be confirmed');this.code=result.error??'';
 }
}
const path=(id:string)=>`${COMMUNITY_API}/me/cards/${encodeURIComponent(id)}/visibility`;
async function request(url:string,token:string,provider:ProviderId,command?:VisibilityCommand):Promise<VisibilityResult> {
 const response=await fetch(url, {method:command?'POST':'GET',cache:'no-store',
  headers:{Authorization:`Bearer ${token}`,'X-Provider':provider,...(command?{'Content-Type':'application/json'}:{})},
  ...(command?{body:JSON.stringify(command)}:{})});
 const body=await response.json() as VisibilityResult & {error?:string};
 if(!response.ok)throw new VisibilityError(response.status,body);
 return body;
}
export const fetchWorkVisibility=(id:string,token:string,provider:ProviderId)=>request(path(id),token,provider);
export const changeWorkVisibility=(id:string,token:string,provider:ProviderId,command:VisibilityCommand)=>request(path(id),token,provider,command);
export const fetchVisibilityOperation=(id:string,operationId:string,token:string,provider:ProviderId)=>request(`${path(id)}/operations/${encodeURIComponent(operationId)}`,token,provider);
