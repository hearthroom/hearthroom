import type {DraftState} from './api';
/** Read-only status fallback while the new author workflow is disabled. No access or action inference. */
export function legacyAuthorStateKey(draft:DraftState|null,status?:string):string{
 if(draft?.updateStatus==='pending')return 'visibility.editor.pendingPublic';
 const current=draft?.status??status;
 if(current==='pending'||current==='waitReview')return 'visibility.state.pendingEditor';
 if(draft?.draftChanged)return 'workspace.draftChanged';
 if(['approved','rejected','needs_review','unshared'].includes(current??''))return `mine.badge.${current}`;
 return '';
}
