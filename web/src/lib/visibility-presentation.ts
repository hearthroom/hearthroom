import type { WorkVisibility } from './work-visibility';
export function visibilityStateKey(v:WorkVisibility,editor=false):string {
 if(v.syncState!=='complete')return v.syncState==='unavailable'?'visibility.operation.unknown':'visibility.operation.updating';
 if(v.restriction!=='none')return `visibility.restriction.${v.restriction}`;
 if(v.review==='revoked')return 'visibility.state.revoked';
 if(v.update==='pending')return editor?'visibility.editor.pendingPublic':'visibility.state.updatePending';
 if(v.update==='rejected')return 'visibility.state.updateRejected';
 if(v.review==='pending')return editor?(v.access==='unlisted'?'visibility.editor.pendingLink':'visibility.state.pendingEditor'):(v.access==='private'?'visibility.state.pendingPrivate':'visibility.state.pendingLink');
 if(v.review==='rejected')return 'visibility.state.rejected';
 if(v.access==='unlisted')return editor?'visibility.link.saveEffect':'visibility.state.unlisted';
 if(v.access==='public')return v.draftChanged?'visibility.state.changed':editor?'visibility.state.publicEditor':'visibility.state.public';
 return 'visibility.state.private';
}
