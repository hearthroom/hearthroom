import {readFileSync,writeFileSync,mkdirSync,readdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createManifest,buildNotes,downloadBase,locales} from './release.mjs';
const git=(...args)=>execFileSync('git',args,{encoding:'utf8'}).trim();
const repo=process.env.GITHUB_REPOSITORY;
const run=Number(process.env.GITHUB_RUN_NUMBER);
if(repo!=='hearthroom/hearthroom'||!Number.isSafeInteger(run)||run<1)throw Error('Expected the authorized Hearthroom release workflow.');
const sourceSha=git('rev-parse','HEAD');
if(sourceSha!==process.env.GITHUB_SHA)throw Error('Source SHA mismatch.');
const versionName=`1.0.${run}`,versionCode=10000+run,tag=`android-${versionName}`;
mkdirSync('android/dist',{recursive:true});
let existing;
try{existing=JSON.parse(execFileSync('gh',['release','view',tag,'--json','targetCommitish,tagName'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));}
catch(e){if(!String(e.stderr).includes('release not found'))throw e;}
if(existing){
 if(existing.targetCommitish!==sourceSha)throw Error('Existing release has another source.');
 execFileSync('gh',['release','download',tag,'--dir','android/dist','--pattern','latest.*','--clobber'],{stdio:'inherit'});
 const m=JSON.parse(readFileSync('android/dist/latest.json'));
 const actual=createManifest({apk:readFileSync('android/dist/latest.apk'),versionCode,versionName,sourceSha,notes:m.releaseNotes,publishedAt:m.publishedAt});
 if(JSON.stringify(m)!==JSON.stringify(actual))throw Error('Existing release artifact does not match manifest.');
}else{
 const response=await fetch(`${downloadBase}/latest.json`,{headers:{'Cache-Control':'no-cache'},signal:AbortSignal.timeout(15000)});
 if(response.status!==404&&!response.ok)throw Error('Cannot determine previous successful release.');
 const previous=response.status===404?null:await response.json();
 let files;
 if(previous){
  if(!/^[a-f0-9]{40}$/.test(previous.sourceSha)||previous.versionCode>=versionCode)throw Error('Stale or invalid previous release.');
  git('merge-base','--is-ancestor',previous.sourceSha,sourceSha);
  files=git('diff','--name-only','--diff-filter=AM',previous.sourceSha,sourceSha,'--','android/changes').split('\n').filter(Boolean);
 }else files=readdirSync('android/changes').filter(n=>n.endsWith('.json')).map(n=>'android/changes/'+n);
 const notes=buildNotes(files.map(f=>JSON.parse(readFileSync(f))));
 const apk=readFileSync('android/app/build/outputs/apk/release/app-release.apk');
 const manifest=createManifest({apk,versionCode,versionName,sourceSha,notes});
 writeFileSync('android/dist/latest.apk',apk);writeFileSync('android/dist/latest.json',JSON.stringify(manifest,null,2)+'\n');
 writeFileSync('android/dist/notes.md',locales.map(locale=>`### ${locale}\n\n${notes[locale]}\n`).join('\n'));
 execFileSync('gh',['release','create',tag,'android/dist/latest.apk','android/dist/latest.json','--target',sourceSha,'--title',`Hearthroom Android ${versionName}`,'--notes-file','android/dist/notes.md','--draft'],{stdio:'inherit'});
}
writeFileSync(process.env.GITHUB_OUTPUT,`tag=${tag}\n`,{flag:'a'});
