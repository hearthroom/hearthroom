import {execFileSync} from 'node:child_process';
import {appendFileSync} from 'node:fs';
import {downloadBase,needsNativeRelease} from './release.mjs';
const git=(...args)=>execFileSync('git',args,{encoding:'utf8'}).trim();
let needed=process.env.GITHUB_EVENT_NAME==='workflow_dispatch';
if(!needed){
 const response=await fetch(`${downloadBase}/latest.json`,{headers:{'Cache-Control':'no-cache'},signal:AbortSignal.timeout(30000)});
 if(response.status===404)needed=true;
 else{
  if(!response.ok)throw Error('Cannot determine previous successful release.');
  const previous=await response.json();
  if(!/^[a-f0-9]{40}$/.test(previous.sourceSha))throw Error('Invalid previous source.');
  const head=git('rev-parse','HEAD');
  git('merge-base','--is-ancestor',previous.sourceSha,head);
  // A rerun of the published source can repair an interrupted latest pair.
  needed=previous.sourceSha===head || needsNativeRelease(git('diff','--name-only',previous.sourceSha,head,'--','android').split('\n'));
 }
}
appendFileSync(process.env.GITHUB_OUTPUT,`release-needed=${needed}\n`);
console.log(needed?'Native app release required.':'Distribution or website change only; keep the current APK.');
