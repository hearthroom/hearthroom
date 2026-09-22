import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {publishLatest,downloadBase} from './release.mjs';
if(process.env.GITHUB_REPOSITORY!=='hearthroom/hearthroom'||process.env.GITHUB_REF!=='refs/heads/main')throw Error('Only the authorized main workflow can publish.');
const artifact=JSON.parse(readFileSync('android/dist/latest.json'));
if(artifact.sourceSha!==process.env.GITHUB_SHA)throw Error('Source mismatch.');
const temp=mkdtempSync(join(tmpdir(),'hearthroom-release-'));
try{
 await publishLatest({apk:readFileSync('android/dist/latest.apk'),...artifact,notes:artifact.releaseNotes},{
  async read(key){
   const response=await fetch(`${downloadBase}/${key}`,{headers:{'Cache-Control':'no-cache, no-store'},signal:AbortSignal.timeout(60000)});
   if(response.status===404)return null;
   if(!response.ok)throw Error('Public release readback failed.');
   const cache=response.headers.get('cf-cache-status');
   if(cache==='HIT'||cache==='STALE'||cache==='UPDATING')throw Error('latest download URL must bypass CDN cache.');
   return Buffer.from(await response.arrayBuffer());
  },
  async write(key,bytes,type){
   const file=join(temp,key);writeFileSync(file,bytes);
   execFileSync('npx',['--no-install','wrangler','r2','object','put',`hearthroom-android/${key}`,'--file',file,'--content-type',type,'--cache-control','no-store, max-age=0','--remote'],{stdio:'inherit'});
  }
 });
 console.log(`Android release ${artifact.versionName}: public APK and manifest verified.`);
}finally{rmSync(temp,{recursive:true,force:true});}
