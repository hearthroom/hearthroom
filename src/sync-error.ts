import { HttpError } from './types';
import type { ProviderId } from './providers';
export interface SyncDetail { provider: ProviderId; step: string; upstreamStatus?: number; upstreamCode?: string }
// Only fixed operations and known codes may leave this boundary. Never upstream
// prose, request URLs, tokens, card content or account identifiers.
const codes = new Set(['invalid_arguments','invalid_argument','invalid_request','insufficient_scope','unauthorized','forbidden','permission_denied','not_found','role_not_found','role_in_review','public_role_requires_clone','validate_reject','quota_exceeded','version_conflict','conflict','temporarily_unavailable']);
export function syncStep(path: string): string {
 if(path.startsWith('/me'))return 'identity';
 if(path.includes('/media/'))return 'image';
 if(path.includes('/worldbook'))return 'lorebook';
 if(path.includes('author-asset'))return 'author_asset';
 if(path.includes('/document'))return 'document';
 if(path.includes('/welcome'))return 'greeting';
 if(path.includes('/locales'))return 'translation';
 if(path.includes('publish'))return 'publish';
 if(path==='/role')return 'create';
 return 'read';
}
export async function upstreamSyncError(r:Response,p:ProviderId,path:string):Promise<HttpError> {
 const body=await r.json().catch(()=>({})) as {error?:unknown};
 const code=typeof body.error==='string'&&codes.has(body.error)?body.error:undefined;
 const message=r.status===401?'sync_authorization_expired':r.status===403?'sync_permission_denied':r.status===404?'sync_resource_missing':r.status<500?'sync_upstream_rejected':'sync_upstream_failed';
 return new HttpError(r.status===401?401:r.status===403?403:502,message,{provider:p,step:syncStep(path),upstreamStatus:r.status,...(code?{upstreamCode:code}:{})});
}
