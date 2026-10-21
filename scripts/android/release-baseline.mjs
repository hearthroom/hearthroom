import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
const pinned=JSON.parse(readFileSync(new URL('./release-baselines.json',import.meta.url)));
const sha=value=>typeof value==='string'&&/^[a-f0-9]{40}$/.test(value);
/** A history rewrite requires an explicitly reviewed, full-tree-identical ancestor. */
export function resolveReleaseBaseline(previousSha,head,{cwd=process.cwd(),recoveries=pinned}={}) {
 if(!sha(previousSha)||!sha(head))throw Error('Invalid release baseline SHA.');
 const git=(...args)=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 const ensureCommit=commit=>{
  try{git('cat-file','-e',`${commit}^{commit}`);}
  catch{git('fetch','--no-tags','origin',commit);git('cat-file','-e',`${commit}^{commit}`);}
 };
 const ancestor=commit=>{
  try{git('merge-base','--is-ancestor',commit,head);return true;}
  catch(error){if(error.status===1)return false;throw error;}
 };
 ensureCommit(previousSha);
 if(ancestor(previousSha))return previousSha;
 const recovery=Object.hasOwn(recoveries,previousSha)?recoveries[previousSha]:null;
 if(!recovery||!sha(recovery.replacementSha)||!sha(recovery.treeSha))throw Error('No reviewed release baseline recovery for divergent history.');
 ensureCommit(recovery.replacementSha);
 if(git('rev-parse',`${previousSha}^{tree}`)!==recovery.treeSha||git('rev-parse',`${recovery.replacementSha}^{tree}`)!==recovery.treeSha)throw Error('Release baseline recovery tree mismatch.');
 if(!ancestor(recovery.replacementSha))throw Error('Recovered release baseline is not an ancestor of the release source.');
 return recovery.replacementSha;
}
