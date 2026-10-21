import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {resolveReleaseBaseline} from './release-baseline.mjs';
const env={...process.env,GIT_AUTHOR_NAME:'Fixture',GIT_AUTHOR_EMAIL:'fixture@example.invalid',GIT_COMMITTER_NAME:'Fixture',GIT_COMMITTER_EMAIL:'fixture@example.invalid'};
function fixture(t){
 const cwd=mkdtempSync(join(tmpdir(),'android-baseline-'));t.after(()=>rmSync(cwd,{recursive:true,force:true}));
 const git=(...a)=>execFileSync('git',a,{cwd,env,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 git('init','-q');writeFileSync(join(cwd,'release.txt'),'same published content');git('add','release.txt');
 const tree=git('write-tree');
 const previous=git('commit-tree',tree,'-m','original source');
 const replacement=git('commit-tree',tree,'-m','rewritten metadata');
 git('update-ref','refs/heads/main',replacement);git('symbolic-ref','HEAD','refs/heads/main');git('reset','--hard','HEAD');
 writeFileSync(join(cwd,'release.txt'),'new app');git('add','release.txt');git('commit','-qm','next release');
 const head=git('rev-parse','HEAD');
 const recoveries={[previous]:{replacementSha:replacement,treeSha:tree}};
 return {cwd,git,previous,replacement,head,recoveries};
}
test('ordinary ancestor remains the exact baseline',t=>{
 const f=fixture(t);assert.equal(resolveReleaseBaseline(f.replacement,f.head,{cwd:f.cwd,recoveries:{}}),f.replacement);
});
test('known rewritten source uses the pinned identical full tree and a current ancestor',t=>{
 const f=fixture(t);assert.equal(resolveReleaseBaseline(f.previous,f.head,f),f.replacement);
});
test('unknown divergent source fails closed',t=>{
 const f=fixture(t);assert.throws(()=>resolveReleaseBaseline(f.previous,f.head,{cwd:f.cwd,recoveries:{}}),/recovery/i);
});
test('mapping cannot substitute different published content',t=>{
 const f=fixture(t);f.recoveries[f.previous].replacementSha=f.head;
 assert.throws(()=>resolveReleaseBaseline(f.previous,f.head,f),/tree/i);
});
test('mapping cannot assert an unverified tree or skip replacement ancestry',t=>{
 const f=fixture(t);f.recoveries[f.previous].treeSha='a'.repeat(40);
 assert.throws(()=>resolveReleaseBaseline(f.previous,f.head,f),/tree/i);
 f.recoveries[f.previous].treeSha=f.git('rev-parse',`${f.previous}^{tree}`);
 const branch=f.git('commit-tree',f.recoveries[f.previous].treeSha,'-m','unrelated same tree');
 f.recoveries[f.previous].replacementSha=branch;
 assert.throws(()=>resolveReleaseBaseline(f.previous,f.head,f),/ancestor/i);
});
test('missing previous object is fetched from origin before full tree validation',t=>{
 const f=fixture(t),remote=join(f.cwd,'remote.git'),clone=join(f.cwd,'clone');
 f.git('init','--bare','-q',remote);f.git('remote','add','origin',remote);
 f.git('update-ref','refs/heads/old-release',f.previous);f.git('push','-q','origin','main','old-release');
 f.git('clone','-q','--no-local','--single-branch','--branch','main',remote,clone);
 assert.throws(()=>execFileSync('git',['cat-file','-e',`${f.previous}^{commit}`],{cwd:clone,stdio:'pipe'}));
 assert.equal(resolveReleaseBaseline(f.previous,f.head,{cwd:clone,recoveries:f.recoveries}),f.replacement);
});
